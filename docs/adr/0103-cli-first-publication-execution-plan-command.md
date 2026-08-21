# ADR-0103: CLI 최초 공개 게시 실행 계획 조회 명령

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0102의 실행 계획은 순수 생성 API와 reader로만 볼 수 있었습니다. 운영자가 이를 확인하려고 별도 스크립트를 조합하면 어떤 파일을 읽었는지, 조회 중 원본이 바뀌지 않았는지, 조회가 온라인 사전 점검이나 실행 준비를 뜻하는지 일관되게 보장하기 어렵습니다.

계획 조회는 실제 실행에 가까워 보이지만 게시 활성화와는 다른 작업입니다. 그러므로 이 명령에 registry 관측, 예약이나 publisher를 연결해서는 안 됩니다.

## 결정

저장소 명령 `pnpm release:bootstrap:plan`을 추가합니다.

```text
--publication-authorization <절대 경로>
--bootstrap <절대 경로>
[--json]
```

두 입력은 각각 64 KiB 이하 regular file로 읽습니다. Publication authorization과 bootstrap을 검증해 ADR-0102의 canonical plan을 만들고, 출력 직전 두 파일이 처음 읽은 bytes와 같은지 다시 확인합니다. 조회 중 하나라도 바뀌면 결과를 출력하지 않습니다.

상대 경로, 빠진 값, 중복되거나 알 수 없는 인자와 `--online`은 파일을 읽기 전에 거부합니다. 명령 조정기에는 tarball, public registry, npm profile, reservation store와 publisher port를 전달하지 않습니다. 결과는 stdout에만 쓰고 문서를 만들지 않습니다.

기본 한국어 출력은 다음을 사람이 바로 구분할 수 있는 문장으로 보여 줍니다.

- 대상 package·version·dist-tag
- 실행 권한이 없고 활성화 기능도 구현되지 않았다는 상태
- 실제 실행 때 다시 확인할 다섯 조건
- 고정된 8단계 실행 순서와 두 사람 확인 문구
- 예약 전, 예약 뒤 게시 전, 게시 시작 뒤의 서로 다른 취소 처분
- 온라인 확인, 사람 확인 요청, 예약, 활성화와 게시를 하지 않았다는 경계

`--json`은 canonical execution plan v1만 출력합니다. 두 출력 모두 정상적으로 계획을 만들면 exit code 0입니다. 이는 조회 명령의 성공이지 preflight `ready`, arming이나 게시 권한이 아닙니다.

입력 경로, 승인자, npm profile·사용자명, user config, credential과 외부 출력 원문은 출력하지 않습니다. 입력·schema·원본 변경 실패는 제한된 오류 code와 고정된 문장으로만 알립니다. 새 runtime event·project 상태·telemetry는 없습니다.

파일 읽기와 snapshot 재검사는 preflight command와 공통 모듈을 사용합니다. 계획 생성 조정, 사람용 formatter와 프로세스 인자 처리는 서로 분리해 이후 다른 표시 방식이 생겨도 실행 정책과 파일 경계를 바꾸지 않게 합니다.

## 결과

Fixture는 실제 계약 파일 조회, `not_armed`·`not_implemented` JSON, 자연스러운 한국어 경계, 조회 중 파일 변경, 상대·중복·online·알 수 없는 인자 거부와 결과 파일 비생성을 확인합니다.

이 명령은 artifact freshness, public package 부재, npm 준비, 예약 가능 여부, 2FA·bypass token 상태나 게시 성공을 관측하거나 주장하지 않습니다. 실제 게시 활성화는 package identity·license·scope owner와 별도 승인 결정을 먼저 요구합니다.
