# ADR-0108: CLI 최초 공개 게시 package metadata 적용 transaction

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0107의 permit은 exact package source와 candidate output에 조건부 쓰기 권한을 부여하지만 실제 파일은 바꾸지 않습니다. `package.json`만 교체하면 release manifest와 SBOM이 이전 metadata를 계속 가리키므로 저장소가 즉시 불일치 상태가 됩니다.

일반 filesystem에는 서로 다른 세 파일을 한 번에 commit하는 원시 연산이 없습니다. 각 파일을 순서대로 rename하면서 이를 완전한 다중 파일 원자성이라고 부르면 프로세스 중단 순간의 혼합 상태를 숨기게 됩니다.

## 결정

명시적인 쓰기 명령과 복구 mode를 추가합니다.

```text
pnpm --silent release:bootstrap:metadata-apply \
  --permit <absolute-path> \
  --write \
  --json

pnpm release:bootstrap:metadata-apply --recover
```

Apply는 absolute permit과 `--write`를 모두 요구합니다. Permit에서 metadata decision과 review binding을 복원하고 현재 package·release manifest에서 preview, candidate metadata와 exact package bytes를 다시 만듭니다. Permit 전체도 재검증합니다. Permit·package manifest·release manifest·release SBOM·lockfile은 제한된 regular-file snapshot으로 읽고 첫 write 직전까지 bytes가 같은지 확인합니다.

세 결과는 write 전에 모두 메모리에서 만듭니다.

1. Candidate의 exact `package.json`
2. Candidate package manifest를 override로 받은 기존 production release generator의 release manifest
3. 새 release manifest와 snapshot lockfile에서 결정적으로 만든 CycloneDX SBOM

현재 release manifest·SBOM도 먼저 각각의 validator를 통과해야 합니다. 새 release manifest는 repository·license·registry·provenance와 그로부터 바뀐 artifact digest를 제외한 모든 section이 현재 manifest와 같아야 합니다. 따라서 build·dependency·archive 등 다른 변경을 metadata transaction에 섞은 generator 결과는 거부합니다. Release manifest를 수동 direct patch하지 않고 production generator 결과 전체를 검증합니다.

Apply plan v1은 permit·candidate digest, 쓰는 세 파일의 before/after byte count·SHA-256, 읽기 전용 permit·lockfile digest와 다음 처분을 결속합니다.

- 모든 source를 첫 write 전에 compare-and-swap
- 원본 file mode를 보존한 staged replace
- recovery journal 사용
- 동기 실패 시 세 원본 모두 rollback
- 프로세스 중단 시 새 apply를 막고 명시적 recovery 요구

Filesystem adapter는 고정된 `apps/cli/.lervo-metadata-apply-transaction` directory를 exclusive하게 만듭니다. Stage와 journal은 owner-only이고 원본 파일은 transaction 안으로 옮겨 보존합니다. 각 원본 이동과 새 파일 게시 뒤 journal을 갱신합니다. 정상 완료는 세 after digest와 permit·lockfile 불변을 확인한 뒤 commit을 기록하고 모든 임시 파일을 제거합니다. Target의 기존 permission mode도 보존합니다.

동기 예외는 게시 순서의 어느 지점이든 보존한 원본을 역순으로 복원하고 before digest를 다시 확인합니다. 복구까지 실패하면 `rollback_failed`로 닫고 transaction directory를 남깁니다. 프로세스 중단을 자동 rollback으로 추정하지 않습니다. 다음 apply는 source를 읽기 전에 막히며 `--recover`를 명시해야 합니다. Journal이 pre-commit이면 세 원본으로 되돌리고, commit 뒤 cleanup만 중단됐다면 after digest를 확인한 뒤 새 결과를 유지하고 임시 기록만 제거합니다. 실행 중인 PID의 journal은 recovery가 건드리지 않습니다.

이 방식은 동기 실패에 대한 all-file rollback과 중단 뒤 결정적 복구를 제공하지만 전원 손실 순간까지 세 경로가 동시에 바뀌는 완전한 filesystem transaction은 아닙니다. Recovery 전에는 혼합 상태가 보일 수 있으므로 journal이 남아 있으면 release·게시 흐름을 계속하면 안 됩니다. Durable 단일 사용 permit store도 만들지 않습니다.

성공 receipt v1은 `status=applied`, plan·permit·candidate digest, 세 before/after binding, journal 제거와 package metadata 변경·release manifest/SBOM 재생성 처분을 결속합니다. 기본 한국어 출력은 실제 변경과 하지 않은 작업을 설명하고 digest·경로는 보여 주지 않습니다. `--json`은 receipt를 stdout에만 출력하며 기계가 읽을 때는 `pnpm --silent`로 package manager 안내를 제외합니다. 별도 receipt 파일, runtime event·project 상태·telemetry는 만들지 않습니다.

Apply는 package manifest, release manifest와 release SBOM만 바꿉니다. Permit·lockfile, 승인·activation·외부 설정을 바꾸지 않고 온라인 관측이나 package publish를 실행하지 않습니다. Transaction 임시 원본에는 세 파일 본문이 잠시 들어가지만 Hub나 stdout으로 내보내지 않고 정상 완료·rollback·recovery 뒤 제거합니다.

## 실패 의미

- `first_publication_package_metadata_apply_arguments_invalid`: absolute permit·`--write`가 없거나 apply와 recovery 인자가 섞였거나 중복·알 수 없는 인자·`--online`이 있습니다. Source read 전에 실패합니다.
- `first_publication_package_metadata_apply_source_invalid`: permit·SBOM JSON 포맷 또는 apply source 좌표가 올바르지 않습니다. Write는 시작되지 않습니다.
- `first_publication_package_metadata_release_regeneration_invalid`: 현재 release 원본이 손상됐거나 generator가 허용 metadata 이외를 바꿨거나 새 SBOM을 일관되게 만들지 못했습니다. Write는 시작되지 않습니다.
- `first_publication_package_metadata_apply_plan_invalid`: permit, source, generated output 또는 plan 전체가 재계산 결과와 다릅니다. Write는 시작되지 않습니다.
- `first_publication_package_metadata_apply_source_changed`: 첫 transaction state를 만들기 전 source compare-and-swap이 실패했습니다. 파일을 수정하거나 복구하지 않습니다.
- `first_publication_package_metadata_apply_failed`: compare-and-swap 또는 staged publication이 실패했고 세 원본 복구와 검증을 완료했습니다.
- `first_publication_package_metadata_apply_recovery_required`: 중단 journal이 이미 있거나 적용 중단 뒤 자동 처분을 확정할 수 없습니다. 새 apply를 막고 명시적 recovery를 요구합니다.
- `first_publication_package_metadata_apply_busy`: journal의 owner process가 아직 살아 있어 recovery를 거부합니다.
- `first_publication_package_metadata_apply_recovery_not_found`: 복구할 transaction directory가 없습니다. 파일을 바꾸지 않습니다.
- `first_publication_package_metadata_apply_journal_invalid`: journal 형식·고정 파일 좌표·binding을 신뢰할 수 없어 경로를 추정하거나 복구하지 않습니다.
- `first_publication_package_metadata_apply_rollback_failed`: 보존 원본 복구나 before digest 확인을 완료하지 못했습니다. 정상 상태를 주장하지 않고 journal을 보존합니다.
- 선행 permit·candidate·release 검증 오류는 기존 제한된 code를 유지합니다. 오류는 permit 내용, 파일 본문·경로, PID나 digest를 복사하지 않습니다.

## 결과

Fixture는 production generator override, metadata 외 release 변경과 stale SBOM 거부, plan·receipt 위조 거부, 세 파일과 read-only source binding, exact apply, mode 보존, 7개 publication checkpoint의 all-file rollback, pre-commit interruption recovery, committed cleanup recovery, live owner·target redirect journal 거부, stale source의 write 전 거부, pending transaction의 source read 전 차단과 한국어 출력을 확인합니다. Built·packed·registry smoke는 미결정 `UNLICENSED`를 하드코딩하지 않고 source package metadata를 배포 결과에 대조하므로 적용 뒤에도 같은 검증 의미를 유지합니다. 현재 저장소의 실제 metadata에는 apply 명령을 실행하지 않았습니다.

다음 단계는 이 transaction의 결과를 다시 읽어 local blocker가 실제로 해소됐는지 확인하고, 아직 남은 license 승인·public package 이름·npm scope control 요구를 실행 권한과 섞지 않는 post-apply verification입니다.
