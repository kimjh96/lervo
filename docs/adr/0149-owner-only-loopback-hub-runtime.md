# ADR-0149: owner-only 구성과 loopback 실행을 강제하는 Hub runtime

- 상태: 채택
- 기준일: 2026-08-22

## 맥락

`@lervo/hub`는 인증된 trace·policy·control·command HTTP handler를 제공하고, ADR-0148은 command artifact cleanup을 HTTP server 수명주기에 연결했습니다. 그러나 실제 실행 파일은 없었습니다. 사용자가 직접 SQLite, CAS, 인증기, 두 서명기와 review grant를 조립하면 시작 실패 때 열린 저장소가 남거나 종료 때 store를 먼저 닫을 수 있습니다.

TLS, credential, 개인키를 다루는 실행 진입점은 편의를 위해 임시 비밀을 만들거나 평문 HTTP를 외부 주소에 열어서는 안 됩니다. 반대로 TLS 인증서 발급 방식이나 process supervisor 제품을 하나로 고정하는 것도 현재 제품 범위를 넘습니다.

## 결정

### HTTP adapter와 실행 조합을 분리한다

새 `@lervo/hub-runtime` 앱이 `lervo-hub --config <config.json>` 실행 진입점을 소유합니다. 기존 `@lervo/hub`에는 storage, filesystem 경로, process signal이나 개인키 로딩을 넣지 않습니다.

Runtime은 다음 순서로 조합합니다.

1. 구성, policy·command Ed25519 개인키와 control review HMAC 비밀을 제한된 크기로 읽습니다.
2. Bearer credential을 HTTP 인증기와 같은 검증기로 확인하고 서명기·review grant를 만듭니다.
3. owner-only SQLite 디렉터리·파일과 command CAS를 열고 무결성을 검사합니다.
4. trace, policy, control, command handler와 durable artifact cleanup을 한 HTTP server에 연결합니다.
5. server가 실제로 listen한 뒤에만 시작 메시지를 출력합니다.

개인키와 HMAC 비밀을 객체로 옮긴 뒤 임시 byte buffer는 즉시 0으로 덮습니다. Runtime은 credential, 개인키, HMAC 비밀을 log나 오류 결과에 넣지 않습니다.

### 구성은 한 번에 읽는 엄격한 원본이다

구성은 `schemaVersion: 1` JSON 한 파일입니다. 알 수 없는 필드를 거부하며 경로는 구성 파일의 디렉터리를 기준으로 해석합니다. 예시는 [hub-runtime.config.example.json](../examples/hub-runtime.config.example.json)에 분리합니다.

필수 구성은 다음과 같습니다.

- loopback listen host와 port
- SQLite와 command CAS 경로
- Node가 미리 신뢰하도록 배포한 Hub identity hash
- principal, permission, project 범위에 묶인 bearer credential 1~256개
- policy·command Ed25519 key ID와 개인키 파일
- control review HMAC 비밀 파일과 선택적 TTL
- cleanup worker ID와 선택적 실행 상한

구성·개인키·HMAC 파일은 실제 일반 파일이어야 하고 다른 OS 계정에 읽기 권한이 없어야 합니다. SQLite 파일과 WAL·SHM이 놓이는 디렉터리도 다른 계정에 열려 있으면 시작을 거부합니다. Command CAS는 기존 owner-only adapter가 디렉터리 `0700`, object `0600`을 강제합니다. Windows에서는 POSIX mode 대신 일반 파일·symlink 검사를 적용합니다.

Bearer token과 개인키를 구성 안에서 자동 생성하지 않습니다. Identity hash와 공개키 신뢰 배포, secret 생성·백업·회전은 운영자가 별도로 수행합니다. 현재 구성은 시작 때 한 번 읽으므로 credential이나 키를 바꾼 뒤에는 안전한 재시작이 필요합니다. 암호화된 개인키의 대화형 passphrase 입력과 외부 secret manager adapter는 후속 범위입니다.

### 평문 server는 loopback만 허용한다

현재 Node server는 TLS를 직접 종료하지 않습니다. 따라서 구성 파서와 직접 호출 API 모두 `127.0.0.1` 또는 `::1`만 허용합니다. 다른 장비에서 접근하려면 같은 호스트의 TLS reverse proxy가 loopback Hub로 전달해야 합니다. 이 결정은 production TLS 인증서 로딩이나 proxy 제품을 구현했다고 뜻하지 않습니다.

### 종료 순서를 한 곳에서 소유한다

`SIGINT`와 `SIGTERM`은 같은 멱등 종료 함수를 호출합니다. 종료 순서는 다음과 같습니다.

1. HTTP server를 닫아 새 요청을 받지 않고 진행 중인 응답을 마칩니다.
2. Cleanup wait를 취소하고 진행 중인 bounded cycle의 종료를 기다립니다.
3. SQLite store를 닫습니다.

중복 signal과 명시적 `close()`는 같은 promise를 반환합니다. HTTP server runtime 오류나 `artifact_cleanup_runtime_failed`는 server 종료를 요청하고 process 결과를 실패로 만듭니다. 조합 도중 CAS나 server 생성이 실패하면 이미 연 SQLite store를 닫습니다.

## 상태와 개인정보

새 실행 event나 command 상태는 만들지 않습니다. 시작 문구에는 loopback host와 port만 있으며 credential, 내부 경로, identity hash, CAS URI를 출력하지 않습니다. 오류는 아래 고정 code와 일반 설명만 외부 출력에 사용하고 원인 객체는 library 내부 cause로만 남깁니다.

- `invalid_arguments`: CLI 인자가 `--config <path>` 한 쌍이 아님
- `invalid_config`: JSON 구조, 값, 관계 또는 loopback 제한이 유효하지 않음
- `unsafe_runtime_file`: 구성·비밀·DB 파일이나 디렉터리의 종류·크기·권한이 안전하지 않음
- `startup_failed`: 키 해석, 인증기·서명기·저장소 조합을 완료하지 못함
- `listen_failed`: 지정한 loopback 주소에서 server를 시작하지 못함
- `shutdown_failed`: server, cleanup 또는 store 종료를 보장하지 못함
- `hub_server_runtime_failed`: listen 뒤 HTTP server가 오류로 중단됨
- `artifact_cleanup_runtime_failed`: cleanup 원장이 안전하게 실패 상태까지 남길 수 없음

이 상태는 HTTP 요청 성공, command 실행·사용, event sync, 문서 적재나 사람의 검토를 뜻하지 않습니다.

## 검증

임시 owner-only 구성, 두 실제 Ed25519 개인키, HMAC 비밀, Hub SQLite와 command CAS로 다음을 확인합니다.

- 상대 경로를 구성 파일 위치 기준으로 해석
- 다른 계정이 읽을 수 있는 구성과 DB 디렉터리 거부
- 외부 평문 bind, 알 수 없는 필드와 서로 맞지 않는 cleanup 상한 거부
- 실제 HTTP server에서 bearer 인증된 trace 요청 처리
- `SIGTERM` 뒤 HTTP 종료, cleanup 종료 대기와 SQLite close
- 종료 뒤 같은 database 재개방과 전체 무결성 감사
- 잘못된 개인키 byte가 CLI 오류에 노출되지 않음

실제 사용자 저장소·CAS, production TLS, 외부 secret manager, process supervisor나 설치 서비스에는 쓰지 않았습니다.

## 결과와 후속 범위

Hub 기능을 한 process로 안전하게 시작하고 멈출 수 있는 첫 실행 진입점이 생겼습니다. 다음 배포 작업은 TLS 종료 방식과 인증서 수명주기, credential·키 회전, 설치 서비스와 상태 확인을 별도 계약으로 정해야 합니다. Hub 등록·event 수신 HTTP 경계와 설치 가능한 Lervo Node daemon도 별도 제품 작업입니다.
