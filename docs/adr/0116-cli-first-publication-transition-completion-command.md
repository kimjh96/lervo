# ADR-0116: CLI 최초 공개 게시 transition 완료 명령

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0115는 정상 execution receipt와 검토된 reconciliation resolution을 구분하면서 동일한 전환 정책으로 수렴시키는 순수 코어를 만들었습니다. 그러나 호출자가 전달한 workflow와 외부 관측만 평가하므로 실제 파일 snapshot, 같은 online 수명주기와 결과 파일 생성은 보장하지 않았습니다.

전환 완료 명령이 evidence 종류를 추정하거나 일부 source를 생략하면 resolution이 execution receipt처럼 보일 수 있습니다. 외부 관측 전후로 workflow나 evidence가 바뀌거나 준비되지 않은 control을 영수증으로 남기는 것도 막아야 합니다.

## 결정

`release:bootstrap:transition`을 source reader, online 조정기, 순수 transition 코어와 immutable writer로 분리합니다.

공통 입력은 publication authorization, bootstrap, arming authorization, workflow와 새 output의 절대 경로, 명시적 `--online`입니다. Publication evidence는 다음 중 정확히 하나입니다.

- `--execution-receipt`
- `--resolution`, `--reconciliation-report`, `--decision`, `--reservation-root` 전체

두 경로를 섞거나 resolution source 일부만 주면 파일을 열기 전에 거부합니다. JSON evidence는 파일별 최대 64 KiB, workflow YAML은 최대 256 KiB regular file로 읽습니다. Symlink, 빈 파일, 초과 파일과 파싱 실패는 source invalid입니다.

Execution 경로는 receipt v2를 원래 세 계약에 다시 결속합니다. Resolution 경로는 resolution, reviewed report, decision과 현재 reservation·immutable `publication_unknown` terminal을 source-bound validator로 다시 확인합니다. Workflow는 구조화된 snapshot으로 읽되 policy 판정은 기존 전환 코어만 소유합니다.

로컬 source 검증 뒤 다음 세 observer를 한 online 수명주기에서 실행합니다.

1. Public npm exact version metadata와 dist-tag
2. npm Trusted Publisher
3. GitHub `npm-release` environment

관측이 모두 끝난 한 시각으로 report v2를 만듭니다. Public release, workflow, npm trust와 GitHub environment 네 검사 중 하나라도 ready가 아니면 완료하지 않습니다. 그 뒤 모든 계약·evidence·workflow bytes와 resolution 저장 snapshot을 다시 확인합니다. 변경이 없을 때 receipt v2를 재생성하고 source-bound reader로 검증합니다.

Writer는 self-contained receipt 구조와 digest를 다시 확인한 뒤 새 절대 output만 `wx`로 생성합니다. 공백 2칸 JSON과 마지막 LF를 사용하며 기존 output은 덮어쓰지 않습니다. Receipt에는 normalized evidence provenance와 public release 좌표만 있고 source 경로, actor, reviewer, npm trust ID, credential과 외부 응답 원문은 없습니다.

명령은 public npm, npm과 GitHub를 읽기만 합니다. 최초 게시, workflow나 외부 control 설정, reservation·terminal 변경, runtime event·project 상태·telemetry 생성을 실행하지 않습니다. 따라서 성공은 관측 시점에 exact release와 stage-only control이 함께 확인되어 transition receipt가 생성됐다는 의미이며, 과거 설정 과정이나 장래 workflow 실행 성공을 증명하지 않습니다.

## 결과

두 evidence 경로는 같은 CLI 완료 경계를 사용하지만 출처는 receipt에 그대로 남습니다. Online 관측 중 source가 바뀌거나 외부 control이 불완전하면 새 파일이 생기지 않고, reconciled unknown 저장 상태도 변경되지 않습니다.

Fixture는 두 실제 source 경로, 세 observer 실행, source 경쟁, blocked control, offline 선행 거부, bounded workflow, 기존 output 보존, 혼합·부분·중복·상대 인자와 권한 상향 재해시를 검증합니다. 실제 npm 게시, 2FA, workflow·npm·GitHub 설정 변경이나 원격 workflow 성공은 주장하지 않습니다.

> 후속 결정: [ADR-0117](./0117-cli-first-publication-stage-only-workflow-candidate.md)은 비활성 workflow에 추가할 exact `publish-cli` job을 byte-preserving 검토 후보로 만듭니다. Stage publication command가 없으면 후보를 만들지 않으며 적용이나 외부 설정 변경은 여전히 하지 않습니다.
