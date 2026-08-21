# ADR-0135: 승인된 숙의 경계에서만 재개

- 상태: 채택
- 날짜: 2026-08-21

## 맥락

다중 역할 숙의가 검토 승인 뒤 중단되면 제안과 검토를 처음부터 다시 실행하는 것은 비용이 크고, 같은 결과를 보장하지도 않습니다. 반대로 진행 중인 임의 지점을 그대로 직렬화하면 일부 event나 문서만 기록된 상태를 정상 이력으로 오인할 수 있습니다.

## 결정

Lervo는 최신 claim을 모든 검토자가 승인한 뒤, 검증을 시작하기 전 경계에서만 체크포인트를 만듭니다. 체크포인트는 `.lervo/state/deliberations/<id>/checkpoints/approved.json` 한 파일이며 기존 파일을 덮어쓰지 않습니다. 주제, 실행 mode, policy hash, runtime 좌표, artifact·publication·handoff event 좌표, provider session 역할, workspace 문서와 현재 claim을 담습니다.

`lervo deliberate --resume <id>`는 다음 원본을 다시 확인합니다.

- 현재 저장 policy에서 계산한 hash
- `deliberation.started`와 모든 `deliberation.artifact.recorded` 원본
- publication·handoff event와 완료 event 부재
- CAS 원문의 hash와 byte 수
- 숙의 디렉터리 안 generated 문서의 경로·hash와 writing contract
- 참여 역할 순서와 provider session 역할 분리

하나라도 다르거나 승인 경계 뒤 숙의 artifact가 이미 추가됐으면 재개하지 않습니다. 검증과 결정만 새 managed session으로 실행하며 제안·검토 artifact를 다시 만들지 않습니다. 재개 뒤 실패는 가능한 경우 `failed` outcome으로 닫고, 이미 완료된 숙의는 다시 재개하지 않습니다.

승인 checkpoint부터 종료까지 별도 process lease를 소유합니다. 살아 있는 lease가 있으면 재개하지 않으며 죽은 process의 lease만 원자적으로 인계합니다. 상세한 생존·경쟁 판정은 [ADR-0137](./0137-deliberation-liveness-and-diagnostics.md)에 기록합니다.

새 event 종류는 추가하지 않습니다. 체크포인트는 복구용 로컬 원본이며 `selected`, `loaded`, `injected`, `used` 증거가 아닙니다. 주제 원문이 포함되므로 파일과 디렉터리는 소유자 전용 권한으로 만들고 최대 1 MiB 일반 파일만 no-follow로 읽습니다.

## 결과

승인 이전의 불완전한 회차는 재개할 수 없고 새 숙의가 필요합니다. 체크포인트가 있어도 event·CAS·문서·정책 중 하나가 달라지면 자동 복구보다 안전한 실패를 택합니다. 정상 재개는 기존 숙의 ID와 append-only event chain을 유지합니다.
