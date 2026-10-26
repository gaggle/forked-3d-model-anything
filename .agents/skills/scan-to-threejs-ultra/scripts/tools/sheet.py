#!/usr/bin/env python3
"""Contact sheet of photo/model pairs: sheet.py <room-id> <cmp dir> <out.jpg> <photo#...>"""
import sys
from PIL import Image
room, d, out, *ids = sys.argv[1:]
rows = [Image.open(f'{d}/ph-{room}-{n}-cmp.jpg') for n in ids]
rows = [r.resize((r.width * 2 // 3, r.height * 2 // 3)) for r in rows]
cols = 3; W = max(r.width for r in rows); H = max(r.height for r in rows)
s = Image.new('RGB', (W * cols + (cols - 1) * 8, (H + 8) * ((len(rows) + cols - 1) // cols)), 'white')
for i, r in enumerate(rows): s.paste(r, ((i % cols) * (W + 8), (i // cols) * (H + 8)))
s.save(out, quality=85)
