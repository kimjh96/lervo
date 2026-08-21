# ADR-0115: CLI 최초 공개 게시 transition evidence union

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

정상 최초 게시 경로에는 publisher receipt에 결속된 execution receipt v2가 있습니다. 결과 불명 뒤 복구 경로에는 public npm 재관측과 사람 검토에 결속된 reconciliation resolution이 있습니다. 두 문서는 증거의 출처와 보장 범위가 다르므로 resolution을 execution receipt 형태로 다시 만들면 안 됩니다.

하지만 stage-only 전환 정책을 증거별로 복제하면 workflow·npm trust·GitHub environment 조건이 서로 달라질 수 있습니다. 또한 기존 전환은 execution receipt만 받고 public package를 fresh 확인하지 않아, receipt 뒤 package metadata나 dist-tag가 달라진 경우를 별도 차단하지 못했습니다.

## 결정

Transition publication evidence를 exact-key tagged union으로 정의합니다.

- `execution_receipt`: execution receipt v2 하나만 가지며 원래 bootstrap·arming authorization·publication authorization에 다시 검증합니다.
- `reconciliation_resolution`: resolution, reviewed reconciliation report, decision, reservation v2와 immutable unknown terminal을 모두 가지며 resolution source-bound validator를 다시 실행합니다.

Member에 다른 type의 필드를 넣거나 필수 source를 생략하면 거부합니다. 검증된 union은 다음 공통 좌표만 반환합니다.

- 원래 `type`
- execution receipt 또는 resolution의 exact digest
- `publishedAt` 또는 `resolvedAt`에서 온 evidence 시각
- `publisher_receipt_verified` 또는 `public_registry_reconciliation_reviewed` basis

이는 provenance 정규화이지 의미 통합이 아닙니다. Resolution을 execution receipt로 변환하거나 2FA proof를 복구했다고 표현하지 않습니다.

ADR-0113의 public npm observation 검증과 exact version·integrity·shasum·dist-tag 판정을 공용 순수 정책으로 분리합니다. Reconciliation report의 기존 outcome과 checks는 바뀌지 않습니다. Transition은 같은 정책을 단일 `exact_public_release` 검사로 접고, 미관측·부분 일치·digest 불일치·registry unavailable을 모두 blocked로 둡니다.

Transition report v2는 다음을 결속합니다.

- bootstrap digest
- normalized publication evidence의 type·digest·evidenceAt·basis
- evidence 시각 이후인 transition 관측 시각
- exact public release
- stage-only workflow
- npm Trusted Publisher
- GitHub protected environment

Stage-only 세 검사의 세부 조건은 ADR-0098을 유지합니다. 네 검사가 모두 ready일 때만 transition receipt v2를 만들 수 있습니다.

Transition receipt v2는 두 경로에서 공통으로 다음을 기록합니다.

- `completed`, bootstrap `consumed`
- `trusted_publisher_stage_only`
- workflow `cli-release-matrix.yml`, environment `npm-release`
- permission `createStagedPackage`, direct publish `forbidden`
- fresh public release target·registry integrity·shasum과 관측 시각

동시에 normalized publication evidence 전체를 남겨 두 경로의 type·digest·basis를 구분합니다. Report digest는 evidence provenance를 포함하므로 두 경로에서 달라지는 것이 정상입니다. Reader는 receipt digest만 믿지 않고 union과 네 관측 원본에서 receipt를 다시 만듭니다. 기존 transition report·receipt v1은 새 필수 public release와 evidence provenance가 없어 자동 변환하지 않고 거부합니다.

오류에는 actor·credential·reviewer·trust ID·외부 응답 원문을 넣지 않습니다. `first_publication_transition_evidence_invalid`는 union type·field 조합이 잘못됐다는 뜻이고 `first_publication_public_release_observation_invalid`는 공용 관측 schema가 잘못됐다는 뜻입니다. 기존 transition input·not ready·receipt 오류는 유지합니다.

현재 구현은 provider-neutral 순수 코어와 fixture입니다. 호출자가 같은 전환 수명주기의 workflow·public npm·npm trust·GitHub 관측을 전달해야 하며, 코어가 network freshness나 source snapshot을 직접 보장한다고 주장하지 않습니다. 이를 연결하는 CLI, 외부 설정 변경과 workflow 활성화는 아직 없습니다. 새 runtime event·project 상태·telemetry도 만들지 않습니다.

## 결과

정상 게시와 reconciled 게시의 증거 차이는 보존되지만 완료 정책은 하나입니다. 어느 경로도 public release나 stage-only control 하나를 생략할 수 없고, resolution 경로가 execution receipt 권한을 얻지 않습니다.

Fixture는 두 경로의 공통 완료 의미와 다른 provenance, 동일 public release 차단, 혼합·누락 union, source 불일치, evidence보다 이른 관측, legacy v1과 redigested basis를 검증합니다. 실제 network freshness·source snapshot·npm 게시·2FA·외부 설정이나 workflow 활성화는 주장하지 않습니다.
