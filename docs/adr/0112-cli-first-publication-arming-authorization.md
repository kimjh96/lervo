# ADR-0112: CLI 최초 공개 게시 일회성 arming authorization

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

Bootstrap v2는 외부 요구와 exact release를 결속하지만 사람에게 실제 실행 시도를 승인받은 문서가 아닙니다. Execution plan은 위험 순서와 취소 처분을 설명하지만 의도적으로 `not_armed`이고, read-only preflight의 `ready`도 실행 permit가 아닙니다. 이 셋 중 하나만으로 실행 코어를 호출할 수 있으면 문서의 비권한성 설명과 실제 경계가 어긋납니다.

반대로 arming 명령에서 npm profile, package 상태나 artifact를 다시 읽고 예약까지 만들면 preflight·execution 책임이 섞입니다. 사람 decision과 exact 계획 결속, 실행 시 fresh 검사와 durable 소비는 서로 다른 경계로 유지해야 합니다.

## 결정

사람이 작성하는 arming decision v1은 다음을 가집니다.

- `arm_` decision ID와 `authorize_first_publication_once`
- 결정 시각과 최대 5분의 만료 시각
- `{ kind: "user", id }` actor
- exact package·version, bootstrap·publication authorization·execution plan digest
- exact plan 검토, preflight 비권한성, 실행 시 fresh 검사, 수동 2FA 게시 1회, 결과 불명 시 reconciliation의 다섯 확인

Decision은 bootstrap의 public package 관측보다 이를 수 없고 bootstrap보다 오래 유효할 수 없습니다. Actor ID는 로컬 의사결정 입력이며 인증된 신원이나 npm 권한 proof가 아닙니다.

`release:bootstrap:arm`은 다음 입력을 받습니다.

```text
pnpm release:bootstrap:arm \
  --publication-authorization <absolute-path> \
  --bootstrap <absolute-path> \
  --decision <absolute-path> \
  --output <new-absolute-path>
```

Publication authorization과 bootstrap을 읽고 execution plan v1 전체를 다시 계산합니다. Decision은 64 KiB 이하 regular file, 공백 2칸 JSON과 마지막 LF여야 합니다. 세 입력 snapshot이 결과 생성 뒤에도 같을 때만 새 output을 `wx`로 씁니다. 명령은 온라인 관측을 받거나 실행하지 않습니다.

Arming authorization v1은 다음을 canonical digest에 결속합니다.

- `status=armed`, `authorizationType=first_publication_manual_once`
- exact registry·package·version·dist-tag·access
- bootstrap, publication authorization, execution plan과 decision ID·digest
- 발급 시각과 decision 만료 시각
- `manual_interactive_once`, durable reservation 소비와 실행 시 다섯 fresh check
- `publisherEntryPoint=not_exposed`
- Trusted Publisher stage-only 전환과 이후 direct publish 금지
- 예약·게시·외부 설정 무변경

Actor 원문은 결과에 넣지 않습니다. Decision ID와 digest, target과 시각은 exact 실행 결속과 감사에 필요한 계약 metadata입니다. Credential, 문서 본문·경로, npm 응답과 오류 원문은 넣지 않습니다.

Self-contained reader는 고정 schema·권한·digest를 확인하고 source-bound validator는 현재 bootstrap·publication authorization에서 plan을 재계산해 target·binding·유효기간을 추가 확인합니다. Digest를 다시 계산해 publisher entry point, 반복 실행이나 broad direct publish 권한을 넣어도 거부합니다.

실행 코어는 arming authorization을 시작 시각과 public package 재관측 뒤 예약 시각에 모두 확인합니다. 관측 중 만료되면 예약과 publish를 시작하지 않습니다. Reservation v2는 기존 bootstrap 기반 ID를 유지하면서 arming authorization digest를 추가합니다. 같은 bootstrap에 새 decision을 만들어도 reservation ID가 같으므로 이미 생성된 예약을 우회할 수 없습니다. Execution receipt v2도 authorization digest와 reservation binding을 보존합니다. Transition report와 receipt는 같은 authorization으로 execution receipt를 재검증합니다.

기존 reservation·execution receipt v1은 아직 운영 게시에 사용되지 않았고 새 필수 binding을 증명할 수 없습니다. 자동 변환하지 않고 invalid로 거부하며 새 bootstrap·decision·authorization과 예약을 요구합니다.

오류 의미는 다음과 같습니다.

- `first_publication_arming_arguments_invalid`: 절대 입력·output이 누락됐거나 인자가 중복·알 수 없고 `--online`을 사용했습니다.
- `first_publication_arming_source_invalid`: decision file 종류·크기·canonical JSON이 올바르지 않습니다.
- `first_publication_arming_decision_invalid`: actor, target, 확인 목록, 시각이나 최대 수명이 올바르지 않습니다.
- `first_publication_arming_authorization_invalid`: authorization schema·digest·고정 권한·source binding·확인 시각이 올바르지 않습니다.
- `first_publication_arming_authorization_expired`: 발급 시점에 bootstrap이 이미 만료됐습니다.
- `first_publication_reservation_invalid`: reservation v2 구조나 bootstrap·arming binding이 올바르지 않습니다.

Contract file, source 변경, output 존재와 하위 release 오류는 기존 code를 유지합니다. 오류에는 actor·원문·경로·digest·credential이나 외부 응답을 복사하지 않습니다.

## 결과

Plan·preflight를 권한으로 사용하지 않으면서 사람의 exact 실행 의사결정을 실행 코어가 실제로 요구하게 됐습니다. Arming 명령은 source와 새 authorization 파일 외 상태를 만들지 않고 reservation·prompt·online 관측·2FA·publication·외부 설정을 실행하지 않습니다. 실제 publisher CLI와 workflow publish job도 계속 없습니다.

테스트는 exact plan 결속, actor 비노출, 다른 plan·만료 decision, redigested 권한 상향, 실행 전 authorization 누락, 관측 중 만료, 같은 bootstrap 재arming의 예약 ID 불변, durable reservation·receipt 결속, canonical source와 output 비덮어쓰기를 검증합니다.
