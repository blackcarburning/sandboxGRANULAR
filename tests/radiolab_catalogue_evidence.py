import argparse
import array
import concurrent.futures
import datetime
import importlib.util
import json
import math
import os
import pathlib
import subprocess
import sys
import tempfile
import time


sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('radiolab_catalogue_evidence', pathlib.Path(__file__).resolve().parents[1] / 'backend/mygrain_radiolab.py')
RADIO = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RADIO)
FETCH_SECONDS = 5
MAX_ENCODED_BYTES = 96 * 1024


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def fetch(station_id, output):
    station = RADIO.station_by_id(station_id)
    RADIO.CONNECT_TIMEOUT = 2
    RADIO.READ_TIMEOUT = 1.5
    result = {'id': station_id, 'name': station['name'], 'kind': station['kind'], 'url': station['url'],
              'sourceUrl': station.get('sourceUrl'), 'startedUtc': utc_now()}
    connection = response = None
    started = time.monotonic()
    try:
        connection, response, content_type = RADIO.open_station_stream(station)
        result.update(status=response.status, contentType=content_type, headers=dict(response.getheaders()))
        body = bytearray()
        while time.monotonic() - started < 3.3 and len(body) < MAX_ENCODED_BYTES:
            try:
                chunk = response.read1(min(8192, MAX_ENCODED_BYTES - len(body)))
            except TimeoutError:
                break
            if not chunk:
                break
            body.extend(chunk)
        (output / (station_id + '.encoded')).write_bytes(body)
        result['encodedBytes'] = len(body)
    except (OSError, ValueError) as error:
        result['error'] = type(error).__name__ + ': ' + str(error)
    finally:
        if response is not None:
            response.close()
        if connection is not None:
            connection.close()
    result['fetchSeconds'] = round(time.monotonic() - started, 3)
    print(json.dumps(result))


def probe(station_id, output):
    try:
        process = subprocess.run([sys.executable, __file__, '--fetch', station_id, '--output', str(output)],
                                 capture_output=True, text=True, timeout=FETCH_SECONDS)
        result = json.loads(process.stdout)
    except (subprocess.TimeoutExpired, ValueError) as error:
        return {'id': station_id, 'error': str(error), 'working': False}
    if result.get('encodedBytes', 0):
        encoded = output / (station_id + '.encoded')
        pcm = output / (station_id + '.s16le')
        environment = {**os.environ, 'GST_REGISTRY': str(output / (station_id + '.gst-registry.bin'))}
        try:
            decoder = subprocess.run([
                'gst-launch-1.0', '-q', 'filesrc', 'location=' + str(encoded), '!', 'decodebin', '!',
                'audioconvert', '!', 'audioresample', '!', 'audio/x-raw,format=S16LE,rate=16000,channels=1',
                '!', 'filesink', 'location=' + str(pcm),
            ], capture_output=True, text=True, timeout=5, env=environment)
            result.update(decoderExit=decoder.returncode, decoderStderr=decoder.stderr[-2000:])
            if pcm.exists():
                samples = array.array('h', pcm.read_bytes())
                if sys.byteorder != 'little':
                    samples.byteswap()
                peak = max((abs(value) for value in samples), default=0)
                rms = math.sqrt(sum(value * value for value in samples) / max(1, len(samples)))
                result.update(decodedFrames=len(samples), decodedSeconds=round(len(samples) / 16000, 3),
                              peak=peak, rms=round(rms, 3))
        except subprocess.TimeoutExpired:
            result['decoderError'] = 'Five-second offline decoder timeout.'
    result['working'] = result.get('decoderExit') == 0 and result.get('decodedFrames', 0) >= 4000 and result.get('rms', 0) > 0
    return result


def main():
    os.umask(0o077)
    station_ids = [station['id'] for station in RADIO.STATIONS]
    parser = argparse.ArgumentParser(description='Explicit, bounded, DNS-pinned catalogue probes; writes evidence only under the temporary directory.')
    parser.add_argument('--station', choices=station_ids, action='append', help='Catalogue ID; defaults to entries with official sourceUrl provenance.')
    parser.add_argument('--output', type=pathlib.Path, required=True, help='New directory under /tmp for private probe evidence.')
    parser.add_argument('--fetch', choices=station_ids, help=argparse.SUPPRESS)
    arguments = parser.parse_args()
    output = arguments.output.resolve()
    if not output.is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve()):
        parser.error('Evidence output must be under the temporary directory.')
    if arguments.fetch:
        fetch(arguments.fetch, output)
        return
    output.mkdir(mode=0o700)
    chosen = list(dict.fromkeys(arguments.station or [station['id'] for station in RADIO.STATIONS if station.get('sourceUrl')]))
    started = utc_now()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda station_id: probe(station_id, output), chosen))
    report = {'startedUtc': started, 'finishedUtc': utc_now(), 'fetchDeadlineSeconds': FETCH_SECONDS,
              'maxEncodedBytes': MAX_ENCODED_BYTES, 'decoderDeadlineSeconds': 5, 'maxConcurrentConnections': 2,
              'results': results}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    for result in results:
        print(json.dumps(result))
    raise SystemExit(0 if all(result['working'] for result in results) else 1)


if __name__ == '__main__':
    main()
