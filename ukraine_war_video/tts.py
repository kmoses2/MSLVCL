# -*- coding: utf-8 -*-
"""나레이션 음성 합성과 타임라인 생성.

sherpa-onnx + vits-mimic3 한국어(KSS) 모델로 각 줄을 합성하고,
장면·줄 단위의 시작/끝 시각을 timeline.json 으로 저장한다.
"""
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from script import SCENES

WORK = os.environ.get("WORK", "work")
MODEL = os.environ.get("TTS_MODEL", "vits-mimic3-ko_KO-kss_low")
SR = 44100

DIG = "영일이삼사오육칠팔구"


def sino(n):
    """정수를 한자어 수사로 (예: 2014 -> 이천십사)."""
    if n == 0:
        return "영"
    out = ""
    big = [(100000000, "억"), (10000, "만")]
    for unit, name in big:
        if n >= unit:
            q, n = divmod(n, unit)
            out += ("" if (q == 1 and name == "만") else sino(q)) + name + " "
    for unit, name in [(1000, "천"), (100, "백"), (10, "십")]:
        if n >= unit:
            q, n = divmod(n, unit)
            out += ("" if q == 1 else DIG[q]) + name
    if n:
        out += DIG[n]
    return out.strip()


def to_speech(text):
    t = text.replace("·", " ").replace("—", ",").replace("~", "에서 ")
    t = re.sub(r"(\d),(\d{3})", r"\1\2", t)
    t = t.replace("6월", "유월").replace("10월", "시월")
    t = re.sub(r"(\d+)%", lambda m: "퍼센트 " + m.group(1), t)
    t = re.sub(r"\d+", lambda m: sino(int(m.group(0))) + " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def main():
    import sherpa_onnx
    os.makedirs(f"{WORK}/voice", exist_ok=True)
    cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(
            model=f"{MODEL}/ko_KO-kss_low.onnx", tokens=f"{MODEL}/tokens.txt",
            data_dir=f"{MODEL}/espeak-ng-data", noise_scale=0.45, noise_scale_w=0.55),
        num_threads=4))
    tts = sherpa_onnx.OfflineTts(cfg)

    t = 0.0
    timeline = []
    for sc in SCENES:
        kind = sc.get("kind", "map")
        entry = {"id": sc["id"], "kind": kind, "start": t, "lines": []}
        if kind != "map":
            t += sc["dur"]
        else:
            t += 1.0  # 장면 전환 후 숨 고르기
            for i, ln in enumerate(sc["lines"]):
                sub, say = (ln if isinstance(ln, tuple) else (ln, to_speech(ln)))
                if isinstance(ln, tuple):
                    say = to_speech(say)
                path = f"{WORK}/voice/{sc['id']}_{i:02d}.wav"
                if not os.path.exists(path):
                    a = tts.generate(say, sid=0, speed=0.92)
                    x = np.asarray(a.samples, dtype=np.float32)
                    x = resample_poly(x, SR, a.sample_rate).astype(np.float32)
                    # 앞뒤 무음 정리
                    nz = np.where(np.abs(x) > 0.01)[0]
                    if len(nz):
                        x = x[max(0, nz[0] - 800): nz[-1] + 2000]
                    sf.write(path, x, SR)
                dur = sf.info(path).duration
                entry["lines"].append({"text": sub, "say": say, "start": t, "end": t + dur,
                                       "wav": path})
                t += dur + 0.55
            t += 0.9
        entry["end"] = t
        timeline.append(entry)
        print(f"{sc['id']:10s} {entry['start']:7.1f} -> {t:7.1f}", file=sys.stderr)
    json.dump({"total": t, "scenes": timeline}, open(f"{WORK}/timeline.json", "w"),
              ensure_ascii=False, indent=1)
    print(f"total {t:.1f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
