# Generate resources/icon.png (128x128) for the 996WolScript extension.
# Design: rounded-square tile, indigo->violet diagonal gradient,
# bold white "996" monogram with an amber script-cursor accent.
from PIL import Image, ImageDraw, ImageFont

S = 1024          # render size (downscaled to 128 for anti-aliasing)
R = int(S * 0.22)  # corner radius

TOP_LEFT = (99, 102, 241)    # #6366F1 indigo
BOTTOM_RIGHT = (147, 51, 234)  # #9333EA purple
AMBER = (251, 191, 36)       # #FBBF24
WHITE = (255, 255, 255)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# --- diagonal gradient clipped to a rounded square ---
G = 64
grad = Image.new("RGB", (G, G))
gp = grad.load()
for gy in range(G):
    for gx in range(G):
        t = (gx + gy) / (2 * (G - 1))
        gp[gx, gy] = tuple(
            int(TOP_LEFT[i] + (BOTTOM_RIGHT[i] - TOP_LEFT[i]) * t) for i in range(3)
        )
grad = grad.resize((S, S), Image.BICUBIC)

mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=R, fill=255)
img.paste(grad, (0, 0), mask)

# subtle top sheen
sheen = Image.new("RGBA", (S, S), (0, 0, 0, 0))
sd = ImageDraw.Draw(sheen)
for y in range(S // 2):
    a = int(46 * (1 - y / (S / 2)))
    sd.line([(0, y), (S, y)], fill=(255, 255, 255, a))
img.paste(sheen, (0, 0), Image.composite(sheen.split()[3], Image.new("L", (S, S), 0), mask))

d = ImageDraw.Draw(img)

# --- "996" monogram ---
font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", int(S * 0.48))
text = "996"
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

# cursor bar geometry (script "cursor" accent after the digits)
bar_w = int(S * 0.18)
bar_h = int(S * 0.075)
gap = int(S * 0.045)

total_w = tw + gap + bar_w
x = (S - total_w) // 2 - bbox[0]
base_y = int(S * 0.68)  # baseline-ish alignment for text block
y = base_y - th - bbox[1] + int(S * 0.02)

d.text((x, y), text, font=font, fill=WHITE)

bar_x = x + bbox[2] + gap
bar_y = base_y - bar_h
d.rounded_rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h],
                    radius=bar_h // 2, fill=AMBER)

img = img.resize((128, 128), Image.LANCZOS)
img.save("resources/icon.png")
print("saved resources/icon.png", img.size)
