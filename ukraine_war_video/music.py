# -*- coding: utf-8 -*-
"""배경음악 합성 (저작권 걱정 없는 자체 합성 음원).

D단조 기반의 시네마틱 앰비언트: 현악 패드 + 저음 드론 + 피아노 아르페지오 +
전쟁 장면용 타악(타이코 풍) + 장 전환 붐/라이저. 장면별 긴장도에 따라 층을 섞는다.
"""
import json
import os

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve, butter, sosfilt

WORK = os.environ.get("WORK", "work")
SR = 44100
rng = np.random.default_rng(7)

# 장면별 긴장도: 0 잔잔, 1 긴장, 2 전투
INTENSITY = {"title": 0, "intro": 0, "geo": 0, "ch1": 1, "maidan": 1, "ch2": 1, "crimea": 1,
             "ch3": 1, "donbas": 1, "ch4": 1, "buildup": 1, "ch5": 2, "invasion": 2, "kyiv": 2,
             "mariupol": 2, "ch6": 1, "blacksea": 1, "ch7": 2, "counter": 2, "ch8": 2,
             "attrition": 2, "kursk": 2, "ch9": 1, "now": 1, "outro": 0, "end": 0}

A4 = 440.0


def hz(midi):
    return A4 * 2 ** ((midi - 69) / 12)


# 코드 진행 (MIDI 음). 8초 단위.
CALM = [[50, 57, 62, 65], [46, 53, 58, 62], [41, 53, 57, 60], [48, 55, 60, 64]]   # Dm Bb F C
TENSE = [[50, 57, 62, 65], [46, 53, 58, 62], [43, 55, 58, 62], [45, 52, 57, 61]]  # Dm Bb Gm A
CHORD_LEN = 8.0


def lowpass(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), btype="low", output="sos")
    return sosfilt(sos, x)


def highpass(x, fc, order=2):
    sos = butter(order, fc / (SR / 2), btype="high", output="sos")
    return sosfilt(sos, x)


def saw(f, n, phase=0.0):
    t = np.arange(n) / SR
    return 2 * ((f * t + phase) % 1.0) - 1


def env_adsr(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na) ** 2
    e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def pad(total, chords_at):
    """chords_at: [(t0, t1, chord)] -> 현악 패드(스테레오)."""
    L = np.zeros(total)
    R = np.zeros(total)
    for t0, t1, ch in chords_at:
        i0, i1 = int(t0 * SR), min(total, int((t1 + 1.5) * SR))
        n = i1 - i0
        if n <= 0:
            continue
        e = env_adsr(n, 1.8, 2.2)
        for k, m in enumerate(ch):
            f = hz(m + 12 if k == 0 else m)
            for det, side in [(-0.12, 0), (0.0, 1), (0.13, 2)]:
                fd = f * 2 ** (det / 12)
                s = saw(fd, n, rng.random()) * 0.06
                if side == 0:
                    L[i0:i1] += s * e
                elif side == 2:
                    R[i0:i1] += s * e
                else:
                    L[i0:i1] += s * e * 0.7
                    R[i0:i1] += s * e * 0.7
    # 부드러운 현악 느낌을 위해 저역통과 + 느린 트레몰로
    L, R = lowpass(L, 1500), lowpass(R, 1500)
    t = np.arange(total) / SR
    trem = 1 + 0.08 * np.sin(2 * np.pi * 0.23 * t)
    return L * trem, R * trem


def drone(total, root_at):
    x = np.zeros(total)
    t = np.arange(total) / SR
    for t0, t1, ch in root_at:
        i0, i1 = int(t0 * SR), min(total, int((t1 + 1.0) * SR))
        n = i1 - i0
        f = hz(ch[0] - 12)
        tt = t[i0:i1]
        s = np.sin(2 * np.pi * f * tt) * 0.35 + np.sin(2 * np.pi * 2 * f * tt) * 0.08
        x[i0:i1] += s * env_adsr(n, 1.2, 1.5)
    return x


def piano_note(f, dur, vel=0.25):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for h, a in [(1, 1.0), (2, 0.45), (3, 0.22), (4, 0.1), (5, 0.05)]:
        s += a * np.sin(2 * np.pi * f * h * t * (1 + 0.0004 * h)) * np.exp(-t * (1.6 + h * 0.9))
    atk = np.minimum(1, t / 0.004)
    return s * atk * vel


def piano(total, chords_at, density):
    L = np.zeros(total)
    R = np.zeros(total)
    for t0, t1, ch in chords_at:
        if density(t0) <= 0:
            continue
        seq = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 24, ch[3] + 12, ch[1] + 24]
        step = 1.0
        k = 0
        tt = t0 + 0.5
        while tt < t1 - 0.2:
            if rng.random() < density(tt):
                m = seq[k % len(seq)]
                note = piano_note(hz(m), 3.5, 0.10 + 0.05 * rng.random())
                i0 = int(tt * SR)
                i1 = min(total, i0 + len(note))
                if i1 <= i0:
                    break
                pan = 0.5 + 0.35 * np.sin(k * 1.3)
                L[i0:i1] += note[: i1 - i0] * (1 - pan)
                R[i0:i1] += note[: i1 - i0] * pan
            k += 1
            tt += step
    return L, R


def taiko(n_len=1.6, f0=70, vel=1.0):
    n = int(n_len * SR)
    t = np.arange(n) / SR
    f = f0 * (1 + 1.2 * np.exp(-t * 30))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 4.5)
    click = lowpass(rng.standard_normal(n), 900) * np.exp(-t * 40) * 0.6
    return (body + click) * vel


def percussion(total, spans):
    """spans: [(t0,t1,level)] 전투 구간에 70BPM 타악 패턴."""
    x = np.zeros(total)
    beat = 60 / 70
    pattern = [1.0, 0, 0.45, 0, 0.8, 0.35, 0.45, 0]  # 8분음표 단위
    for t0, t1, lvl in spans:
        tt = t0
        k = 0
        while tt < t1:
            v = pattern[k % 8]
            if v:
                h = taiko(1.4, 62 if v > 0.7 else 85, v * lvl * 0.55)
                i0 = int(tt * SR)
                i1 = min(total, i0 + len(h))
                if i1 > i0:
                    x[i0:i1] += h[: i1 - i0]
            k += 1
            tt += beat / 2
    return x


def boom(total, times):
    x = np.zeros(total)
    for tm in times:
        h = taiko(4.0, 42, 1.0)
        sub = np.sin(2 * np.pi * 38 * np.arange(len(h)) / SR) * np.exp(-np.arange(len(h)) / SR * 1.2) * 0.8
        h = h + sub
        i0 = int(tm * SR)
        i1 = min(total, i0 + len(h))
        x[i0:i1] += h[: i1 - i0] * 0.8
        # 라이저(직전 2.5초 필터 노이즈 스웰)
        n = int(2.5 * SR)
        r0 = max(0, i0 - n)
        nz = rng.standard_normal(i0 - r0)
        nz = highpass(nz, 1800) * np.linspace(0, 1, i0 - r0) ** 3 * 0.12
        x[r0:i0] += nz
    return x


def wind(total):
    nz = rng.standard_normal(total)
    nz = lowpass(highpass(nz, 150), 700)
    t = np.arange(total) / SR
    return nz * (0.5 + 0.5 * np.sin(2 * np.pi * 0.05 * t)) * 0.035


def reverb(x, sec=3.2, wet=0.35):
    n = int(sec * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 6.9 / sec)
    ir = lowpass(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    y = fftconvolve(x, ir)[: len(x)]
    return x * (1 - wet) + y * wet * 1.4


def main():
    tl = json.load(open(f"{WORK}/timeline.json"))
    total_t = tl["total"] + 1.0
    total = int(total_t * SR)
    scenes = tl["scenes"]

    def intensity_at(tm):
        for s in scenes:
            if s["start"] <= tm < s["end"]:
                return INTENSITY.get(s["id"], 0)
        return 0

    chords = []
    tm = 0.0
    k = 0
    while tm < total_t:
        prog = CALM if intensity_at(tm + 1) == 0 else TENSE
        chords.append((tm, tm + CHORD_LEN, prog[k % 4]))
        tm += CHORD_LEN
        k += 1

    pL, pR = pad(total, chords)
    dr = drone(total, chords)
    piL, piR = piano(total, chords, lambda tt: {0: 0.85, 1: 0.35, 2: 0.0}[intensity_at(tt)])
    spans = []
    for s in scenes:
        lv = INTENSITY.get(s["id"], 0)
        if lv == 2:
            spans.append((s["start"], s["end"], 1.0))
        elif lv == 1 and s["kind"] == "map":
            spans.append((s["start"] + 1.0, s["end"], 0.35))
    perc = percussion(total, spans)
    booms = boom(total, [s["start"] for s in scenes if s["kind"] in ("card",)])
    wd = wind(total)

    # 긴장도에 따른 층별 게인 곡선(부드럽게)
    t = np.arange(total) / SR
    lvl = np.array([intensity_at(x) for x in np.arange(0, total_t, 0.1)])
    lvl = np.interp(t, np.arange(len(lvl)) * 0.1, lvl)
    k = int(2.0 * SR)
    ker = np.hanning(k)
    ker /= ker.sum()
    lvl = fftconvolve(lvl, ker, mode="same")
    pad_g = 0.9 + 0.25 * lvl
    drone_g = 0.6 + 0.35 * lvl

    L = pL * pad_g + dr * drone_g + piL + perc * 0.9 + booms + wd
    R = pR * pad_g + dr * drone_g + piR + perc * 0.9 + booms + wd * 0.9
    L, R = reverb(L), reverb(R)

    # 페이드 인/아웃
    fi, fo = int(2.5 * SR), int(6 * SR)
    L[:fi] *= np.linspace(0, 1, fi)
    R[:fi] *= np.linspace(0, 1, fi)
    L[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    R[-fo:] *= np.linspace(1, 0, fo) ** 1.5
    m = np.stack([L, R], 1)
    m /= np.max(np.abs(m)) + 1e-9
    sf.write(f"{WORK}/music.wav", (m * 0.89).astype(np.float32), SR)
    print("music", total_t)


if __name__ == "__main__":
    main()
