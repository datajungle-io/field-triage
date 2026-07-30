"""Generate the Open Graph / link-preview card at public/og.png.

A static PNG rather than next/og's ImageResponse: the card is the same for
every page, so rendering it per request buys nothing and adds a runtime
dependency that can fail in a way a committed file cannot. Re-run this when the
headline changes.

    python3 scripts/make-og-image.py

Mozilla Text is the face the dashboards use. Inter (the landing page face) is
not installed locally, and the product font is the more honest choice for a card
that represents the report.
"""

import pathlib

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
BG = (11, 17, 22)
TEXT = (232, 234, 237)
MUTED = (158, 163, 171)
LIME = (157, 211, 26)
RED = (240, 112, 112)
CARD = (21, 26, 33)
LINE = (37, 43, 52)

FONTS = pathlib.Path("/Users/wbrendanmcdonald/Business/data-jungle/datajungle-mozilla-fonts")
REPO = pathlib.Path(__file__).resolve().parent.parent


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def text_width(draw: ImageDraw.ImageDraw, s: str, f: ImageFont.FreeTypeFont) -> int:
    return int(draw.textbbox((0, 0), s, font=f)[2])


def wrap(draw, words: str, f, max_w: int) -> list[str]:
    lines, cur = [], ""
    for word in words.split():
        trial = f"{cur} {word}".strip()
        if text_width(draw, trial, f) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def main() -> None:
    img = Image.new("RGB", (W, H), BG)

    # The landing page's lime glow, top right. Drawn oversized and blurred so it
    # falls off smoothly instead of banding.
    glow = Image.new("RGB", (W, H), BG)
    ImageDraw.Draw(glow).ellipse([W - 520, -300, W + 260, 420], fill=(28, 44, 20))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(150)), 0.85)

    d = ImageDraw.Draw(img)
    M = 72  # margin

    # --- brand -------------------------------------------------------------
    mark = Image.open(REPO / "public" / "dj-logomark-email.png").convert("RGBA")
    mark = mark.resize((52, 52), Image.LANCZOS)
    img.paste(mark, (M, 56), mark)
    d.text((M + 68, 68), "Data Jungle", font=font("MozillaText-Bold.ttf", 34), fill=TEXT)

    # --- eyebrow -----------------------------------------------------------
    eyebrow_f = font("MozillaText-Bold.ttf", 21)
    d.ellipse([M, 193, M + 11, 204], fill=LIME)
    # Letter-spaced by hand; PIL has no tracking control.
    x = M + 26
    for ch in "FREE SALESFORCE AUDIT":
        d.text((x, 186), ch, font=eyebrow_f, fill=LIME)
        x += text_width(d, ch, eyebrow_f) + 2.6

    # --- headline ----------------------------------------------------------
    head_f = font("MozillaText-Bold.ttf", 72)
    lines = wrap(d, "Find the fields you can delete today.", head_f, W - 2 * M)
    y = 238
    for line in lines:
        d.text((M, y), line, font=head_f, fill=TEXT)
        y += 84

    # --- stat tiles --------------------------------------------------------
    # The same three figures as the landing hero mock, so a shared link and the
    # page it opens agree.
    tiles = [("822", "Fields scanned", TEXT), ("149", "Deletion candidates", RED),
             ("8", "No dependencies", LIME)]
    tw, gap, th = 320, 22, 118
    ty = H - M - th
    num_f, lab_f = font("MozillaText-Bold.ttf", 42), font("MozillaText-Regular.ttf", 20)
    for i, (value, label, colour) in enumerate(tiles):
        tx = M + i * (tw + gap)
        d.rounded_rectangle([tx, ty, tx + tw, ty + th], radius=12, fill=CARD, outline=LINE, width=1)
        d.text((tx + 22, ty + 20), value, font=num_f, fill=colour)
        d.text((tx + 22, ty + 76), label, font=lab_f, fill=MUTED)

    out = REPO / "public" / "og.png"
    img.save(out, "PNG", optimize=True)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB, {W}x{H})")


if __name__ == "__main__":
    main()
