# 보름달 코딩길

추석 특별판 3D 웹 게임. AI 코딩 라이브에서 배운 다섯 가지 습관을 관문 퀴즈로 복습합니다.

1. 말로 시키기
2. 모르면 추측 말고 물어보게 하기
3. 기획서(PRD)부터
4. 한 번에 하나씩
5. 깃허브에 저장하고 배포

- 이동: WASD / 방향키, 모바일은 왼쪽 조이스틱
- 퀴즈: 등불 가까이에서 E / 스페이스, 모바일은 오른쪽 버튼

## 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 에 정적 빌드
```

## Vercel 배포

Vercel에서 이 저장소를 Import 하고 **Root Directory** 를 `chuseok-game` 으로 지정하면 Vite 프리셋이 자동으로 잡힙니다 (Build: `npm run build`, Output: `dist`).
