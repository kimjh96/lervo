# ADR-0074: 의존성을 분리한 doctor 범위 실행 계획

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

`search` 범위는 전체 doctor를 실행하지 않고 검색 검사만 수행할 수 있었지만 지식, 문서, 스킬과 에이전트 실행 환경은 여전히 전체 진단을 거쳐야 했습니다. 범위를 단순한 결과 필터로 늘리면 필요하지 않은 event DB, CAS, 사용자 스킬 디렉터리나 외부 실행 파일을 열고도 화면에서는 감추는 문제가 생깁니다.

## 결정

Doctor scope를 `all`, `knowledge`, `documents`, `skills`, `providers`, `search`로 확장하고 scope마다 허용 검사 ID와 실행 의존성을 고정합니다.

| scope | 실행 검사 | 여는 의존성 |
| --- | --- | --- |
| `all` | 모든 지식·환경·검색 검사 | project storage, CAS, 문서, 스킬, provider probe, 검색 원본 |
| `knowledge` | event chain, candidate, review, verified, staleness | project storage와 CAS |
| `documents` | document registry, source | project manifest와 등록 문서 |
| `skills` | skill package, lock | project manifest, 프로젝트·사용자 스킬과 lock |
| `providers` | Codex·Claude runtime | project manifest와 두 provider version probe |
| `search` | engine selection, rollout policy, review, action | project manifest, 검색 정책·상태와 등록 검색 corpus |

`knowledge`는 환경 검사 application service를 호출하지 않습니다. 나머지 제한 범위는 event store와 CAS를 열지 않고 project manifest로 project 좌표만 확인한 뒤 해당 검사기만 실행합니다. `search`가 corpus 무결성을 위해 등록 문서를 읽는 것은 검색 검사 자체의 의존성이며 별도 documents 결과를 추가하지 않습니다.

Diagnostics report 조합기는 scope별 허용 검사 ID 집합을 전체 매핑으로 관리합니다. 누락, 중복이나 다른 범위의 검사 결과가 들어오면 제한 결과를 만들지 않습니다. 지식 원본 검사는 별도 모듈이 소유하고 `all`과 `knowledge`가 같은 구현을 사용합니다.

## 출력과 종료 의미

모든 제한 범위는 텍스트에 해당 범위만 확인했고 프로젝트 전체 상태가 아님을 표시하고 JSON의 `scope`와 실제 `checks`를 일치시킵니다. 종료 코드 0은 선택한 범위의 모든 검사만 `healthy`라는 뜻입니다. 지원하지 않는 범위는 project 원본을 열기 전에 거부합니다.

## 결과

운영자는 필요한 진단만 실행하고 느리거나 사용할 수 없는 다른 의존성의 영향을 받지 않습니다. 새 범위는 허용 검사, 실행 의존성, 저장소 개방 여부와 범위 표시를 함께 정의해야 하므로 사후 필터나 암묵적 전체 정상 판정으로 확장할 수 없습니다.
