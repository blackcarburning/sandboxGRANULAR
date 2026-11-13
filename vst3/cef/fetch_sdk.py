#!/usr/bin/env python3
"""Download the exact official CEF SDK recorded in sdk-lock.json."""
import argparse,hashlib,json,pathlib,tarfile,urllib.parse,urllib.request
p=argparse.ArgumentParser();p.add_argument('platform',choices=['windows64','linux64','macosarm64','macosx64']);p.add_argument('destination',type=pathlib.Path);a=p.parse_args()
entry=json.loads(pathlib.Path(__file__).with_name('sdk-lock.json').read_text())[a.platform]
a.destination.mkdir(parents=True,exist_ok=True);archive=a.destination/entry['file']
if not archive.exists():urllib.request.urlretrieve('https://cef-builds.spotifycdn.com/'+urllib.parse.quote(entry['file']),archive)
assert archive.stat().st_size==entry['bytes']
assert hashlib.sha1(archive.read_bytes()).hexdigest()==entry['sha1']
with tarfile.open(archive) as t:
 for member in t.getmembers():
  target=(a.destination/member.name).resolve();assert target.is_relative_to(a.destination.resolve())
 t.extractall(a.destination,filter='data')
print(a.destination/entry['file'].removesuffix('.tar.bz2'))
