# ADR-0114: CLI 최초 공개 게시 reconciliation resolution

- 상태: 승인
- 날짜: 2026-08-21

> 후속 결정: [ADR-0115](./0115-cli-first-publication-transition-evidence-union.md)는 resolution을 별도 evidence member로 소비해 정상 execution receipt와 같은 stage-only 완료 정책에 연결합니다.

## 맥락

ADR-0113의 reconciliation report가 `published`여도 이는 public npm에서 exact artifact와 dist-tag를 관측했다는 뜻뿐입니다. 원래 publisher receipt, 2FA proof와 실행 영수증을 복구하지 않으며 immutable terminal은 계속 `publication_unknown`입니다. Report 필드와 digest만 다시 계산해 이를 실행 성공으로 바꾸거나 terminal을 덮어쓰면 증거의 출처와 한계를 잃습니다.

반대로 운영자가 exact report를 검토했고 public 상태가 계속 일치하는데도 후속 stage-only 전환 검토로 연결할 방법이 전혀 없으면 unknown 처리 이후의 안전한 복구 절차가 끊깁니다. 실행 성공을 재구성하지 않으면서 후속 검토 가능 여부만 별도 문서로 표현해야 합니다.

## 결정

Serialized reconciliation report 전용 reader를 추가합니다. Reader는 schema, canonical digest, target·binding·side effect·한계와 policy가 실제 만들 수 있는 check 조합을 확인합니다. 현재 publication authorization·bootstrap·arming authorization·reservation v2·unknown terminal에도 다시 대조합니다. 이 검증만으로 외부 사실을 새로 증명하거나 `published` 권한을 만들지는 않습니다.

사람이 작성하는 resolution decision v1은 다음을 가집니다.

- `res_` decision ID와 `authorize_reconciled_publication_transition_review`
- 결정·만료 시각과 `{ kind: "user", id }` actor
- exact package·version, bootstrap·reservation·terminal record·reviewed report digest
- exact published report 검토
- public registry 관측이 원래 publisher receipt가 아님
- 2FA proof가 복구되지 않음
- unknown terminal을 바꾸지 않음
- stage-only 전환에는 별도 fresh evidence가 필요함

결정은 reviewed report 관측 뒤에만 가능하고 report 관측부터 만료까지 전체 최대 10분입니다. Actor는 로컬 사람 진술이며 npm 권한이나 2FA proof가 아니고 resolution 결과에 복사하지 않습니다.

명령은 다음 입력을 받습니다.

```text
pnpm release:bootstrap:resolve \
  --publication-authorization <absolute-path> \
  --bootstrap <absolute-path> \
  --arming-authorization <absolute-path> \
  --reservation-root <absolute-path> \
  --reconciliation-report <absolute-path> \
  --decision <absolute-path> \
  --output <new-absolute-path> \
  --online
```

Reviewed report와 decision은 64 KiB 이하 regular file, 공백 2칸 JSON과 마지막 LF여야 합니다. Base 계약과 저장 snapshot을 포함한 모든 source를 읽은 뒤 public npm의 exact version metadata와 dist-tag를 다시 관측합니다. Fresh report도 `published`이고 reviewed report보다 늦을 때만 resolution을 만듭니다. 모든 source가 그대로인지 다시 확인한 뒤 새 output만 `wx`로 씁니다.

Resolution v1은 `status=transition_review_eligible`, `resolutionType=reconciled_first_publication`입니다. 다음을 canonical digest에 묶습니다.

- exact target과 bootstrap·arming·publication authorization
- reservation·unknown terminal record
- reviewed reconciliation report와 fresh reconciliation report
- decision ID와 digest, resolution 시각
- transition review만 eligible
- transition completion not authorized
- execution receipt not recovered
- retry forbidden
- unknown terminal과 terminal mutation forbidden
- 후속 exact public release·stage-only workflow·npm trust·GitHub environment fresh 검사
- 예약·terminal·execution receipt·게시·외부 설정 무변경

Fresh reconciliation report는 resolution 안에 포함해 후속 reader가 schema·outcome·관측 시각과 digest를 독립적으로 확인할 수 있게 합니다. Reviewed report는 사람이 검토한 별도 source 문서로 유지하며 decision과 resolution은 그 digest를 결속합니다.

Resolution은 execution receipt와 다른 증거 유형이며 `published_transition_pending`을 직접 만들지 않습니다. 후속 전환은 두 유형을 구분해 검증하면서 같은 stage-only 정책을 fresh 확인해야 합니다.

오류에는 actor·문서 원문·경로·credential·registry 원문·다른 digest나 tag를 넣지 않습니다. 새 runtime event·project 상태·telemetry는 만들지 않으며 `transition_review_eligible`은 이 문서 안에서만 사용합니다.

## 결과

Redigested report 하나나 오래된 사람 결정만으로 unknown 실행을 성공으로 승격할 수 없습니다. Fresh exact public 관측과 bounded 사람 검토가 모두 있어야 후속 전환 검토가 가능하며, 기존 terminal과 실행 증거의 의미는 바뀌지 않습니다.

Fixture는 reviewed·fresh published 결속, report·decision 불일치, decision 만료, fresh 미관측·순서 역전, actor 비노출, 권한 상향 redigest, canonical source, source 변경, output 비덮어쓰기와 reservation directory 무변경을 검증합니다. 실제 게시·2FA·execution receipt 복구·전환 완료나 외부 설정 변경은 주장하지 않습니다.
