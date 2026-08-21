# ADR-0107: CLI 최초 공개 게시 package metadata 적용 허가

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0106의 candidate는 현재 `package.json` 원본과 exact 결과 바이트를 결속하지만 `writesAllowed=false`입니다. 후보를 만들었다는 사실만으로 적용을 허용하면 사용자가 실제로 검토한 대상과 적용할 대상이 같은지 확인할 수 없습니다.

반대로 허가 생성과 파일 교체를 한 명령에 넣으면 사람의 결정, 권한 문서와 filesystem side effect가 섞입니다. 원본이 검토 뒤 달라졌을 때 어떤 내용을 덮어썼는지도 불명확해집니다.

## 결정

저장소 명령을 추가합니다.

```text
pnpm release:bootstrap:metadata-permit \
  --repository <owner/repository> \
  --license <license> \
  --scope-owner-kind <organization|user> \
  --scope-owner-name lervo \
  --reviewed-candidate-digest <sha256:...> \
  --reviewed-source-sha256 <sha256:...> \
  --reviewed-output-sha256 <sha256:...> \
  --confirm-reviewed-candidate \
  [--json]
```

사용자는 먼저 candidate의 JSON metadata와 별도 `--package-json` 결과를 검토해야 합니다. Permit 명령에는 검토한 candidate digest, package source SHA-256과 output SHA-256을 모두 다시 제출하고 `--confirm-reviewed-candidate`를 명시합니다. 이 확인은 사람의 진술이며 검토 행위나 검토자 신원을 시스템이 독립적으로 증명한다는 뜻이 아닙니다.

조정기는 현재 package·release manifest snapshot에서 metadata decision, preview, candidate metadata와 exact output bytes를 다시 만듭니다. Candidate validator도 같은 원본에서 다시 실행합니다. 세 reviewed digest가 재계산 결과와 모두 같을 때만 apply permit v1을 만듭니다.

Permit은 다음을 결속합니다.

- `status=apply_permitted`, `permitType=first_publication_package_metadata_apply`
- 고정 package·version·상대 경로와 선택한 repository·license·scope owner
- candidate digest, package source byte count·SHA-256, output byte count·SHA-256
- `actorKind=human_operator`, `decision=approve_exact_package_metadata_apply`, `confirmation=reviewed_exact_candidate`
- package manifest는 source가 같을 때만 교체, release manifest는 package 변경 뒤 재생성, release manifest 직접 patch 금지
- 권한 범위 `local_package_metadata_only`
- replay 방어 범위 `source_compare_and_swap`
- 이 명령에서 metadata·release manifest·승인·activation·게시를 바꾸지 않았다는 처분

`source_compare_and_swap`은 durable 소비 기록이나 영구적인 단일 사용 증명이 아닙니다. 이후 적용기가 현재 source SHA-256을 다시 검사해야 하며, source가 바뀌면 permit을 사용할 수 없습니다. 원본을 과거 bytes로 되돌린 경우까지 막는 durable replay store는 이 permit이 제공하지 않습니다.

기본 사람용 출력은 선택한 비민감 metadata, 조건부 권한과 실제로 하지 않은 작업을 자연스러운 한국어로 설명하고 digest·경로는 보여 주지 않습니다. `--json`은 canonical digest가 붙은 permit만 stdout에 출력합니다. 기존의 다른 값과 package 본문은 permit에 복사하지 않습니다. 사용자가 shell redirect로 JSON을 저장할 수 있지만 명령 자체는 결과 파일을 만들거나 덮어쓰지 않습니다.

명령에는 filesystem writer, release generator, online observer, reservation·publisher port가 없습니다. Package·release manifest, 승인·activation·게시 상태, runtime event·project 상태·telemetry를 바꾸지 않습니다.

## 실패 의미

- `first_publication_package_metadata_apply_permit_arguments_invalid`: 필수 인자나 확인이 누락·중복되었거나 알 수 없는 인자, `--online`, `--package-json` 또는 겹치는 output mode가 있습니다. Source를 읽기 전에 실패합니다.
- `first_publication_package_metadata_apply_review_invalid`: 확인 종류나 actor kind가 고정 계약과 다르거나 제출한 세 digest 중 하나가 현재 재계산 결과와 다릅니다. 검토한 후보에 대한 허가를 만들 수 없습니다.
- `first_publication_package_metadata_apply_permit_invalid`: decision·candidate·output bytes 또는 permit의 권한·binding·digest가 전체 재계산 결과와 다릅니다. 허가를 신뢰하거나 적용에 사용할 수 없습니다.
- Source·decision·preview·candidate 선행 오류는 기존 제한된 code를 유지합니다. 오류에는 제출한 digest, 입력값, 원본 내용이나 경로를 복사하지 않습니다.

## 결과

Fixture는 세 exact binding, 조건부 최소 권한, reviewed digest·확인·actor 불일치, 추가 review field, candidate bytes 변경, redigest 권한 확장, 다른 candidate 재사용, 생성 중 source 변경, 사람용 문장, JSON 출력과 두 manifest byte 보존을 확인합니다.

다음 단계는 permit과 현재 source에서 candidate를 다시 계산한 뒤 package metadata와 그에 따른 생성 원본을 일관되게 갱신하는 적용 transaction입니다. Atomicity와 실패 시 rollback 처분을 먼저 고정한 뒤에만 실제 writer를 엽니다.
