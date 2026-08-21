# ADR-0105: CLI 최초 공개 게시 metadata 결정과 비쓰기 변경 preview

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0104는 현재 로컬 차단 항목을 보여 주지만 repository·license·npm scope owner를 선택하거나 어떤 파일 필드가 달라지는지는 계산하지 않습니다. 이 값을 명령 인자로 받자마자 package 파일에 쓰면 선택 검토, 현재 원본 대조와 실제 적용 권한이 한 단계에 섞입니다.

Release manifest는 package와 build 결과에서 만드는 생성 원본입니다. Package metadata와 함께 두 파일을 직접 patch하면 생성 경계를 우회하고 digest를 수동으로 맞추게 됩니다.

## 결정

저장소 명령을 추가합니다.

```text
pnpm release:bootstrap:metadata-preview \
  --repository <owner/repository> \
  --license <license> \
  --scope-owner-kind <organization|user> \
  --scope-owner-name lervo \
  [--json]
```

입력은 metadata decision v1으로 정규화합니다. Decision은 `first_publication_metadata_selection`, `authority=preview_only`이며 `approval=not_granted`, `scopeControl=not_confirmed`, `packageAvailability=not_observed`를 고정합니다. Repository는 제한된 GitHub 좌표이고 scope owner name은 package scope와 같은 `lervo`여야 합니다. License는 1~128자, 앞뒤 공백과 control·format 문자 없음, `UNLICENSED` 아님만 확인합니다. 이는 SPDX 문법 검사, 법률 검토나 공개 배포 승인이 아닙니다.

Preview는 ADR-0104와 같은 고정 package·release manifest snapshot을 사용합니다. Package identity·version·public access가 현재 계약과 다르면 metadata 결정으로 함께 고치지 않고 실패합니다. 다음 네 package 필드만 비교합니다.

- `repository`
- `license`
- `publishConfig.registry`
- `publishConfig.provenance`

다른 값은 preview에 복사하지 않고 `currentState=missing|different`만 남깁니다. 변경은 `source=package_manifest`, `operation=set`과 선택한 새 값만 가집니다. 선택과 이미 같으면 change를 만들지 않습니다.

Release manifest에는 직접 patch를 만들지 않습니다. Package change가 있거나 현재 artifact metadata가 선택과 다르면 다음 처분만 기록합니다.

```json
{
  "status": "required",
  "action": "regenerate_after_package_metadata_update",
  "directPatch": "forbidden"
}
```

Preview 전체 상태는 `changes_required|no_local_changes`이고 activation은 `not_implemented`, advisory-only입니다. 로컬 변경이 없어도 license 승인, public npm 이름 관측, scope control 확인과 별도 최초 게시 승인은 required입니다. Decision과 두 source digest, exact change·regeneration·remaining requirement·side effect를 canonical preview digest에 묶고 reader는 원본에서 전체를 다시 계산합니다.

정상 출력은 exit code 0입니다. Human formatter는 선택한 repository·license·scope owner와 필요한 변경을 자연스러운 한국어로 보여 주되 source digest·경로·기존 다른 값은 표시하지 않습니다. `--json`은 canonical preview만 출력합니다. 중복·누락·알 수 없는 인자와 `--online`은 source read 전에 거부합니다.

명령에는 filesystem writer, release generator, online observer, approval·reservation·publisher port가 없습니다. Metadata·release manifest·외부 설정을 바꾸지 않고 결과 파일, runtime event·project 상태·telemetry도 만들지 않습니다. 오류는 입력값, 원본 내용이나 경로를 복사하지 않습니다.

## 결과

Fixture는 현재 네 변경, 이미 일치하는 metadata, 기존 값 비노출, source identity 범위 이탈, redigest activation·approval 위조, snapshot 변경, 자연스러운 한국어, canonical JSON, 인자 비노출과 두 manifest byte 보존을 확인합니다.

이 preview에는 실제 결과 bytes가 없어 적용할 수 없습니다. 다음 단계는 preview·source digest에 결속된 exact package manifest candidate bytes를 만들되 쓰지 않는 계약이며, 실제 적용은 별도 permit 뒤에만 가능합니다.
