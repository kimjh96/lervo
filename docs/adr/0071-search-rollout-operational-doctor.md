# ADR-0071: 검색 rollout 운영 원본 진단

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

검색 엔진 선택, 세 종류의 정책, rollout 검토와 조치는 서로 연결된 immutable 원본입니다. 개별 상태 명령은 운영자가 요청한 목록이나 조합을 자세히 설명하지만, 프로젝트 전체 진단에서 이 원본들이 읽히고 서로 맞는지는 보여 주지 않았습니다. 반대로 일부 원본을 읽지 못한 상태에서 뒤의 검토나 조치를 정상으로 표시하면 손상된 운영 상태를 숨기게 됩니다.

## 결정

기존 `lervo doctor`에 `search_engine_selection`, `search_rollout_policies`, `search_rollout_reviews`, `search_rollout_actions` 네 검사를 추가합니다. 엔진 선택과 정책은 서로 독립적으로 검사하고, rollout 검토는 두 선행 검사가 모두 `healthy`일 때만 판정합니다. 조치는 선택·정책·검토가 모두 `healthy`일 때만 판정합니다.

직접 읽은 원본이 없고 저장소가 정상적으로 비어 있으면 해당 검사는 관측 수 0의 `healthy`입니다. 직접 확인한 원본이나 연결이 손상되면 `unhealthy`이고, 선행 검사가 실패해 뒤의 범위를 안전하게 확인할 수 없으면 `unknown`입니다. `unknown`을 빈 상태의 `healthy`로 바꾸거나 하위 원본을 추측해 판정하지 않습니다.

선택 검사는 운영 resolver와 같은 전체 선택 chain·정책·후보 replay 검증을 사용합니다. 정책 검사는 engine, rollout review, rollout action policy의 project 좌표와 action policy의 원본 결속을 확인합니다. 검토와 조치 검사는 각각 기존 bounded 상태 조회기를 사용하므로 페이지 밖 원본까지 포함한 관계 검증을 그대로 따릅니다.

## 무부작용과 정보 경계

진단은 검색 엔진을 선택하거나 최신 검토·조치를 고르지 않고, acknowledgement·선택 전이·정책·event와 Hub 원본을 만들지 않습니다. Issue는 고정된 코드와 한국어 설명만 반환합니다. Query·digest, 원본 ID, 문서 좌표·본문, provider 결과, credential, 절대 경로와 내부 오류 원문은 포함하지 않습니다.

## 결과

운영자는 일반 프로젝트 진단에서 검색 rollout 원본의 손상과 확인 불가를 구분할 수 있습니다. 이 결과는 원본 무결성 진단일 뿐 품질 평가, rollout 판단, 승인, 조치 사전 점검이나 실행을 대신하지 않습니다.
