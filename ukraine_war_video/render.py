# -*- coding: utf-8 -*-
"""타임라인에 맞춰 854x480 프레임을 그리고 ffmpeg 로 인코딩한다."""
import json
import math
import os
import pickle
import subprocess
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon

import script as S
from basemap import LON0, Y1, PPU_HI, PPU_LO, merc, polys

Image.MAX_IMAGE_PIXELS = None
WORK = os.environ.get("WORK", "work")
W, H = 854, 480
SS = 2  # 도형 슈퍼샘플링 배율
FPS = int(os.environ.get("FPS", 30))
FONT_DIR = "/usr/share/fonts/opentype/noto"


def font(size, weight="Bold", serif=False):
    fam = "NotoSerifCJK" if serif else "NotoSansCJK"
    return ImageFont.truetype(f"{FONT_DIR}/{fam}-{weight}.ttc", size, index=1)


F = {k: font(*v) for k, v in {
    "sub": (21, "Medium"), "city": (13, "Bold"), "city_big": (15, "Bold"), "date": (26, "Black"),
    "chap": (13, "Medium"), "stat_big": (30, "Black"), "stat_small": (13, "Medium"),
    "title": (54, "Black", True), "title_sub": (19, "Medium"), "card_num": (16, "Bold"),
    "card_title": (40, "Black", True), "card_years": (17, "Medium"), "note": (12, "Regular"),
    "icon": (11, "Bold"),
}.items()}
_lab_cache = {}


def lab_font(size):
    if size not in _lab_cache:
        _lab_cache[size] = font(size, "Bold")
    return _lab_cache[size]


# ------------------------------------------------------------------ 유틸
def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


def ease_io(x):
    x = clamp(x)
    return 0.5 - 0.5 * math.cos(math.pi * x)


def ease_out(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def catmull(pts, n=80):
    pts = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    segs = len(pts) - 3
    for i in range(segs):
        p0, p1, p2, p3 = [np.array(p, float) for p in pts[i:i + 4]]
        for t in np.linspace(0, 1, max(2, n // segs), endpoint=(i == segs - 1)):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.array(out)


# ------------------------------------------------------------------ 데이터 준비
TL = json.load(open(f"{WORK}/timeline.json"))
TOTAL = TL["total"]
SC_BY_ID = {s["id"]: s for s in S.SCENES}
GEO = pickle.load(open(f"{WORK}/geo.pkl", "rb"))


def area_geom(name, clip):
    if name == "crimea":
        g = GEO["crimea"]
    else:
        pts = S.AREAS[name]
        if name in S.SMOOTH_AREAS:
            pts = [tuple(p) for p in catmull(list(pts) + [pts[0]], 120)]
        g = Polygon(pts).buffer(0)
        if clip:
            g = g.intersection(GEO[clip])
    g = g.simplify(0.004)
    return [p for p in polys(g) if p.area > 1e-4]


AREA_CACHE = {}


def get_area(name, clip):
    k = (name, clip)
    if k not in AREA_CACHE:
        AREA_CACHE[k] = area_geom(name, clip)
    return AREA_CACHE[k]


def build_instances():
    """각 오버레이의 [t_in, t_out] 계산. 같은 key 가 장면 경계에서 이어지면 합친다."""
    inst = []
    by_key_open = {}
    for sc_t in TL["scenes"]:
        sc = SC_BY_ID[sc_t["id"]]
        s0, s1 = sc_t["start"], sc_t["end"]
        starts = [ln["start"] for ln in sc_t["lines"]]
        stats = []
        for at, fx in sc.get("fx", []):
            t_in = s0 if at == 0 else starts[min(at, len(starts) - 1)] - 0.1
            typ = fx["type"]
            if typ == "fade_area":
                for o in inst:
                    if o["key"] == fx["key"] and o["t_out"] >= t_in:
                        o["t_out"] = t_in + 1.2
                continue
            if typ == "swap_area":
                for o in inst:
                    if o["key"] == fx["from"] and o["t_out"] >= t_in:
                        o["t_out"] = t_in + 1.5
                src = next(o for o in inst if o["key"] == fx["from"])
                nfx = dict(src["fx"], key=fx["to"], area=fx["to"][2:])
                o = {"key": fx["to"], "fx": nfx, "t_in": t_in, "t_out": s1, "scene": sc["id"]}
                inst.append(o)
                by_key_open[fx["to"]] = o
                continue
            prev = by_key_open.get(fx["key"])
            if at == 0 and prev is not None and abs(prev["t_out"] - s0) < 1e-6:
                prev["t_out"] = s1
                continue
            o = {"key": fx["key"], "fx": fx, "t_in": t_in, "t_out": s1, "scene": sc["id"]}
            inst.append(o)
            by_key_open[fx["key"]] = o
            if typ == "stat":
                if stats:
                    stats[-1]["t_out"] = t_in
                stats.append(o)
    return inst


INST = build_instances()


def scene_at(t):
    for s in TL["scenes"]:
        if s["start"] <= t < s["end"]:
            return s
    return TL["scenes"][-1]


# ------------------------------------------------------------------ 카메라
def cam_lerp(a, b, u):
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u,
            math.exp(math.log(a[2]) + (math.log(b[2]) - math.log(a[2])) * u))


def scene_cam(sc, sc_t, t):
    """장면 내부 카메라: 시작 위치 -> (줄별 key 위치들) -> 천천히 드리프트."""
    s0, s1 = sc_t["start"], sc_t["end"]
    keys = sc.get("keys", [])
    if not keys:
        return cam_lerp(sc["cam"], sc["cam_end"], ease_io((t - s0) / (s1 - s0)))
    starts = [ln["start"] for ln in sc_t["lines"]]
    way = [(s0, sc["cam"])] + [(starts[i] - 0.4, c) for i, c in keys]
    way.append((s1, None))
    for k in range(len(way) - 1):
        if t < way[k + 1][0] or k == len(way) - 2:
            break
    ta, ca = way[k]
    tb = way[k + 1][0]
    def drifted(c, ta_, tb_, tt):
        u = clamp((tt - ta_) / max(0.1, tb_ - ta_))
        return (c[0], c[1], c[2] * (1 - 0.06 * ease_io(u)))
    here = drifted(ca, ta, tb, t)
    if k == 0:
        return here
    tp, cp = way[k - 1]
    prev = drifted(cp, tp, ta, ta)
    return cam_lerp(prev, here, ease_io((t - ta) / 2.2))


def camera(t):
    scenes = TL["scenes"]
    for i, s in enumerate(scenes):
        if s["start"] <= t < s["end"] or i == len(scenes) - 1:
            break
    sc = SC_BY_ID[s["id"]]
    here = scene_cam(sc, s, t)
    if i == 0:
        return here
    ps = scenes[i - 1]
    prev_end = scene_cam(SC_BY_ID[ps["id"]], ps, ps["end"])
    trans = min(2.4, (s["end"] - s["start"]) * 0.5)
    return cam_lerp(prev_end, here, ease_io((t - s["start"]) / trans))


# ------------------------------------------------------------------ 배경 지도
BASE_HI = None
BASE_LO = None


def load_bases():
    global BASE_HI, BASE_LO
    BASE_HI = Image.open(f"{WORK}/base_hi.png").convert("RGB")
    BASE_HI.load()
    BASE_LO = Image.open(f"{WORK}/base_lo.png").convert("RGB")
    BASE_LO.load()


class View:
    def __init__(self, cam):
        self.lon, self.lat, self.w = cam
        self.cy = merc(self.lat)
        self.h = self.w * H / W
        self.x0 = self.lon - self.w / 2
        self.ytop = self.cy + self.h / 2

    def px(self, lon, lat, ss=1):
        return ((lon - self.x0) / self.w * W * ss, (self.ytop - merc(lat)) / self.h * H * ss)

    def pts(self, coords, ss=SS):
        return [self.px(x, y, ss) for x, y in coords]

    @property
    def scale(self):  # 1경도 당 화면 px
        return W / self.w

    def base(self):
        if self.w * PPU_HI / W > 2.6:
            img, ppu = BASE_LO, PPU_LO
        else:
            img, ppu = BASE_HI, PPU_HI
        x0 = (self.x0 - LON0) * ppu
        y0 = (Y1 - self.ytop) * ppu
        box = (x0, y0, x0 + self.w * ppu, y0 + self.h * ppu)
        return img.resize((W, H), Image.BILINEAR, box=box, reducing_gap=2.0)


# ------------------------------------------------------------------ 후처리 자원
def make_vignette():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    return (1 - 0.55 * np.clip(d - 0.45, 0, 1) ** 1.6)[..., None]


VIG = make_vignette()
GRAIN = [np.random.default_rng(i).normal(0, 3.5, (H, W, 1)).astype(np.float32) for i in range(8)]
HATCH = None


def hatch_mask():
    im = Image.new("L", (W * SS, H * SS), 0)
    d = ImageDraw.Draw(im)
    step = 9 * SS
    for x in range(-H * SS, W * SS, step):
        d.line([(x, H * SS), (x + H * SS, 0)], fill=255, width=2 * SS)
    return im


# ------------------------------------------------------------------ 도형 그리기 (SS 배율 레이어)
def fade_of(o, t, fin=0.7, fout=0.7):
    return clamp((t - o["t_in"]) / fin) * clamp((o["t_out"] - t) / fout)


def draw_area(layer, v, fx, f, t):
    global HATCH
    if HATCH is None:
        HATCH = hatch_mask()
    geoms = get_area(fx["area"], fx.get("clip"))
    mask = Image.new("L", layer.size, 0)
    dm = ImageDraw.Draw(mask)
    for p in geoms:
        dm.polygon(v.pts(p.exterior.coords), fill=255)
        for h in p.interiors:
            dm.polygon(v.pts(h.coords), fill=0)
    col = fx["color"]
    a = np.asarray(mask, np.float32) / 255.0
    alpha = a * fx["alpha"]
    if fx.get("hatch"):
        alpha = alpha + a * (np.asarray(HATCH, np.float32) / 255.0) * 0.18
    alpha *= f * (0.92 + 0.08 * math.sin(t * 2.0))
    solid = Image.new("RGBA", layer.size, col + (0,))
    solid.putalpha(Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8)))
    layer.alpha_composite(solid)
    d = ImageDraw.Draw(layer)
    edge = tuple(min(255, c + 40) for c in col) + (int(210 * f),)
    for p in geoms:
        d.line(v.pts(p.exterior.coords) + [v.pts(p.exterior.coords)[0]], fill=edge, width=2 * SS,
               joint="curve")


def draw_polyline(d, pts, color, width, dashed=False, dash=14):
    if len(pts) < 2:
        return
    if not dashed:
        d.line([tuple(p) for p in pts], fill=color, width=width, joint="curve")
        return
    acc = 0.0
    on = True
    seg = [tuple(pts[0])]
    for a, b in zip(pts[:-1], pts[1:]):
        L = float(np.hypot(*(b - a)))
        pos = 0.0
        while L - pos > 1e-6:
            step = min(dash - acc, L - pos)
            pos += step
            acc += step
            q = a + (b - a) * (pos / L)
            seg.append(tuple(q))
            if acc >= dash - 1e-6:
                if on and len(seg) > 1:
                    d.line(seg, fill=color, width=width)
                on = not on
                acc = 0.0
                seg = [tuple(q)]
    if on and len(seg) > 1:
        d.line(seg, fill=color, width=width)


def draw_arrow(layer, v, fx, f, t, o):
    p = ease_out((t - o["t_in"]) / fx["dur"])
    if p <= 0:
        return
    curve = catmull(fx["path"], 90)
    pts = np.array([v.px(x, y, SS) for x, y in curve])
    seg = np.hypot(*(pts[1:] - pts[:-1]).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1] * p
    k = int(np.searchsorted(cum, L))
    k = max(1, min(k, len(pts) - 1))
    part = list(pts[:k])
    r = (L - cum[k - 1]) / max(1e-6, cum[k] - cum[k - 1])
    tip = pts[k - 1] + (pts[k] - pts[k - 1]) * clamp(r)
    part.append(tip)
    part = np.array(part)
    col = fx["color"]
    d = ImageDraw.Draw(layer)
    wid = int(max(3, min(7, v.scale / 40)) * SS)
    if not fx.get("dashed"):
        draw_polyline(d, part, col + (int(60 * f),), wid * 3)
    draw_polyline(d, part, col + (int(235 * f),), wid, fx.get("dashed"), dash=8 * SS)
    # 화살촉
    back = part[max(0, len(part) - 6)]
    dirv = tip - back
    n = np.hypot(*dirv)
    if n > 1e-3:
        dirv /= n
        nrm = np.array([-dirv[1], dirv[0]])
        hl = wid * 3.2
        tri = [tuple(tip + dirv * hl * 0.6), tuple(tip - dirv * hl + nrm * hl * 0.75),
               tuple(tip - dirv * hl - nrm * hl * 0.75)]
        d.polygon(tri, fill=col + (int(245 * f),))


def ring(d, c, r, color, width):
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], outline=color, width=width)


def disc(d, c, r, color):
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=color)


CITY_COL = {"dot": (235, 235, 235), "capital": (255, 215, 90), "red": (240, 80, 70),
            "blue": (90, 170, 255), "gold": (255, 205, 80), "siege": (240, 80, 70)}


def draw_city(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    c = v.px(fx["lon"], fx["lat"], SS)
    col = CITY_COL[fx["style"]]
    age = t - o["t_in"]
    if 0 < age < 1.6:  # 등장 시 퍼지는 원
        rr = (6 + 30 * ease_out(age / 1.6)) * SS
        ring(d, c, rr, col + (int(200 * (1 - age / 1.6) * f),), 2 * SS)
    pulse = 0.5 + 0.5 * math.sin(t * 3.0 + fx["lon"])
    disc(d, c, (7 + 3 * pulse) * SS, col + (int(55 * f),))
    r = (5 if fx["style"] == "capital" else 3.6) * SS
    disc(d, c, r + 1.5 * SS, (15, 15, 20, int(220 * f)))
    disc(d, c, r, col + (int(255 * f),))
    if fx["style"] == "capital":
        ring(d, c, r + 4 * SS, col + (int(230 * f),), 1 * SS + 1)
    if fx["style"] == "siege":
        # 회전하는 포위 링
        rr = 13 * SS
        for i in range(8):
            a0 = t * 40 + i * 45
            d.arc([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], a0, a0 + 25,
                  fill=(255, 90, 80, int(230 * f)), width=2 * SS)


def draw_blast(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    c = v.px(fx["lon"], fx["lat"], SS)
    age = t - o["t_in"]
    for k in range(3):
        a = (age - k * 0.45) % 2.2
        if age - k * 0.45 < 0:
            continue
        u = a / 2.2
        ring(d, c, (4 + 34 * ease_out(u)) * SS, (255, 150, 60, int(230 * (1 - u) * f)), 3 * SS)
    fl = math.exp(-((age % 2.2) * 5))
    disc(d, c, (6 + 10 * fl) * SS, (255, 220, 150, int((120 + 120 * fl) * f)))


def draw_ship(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    cx, cy = v.px(fx["lon"], fx["lat"], SS)
    age = t - o["t_in"]
    sunk = fx.get("sunk") and age > 1.8
    sink = clamp((age - 1.8) / 2.5) if fx.get("sunk") else 0
    s = 1.0 * SS
    dy = sink * 6 * SS
    col = (230, 90, 80) if not fx.get("sunk") else (210, 210, 220)
    a = int(255 * f * (1 - 0.6 * sink))
    hull = [(cx - 16 * s, cy - 2 * s + dy), (cx + 16 * s, cy - 2 * s + dy), (cx + 11 * s, cy + 5 * s + dy),
            (cx - 12 * s, cy + 5 * s + dy)]
    d.polygon(hull, fill=col + (a,))
    d.rectangle([cx - 6 * s, cy - 8 * s + dy, cx + 5 * s, cy - 2 * s + dy], fill=col + (a,))
    d.rectangle([cx - 1 * s, cy - 13 * s + dy, cx + 1 * s, cy - 8 * s + dy], fill=col + (a,))
    if fx.get("sunk"):
        if age > 1.2:
            draw_blast(layer, v, {"lon": fx["lon"], "lat": fx["lat"]}, f, t, {"t_in": o["t_in"] + 1.2})
        if sunk:
            for k in range(3):
                u = ((age - 1.8) * 0.6 + k / 3) % 1
                ring(d, (cx, cy + 3 * s), (8 + 22 * u) * SS, (150, 200, 255, int(150 * (1 - u) * f)), SS)
            w = 9 * SS
            d.line([(cx - w, cy - w - 18 * SS), (cx + w, cy + w - 18 * SS)], fill=(255, 70, 60, int(255 * f)), width=3 * SS)
            d.line([(cx - w, cy + w - 18 * SS), (cx + w, cy - w - 18 * SS)], fill=(255, 70, 60, int(255 * f)), width=3 * SS)


def draw_plane(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    age = t - o["t_in"]
    tx, ty = v.px(fx["lon"], fx["lat"], SS)
    # 서쪽에서 동쪽으로 날아오다 격추
    fly = clamp(age / 2.0)
    sx = tx - (1 - fly) * 160 * SS
    sy = ty - (1 - fly) * 40 * SS
    s = SS * 1.1
    if age < 2.0:
        col = (235, 235, 240, int(255 * f))
        d.polygon([(sx + 12 * s, sy), (sx - 10 * s, sy - 2 * s), (sx - 10 * s, sy + 2 * s)], fill=col)
        d.polygon([(sx + 1 * s, sy), (sx - 5 * s, sy - 11 * s), (sx - 7 * s, sy - 11 * s), (sx - 4 * s, sy)], fill=col)
        d.polygon([(sx + 1 * s, sy), (sx - 5 * s, sy + 11 * s), (sx - 7 * s, sy + 11 * s), (sx - 4 * s, sy)], fill=col)
        draw_polyline(d, np.array([[sx - 14 * s, sy], [sx - 90 * s, sy - 22 * s]]), (220, 220, 230, int(80 * f)), SS, True, 6 * SS)
    else:
        draw_blast(layer, v, fx, f, t, {"t_in": o["t_in"] + 2.0})


def draw_crowd(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    cx, cy = v.px(fx["lon"], fx["lat"], SS)
    rng = np.random.default_rng(5)
    n = int(160 * clamp((t - o["t_in"]) / 3))
    rad = 32 * SS
    for i in range(n):
        a = rng.random() * 2 * math.pi
        r = rad * math.sqrt(rng.random())
        jx = math.sin(t * 2 + i) * 1.5 * SS
        col = (70, 140, 255) if i % 2 else (255, 210, 60)
        disc(d, (cx + math.cos(a) * r + jx, cy + math.sin(a) * r * 0.7), 1.6 * SS, col + (int(210 * f),))


def draw_soldiers(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    spots = [(34.10, 44.95), (33.52, 44.60), (36.47, 45.36), (33.98, 45.05), (34.55, 45.55), (33.6, 45.1),
             (35.4, 45.05), (34.4, 44.7)]
    age = t - o["t_in"]
    for i, (lon, lat) in enumerate(spots):
        u = clamp((age - i * 0.35) / 0.6)
        if u <= 0:
            continue
        c = v.px(lon, lat, SS)
        for j in range(5):
            ox = (j - 2) * 5 * SS
            oy = ((j * 7) % 5 - 2) * 3 * SS
            disc(d, (c[0] + ox, c[1] + oy), 2.6 * SS * u, (80, 170, 80, int(235 * f)))


def unit_symbol(d, c, s, col, a):
    x, y = c
    d.rectangle([x - 9 * s, y - 6 * s, x + 9 * s, y + 6 * s], fill=(40, 12, 12, a), outline=col + (a,), width=max(1, int(1.6 * s)))
    d.line([(x - 9 * s, y - 6 * s), (x + 9 * s, y + 6 * s)], fill=col + (a,), width=max(1, int(1.6 * s)))
    d.line([(x - 9 * s, y + 6 * s), (x + 9 * s, y - 6 * s)], fill=col + (a,), width=max(1, int(1.6 * s)))


def draw_buildup(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    age = t - o["t_in"]
    for i, (lon, lat) in enumerate(S.BUILDUP):
        u = clamp((age - i * 0.9) / 0.8)
        if u <= 0:
            continue
        c = v.px(lon, lat, SS)
        pulse = 0.5 + 0.5 * math.sin(t * 3 + i)
        disc(d, c, (16 + 6 * pulse) * SS, (220, 50, 40, int(45 * f * u)))
        unit_symbol(d, c, SS * (0.6 + 0.4 * u), (240, 90, 80), int(240 * f * u))


def draw_para(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    cx, cy = v.px(fx["lon"], fx["lat"], SS)
    age = t - o["t_in"]
    for i in range(7):
        ph = ((age * 0.35) + i / 7) % 1
        x = cx + (i - 3) * 16 * SS + math.sin(age + i) * 4 * SS
        y = cy - (1 - ph) * 90 * SS
        a = int(230 * f * min(1, (1 - ph) * 4))
        r = 7 * SS
        d.pieslice([x - r, y - r, x + r, y + r], 180, 360, fill=(235, 235, 240, a))
        d.line([(x - r, y), (x, y + 10 * SS)], fill=(235, 235, 240, a), width=SS)
        d.line([(x + r, y), (x, y + 10 * SS)], fill=(235, 235, 240, a), width=SS)
        disc(d, (x, y + 11 * SS), 2 * SS, (240, 90, 80, a))


def draw_blockade(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    path = catmull([(33.3, 44.35), (32.2, 44.7), (31.2, 45.0), (30.2, 45.05), (29.75, 45.2)], 60)
    pts = np.array([v.px(x, y, SS) for x, y in path])
    p = ease_out((t - o["t_in"]) / 2.0)
    k = max(2, int(len(pts) * p))
    draw_polyline(d, pts[:k], (240, 80, 70, int(230 * f)), 3 * SS, True, 10 * SS)
    for lon, lat in [(32.4, 44.62), (29.95, 45.12)]:
        if p > 0.6:
            c = v.px(lon, lat, SS)
            unit_symbol(d, c, SS * 0.8, (240, 90, 80), int(230 * f))


def draw_dragon(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    front = [(34.9, 47.45), (35.4, 47.4), (35.85, 47.38), (36.2, 47.55), (36.6, 47.7), (37.0, 47.7)]
    p = ease_out((t - o["t_in"]) / 2.5)
    for k, off in enumerate([0.12, 0.28, 0.45]):
        pts = np.array([v.px(x, y - off, SS) for x, y in catmull(front, 50)])
        n = max(2, int(len(pts) * clamp(p * 1.4 - k * 0.2)))
        draw_polyline(d, pts[:n], (255, 150, 120, int(200 * f)), 2 * SS, True, 5 * SS)


def draw_line(layer, v, fx, f, t, o):
    d = ImageDraw.Draw(layer)
    pts = S.AREAS[fx["area"]][: fx["n"]]
    pp = np.array([v.px(x, y, SS) for x, y in pts])
    p = ease_out((t - o["t_in"]) / 2.0)
    n = max(2, int(len(pp) * p))
    draw_polyline(d, pp[:n], (255, 255, 255, int(230 * f)), 2 * SS, True, 7 * SS)


SHAPE_DRAW = {"area": None, "arrow": draw_arrow, "city": draw_city, "blast": draw_blast,
              "ship": draw_ship, "plane": draw_plane, "crowd": draw_crowd, "soldiers": draw_soldiers,
              "buildup": draw_buildup, "para": draw_para, "blockade": draw_blockade,
              "dragon": draw_dragon, "line": draw_line}


# ------------------------------------------------------------------ 텍스트 (1x)
def text_c(d, xy, s, fnt, fill, stroke=2, anchor="mm", spacing=0, sfill=(5, 8, 12)):
    if spacing:
        widths = [d.textlength(ch, font=fnt) for ch in s]
        total = sum(widths) + spacing * (len(s) - 1)
        x = xy[0] - total / 2 if anchor[0] == "m" else xy[0]
        for ch, wch in zip(s, widths):
            d.text((x, xy[1]), ch, font=fnt, fill=fill, anchor="l" + anchor[1], stroke_width=stroke,
                   stroke_fill=sfill + (fill[3],) if len(fill) == 4 else sfill)
            x += wch + spacing
        return
    d.text(xy, s, font=fnt, fill=fill, anchor=anchor, stroke_width=stroke,
           stroke_fill=sfill + (fill[3],) if len(fill) == 4 else sfill)


def wrap(d, s, fnt, maxw):
    words = s.split(" ")
    lines, cur = [], ""
    for w_ in words:
        cand = (cur + " " + w_).strip()
        if d.textlength(cand, font=fnt) <= maxw:
            cur = cand
        else:
            if cur:
                lines.append(cur)
            cur = w_
    if cur:
        lines.append(cur)
    return lines


def balanced_wrap(d, s, fnt, maxw):
    lines = wrap(d, s, fnt, maxw)
    if len(lines) == 2:  # 두 줄 길이를 비슷하게
        best = None
        words = s.split(" ")
        for i in range(1, len(words)):
            a, b = " ".join(words[:i]), " ".join(words[i:])
            la, lb = d.textlength(a, font=fnt), d.textlength(b, font=fnt)
            if la <= maxw and lb <= maxw:
                sc = abs(la - lb)
                if best is None or sc < best[0]:
                    best = (sc, [a, b])
        if best:
            lines = best[1]
    return lines


def draw_texts(frame, v, t, active, sc_t):
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # 지명 라벨
    for o, f in active:
        fx = o["fx"]
        a = int(255 * f)
        if a <= 0:
            continue
        if fx["type"] == "label":
            x, y = v.px(fx["lon"], fx["lat"])
            size = int(fx["size"] * clamp((v.scale / 45) ** 0.25, 0.8, 1.35))
            text_c(d, (x, y), fx["text"], lab_font(size), fx["color"] + (int(a * 0.95),), 2,
                   spacing=fx.get("spacing", 0))
        elif fx["type"] == "city":
            x, y = v.px(fx["lon"], fx["lat"])
            big = fx["style"] in ("capital",)
            fnt = F["city_big"] if big else F["city"]
            if fx.get("side") == "l":
                text_c(d, (x - 10, y), fx["name"], fnt, (240, 240, 240, a), 2, anchor="rm")
            else:
                text_c(d, (x + 10, y), fx["name"], fnt, (240, 240, 240, a), 2, anchor="lm")
        elif fx["type"] == "ship" and fx.get("label"):
            x, y = v.px(fx["lon"], fx["lat"])
            text_c(d, (x, y + 16), fx["label"], F["icon"], (235, 225, 225, a), 2, anchor="mt")
        elif fx["type"] == "plane" and t - o["t_in"] > 2.0:
            x, y = v.px(fx["lon"], fx["lat"])
            text_c(d, (x, y + 26), "MH17 격추", F["city"], (255, 200, 150, a), 2, anchor="mt")
        elif fx["type"] == "buildup":
            pass
    # 통계 카드 (오른쪽 위)
    for o, f in active:
        fx = o["fx"]
        if fx["type"] != "stat" or f <= 0:
            continue
        slide = (1 - ease_out(clamp((t - o["t_in"]) / 0.6))) * 30
        a = int(255 * f)
        bw = max(d.textlength(fx["big"], font=F["stat_big"]), d.textlength(fx["small"], font=F["stat_small"])) + 34
        x1 = W - 18 + slide
        x0 = x1 - bw
        y0, y1 = 64, 64 + 70
        d.rectangle([x0, y0, x1, y1], fill=(8, 12, 18, int(185 * f)))
        d.rectangle([x0, y0, x0 + 4, y1], fill=(242, 194, 48, a))
        d.text((x0 + 17, y0 + 8), fx["big"], font=F["stat_big"], fill=(255, 255, 255, a))
        d.text((x0 + 17, y0 + 48), fx["small"], font=F["stat_small"], fill=(200, 205, 215, a))

    # 날짜 배지 (왼쪽 위)
    sc = SC_BY_ID[sc_t["id"]]
    if sc.get("kind", "map") == "map" and sc.get("date"):
        date = sc["date"]
        chg = sc_t["start"]
        for o, f in active:
            if o["fx"]["type"] == "date" and o["t_in"] <= t and o["scene"] == sc["id"]:
                if o["t_in"] >= chg:
                    date, chg = o["fx"]["text"], o["t_in"]
        fs = clamp((t - sc_t["start"]) / 0.8) * clamp((sc_t["end"] - t) / 0.6)
        pop = ease_out(clamp((t - chg) / 0.5))
        a = int(255 * fs)
        d.rectangle([18, 18, 22, 70], fill=(242, 194, 48, a))
        text_c(d, (32, 36), date, F["date"], (255, 220, 120, int(a * pop)), 2, anchor="lm")
        text_c(d, (33, 61), sc.get("chapter", ""), F["chap"], (210, 215, 225, a), 2, anchor="lm")

    # 자막
    for ln in sc_t.get("lines", []):
        if ln["start"] - 0.15 <= t <= ln["end"] + 0.35:
            fa = clamp((t - ln["start"] + 0.15) / 0.25) * clamp((ln["end"] + 0.35 - t) / 0.25)
            lines = balanced_wrap(d, ln["text"], F["sub"], W - 90)
            lh = 30
            ytop = H - 22 - lh * len(lines)
            grad = Image.new("L", (1, 140))
            grad.putdata([int(200 * (i / 139) ** 1.5 * fa) for i in range(140)])
            band = Image.new("RGBA", (W, 140), (0, 0, 0, 255))
            band.putalpha(grad.resize((W, 140)))
            ov.alpha_composite(band, (0, H - 140))
            for i, s in enumerate(lines):
                text_c(d, (W / 2, ytop + lh * i + lh / 2), s, F["sub"], (255, 255, 255, int(255 * fa)), 2)
            break
    frame.alpha_composite(ov)


def draw_cards(frame, t, sc_t):
    sc = SC_BY_ID[sc_t["id"]]
    kind = sc.get("kind", "map")
    if kind == "map":
        return
    u = (t - sc_t["start"]) / (sc_t["end"] - sc_t["start"])
    fin = clamp((t - sc_t["start"]) / 0.9)
    fout = clamp((sc_t["end"] - t) / 0.8)
    f = fin * fout
    ov = Image.new("RGBA", (W, H), (0, 0, 0, int(150 * f)))
    d = ImageDraw.Draw(ov)
    a = int(255 * f)
    if kind == "title":
        sp = 18 - 10 * ease_out(u)
        text_c(d, (W / 2, H / 2 - 22), sc["title"], F["title"], (255, 240, 205, a), 0, spacing=int(sp))
        lw = int(260 * ease_out(clamp((t - sc_t["start"] - 0.5) / 1.5)))
        d.rectangle([W / 2 - lw / 2, H / 2 + 22, W / 2 + lw / 2, H / 2 + 24], fill=(242, 194, 48, a))
        text_c(d, (W / 2, H / 2 + 50), sc["subtitle"], F["title_sub"], (215, 220, 230, a), 0)
    elif kind == "card":
        text_c(d, (W / 2, H / 2 - 50), sc["num"], F["card_num"], (242, 194, 48, a), 0, spacing=6)
        sp = 10 - 7 * ease_out(u)
        text_c(d, (W / 2, H / 2 - 6), sc["title"], F["card_title"], (255, 255, 255, a), 0, spacing=int(sp))
        lw = int(200 * ease_out(clamp((t - sc_t["start"] - 0.3) / 1.2)))
        d.rectangle([W / 2 - lw / 2, H / 2 + 30, W / 2 + lw / 2, H / 2 + 31], fill=(242, 194, 48, a))
        text_c(d, (W / 2, H / 2 + 52), sc["years"], F["card_years"], (210, 215, 225, a), 0, spacing=2)
    elif kind == "end":
        text_c(d, (W / 2, H / 2 - 10), sc["title"], F["card_title"], (255, 245, 220, a), 0)
        text_c(d, (W / 2, H / 2 + 36), sc["note"], F["note"], (180, 185, 195, a), 0)
    frame.alpha_composite(ov)


# ------------------------------------------------------------------ 프레임
def render_frame(i):
    t = i / FPS
    sc_t = scene_at(t)
    v = View(camera(t))
    base = v.base().convert("RGBA")

    active = []
    for o in INST:
        if o["t_in"] - 0.01 <= t <= o["t_out"] + 0.8:
            ty = o["fx"]["type"]
            if ty in ("area",):
                f = fade_of(o, t, 1.2, 1.2)
            else:
                f = fade_of(o, t, 0.6, 0.7)
            if f > 0:
                active.append((o, f))

    layer = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
    for o, f in active:  # 영역 먼저
        if o["fx"]["type"] == "area":
            draw_area(layer, v, o["fx"], f, t)
    for o, f in active:
        fn = SHAPE_DRAW.get(o["fx"]["type"])
        if fn:
            fn(layer, v, o["fx"], f, t, o)
    layer = layer.resize((W, H), Image.LANCZOS)
    base.alpha_composite(layer)
    draw_texts(base, v, t, active, sc_t)
    draw_cards(base, t, sc_t)

    arr = np.asarray(base.convert("RGB"), np.float32)
    arr = arr * VIG + GRAIN[i % len(GRAIN)]
    # 살짝 대비를 올리고 따뜻한 톤
    arr = (arr - 128) * 1.06 + 128
    arr[..., 0] *= 1.02
    # 전체 페이드 인/아웃
    g = clamp(t / 1.2) * clamp((TOTAL - t) / 2.0)
    arr *= g
    return np.clip(arr, 0, 255).astype(np.uint8).tobytes()


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else f"{WORK}/video.mp4"
    frames = int(TOTAL * FPS)
    if os.environ.get("PREVIEW"):
        ts = [float(x) for x in os.environ["PREVIEW"].split(",")]
        load_bases()
        for tt in ts:
            b = render_frame(int(tt * FPS))
            Image.frombytes("RGB", (W, H), b).save(f"{WORK}/prev_{tt:06.1f}.png")
        return
    load_bases()
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
                           "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264",
                           "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", out],
                          stdin=subprocess.PIPE)
    with Pool(int(os.environ.get("JOBS", os.cpu_count()))) as pool:
        for k, b in enumerate(pool.imap(render_frame, range(frames), chunksize=6)):
            ff.stdin.write(b)
            if k % (FPS * 15) == 0:
                print(f"{k / FPS:6.1f}s / {TOTAL:.1f}s", file=sys.stderr, flush=True)
    ff.stdin.close()
    ff.wait()


if __name__ == "__main__":
    main()
