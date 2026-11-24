# Writes the greeting across the top of private/greeting-card.jpg, on a soft cream fade -> private/greeting-card-captioned.jpg
# (a script can't send text and a picture as one message, so the text goes in the picture). Needs Pillow.
# Usage: python3 scripts/caption-card.py
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

priv = Path(__file__).resolve().parent.parent / "private"
card = Image.open(priv / "greeting-card.jpg").convert("RGB")
w, h = card.size
fade, size, color = 460, 88, (115, 51, 13)
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size, index=1)
emoji_font = ImageFont.truetype("/System/Library/Fonts/Apple Color Emoji.ttc", 160)  # the only size the bitmap font has
emoji = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
ImageDraw.Draw(emoji).text((0, 0), "🦃", font=emoji_font, embedded_color=True)
emoji = emoji.crop(emoji.getbbox()).resize((int(size * 1.1),) * 2)

left, right = "Happy Thanksgiving!  - Tom ", " (Jenn's Thanksgiving Agent)"
measure = ImageDraw.Draw(card)
lw, rw = measure.textlength(left, font=font), measure.textlength(right, font=font)
x = (w - (lw + emoji.width + rw)) / 2
out = card.convert("RGBA")
mask = Image.new("L", (w, fade))  # a light cream wash that eases out into the picture
for row in range(fade):
    t = min(1, (fade - row) / (fade - 90))
    mask.paste(int(255 * 0.80 * t * t * (3 - 2 * t)), (0, row, w, row + 1))
out.paste(Image.new("RGBA", (w, fade), (250, 240, 220, 255)), (0, 0), mask)
y = 55
glow = Image.new("L", out.size, 0)  # a soft cream halo so the words stay readable over the scene
ImageDraw.Draw(glow).text((x, y), left, font=font, fill=255)
ImageDraw.Draw(glow).text((x + lw + emoji.width, y), right, font=font, fill=255)
out.paste(Image.new("RGBA", out.size, (250, 240, 220, 255)), (0, 0), glow.filter(ImageFilter.GaussianBlur(14)))
d = ImageDraw.Draw(out)
d.text((x, y), left, font=font, fill=color)
out.paste(emoji, (int(x + lw), int(y + 5)), emoji)
d.text((x + lw + emoji.width, y), right, font=font, fill=color)
out.convert("RGB").save(priv / "greeting-card-captioned.jpg", quality=92)
