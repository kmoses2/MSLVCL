# 우크라이나 전쟁 — 흑해에서 돈바스까지 (지도 애니메이션 영상)

유튜브 업로드용 480p(854×480, 30fps) 해설 영상을 코드로 만든다.
지도를 중심으로 2014년 유로마이단·크림반도 병합부터 2025년까지의 흐름을 보여 준다.

- `output/ukraine_war_480p.mp4`: 완성 영상 (나레이션 + 배경음악 + 화면 자막)
- `output/subtitles.srt`: 유튜브에 따로 올릴 수 있는 자막 파일
- `output/narration_script.md`: 나레이션 대본 (다른 음성으로 다시 녹음할 때 사용)

## 구성

| 파일 | 역할 |
| --- | --- |
| `script.py` | 대본, 장면별 카메라 위치, 지도 위 요소(도시, 화살표, 점령 범위 등) |
| `tts.py` | 한국어 TTS(sherpa-onnx + mimic3 KSS 음성)로 나레이션을 만들고 타임라인 생성 |
| `music.py` | 배경음악을 직접 합성 (저작권 문제 없음) |
| `basemap.py` | Natural Earth 데이터로 고해상도 배경 지도 렌더링 |
| `render.py` | 프레임 렌더링 → ffmpeg 인코딩 |
| `mix.py` | 나레이션 배치, 음악 덕킹, 라우드니스(-14 LUFS) 맞춤, 최종 mp4 + SRT |

## 다시 만들기

```bash
pip install numpy pillow shapely scipy soundfile sherpa-onnx
# ffmpeg, fonts-noto-cjk 필요
export WORK=work GEO=geo TTS_MODEL=vits-mimic3-ko_KO-kss_low
# geo/ 에 Natural Earth geojson(ne_10m_admin_0_countries_ukr, ne_10m_admin_1_states_provinces,
#   ne_10m_rivers_lake_centerlines, ne_10m_lakes, ne_10m_coastline),
# TTS 모델은 k2-fsa/sherpa-onnx 릴리스(tts-models)의 vits-mimic3-ko_KO-kss_low
python3 tts.py && python3 music.py && python3 basemap.py
python3 render.py work/video.mp4 && python3 mix.py output/ukraine_war_480p.mp4
```

## 참고

- 지도의 점령 범위는 이해를 돕기 위한 **대략적인 표시**다.
- 무료로 쓸 수 있는 오프라인 한국어 TTS 음성을 써서 발음이 다소 기계적이다.
  더 자연스러운 나레이션이 필요하면 `narration_script.md` 대본으로 직접 녹음하거나
  다른 TTS로 음성을 만들고, `WORK/voice/*.wav` 파일을 바꾼 뒤 `tts.py` → `mix.py` 를 다시 실행하면 된다.
