# WSTV Live 10s bumper - frames -> png sequence (25fps, 1280x720, supersampled 2x)
#
# usage:  python3 tools/make-bumper.py
#         ffmpeg -y -framerate 25 -i /tmp/vidbuild/frames/%04d.png \
#           -f lavfi -i "aevalsrc=0.10*sin(2*PI*220*t)+0.09*sin(2*PI*277.18*t)+0.09*sin(2*PI*329.63*t)+0.06*sin(2*PI*110*t):s=44100:d=10" \
#           -filter_complex "[1:a]afade=t=in:d=0.8,afade=t=out:st=8.8:d=1[a]" \
#           -map 0:v -map "[a]" -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -movflags +faststart -t 10 bumper.mp4
#
# needs: python3 + pillow. the 0-2.5s test card mirrors the 404 page design.
# 0-2.5s color bars test card -> wipe -> logo sting -> "you're watching" bug -> fade
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1280, 720
SS = 2
CW, CH = W * SS, H * SS
FPS = 25
FRAMES = FPS * 10
OUT = '/tmp/vidbuild/frames'
os.makedirs(OUT, exist_ok=True)
random.seed(42)

F_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
F_MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
f_wstv    = ImageFont.truetype(F_BOLD, 176)
f_sub     = ImageFont.truetype(F_MONO, 52)
f_osd     = ImageFont.truetype(F_MONO, 52)
f_typing  = ImageFont.truetype(F_MONO, 84)
f_bug     = ImageFont.truetype(F_BOLD, 58)

BRAND1, BRAND2 = (124, 92, 255), (255, 77, 141)
BARS = [(200,204,212),(205,211,27),(37,198,81),(34,195,214),(124,92,255),(224,64,123),(58,65,87)]

def lerp(a, b, t): return a + (b - a) * t
def clamp01(t): return max(0.0, min(1.0, t))
def ease_out_cubic(t): return 1 - (1 - t) ** 3
def ease_out_back(t, k=1.7):
    t -= 1
    return 1 + (k + 1) * t ** 3 + k * t ** 2

# ── prebuilt layers ────────────────────────────────────────
# color bars (2x)
bars = Image.new('RGB', (CW, CH), BARS[-1])
bd = ImageDraw.Draw(bars)
bw = CW / 7
for i, c in enumerate(BARS):
    bd.rectangle([round(i * bw), 0, round((i + 1) * bw) - 1, CH], fill=c)
bars = bars.convert('RGBA')

# scanline overlay (2x)
scan = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
sd = ImageDraw.Draw(scan)
for y in range(0, CH, 6):
    sd.rectangle([0, y, CW, y + 2], fill=(0, 0, 0, 42))

# dark bg with brand glow (2x)
bg = Image.new('RGB', (CW, CH), (10, 14, 23))
gd = ImageDraw.Draw(bg)
gd.ellipse([CW//2 - 900, CH//2 - 620, CW//2 + 900, CH//2 + 620], fill=(30, 22, 66))
gd.ellipse([CW//2 - 520, CH//2 - 360, CW//2 + 520, CH//2 + 360], fill=(46, 30, 92))
bg = bg.filter(ImageFilter.GaussianBlur(120)).convert('RGBA')

# logo tile: TV + antenna + play triangle, gradient fill, 512px tile
def make_logo_tile():
    big = 1024
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    # gradient tile
    grad = Image.new('RGB', (big, big))
    px = grad.load()
    for y in range(big):
        for x in range(big):
            t = (x + y) / (2 * big)
            px[x, y] = (int(lerp(BRAND1[0], BRAND2[0], t)), int(lerp(BRAND1[1], BRAND2[1], t)), int(lerp(BRAND1[2], BRAND2[2], t)))
    d = ImageDraw.Draw(img)
    # antenna (V) — draw on gradient too
    mask = Image.new('L', (big, big), 0)
    md = ImageDraw.Draw(mask)
    a_top = (big // 2, 210)
    md.line([(big // 2 - 165, 480), a_top], fill=255, width=58)
    md.line([(big // 2 + 165, 480), a_top], fill=255, width=58)
    md.rounded_rectangle([180, 420, big - 180, big - 140], radius=150, fill=255)
    img.paste(grad, (0, 0), mask)
    # play triangle (white)
    d = ImageDraw.Draw(img)
    d.polygon([(big // 2 - 90, 560), (big // 2 + 160, big // 2 + 150), (big // 2 - 90, big - 300)], fill=(255, 255, 255, 255))
    return img.resize((512, 512), Image.LANCZOS)

LOGO = make_logo_tile()

def logo_at(size, alpha=255):
    t = LOGO.resize((size, size), Image.LANCZOS)
    if alpha < 255:
        t = t.copy()
        a = t.getchannel('A').point(lambda v: v * alpha // 255)
        t.putalpha(a)
    return t

def text_alpha(img, xy, txt, font, fill, anchor='mm', alpha=255):
    if alpha <= 0: return
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = tuple(int(c * alpha / 255) for c in fill[:3]) + (alpha,)
    d.text(xy, txt, font=font, fill=f, anchor=anchor)
    img.alpha_composite(layer)

def letterspaced(img, cx, y, txt, font, fill, tracking, alpha=255):
    if alpha <= 0: return
    widths = [ImageDraw.Draw(Image.new('RGB', (10, 10))).textlength(c, font=font) for c in txt]
    total = sum(widths) + tracking * (len(txt) - 1)
    x = cx - total / 2
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = tuple(int(c * alpha / 255) for c in fill[:3]) + (alpha,)
    for c, w in zip(txt, widths):
        d.text((x, y), c, font=font, fill=f, anchor='lm')
        x += w + tracking
    img.alpha_composite(layer)

def draw_noise(img, n, strength):
    d = ImageDraw.Draw(img)
    for _ in range(n):
        x, y = random.randrange(CW), random.randrange(CH)
        v = random.randrange(40, 160)
        d.point((x, y), fill=(v, v, v, strength))

def osd_flicker(f):
    return (f // 3) % 9 != 8 and f > 12

# ── render ─────────────────────────────────────────────────
for f in range(FRAMES):
    t = f / FPS
    frame = bg.copy()

    # phase A: bars + osd (0 - 3.08s)
    if f <= 77:
        if f < 63:
            off = 0
        else:
            tt = clamp01((f - 63) / 14)
            off = -int(ease_out_cubic(tt) * CH)
        b = bars.copy()
        if osd_flicker(f):
            text_alpha(b, (120, 120), 'WSTV', f_osd, (255, 255, 255), anchor='lm')
        led = 0.55 + 0.45 * math.sin(2 * math.pi * f / 50)
        text_alpha(b, (CW - 320, 120), 'STANDBY', f_osd, (150, 160, 180), anchor='lm')
        ld = ImageDraw.Draw(b)
        la = int(led * 255)
        ld.ellipse([CW - 240, 120 - 14, CW - 212, 120 + 14], fill=(34, 197, 94, la))
        draw_noise(b, 260, 46)
        b.alpha_composite(scan)
        if off:
            frame.paste(b, (0, off), b)
        else:
            frame.alpha_composite(b)

    # phase B: logo sting (3.1 - 6s)
    if 78 <= f <= 167:
        tt = clamp01((f - 78) / 22)
        scale = ease_out_back(tt) if tt < 1 else 1.0
        size = int(430 * SS * scale)
        if 78 <= f < 152:
            if size > 8:
                tile = logo_at(size)
                frame.alpha_composite(tile, (CW // 2 - size // 2, int(CH * 0.40) - size // 2))
            # WSTV LIVE
            ta = int(clamp01((f - 96) / 19) * 255)
            ty = int(CH * 0.70 + (1 - ease_out_cubic(clamp01((f - 96) / 19))) * 40)
            text_alpha(frame, (CW // 2, ty), 'WSTV LIVE', f_wstv, (255, 255, 255), alpha=ta)
            # letterspaced subtitle
            sa = int(clamp01((f - 112) / 22) * 255)
            letterspaced(frame, CW // 2, int(CH * 0.82), 'WEBSOCKETS TELEVISION', f_sub, (160, 170, 195), 26, alpha=sa)
        else:
            # fading out, moving up
            tt2 = clamp01((f - 152) / 15)
            al = int((1 - tt2) * 255)
            size = int(430 * SS * (1 - 0.25 * tt2))
            tile = logo_at(size, al)
            frame.alpha_composite(tile, (CW // 2 - size // 2, int(CH * 0.40 - 0.06 * tt2 * CH) - size // 2))
            text_alpha(frame, (CW // 2, int(CH * 0.70 - 0.06 * tt2 * CH)), 'WSTV LIVE', f_wstv, (255, 255, 255), alpha=al)

    # phase C: typing (6.3s - end)
    if f >= 158:
        msg = "YOU'RE WATCHING WSTV"
        nchars = min(len(msg), max(0, (f - 158) // 2))
        shown = msg[:nchars]
        if nchars < len(msg) and (f // 6) % 2 == 0:
            shown += '_'
        if shown:
            text_alpha(frame, (CW // 2, int(CH * 0.44)), shown, f_typing, (235, 240, 250))

    # phase D: channel bug (7.5s - end)
    if f >= 188:
        ba = int(clamp01((f - 188) / 10) * 255)
        bsize = 110
        tile = logo_at(bsize, ba)
        frame.alpha_composite(tile, (90, 74))
        text_alpha(frame, (90 + bsize + 28, 74 + bsize // 2), 'WSTV LIVE', f_bug, (255, 255, 255), anchor='lm', alpha=ba)

    # global film grain
    draw_noise(frame, 90, 18)
    frame.alpha_composite(scan)

    # fade to black at the end
    if f >= 235:
        fa = int(255 * clamp01((f - 235) / 14))
        black = Image.new('RGBA', (CW, CH), (0, 0, 0, fa))
        frame.alpha_composite(black)

    frame.convert('RGB').resize((W, H), Image.LANCZOS).save(f'{OUT}/{f:04d}.png', optimize=True)
    if f % 50 == 0:
        print(f'frame {f}/{FRAMES}')

print('all frames done')
