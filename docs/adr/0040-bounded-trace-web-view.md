# ADR-0040: 페이지를 누적하지 않는 read-only trace web view

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

인증된 trace HTTP API는 project, run, event를 제한된 cursor page로 제공하지만 사람이 이를 탐색할 화면은 없었습니다. 한 화면에 모든 run과 event를 계속 붙이면 긴 문서와 같은 문제가 생깁니다. 처음에는 편해 보여도 project 수와 실행 이력이 늘수록 현재 선택, 연속 이력과 gap 뒤 event의 차이를 알아보기 어려워지고 browser memory도 이력 크기에 따라 증가합니다.

Web view가 Hub 저장소나 credential 구성을 직접 읽으면 HTTP authorization 경계를 우회합니다. 반대로 bearer token을 URL, HTML, browser storage에 넣으면 history, 동기화, 확장 프로그램이나 복사된 링크를 통해 남을 수 있습니다. 최소 화면은 인증 경계와 bounded query를 그대로 사용하면서 이 두 문제를 함께 피해야 합니다.

## 결정

### 공개 shell과 인증된 데이터를 분리한다

`GET /trace`는 데이터가 없는 HTML shell만 반환합니다. JavaScript와 CSS는 `/assets/` 아래의 고정 route만 제공하며 사용자 입력으로 파일 경로를 만들지 않습니다. Shell과 asset 요청은 Hub authenticator나 trace source를 호출하지 않습니다.

사용자가 입력한 bearer token은 현재 page의 JavaScript 변수에만 둡니다. 입력 element는 API 요청을 시작하기 전에 비우고 token을 query parameter, fragment, HTML, `localStorage`, `sessionStorage`, cookie에 기록하지 않습니다. 같은 origin의 기존 `/v1/trace` API에만 `Authorization` header로 보내며 fetch의 cookie credential은 사용하지 않습니다. 연결 해제, 인증 실패와 page 종료 시 메모리 참조를 비웁니다. 이는 browser process memory에서 token이 사라졌다는 증명이나 사용자 federation을 뜻하지 않습니다.

### Project, run, event를 독립된 단계와 page로 탐색한다

화면은 project, run, event의 세 영역을 둡니다. Project를 선택해야 run을 읽고 run을 선택해야 event를 읽습니다. 각 영역은 API의 cursor page 하나만 표시하며 다음 페이지로 갈 때 기존 DOM 목록을 교체합니다. 이전 이동에 필요한 cursor stack만 현재 탭 메모리에 두고 event 원본을 누적하지 않습니다. Web 기본 page 크기는 20이고 API의 최대 100 계약은 바꾸지 않습니다.

Project page가 바뀌면 선택한 run과 event를 비우고, run page가 바뀌면 선택한 event를 비웁니다. 빠르게 다른 project나 run을 선택해 이전 요청이 나중에 끝나더라도 현재 pager와 다른 응답은 화면에 반영하지 않습니다. 실패한 다음 page 요청은 현재 cursor 위치를 유지합니다.

Event는 `continuous`를 `연속 이력`, `buffered`를 `연결 대기`로 표시하고 색과 문구를 함께 사용합니다. 알려진 event와 payload field는 한국어 설명을 먼저 보여주되 ID와 hash는 증거 좌표이므로 숨기거나 의미를 추정하지 않습니다. 모든 Hub 문자열은 `textContent`로 만들고 HTML로 해석하지 않습니다.

### Browser 응답과 asset 크기를 제한한다

HTML과 asset에는 `Cache-Control: no-store`, same-origin resource policy, `Referrer-Policy: no-referrer`, frame 차단, MIME sniffing 차단과 다음 Content Security Policy를 적용합니다.

- 기본 resource 차단
- same-origin script, style과 API 연결만 허용
- base, form action과 frame ancestor 차단

각 정적 asset은 시작 시 고정 경로에서 최대 256 KiB로 읽습니다. 인증, API client, cursor pager, DOM renderer와 화면 조정 코드를 분리합니다. Style도 공통 토큰·연결 영역, trace workspace, 반응형 규칙으로 나눠 한 파일에 계속 쌓지 않습니다. Browser JavaScript는 package build에서 `node --check`로 구문을 확인합니다.

## 실패 의미와 개인정보

`/trace` 또는 asset에 query parameter나 GET body가 있으면 400, 다른 method는 405입니다. 고정된 경로가 아니면 web handler가 처리하지 않고 기존 API의 404 경계로 넘깁니다. Asset read나 크기 검사는 server 생성 중 실패하므로 일부 화면만 열린 상태로 시작하지 않습니다.

API의 401, 403, 404와 500 의미는 바꾸지 않습니다. UI는 고정 API message만 표시하고 token, 예외 stack과 실패 응답 원문을 붙이지 않습니다. 401이면 현재 화면과 token 참조를 비웁니다. Shell에는 principal, 허용 project 목록, Hub source, event와 credential이 없습니다.

이번 변경은 새 event나 telemetry 상태를 만들지 않습니다. 화면에서 event를 표시한 사실은 agent가 문서를 이해했거나 사용했다는 증거가 아니며 실행 또는 sync 완료 상태도 새로 추정하지 않습니다.

## 검증

실제 Node HTTP server에서 인증 없이 shell과 고정 asset만 반환하고 trace source를 호출하지 않는지 확인했습니다. CSP, no-store, frame·referrer·same-origin header와 HTML에 credential·project fixture가 없는 상태를 검사했습니다. Query credential과 write method는 값을 되돌려 보내지 않고 거부합니다.

Cursor pager는 다음 page 결과가 이전 items에 합쳐지지 않고 현재 page를 교체하는지, 이전 cursor로 돌아갈 수 있는지, 다음 page 실패 뒤 현재 위치를 보존하는지 검증했습니다. Asset 전체는 storage API와 `innerHTML`을 사용하지 않는지 확인하고 build에서 JavaScript 구문을 검사합니다.

## 결과

사용자는 `/trace`에서 project부터 event까지 단계적으로 탐색할 수 있고, 권한 있는 데이터는 기존 인증·project scope API를 통해서만 들어옵니다. 화면이나 browser state는 전체 trace 이력에 비례해 계속 커지지 않습니다. 다음 M6 작업은 서명된 원격 command protocol의 로컬 fixture입니다.
