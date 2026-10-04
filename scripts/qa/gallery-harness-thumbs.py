#!/usr/bin/env python3
"""Generate the thumbnail set for apps/desktop/qa/gallery-harness.html.

Writes 36 PNG thumbnails (12 shapes x 3 fixture images, including a 3:1
panorama and a 1:3 portrait) plus manifest.json into apps/desktop/qa/thumbs/.
The harness cycles through them with cache-busting query strings so a
1,000-item Vault decodes 1,000 distinct images. Requires Pillow.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_DIR = os.path.join(ROOT, "fixtures", "media")
OUT = os.path.join(ROOT, "apps", "desktop", "qa", "thumbs")
SOURCES = [
    "nasa-blue-marble.jpg",
    "gradient.png",
    "two-color.png",
    "grayscale.png",
    "solid-red.png",
    "transparent-logo.png",
]
# (width, height) at a 640 px long edge.
SHAPES = [
    (640, 213), (213, 640), (640, 480), (480, 640), (640, 640), (640, 360),
    (360, 640), (640, 427), (427, 640), (640, 320), (320, 640), (600, 640),
]


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    index = 0
    for width, height in SHAPES:
        for name in SOURCES[:2] + [SOURCES[index % len(SOURCES)]]:
            image = Image.open(os.path.join(SRC_DIR, name)).convert("RGBA")
            scale = max(width / image.width, height / image.height)
            image = image.resize(
                (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                Image.LANCZOS,
            )
            left = (image.width - width) // 2
            top = (image.height - height) // 2
            image = image.crop((left, top, left + width, top + height))
            ImageDraw.Draw(image).rectangle(
                [4, 4, 40, 40],
                fill=(index * 37 % 256, index * 91 % 256, index * 53 % 256, 255),
            )
            file_name = f"qa-{index:03d}.png"
            image.save(os.path.join(OUT, file_name), optimize=True)
            manifest.append({"file": file_name, "width": width, "height": height})
            index += 1
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle)
    print(f"{len(manifest)} thumbnails in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
