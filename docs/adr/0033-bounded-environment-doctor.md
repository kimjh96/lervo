# ADR-0033: 범위가 드러나는 로컬 환경 진단

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

기존 `lervo doctor`는 로컬 event hash chain과 지식 수명주기 원본만 검사했습니다. 이 범위는 유용하지만 문서, 스킬과 provider 실행 환경을 확인하지 않은 채 전체 환경이 정상인 것처럼 읽힐 수 있었습니다.

환경 진단은 서로 다른 실패 의미를 한 상태로 합치면 안 됩니다. 손상된 원본은 실제 문제이고, 실행 파일이나 실행별 lock이 없는 상태는 준비 여부를 증명하지 못한 것입니다. Provider 실행 파일의 version 조회가 성공해도 인증, 네트워크와 실제 managed session까지 성공한다고 볼 수 없습니다.

## 결정

### 검사 항목과 판정을 분리한다

Doctor report는 기존 event·지식 검사에 다음 항목을 독립적으로 추가합니다.

- `document_registry`: 분할 sidecar 또는 legacy registry의 구조와 계약
- `document_sources`: registry에 등록된 저장소 상대 경로의 안전한 일반 파일 원본
- `skill_packages`: 프로젝트와 사용자 스킬의 manifest, 전체 내용 hash와 안전한 경로
- `skill_lock`: 현재 패키지를 기록된 실행 환경으로 다시 해석한 선택·탈락 결과
- `provider_codex_runtime`: Codex adapter가 정한 실행 파일의 version 응답
- `provider_claude_runtime`: Claude adapter가 찾은 Agent SDK bundled 실행 파일의 version 응답

각 항목은 `healthy`, `unhealthy`, `unknown` 중 하나입니다. `healthy`는 해당 검사를 끝내고 계약을 만족했다는 뜻입니다. `unhealthy`는 원본의 손상, 누락 또는 stale처럼 유효하지 않은 상태를 직접 확인했다는 뜻입니다. `unknown`은 선행 원본이나 실행 환경이 없거나 probe가 실패해 판정할 수 없다는 뜻입니다.

스킬 패키지가 하나도 없으면 `skills.lock`이 없어도 검사 결과는 `healthy`입니다. 패키지가 있지만 실행별 lock이 아직 없으면 `unknown`입니다. Lock이 있으면 그 안의 runtime과 요청된 skill ID로 공통 resolver를 다시 실행하고 선택·탈락 결과 전체를 비교합니다. 이 방식은 선택된 hash의 변경뿐 아니라 새 후보가 우선순위를 바꾸는 경우도 stale로 판정합니다.

전체 상태는 `unhealthy`, `unknown`, `healthy` 순서로 우선합니다. 모든 항목이 `healthy`일 때만 CLI가 종료 코드 0을 반환합니다. `unknown`은 문제를 확인했다는 뜻은 아니지만 정상이라고 표시하지 않습니다.

### Provider별 탐색은 adapter 뒤에 둔다

공통 adapter 계약은 shell 없이 실행 파일에 `--version`을 호출하고 결과를 제한하는 작은 probe만 제공합니다. Codex adapter는 PATH 또는 명시적으로 구성된 실행 파일을 정합니다. Claude adapter는 현재 운영체제와 CPU에 맞는 Agent SDK native package의 bundled 실행 파일을 정합니다. 지원하지 않는 platform과 package 탐색 실패는 성공으로 추정하지 않습니다.

Probe는 5초 timeout과 16 KiB 출력 한도를 사용하고, 첫 ASCII 문장만 최대 200자로 version 증거에 남깁니다. `available`은 이 제한된 version 명령이 성공했다는 뜻일 뿐입니다. Provider 인증, 계정 권한, 네트워크 연결, 모델 접근과 managed session 성공은 이번 doctor가 검사하지 않습니다.

### 읽기 전용 application service로 조합한다

문서 검사, 스킬 검사와 provider 검사는 서로 다른 모듈에 둡니다. CLI application service는 이 검사들을 병렬로 실행해 `@lervo/diagnostics`의 공통 report와 합칩니다. Diagnostics core는 provider package 탐색이나 파일 layout을 직접 알지 않습니다.

이번 변경은 파일, CAS, event와 Hub 상태를 쓰지 않습니다. Hub 연결 상태도 검사 범위에 포함하지 않습니다.

## 실패 의미와 개인정보

| issue code | 의미 |
|---|---|
| `document_registry_invalid` | 문서 registry를 안전하게 읽거나 계약에 맞게 해석하지 못했습니다. |
| `document_source_invalid` | registry의 선행 실패로 판정할 수 없거나, 등록된 문서 원본 일부를 안전한 일반 파일로 읽지 못했습니다. |
| `skill_package_invalid` | 스킬 manifest, 내용 hash 또는 package 경로가 유효하지 않습니다. |
| `skill_lock_missing` | 스킬 package는 있지만 비교할 실행별 lock이 없습니다. |
| `skill_lock_invalid` | lock을 안전하게 읽지 못했거나 schema·중복 계약이 유효하지 않습니다. |
| `skill_lock_stale` | lock의 project 또는 다시 계산한 해석 결과가 현재 원본과 다릅니다. |
| `provider_executable_missing` | adapter가 정한 provider 실행 파일을 찾거나 실행하지 못했습니다. |
| `provider_probe_failed` | version probe가 실패하거나 timeout 또는 허용된 출력 계약을 통과하지 못했습니다. |
| `provider_platform_unsupported` | 현재 platform의 provider 실행 파일 위치를 판정할 수 없습니다. |

Issue와 일반 출력에는 절대 경로, 문서·스킬 본문, publisher, credential, 환경 변수와 provider raw output을 넣지 않습니다. Probe child process에는 PATH만 전달합니다. 허용된 version 문장만 report에 남기며 doctor는 새 event를 만들지 않습니다.

## 검증

실제 임시 저장소에서 빈 환경의 모든 항목, 등록됐지만 사라진 문서, hash가 틀린 스킬, lock 부재와 현재 resolver 결과가 달라진 lock을 검사합니다. Provider 공통 계약은 실제 child process의 제한된 version 응답과 존재하지 않는 실행 파일을 구분합니다. CLI fixture는 `unknown`을 정상으로 표시하지 않고 종료 코드 1을 반환하는지 확인합니다.

## 결과

`lervo doctor`는 검사하지 않은 환경을 정상으로 뭉뚱그리지 않습니다. 문서·스킬 원본의 문제와 아직 확인할 수 없는 provider 준비 상태를 구분하면서도, provider별 설치 방식은 adapter 경계에 남습니다.
