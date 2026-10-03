# 말씀 암송 NIV

NIV 성경 구절을 소리 내어 외우면, 본문과 한 단어씩 맞춰 보고 틀린 곳을 표시해 주는 웹앱입니다.
휴대폰 브라우저에서 바로 쓰고, 홈 화면에 추가하면 앱처럼 열립니다.

## 쓰는 법

1. 구절을 고르고 마이크 버튼을 누른 뒤 영어로 암송합니다. 다 했으면 빨간 버튼을 누릅니다.
2. 결과 화면에서 틀린 곳을 확인합니다.
   - 틀린 단어: 빨간 글씨, 위에 작게 들린 말
   - 빠뜨린 단어: 빨간 점선 상자
   - 본문에 없는 말: 주황색 취소선
3. 마이크가 잘못 알아들은 단어는 눌러서 맞음으로 바꿀 수 있습니다.
4. 최근 3번을 연속으로 100% 맞히면 ‘암송 완료’가 됩니다.

연습할 때는 본문을 가리기(단어 길이만큼 빈칸) / 첫 글자 / 전체 보기로 바꿔 볼 수 있고, ‘듣기’로 본문을 읽어 줍니다.
마이크를 쓸 수 없을 때는 키보드로 입력해서 채점할 수도 있습니다.

## 채점 규칙

| 구분 | 내용 |
| --- | --- |
| 틀림으로 보는 것 | 단어가 하나라도 다르면 틀림. `plans` ↔ `plan`, `submit to` ↔ `acknowledge`(NIV 1984 표현) |
| 보지 않는 것 | 대소문자, 문장부호, 숫자 표기(`1` ↔ `one`), 붙여 쓰기(`every one` ↔ `everyone`), 영국식 철자(`honour` ↔ `honor`) |
| 음성일 때만 맞게 보는 것 | 소리가 같은 단어(`Son` ↔ `sun`, `peace` ↔ `piece`). 마이크로는 구별할 수 없기 때문입니다. |
| 장절 | “John three sixteen”처럼 앞뒤에 말해도 채점하지 않습니다. |

점수는 `맞은 단어 ÷ (본문 단어 + 본문에 없는 말)`이며, 모든 단어가 맞아야만 100%가 됩니다.

## 구절 추가

YouVersion(성경 앱)이나 BibleGateway에서 번역본을 NIV로 고른 뒤 본문을 복사해 붙여넣으세요.
절 번호, 각주 표시(`[a]`, `(A)`), 링크, “John 3:16 NIV” 같은 줄은 자동으로 지워지고 장절 칸도 채워집니다.
한 단어씩 채점하므로 저장하기 전에 본문이 정확한지 확인해 주세요.

## 브라우저

- iPhone: Safari. 설정 › 일반 › 키보드에서 받아쓰기가 켜져 있어야 할 수 있습니다.
- Android, PC: Chrome 또는 Edge
- 카카오톡 같은 앱 안의 브라우저에서는 음성 인식이 안 될 수 있습니다. 메뉴에서 다른 브라우저로 여세요.
- 음성은 브라우저의 음성 인식 서비스(Chrome은 Google, Safari는 Apple)로 보내져 글자로 바뀝니다. 인터넷 연결이 필요하고, https 주소에서만 동작합니다.

## 저장

구절과 기록은 그 기기의 브라우저(localStorage)에만 저장되고 서버로 가지 않습니다.
설정 화면에서 백업 파일로 내보내고 불러올 수 있습니다.
iPhone Safari는 오래 쓰지 않은 사이트의 데이터를 지울 수 있으니 홈 화면에 추가해서 쓰는 것을 권합니다.

## 공개하기 (GitHub Pages)

이 저장소는 GitHub Pages가 켜져 있습니다. master 브랜치에 합치면 아래 주소에서 열립니다.

https://kmoses2.github.io/MSLVCL/recite/

주소가 열리지 않으면 저장소의 Settings › Pages에서 배포 브랜치가 `master`, 폴더가 `/ (root)`인지 확인하세요.

## 개발

빌드 과정 없이 정적 파일만 있습니다.

```sh
cd recite
npm start   # http://localhost:8080 (localhost에서도 음성 인식이 됩니다)
npm test    # 단위 테스트, Node 18 이상
```

| 파일 | 하는 일 |
| --- | --- |
| `lib/compare.js` | 본문과 암송을 단어 단위로 정렬하고 채점 |
| `lib/text.js` | 단어 나누기, 숫자·철자·동음이의어 처리 |
| `lib/books.js` | 성경 66권 이름(영어·한글·약어), 장절 해석 |
| `lib/cleanup.js` | 붙여넣은 본문 정리 |
| `lib/speech.js` | 브라우저 음성 인식 (자동 재시작, 중복 결과 정리) |
| `lib/store.js` | 구절·기록 저장, 백업 |
| `lib/starter.js` | 기본 구절 12개 |
| `app.js`, `styles.css`, `index.html` | 화면 |
| `sw.js`, `manifest.webmanifest`, `icons/` | 오프라인 사용, 홈 화면 앱 |

## 저작권

기본으로 들어 있는 12구절(네비게이토 5확신 구절 포함)은 NIV(2011) 본문으로, Biblica의 인용 허락 범위(500절 이하, 저작권 표시)에 따라 실었습니다.

Scripture quotations taken from The Holy Bible, New International Version® NIV®. Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.™ Used by permission. All rights reserved worldwide.
