# -*- coding: utf-8 -*-
"""나레이션 트랙 배치 + 배경음악 덕킹 + 최종 mp4 합성 + SRT 자막 생성."""
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

WORK = os.environ.get("WORK", "work")
SR = 44100


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else f"{WORK}/final.mp4"
    tl = json.load(open(f"{WORK}/timeline.json"))
    music, _ = sf.read(f"{WORK}/music.wav", dtype="float32")
    n = len(music)
    voice = np.zeros(n, np.float32)
    lines = [ln for s in tl["scenes"] for ln in s["lines"]]
    for ln in lines:
        x, sr = sf.read(ln["wav"], dtype="float32")
        i0 = int(ln["start"] * SR)
        i1 = min(n, i0 + len(x))
        voice[i0:i1] += x[: i1 - i0]

    # 목소리 다듬기: 저역 정리 + 존재감 대역 살짝 강조 + 가벼운 공간감
    voice = sosfilt(butter(2, 90 / (SR / 2), "high", output="sos"), voice)
    pres = sosfilt(butter(2, [2500 / (SR / 2), 6000 / (SR / 2)], "band", output="sos"), voice)
    voice = voice + 0.35 * pres
    t = np.arange(int(0.6 * SR)) / SR
    ir = np.random.default_rng(3).standard_normal(len(t)) * np.exp(-t * 11)
    ir /= np.sqrt(np.sum(ir ** 2))
    voice = voice + 0.10 * fftconvolve(voice, ir)[:n]
    # 소프트 컴프레션
    voice = np.tanh(voice / (np.max(np.abs(voice)) + 1e-9) * 1.8) / np.tanh(1.8)

    # 덕킹: 나레이션 구간에서 음악 볼륨 낮춤
    env = np.zeros(n, np.float32)
    for ln in lines:
        env[int((ln["start"] - 0.25) * SR): int((ln["end"] + 0.3) * SR)] = 1
    k = int(0.35 * SR)
    ker = np.hanning(k)
    ker /= ker.sum()
    env = fftconvolve(env, ker, mode="same")
    duck = 1.0 - 0.62 * np.clip(env, 0, 1)
    mix = music * (0.55 * duck)[:, None] + (voice * 0.80)[:, None]
    mix /= max(1.0, np.max(np.abs(mix)) / 0.97)
    sf.write(f"{WORK}/mix.wav", mix.astype(np.float32), SR)

    with open(f"{WORK}/subtitles.srt", "w", encoding="utf-8") as f:
        for i, ln in enumerate(lines, 1):
            f.write(f"{i}\n{srt_time(ln['start'])} --> {srt_time(ln['end'] + 0.3)}\n{ln['text']}\n\n")

    # 유튜브 480p 에 맞는 2패스 인코딩(약 1.5Mbps) + 유튜브 권장 라우드니스 -14 LUFS
    venc = ["-vf", "hqdn3d=2:1.5:4:3", "-c:v", "libx264", "-preset", "slow", "-b:v", "1500k",
            "-passlogfile", f"{WORK}/x264pass"]
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{WORK}/video.mp4", *venc, "-pass", "1",
                    "-an", "-f", "mp4", os.devnull], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{WORK}/video.mp4", "-i", f"{WORK}/mix.wav",
                    *venc, "-pass", "2", "-maxrate", "2500k", "-bufsize", "5000k",
                    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000",
                    "-c:a", "aac", "-b:a", "160k", "-shortest",
                    "-movflags", "+faststart", out], check=True)
    print("wrote", out)


if __name__ == "__main__":
    main()
