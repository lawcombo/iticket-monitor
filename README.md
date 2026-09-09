# iticket-monitor

GitHub Pages에서 실행되는 정적 AP 서버 상태 모니터링 대시보드입니다. 설정된 주기마다 각 API 주소에 실제 POST 요청을 보내 HTTP 결과와 브라우저에서 측정한 전체 응답시간을 기록합니다. 기본 점검 대상은 `관광지조회`와 `헬스체크`이며, 브라우저 저장소가 비어 있으면 이 기본값으로 자동 복원됩니다.

## 로컬 실행

빌드나 패키지 설치가 필요하지 않습니다. `index.html`을 더블클릭해 바로 열 수 있습니다. 실제 API 호출을 시험할 때는 브라우저 보안 정책을 정확히 확인하기 위해 간단한 정적 웹 서버 사용을 권장합니다.

```bash
python -m http.server 8000
```

실행 후 `http://localhost:8000`에 접속합니다.

## GitHub Pages 배포

1. GitHub 저장소의 **Settings → Pages**로 이동합니다.
2. **Build and deployment**의 Source를 **Deploy from a branch**로 선택합니다.
3. Branch는 `main`, 폴더는 `/(root)`를 선택하고 저장합니다.
4. 배포가 끝나면 `https://lawcombo.github.io/iticket-monitor/`에서 확인할 수 있습니다.

모든 정적 리소스는 GitHub Pages 하위 경로에서도 동작하도록 상대경로로 연결되어 있습니다.

> 비공개 저장소의 GitHub Pages는 GitHub Pro, Team 또는 Enterprise 요금제에서 사용할 수 있습니다. 저장소가 비공개여도 배포된 Pages 사이트는 인터넷에 공개되므로 민감정보를 포함하지 마세요.

## 실제 API 연결

서버 관리에서 시스템명과 API 주소를 등록하면 자동 점검 또는 즉시 점검 시 해당 주소를 호출합니다. Authorization Bearer 토큰은 소스 기본값으로 적용되며 설정 화면에서 현재 탭에 한해 교체할 수 있습니다. 기본 요청 방식은 다음과 같습니다.

```http
POST https://서버주소/internal/monitor/health
Accept: application/json
Content-Type: application/json
Authorization: Bearer {설정 화면에서 입력한 토큰}

{}
```

예상 응답은 다음과 같습니다.

```json
{
  "status": "NORMAL",
  "message": "정상",
  "checkedAt": "2026-09-09T08:30:00+09:00"
}
```

응답 필드가 바뀌면 `js/app.js`의 `normalizeApiResponse(payload)` 함수만 수정하면 됩니다. 실제 요청 자체를 바꾸려면 같은 파일의 `requestRealApi(server, signal)` 함수를 수정합니다.

JSON이 아니거나 일부 필드가 없는 응답도 화면 전체가 중단되지 않도록 안전하게 처리합니다. HTTP 오류가 발생하면 요청 실패 여부, HTTP 상태코드, 서버가 반환한 오류 메시지를 서버 카드와 점검 이력에 함께 표시합니다. 단, CORS 또는 네트워크 차단으로 브라우저가 응답 자체를 읽지 못한 경우에는 서버 응답 본문을 표시할 수 없습니다.

## HTTPS와 CORS 주의사항

GitHub Pages는 HTTPS로 제공됩니다. 따라서 실제 API도 유효한 HTTPS 인증서를 사용해야 합니다. HTTPS 페이지에서 HTTP API를 호출하면 브라우저가 혼합 콘텐츠로 차단합니다.

API 서버는 GitHub Pages 출처의 브라우저 요청을 허용하도록 CORS 응답 헤더를 설정해야 합니다. 예시는 다음과 같습니다.

```http
Access-Control-Allow-Origin: https://lawcombo.github.io
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Accept, Content-Type, Authorization
```

운영 환경에서는 허용 출처를 필요한 도메인으로만 제한하세요. CORS 오류는 프런트엔드 코드만으로 우회할 수 없습니다.

## 보안 및 운영 제한

- 현재 요청에 따라 기본 Bearer 토큰이 `js/app.js`에 포함되어 있습니다. GitHub Pages 방문자는 개발자 도구에서 이 토큰을 확인할 수 있으므로 토큰 권한을 최소화하고 필요 시 즉시 폐기·교체해야 합니다.
- 인증이 필요하다면 별도의 안전한 중계 서버 또는 인증 프록시를 사용하세요.
- 이 화면은 서버가 아니라 사용자의 브라우저에서 점검합니다. 브라우저 탭이 열려 있을 때만 모니터링하며, 탭을 닫거나 장치가 절전 상태가 되면 점검도 중단됩니다.
- 브라우저 백그라운드 탭에서는 타이머가 지연될 수 있습니다. 다시 활성화하면 자동 점검 일정을 복구합니다.
- 설정과 최근 이력(최대 1,000건)은 해당 브라우저의 `localStorage`에만 저장됩니다.

## 파일 구조

```text
index.html       화면 구조
css/style.css    디자인과 반응형 스타일
js/app.js        실제 API 점검, 저장, 차트, 설정 기능
README.md        실행·배포·연동 안내
```
