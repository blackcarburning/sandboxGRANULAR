#!/usr/bin/env python3
"""Unpack only the frozen public frontend fixture, never account data."""
import pathlib,json,hashlib,zipfile,sys
src=pathlib.Path(__file__).parent;dest=pathlib.Path(sys.argv[1]);info=json.loads((src/'current-app.json').read_text());archive=src/'current-app.zip'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==info['zipSha256']
with zipfile.ZipFile(archive) as z:
 assert set(z.namelist())==set(info['files'])
 for name,digest in info['files'].items():
  body=z.read(name);assert hashlib.sha256(body).hexdigest()==digest
  p=(dest/name).resolve();assert p.is_relative_to(dest.resolve());p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
print('CEF test app:',info['build'],len(info['files']),'verified public files')
