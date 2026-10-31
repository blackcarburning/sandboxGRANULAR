"""Small, account-local raster artwork. Called under the existing account lock."""
import hashlib
import io
import json
import os
import pathlib
import secrets
from urllib.parse import parse_qs, quote, urlsplit
from PIL import Image, ImageOps

MAX_UPLOAD = 2 * 1024 * 1024


def signature(path):
    stat = path.stat()
    return [stat.st_size, stat.st_mtime_ns, stat.st_ino]


def paths(root, name):
    root = pathlib.Path(root)
    if not isinstance(name, str) or pathlib.PurePosixPath(name).name != name or '\\' in name or name.startswith('.') or not name.lower().endswith('.wav'):
        raise ValueError('Choose a rendered WAV.')
    folder = root / '.artwork'
    if root.is_symlink() or folder.is_symlink() or (root / name).is_symlink():
        raise ValueError('Invalid artwork storage.')
    key = hashlib.sha256(name.encode()).hexdigest()
    result = [folder / (key + suffix) for suffix in ('.json', '.webp', '-thumb.webp')]
    if any(p.is_symlink() for p in result):
        raise ValueError('Invalid artwork storage.')
    return root / name, *result


def info(root, name):
    try:
        wav, meta, image, thumb = paths(root, name)
        if meta.stat().st_size > 4096:
            return None
        saved = json.loads(meta.read_text())
        if saved['signature'] != signature(wav) or not image.is_file() or not thumb.is_file():
            return None
        url = '/mygrain-wavs/api/art?filename=' + quote(name, safe='') + '&v=' + saved['version']
        return {**saved['image'], 'url': url, 'thumbnailUrl': url + '&thumbnail=1'}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def atomic(path, data):
    temp = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    try:
        temp.write_bytes(data)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def encode(image, size, cap):
    image = image.copy()
    image.thumbnail((size, size), Image.Resampling.LANCZOS)
    for quality in (78, 65, 50, 35):
        output = io.BytesIO()
        image.save(output, 'WEBP', quality=quality, method=4)
        data = output.getvalue()
        if len(data) <= cap:
            return data, image.size
    # High-entropy images still have a strict storage ceiling.
    return encode(image, size // 2, cap)


def save(root, name, data):
    wav, meta, image_path, thumb_path = paths(root, name)
    if not wav.is_file():
        raise FileNotFoundError('WAV not found.')
    if not 0 < len(data) <= MAX_UPLOAD:
        raise ValueError('Artwork must be under 2 MB after resizing.')
    with Image.open(io.BytesIO(data)) as source:
        if source.format not in ('JPEG', 'PNG', 'WEBP', 'GIF') or source.width * source.height > 25_000_000:
            raise ValueError('Use a PNG, JPEG, WebP or GIF image under 25 megapixels.')
        source.seek(0)
        image = ImageOps.exif_transpose(source).convert('RGBA' if 'A' in source.getbands() or 'transparency' in source.info else 'RGB')
        large, size = encode(image, 768, 128 * 1024)
        small, _ = encode(image, 96, 8 * 1024)
    meta.parent.mkdir(parents=True, exist_ok=True)
    atomic(image_path, large)
    atomic(thumb_path, small)
    atomic(meta, json.dumps({'signature': signature(wav), 'version': secrets.token_hex(12),
        'image': {'width': size[0], 'height': size[1], 'size': len(large), 'thumbnailSize': len(small)}}).encode())
    return info(root, name)


def rebind_after_replace(root, name, previous_signature):
    """Same logical WAV: retain art bytes/version, change only its audio binding."""
    wav, meta, image, thumb = paths(root, name)
    if not meta.is_file() or meta.stat().st_size > 4096:
        return
    try:
        saved = json.loads(meta.read_text())
    except (OSError, ValueError):
        return
    if not isinstance(saved, dict) or saved.get('signature') != previous_signature or not image.is_file() or not thumb.is_file():
        return
    saved['signature'] = signature(wav)
    atomic(meta, json.dumps(saved).encode())


def copy_art(source_root, source_name, target_root, target_name):
    if not info(source_root, source_name):
        return
    _, source_meta, image, thumb = paths(source_root, source_name)
    wav, meta, out_image, out_thumb = paths(target_root, target_name)
    saved = json.loads(source_meta.read_text())
    saved['signature'] = signature(wav)
    saved['version'] = secrets.token_hex(12)
    meta.parent.mkdir(parents=True, exist_ok=True)
    atomic(out_image, image.read_bytes())
    atomic(out_thumb, thumb.read_bytes())
    atomic(meta, json.dumps(saved).encode())


def delete(root, name):
    for path in paths(root, name)[1:]:
        path.unlink(missing_ok=True)


def rename(root, old, new):
    # The WAV has already moved; its identity/signature is unchanged.
    _, meta, image, thumb = paths(root, old)
    if not meta.exists():
        return
    wav, target_meta, target_image, target_thumb = paths(root, new)
    saved = json.loads(meta.read_text())
    if saved.get('signature') != signature(wav):
        delete(root, old)
        return
    for a, b in ((image, target_image), (thumb, target_thumb), (meta, target_meta)):
        os.replace(a, b)


def handle_request(handler, method, path, root):
    if path != '/api/art':
        return False
    query = parse_qs(urlsplit(handler.path).query)
    name = query.get('filename', [''])[0]
    try:
        if method == 'POST':
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_UPLOAD:
                raise ValueError('Artwork must be under 2 MB after resizing.')
            art = save(root, name, handler.rfile.read(length))
            handler.send_json({'ok': True, 'artwork': art}, extra_headers={'Cache-Control': 'no-store'})
        elif method in ('GET', 'HEAD'):
            if not info(root, name):
                handler.send_json({'ok': False, 'error': 'Artwork not found.'}, status=404)
            else:
                _, _, image, thumb = paths(root, name)
                handler.send_mygrain_bytes((thumb if query.get('thumbnail') == ['1'] else image).read_bytes(), 'image/webp')
        else:
            handler.send_json({'ok': False, 'error': 'Method not allowed.'}, status=405)
    except (ValueError, OSError, Image.DecompressionBombError) as error:
        handler.close_connection = True
        handler.send_json({'ok': False, 'error': str(error)}, status=400)
    return True
