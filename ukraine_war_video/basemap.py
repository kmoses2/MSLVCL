# -*- coding: utf-8 -*-
"""Natural Earth 데이터로 흑해·우크라이나 일대의 고해상도 배경 지도를 그린다.

메르카토르 투영. 결과: WORK/base_hi.png, WORK/base_lo.png, WORK/geo.pkl(영역 폴리곤)
"""
import json
import math
import os
import pickle

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from shapely.geometry import shape, box, Polygon, MultiPolygon, LineString, MultiLineString
from shapely.ops import unary_union

WORK = os.environ.get("WORK", "work")
GEO = os.environ.get("GEO", "geo")

LON0, LON1, LAT0, LAT1 = 14.0, 52.0, 36.0, 58.0
PPU_HI, PPU_LO = 180, 45


def merc(lat):
    return math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))


Y0, Y1 = merc(LAT0), merc(LAT1)

COLORS = {
    "UKR": (46, 62, 82), "RUS": (58, 36, 40), "BLR": (50, 42, 46),
    "default": (36, 42, 50),
}


def load(name):
    return json.load(open(f"{GEO}/{name}.geojson"))["features"]


def polys(g):
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in polys(x)]
    return []


def lines(g):
    if isinstance(g, LineString):
        return [g]
    if isinstance(g, MultiLineString):
        return list(g.geoms)
    if hasattr(g, "geoms"):
        return [p for x in g.geoms for p in lines(x)]
    return []


def to_px(coords, ppu):
    return [((x - LON0) * ppu, (Y1 - merc(max(-85, min(85, y)))) * ppu) for x, y in coords]


def draw_poly(dr, g, ppu, fill, hole_fill):
    for p in polys(g):
        dr.polygon(to_px(p.exterior.coords, ppu), fill=fill)
        for h in p.interiors:
            dr.polygon(to_px(h.coords, ppu), fill=hole_fill)


def value_noise(w, h, cell, seed):
    rng = np.random.default_rng(seed)
    gw, gh = w // cell + 2, h // cell + 2
    g = rng.random((gh, gw)).astype(np.float32)
    im = Image.fromarray((g * 255).astype(np.uint8)).resize((gw * cell, gh * cell), Image.BICUBIC)
    return np.asarray(im, dtype=np.float32)[:h, :w] / 255.0


def render(ppu, feats, geo):
    W = int((LON1 - LON0) * ppu)
    H = int((Y1 - Y0) * ppu)
    s = ppu / PPU_HI  # 선 굵기 스케일

    # --- 바다: 위아래 그라데이션 + 노이즈
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    sea = np.zeros((H, W, 3), np.float32)
    top, bot = np.array([14, 30, 48]), np.array([9, 20, 34])
    sea[:] = (top * (1 - yy) + bot * yy)[:, None, :].reshape(H, 1, 3)

    # --- 육지 마스크 및 국가별 색
    land = Image.new("L", (W, H), 0)
    col = Image.new("RGB", (W, H), (0, 0, 0))
    dl, dc = ImageDraw.Draw(land), ImageDraw.Draw(col)
    for a3, g in feats:
        c = COLORS.get(a3, COLORS["default"])
        draw_poly(dl, g, ppu, 255, 0)
        draw_poly(dc, g, ppu, c, (0, 0, 0))
    # 호수/저수지는 바다색
    lakes = Image.new("L", (W, H), 0)
    dlk = ImageDraw.Draw(lakes)
    for g in geo["lakes"]:
        draw_poly(dlk, g, ppu, 255, 0)
    lm = np.asarray(land, np.float32) / 255.0
    lk = np.asarray(lakes, np.float32) / 255.0
    lm = lm * (1 - lk)

    # 해안 근처 얕은 바다 느낌
    shallow = np.asarray(land.filter(ImageFilter.GaussianBlur(40 * s + 2)), np.float32) / 255.0
    sea += (np.array([28, 60, 88]) * np.clip(shallow * 1.6, 0, 1)[..., None]) * 0.55

    landc = np.asarray(col, np.float32)
    # 지형 느낌의 저주파 노이즈 + 미세 질감
    n1 = value_noise(W, H, max(8, int(160 * s)), 1)
    n2 = value_noise(W, H, max(3, int(28 * s)), 2)
    shade = 0.82 + 0.26 * n1 + 0.08 * (n2 - 0.5)
    landc = landc * shade[..., None]
    img = sea * (1 - lm[..., None]) + landc * lm[..., None]
    sea_n = value_noise(W, H, max(6, int(90 * s)), 3)
    img += ((sea_n - 0.5) * 6)[..., None] * (1 - lm[..., None])

    base = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert("RGBA")

    def overlay(draw_fn, blur=0):
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw_fn(ImageDraw.Draw(layer))
        if blur:
            layer = layer.filter(ImageFilter.GaussianBlur(blur))
        base.alpha_composite(layer)

    # 경위선
    def grat(d):
        for lon in range(16, 52, 2):
            d.line(to_px([(lon, LAT0), (lon, LAT1)], ppu), fill=(120, 160, 200, 18), width=max(1, int(2 * s)))
        for lat in range(36, 58, 2):
            d.line(to_px([(LON0, lat), (LON1, lat)], ppu), fill=(120, 160, 200, 18), width=max(1, int(2 * s)))
    overlay(grat)

    # 해안선 글로우
    def coast(d, w, c):
        for ln in geo["coast"]:
            d.line(to_px(ln.coords, ppu), fill=c, width=w)
    overlay(lambda d: coast(d, max(2, int(10 * s)), (90, 170, 230, 70)), blur=8 * s + 1)
    overlay(lambda d: coast(d, max(1, int(2 * s)), (110, 170, 215, 150)))

    # 강
    def rivers(d):
        for ln, rank in geo["rivers"]:
            w = max(1, int((5 if rank <= 3 else 3) * s))
            d.line(to_px(ln.coords, ppu), fill=(60, 120, 170, 200), width=w, joint="curve")
    overlay(rivers)
    # 호수 테두리
    overlay(lambda d: [d.line(to_px(p.exterior.coords, ppu), fill=(60, 120, 170, 160), width=max(1, int(2 * s)))
                       for g in geo["lakes"] for p in polys(g)])

    # 우크라이나 주 경계
    def oblasts(d):
        for g in geo["oblast_lines"]:
            for ln in lines(g):
                d.line(to_px(ln.coords, ppu), fill=(150, 170, 200, 70), width=max(1, int(2 * s)))
    overlay(oblasts)

    # 국경
    def borders(d):
        for g in geo["borders"]:
            for ln in lines(g):
                d.line(to_px(ln.coords, ppu), fill=(170, 175, 185, 150), width=max(1, int(3 * s)))
    overlay(borders)

    # 우크라이나 국경 강조(금빛 글로우)
    def ukr_border(d, w, c):
        for p in polys(geo["UKR"]):
            d.line(to_px(p.exterior.coords, ppu), fill=c, width=w, joint="curve")
    overlay(lambda d: ukr_border(d, max(3, int(16 * s)), (240, 190, 70, 90)), blur=10 * s + 1)
    overlay(lambda d: ukr_border(d, max(1, int(4 * s)), (240, 200, 90, 230)))
    return base.convert("RGB")


def main():
    os.makedirs(WORK, exist_ok=True)
    bb = box(LON0 - 1, LAT0 - 1, LON1 + 1, LAT1 + 1)
    feats = []
    geo = {}
    for f in load("ne_10m_admin_0_countries_ukr"):
        g = shape(f["geometry"])
        if not g.intersects(bb):
            continue
        a3 = f["properties"]["ADM0_A3"]
        g = g.intersection(bb)
        feats.append((a3, g))
        if a3 in ("UKR", "RUS"):
            geo[a3] = g
    # 국경선 = 국가 경계 중 해안이 아닌 부분
    bl = [g.boundary for _, g in feats]
    coast_lines = []
    for f in load("ne_10m_coastline"):
        g = shape(f["geometry"])
        if g.intersects(bb):
            coast_lines += lines(g.intersection(bb))
    coast_union = unary_union(coast_lines).buffer(0.02)
    geo["borders"] = [b.difference(coast_union) for b in bl]
    geo["coast"] = coast_lines

    geo["lakes"] = [shape(f["geometry"]).intersection(bb) for f in load("ne_10m_lakes")
                    if shape(f["geometry"]).intersects(bb)]
    geo["rivers"] = []
    for f in load("ne_10m_rivers_lake_centerlines"):
        g = shape(f["geometry"])
        rank = f["properties"].get("scalerank", 9) or 9
        if rank <= 7 and g.intersects(bb):
            for ln in lines(g.intersection(bb)):
                geo["rivers"].append((ln, rank))

    ob = []
    crimea = []
    for f in load("ne_10m_admin_1_states_provinces"):
        p = f["properties"]
        if p["name"] in ("Crimea", "Sevastopol") and p["adm0_a3"] == "RUS":
            crimea.append(shape(f["geometry"]))
        if p["adm0_a3"] == "UKR" or p["name"] in ("Crimea", "Sevastopol"):
            ob.append(shape(f["geometry"]).boundary)
    ukr_inner = geo["UKR"].buffer(-0.02)
    geo["oblast_lines"] = [b.intersection(ukr_inner) for b in ob]
    geo["crimea"] = unary_union(crimea).intersection(geo["UKR"].buffer(0.01))

    for ppu, name in [(PPU_LO, "lo"), (PPU_HI, "hi")]:
        im = render(ppu, feats, geo)
        im.save(f"{WORK}/base_{name}.png", compress_level=1)
        print(name, im.size)
    pickle.dump({"UKR": geo["UKR"], "RUS": geo["RUS"], "crimea": geo["crimea"]},
                open(f"{WORK}/geo.pkl", "wb"))


if __name__ == "__main__":
    main()
