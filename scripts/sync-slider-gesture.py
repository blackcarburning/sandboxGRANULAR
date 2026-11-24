"""Embed the shared gesture owner before application startup, without a request."""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
page = root / 'index.html'
code = (root / 'slider-gesture.js').read_text().strip()
text, count = re.subn(r'<script id="mygrain-slider-gesture">[\s\S]*?</script>', lambda _: '<script id="mygrain-slider-gesture">\n' + code + '\n</script>', page.read_text())
assert count == 1, 'Expected one early shared gesture script'
page.write_text(text)
