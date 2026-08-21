# ADR-0113: CLI 최초 공개 게시 불명확한 결과 대조

- 상태: 승인
- 날짜: 2026-08-21

> 후속 결정: [ADR-0114](./0114-cli-first-publication-reconciliation-resolution.md)는 reviewed report를 현재 원본에 다시 결속하고 fresh public 관측과 사람 결정을 요구하는 별도 resolution을 추가했습니다.

## 맥락

Publisher 호출 뒤 연결 오류, receipt 불일치나 terminal 완료 저장 실패가 생기면 로컬에서는 게시 성공 여부를 알 수 없습니다. 실행 코어는 이 경우 durable reservation을 남기고 `publication_unknown`, `retry=forbidden`으로 닫습니다. 이를 실패로 추정해 다시 게시하면 중복 시도가 되고, package 이름만 보인다는 이유로 성공으로 추정하면 다른 artifact나 잘못된 dist-tag를 승인할 수 있습니다.

대조 과정이 기존 terminal을 덮어쓰거나 새 bootstrap을 발급하면 관측과 복구 권한이 섞입니다. 먼저 public npm에서 확인할 수 있는 사실만 exact release와 비교하고, 그 한계를 보존하는 읽기 전용 보고서가 필요합니다.

## 결정

Reconciliation은 reservation v2와 `publication_unknown`, `retry=forbidden` terminal만 받습니다. Publication authorization·bootstrap·arming authorization을 다시 검증하고 reservation·terminal 좌표와 digest를 대조합니다. Arming authorization은 원래 발급 시점에, reservation은 원래 예약 시점에 유효했는지 확인하며 현재 시점에 만료됐다는 이유로 과거 원본을 버리지 않습니다.

익명 public npm observer는 다음 두 endpoint만 읽습니다.

- exact `@lervo/cli@<version>` metadata의 `dist.integrity`와 `dist.shasum`
- `@lervo/cli` dist-tags의 승인된 `latest|next` 값

각 응답은 10초와 256 KiB로 제한하고 redirect를 허용하지 않습니다. 원문 body, 다른 version metadata, 다른 tag, 요청 오류는 보존하지 않습니다. 관측 결과는 필요한 두 값이나 `not_found|unavailable`로만 정규화합니다.

순수 정책의 outcome은 다음과 같습니다.

- `published`: 대상 version의 integrity·shasum이 exact release와 같고 대상 dist-tag도 exact version을 가리킵니다.
- `not_observed`: 대상 version metadata가 없고 대상 dist-tag도 exact version을 가리키지 않습니다.
- `unknown`: 두 응답 중 일부만 일치하거나 version digest가 다르고, 응답이 손상됐거나 registry를 읽지 못했습니다.

`not_observed`는 게시되지 않았다는 증명이나 재시도 권한이 아닙니다. Registry 전파 지연이나 관측 한계가 있을 수 있으므로 terminal의 `retry=forbidden`을 유지합니다. `published`도 원래 publisher receipt, 2FA proof나 execution receipt가 아니며 stage-only 전환을 완료하지 않습니다.

Report v1은 exact target, bootstrap·arming authorization·publication authorization·reservation·terminal record digest, 관측 시각, version·dist-tag 검사와 다음 한계를 canonical digest에 결속합니다.

- public registry만 관측함
- private package 상태는 관측하지 않음
- 자동 재시도 권한이 없음
- 전환을 완료하지 않음

Side effect는 reservation·terminal `unchanged`, publication `not_attempted`, external settings `not_changed`입니다. Reader는 report digest만 믿지 않고 원본과 normalized observation에서 전체 report를 다시 만듭니다.

명령은 다음 형태입니다.

```text
pnpm release:bootstrap:reconcile \
  --publication-authorization <absolute-path> \
  --bootstrap <absolute-path> \
  --arming-authorization <absolute-path> \
  --reservation-root <absolute-path> \
  --online [--json]
```

명시적 online 경계가 없으면 파일을 읽지 않습니다. Source reader는 세 계약 파일과 저장 snapshot을 관측 전후 다시 확인합니다. 저장 adapter의 `inspect`는 누락 root나 reservation directory를 만들지 않습니다. 정상 exit code는 report 생성 성공만 뜻하며 outcome과 관계없이 stdout에만 출력합니다. 결과 파일, prompt, 예약·terminal, publish, retry와 외부 설정 변경은 없습니다.

오류에는 경로·credential·registry 원문·다른 digest나 tag 값을 넣지 않습니다. 새 runtime event·project 상태·telemetry는 만들지 않으며 세 outcome은 reconciliation report 안에서만 사용합니다.

## 결과

운영자는 불명확한 최초 게시 결과를 blind retry 없이 세 종류로 구분할 수 있습니다. Exact public release가 보여도 기존 unknown terminal은 보존되고 후속 복구 권한은 별도 결정으로 남습니다. Public npm에서 아무것도 보이지 않아도 자동 재시도는 열리지 않습니다.

Fixture는 exact 게시 관측, 둘 다 미관측, 부분 일치, digest 불일치, registry 실패, redigested outcome 위조, 다른 terminal, 관측 중 source 변경, 누락 root 무생성과 bounded 응답을 검증합니다. 실제 npm 게시, 2FA, private package 부재나 전환 완료는 주장하지 않습니다.
