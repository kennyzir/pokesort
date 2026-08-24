from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

NAVY = "#151c35"
CREAM = "#fffdf7"
YELLOW = "#ffd947"
RED = "#ef5a5a"
BLUE = "#4768ff"
MUTED = "#c4cce2"


def draw_mark(size: int, safe: float = 0.0) -> Image.Image:
    image = Image.new("RGB", (size, size), YELLOW)
    draw = ImageDraw.Draw(image)
    pad = int(size * safe)
    if safe:
        radius = int(size * 0.2)
        draw.rounded_rectangle((pad, pad, size - pad, size - pad), radius=radius, fill=YELLOW)
    cx = cy = size / 2
    r = size * (0.34 if safe else 0.35)
    line = max(2, round(size * 0.078))
    bbox = (cx - r, cy - r, cx + r, cy + r)
    draw.ellipse(bbox, fill=CREAM, outline=NAVY, width=line)
    draw.pieslice(bbox, 180, 360, fill=RED)
    draw.arc(bbox, 0, 360, fill=NAVY, width=line)
    band = max(3, round(size * 0.11))
    draw.rectangle((cx - r, cy - band / 2, cx + r, cy + band / 2), fill=NAVY)
    button_r = size * 0.125
    draw.ellipse((cx-button_r, cy-button_r, cx+button_r, cy+button_r), fill=CREAM, outline=NAVY, width=max(2, round(size * 0.055)))
    dot = size * 0.038
    draw.ellipse((cx-dot, cy-dot, cx+dot, cy+dot), fill=BLUE)
    return image


def font(size: int, bold: bool = False):
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


for size, name in [(16, "favicon-16x16.png"), (32, "favicon-32x32.png"), (48, "favicon-48x48.png"), (96, "favicon-96x96.png"), (180, "apple-touch-icon.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    draw_mark(size).save(ASSETS / name, optimize=True)

draw_mark(512, safe=0.1).save(ASSETS / "icon-maskable-512.png", optimize=True)

# Pillow creates the requested ICO directory entries by downscaling the source
# image. Saving the former 16px source silently produced a one-frame 16px ICO.
ico_sizes = [(16, 16), (32, 32), (48, 48), (96, 96)]
ico_source = draw_mark(96)
ico_source.save(ASSETS / "favicon.ico", format="ICO", sizes=ico_sizes)
ico_source.save(ROOT / "favicon.ico", format="ICO", sizes=ico_sizes)

card = Image.new("RGB", (1200, 630), NAVY)
draw = ImageDraw.Draw(card)
draw.ellipse((900, -180, 1320, 240), fill=YELLOW)
mark = draw_mark(220)
card.paste(mark, (870, 270))
draw.text((80, 92), "DAILY POKÉMON PUZZLE", font=font(40, True), fill=YELLOW)
draw.text((80, 215), "POKE", font=font(112, True), fill="white")
poke_width = draw.textbbox((0, 0), "POKE", font=font(112, True))[2]
draw.text((80 + poke_width, 215), "SORT", font=font(112, True), fill=YELLOW)
draw.text((84, 375), "Find four groups. Protect your streak.", font=font(35), fill=MUTED)
card.save(ASSETS / "social-card.png", optimize=True)

print("Generated favicon, Apple, PWA, maskable, and social preview PNG assets.")
