"""Synthesises a sound bed for shorts.html: low drone + whooshes on cuts + booms on impacts.
Usage: python3 sfx.py out.wav"""
import sys, wave
import numpy as np

SR, DUR = 44100, 30.0
n = int(SR * DUR)
t = np.arange(n) / SR
rng = np.random.default_rng(7)
mix = np.zeros(n)

# drone: detuned low sines with slow swell, rising tension toward the eruptions
swell = 0.6 + 0.4 * np.clip((t - 10) / 7, 0, 1) - 0.3 * np.clip((t - 27) / 3, 0, 1)
for f, a in [(55, .5), (55.4, .4), (82.4, .25), (110, .12)]:
    mix += a * np.sin(2 * np.pi * f * t) * (0.8 + 0.2 * np.sin(2 * np.pi * 0.17 * t))
mix *= 0.09 * swell

def place(sig, at, gain):
    i = int(at * SR); j = min(n, i + len(sig))
    mix[i:j] += gain * sig[: j - i]

def whoosh(d=0.45):
    m = int(SR * d); x = rng.standard_normal(m)
    env = np.sin(np.pi * np.linspace(0, 1, m)) ** 2
    # sweeping one-pole low-pass
    cut = np.linspace(0.02, 0.35, m) ** 1.5
    y = np.zeros(m); acc = 0.0
    for k in range(m):
        acc += cut[k] * (x[k] - acc); y[k] = acc
    return y * env / (np.abs(y).max() + 1e-9)

def boom(d=1.6, f0=60, f1=32):
    m = int(SR * d); tt = np.arange(m) / SR
    f = f1 + (f0 - f1) * np.exp(-tt * 4)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-tt * 2.5)
    crack = rng.standard_normal(m) * np.exp(-tt * 18) * 0.5
    return body + crack

def pop(d=0.06):
    m = int(SR * d); tt = np.arange(m) / SR
    return np.sin(2 * np.pi * 900 * tt) * np.exp(-tt * 80)

for at in [2.0, 3.5, 5.0, 6.8, 8.5, 10.0, 19.5, 21.5, 23.0, 25.0, 27.0]:
    place(whoosh(), at - 0.22, 0.35)
for at in [14.0, 15.4, 16.3, 17.2]:
    place(boom(), at, 0.75)
place(boom(2.2, 45, 25), 20.4, 0.6)            # caldera collapse
place(boom(1.2, 90, 50), 24.0, 0.3)            # geyser burst
for at in [0.25, 2.0, 3.5, 5.0, 6.8, 8.5, 10.0, 12.2, 14.0, 15.4, 17.2, 19.5, 21.5, 23.0, 25.0, 27.0]:
    place(pop(), at, 0.08)

mix[-int(SR * .4):] *= np.linspace(1, 0, int(SR * .4))
mix = np.tanh(mix * 1.4) * 0.85
pcm = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'sfx.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
