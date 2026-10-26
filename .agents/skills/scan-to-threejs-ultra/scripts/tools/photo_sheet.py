#!/usr/bin/env python3
"""Labelled thumbnail sheet of every prepared (upright) photo: photo_sheet.py <photos dir> <out.jpg> [cols]"""
import sys, glob
from PIL import Image, ImageDraw
src, out = sys.argv[1:3]; cols = int(sys.argv[3]) if len(sys.argv) > 3 else 12
fs = sorted(glob.glob(f'{src}/*.jpg')); tw, th = 120, 160
S = Image.new('RGB', (cols * tw, (len(fs) + cols - 1) // cols * th), 'black')
for i, f in enumerate(fs):
    im = Image.open(f); im.thumbnail((tw, th))
    S.paste(im, ((i % cols) * tw, (i // cols) * th)); ImageDraw.Draw(S).text(((i % cols) * tw + 3, (i // cols) * th + 3), str(i), fill='yellow')
S.save(out, quality=85)
