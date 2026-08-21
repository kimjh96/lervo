# ADR-0104: CLI 최초 공개 게시 활성화 차단 보고서

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0103은 실제 게시 순서와 위험 경계를 볼 수 있게 했지만, 현재 저장소에서 무엇을 고칠 수 있고 무엇을 외부에서 확인해야 하는지는 한눈에 구분하지 못했습니다. 기존 Trusted Publisher readiness는 예상 GitHub 저장소를 인자로 받아 npm·GitHub 상시 게시 설정까지 확인하므로, 아직 정하지 않은 저장소나 scope 권한을 최초 게시 결정으로 대신할 수 없습니다.

현재 package manifest와 release manifest에는 공개 저장소가 없고 라이선스는 `UNLICENSED`이며 public registry와 provenance도 확정되지 않았습니다. 반면 public npm 이름 가용성, `@lervo` scope 관리 권한과 게시 승인은 로컬 파일만으로 알 수 없습니다.

## 결정

저장소 명령 `pnpm release:bootstrap:blockers [--json]`를 추가합니다. 명령은 고정된 `apps/cli/package.json`과 `apps/cli/release-artifact-manifest.json`만 읽으며 각 파일은 1 MiB 이하 regular file이어야 합니다. Report 생성 뒤 두 snapshot의 bytes를 다시 대조하고 바뀌었으면 출력하지 않습니다.

Report v1은 다음 상태를 고정합니다.

```json
{
  "status": "blocked",
  "activation": "not_implemented",
  "advisoryOnly": true
}
```

로컬 검사는 다음 네 항목입니다.

- `package_identity`: `@lervo/cli`, release version, 공개 package와 public access
- `repository_metadata`: 두 manifest의 유효한 같은 GitHub 저장소
- `license_metadata`: `UNLICENSED`가 아닌 두 manifest의 같은 라이선스
- `publication_metadata`: 두 manifest의 public npm registry와 명시적인 provenance 활성화

각 검사는 `ready|blocked`와 제한된 reason code만 가집니다. Repository와 license는 두 원본이 모두 유효하고 같을 때만 target에 나타납니다. 두 manifest의 digest와 검사 결과는 report digest에 결속하며 reader는 원본에서 전체 report를 다시 계산합니다.

다음 세 항목은 로컬 차단과 섞지 않고 `required` external requirement로 둡니다.

- public npm에서 package 이름을 사용할 수 있다는 온라인 관측
- 실제 `@lervo` npm scope 관리 권한에 대한 사람 확인
- 라이선스·이름·scope·수동 최초 게시 1회·stage-only 전환을 묶은 별도 승인

`required`는 부재나 실패를 관측했다는 뜻이 아닙니다. 이 보고서가 해당 외부 사실을 읽지 않으며 후속 관측·확인이 필요하다는 뜻입니다. 로컬 검사 네 개가 모두 ready여도 external requirement와 미구현 activation 때문에 전체는 blocked입니다.

기본 한국어 출력은 로컬 해결 항목과 외부 확인 항목을 별도 문단으로 보여 줍니다. `--json`은 canonical report v1을 출력합니다. 정상 조회는 exit code 0이며 이는 blocker 해소나 활성화 가능을 뜻하지 않습니다. 소비자는 report의 `status`를 확인해야 합니다. 그 밖의 인자와 `--online`은 원본을 읽기 전에 거부합니다.

명령에는 online observer, approval writer, patch·reservation·publisher port가 없습니다. `metadata=not_changed`를 포함한 무부작용 상태를 report digest에 묶습니다. 경로·digest는 사람용 출력에 넣지 않고 오류에는 원본 내용·경로를 넣지 않습니다. 결과 파일, runtime event·project 상태·telemetry를 만들지 않습니다.

## 결과

Fixture는 현재 로컬 차단과 세 외부 요구사항, 로컬 metadata가 모두 완성돼도 blocked인 경계, redigest한 ready 위조, snapshot 변경, 결과 파일 비생성, 자연스러운 한국어, canonical JSON과 인자·원본 오류 비노출을 확인합니다.

이 보고서는 repository·license·scope owner를 선택하거나 package 파일을 고치지 않습니다. 다음 단계는 명시적으로 받은 metadata 결정에서 필요한 변경만 계산하는 비쓰기 preview이며 실제 적용·승인·게시 활성화는 계속 별도 작업입니다.
