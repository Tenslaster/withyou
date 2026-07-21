#!/usr/bin/env python3
"""Generate WithYou app icons from Downloads/WithYou.png for Expo + PWA."""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    import subprocess

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
    from PIL import Image, ImageOps

SRC = Path(r"C:\Users\cedri\Downloads\WithYou.png")
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "withyou-app" / "assets"
WEB = ROOT / "server" / "web"
BG = (15, 10, 18, 255)


def to_square(img: Image.Image, size: int = 1024, bg=BG) -> Image.Image:
    w, h = img.size
    scale = max(size / w, size / h)
    nw, nh = max(1, int(w * scale + 0.5)), max(1, int(h * scale + 0.5))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left, top = (nw - size) // 2, (nh - size) // 2
    cropped = resized.crop((left, top, left + size, top + size))
    out = Image.new("RGBA", (size, size), bg)
    out.alpha_composite(cropped)
    return out


def contain(img: Image.Image, size: int, bg, pad: float = 0.12) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), bg)
    max_side = int(size * (1 - 2 * pad))
    w, h = img.size
    scale = min(max_side / w, max_side / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    r = img.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(r, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def main() -> int:
    if not SRC.is_file():
        print("Missing source:", SRC)
        return 1
    ASSETS.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)
    im = Image.open(SRC).convert("RGBA")
    print("source", im.size)

    to_square(im, 1024).save(ASSETS / "icon.png", "PNG")
    contain(im, 1284, BG, 0.08).save(ASSETS / "splash-icon.png", "PNG")
    contain(im, 1024, (0, 0, 0, 0), 0.18).save(
        ASSETS / "android-icon-foreground.png", "PNG"
    )

    # Soft pink → light blue gradient background for adaptive icon
    top = Image.new("RGB", (1, 2))
    top.putpixel((0, 0), (255, 182, 193))
    top.putpixel((0, 1), (186, 230, 253))
    top.resize((1024, 1024), Image.Resampling.BILINEAR).convert("RGBA").save(
        ASSETS / "android-icon-background.png", "PNG"
    )

    mono_src = to_square(im, 1024, (0, 0, 0, 0))
    alpha = mono_src.split()[3]
    mono = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    mono.putdata(
        [
            (0, 0, 0, 0) if a < 20 else (255, 255, 255, a)
            for a in alpha.getdata()
        ]
    )
    mono.save(ASSETS / "android-icon-monochrome.png", "PNG")

    to_square(im, 48).save(ASSETS / "favicon.png", "PNG")
    to_square(im, 192).save(WEB / "icon-192.png", "PNG")
    to_square(im, 512).save(WEB / "icon-512.png", "PNG")
    to_square(im, 1024).save(ASSETS / "icon-source.png", "PNG")

    for f in sorted(ASSETS.glob("*.png")):
        print(f.name, f.stat().st_size)
    print("web", (WEB / "icon-192.png").stat().st_size, (WEB / "icon-512.png").stat().st_size)
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
