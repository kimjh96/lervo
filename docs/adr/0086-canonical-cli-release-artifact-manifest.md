# ADR-0086: Canonical CLI release artifact manifest

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

설치 smoke는 production dependency를 조립한 CLI가 실행되는지 확인하지만, release archive에 어떤 파일이 들어가는지와 dependency closure가 의도적으로 바뀌었는지는 고정하지 않았습니다. 실제 CLI pack 결과에는 `src`, `test`, `tsconfig`와 build cache까지 178개 항목이 포함되어 있었습니다. 실행에 필요하지 않은 파일을 배포하면 archive가 커지고 내부 fixture와 source가 공개 경계에 섞입니다.

같은 내용으로 pack한 tarball도 생성 metadata 때문에 archive byte checksum이 달라질 수 있습니다. Tarball 전체 hash를 승인값으로 두면 실제 내용 변화와 무관한 실패가 생기므로 내용 기반 canonical checksum 경계가 필요합니다. Native provider package는 운영체제와 CPU에 따라 이름이 달라져 한 platform에서 관측한 전체 dependency 이름을 다른 platform의 고정값으로 사용할 수도 없습니다.

## 결정

CLI package의 공개 파일은 `dist/**/*.js`, `dist/**/*.d.ts`와 npm이 항상 포함하는 `package.json`으로 제한합니다. `pnpm pack --dry-run --json`의 실제 file list를 읽으며 그 밖의 root 파일, source, test, 설정과 `.tsbuildinfo`가 하나라도 포함되면 실패합니다.

`apps/cli/release-artifact-manifest.json`은 schema version 1의 교체형 release 원본입니다. 실행별 결과를 이어 붙이지 않으며 다음 값을 가집니다.

- package name·version·private·module type, bin·main·types와 공개 file pattern
- workspace version으로 정규화한 직접 production dependency 좌표
- 정렬된 각 dist 파일의 path, byte 수와 SHA-256 및 전체 canonical content digest
- 임시 production deploy에서 발견한 정렬·중복 제거 portable dependency closure와 canonical digest
- OS·CPU에 묶인 package를 portable 목록과 섞지 않기 위한 name prefix·version family
- 위 identity와 digest를 다시 결속한 최종 artifact digest

Canonical digest는 정렬된 JSON 값에 고정 newline을 붙여 SHA-256으로 계산합니다. Tar header, 생성 시각, 임시 경로, symlink 위치와 platform 이름은 digest 입력에 넣지 않습니다. 현재 Claude Agent SDK native package는 `@anthropic-ai/claude-agent-sdk-` prefix와 정확한 version family로 관리합니다. 설치된 package manifest가 OS 또는 CPU 제한을 선언하면서 승인 family와 맞지 않으면 dependency 이름을 오류에 복사하지 않고 실패합니다.

`pnpm release:manifest:update`만 manifest를 통째로 다시 쓰며 `pnpm release:manifest:check`와 `pnpm check`는 읽기 전용입니다. Check는 build 뒤 pack file list와 임시 deploy를 새로 만들고 승인 manifest의 자체 digest를 먼저 검증한 뒤 실제 identity, archive, dependency와 최종 digest를 비교합니다. 차이는 제한된 section 이름만 출력합니다. 파일 hash 변경, dependency 누락, stale digest와 bounded 오류 출력을 별도 회귀 테스트로 검증합니다.

새 runtime event, project 상태나 telemetry는 없습니다. 임시 deploy는 성공·실패 모두 제거하며 manifest에는 사용자 경로, payload, credential이나 임시 위치를 기록하지 않습니다.

## 결과

CLI archive는 103개 항목으로 제한되고 source·test·build cache가 배포 경계에서 빠집니다. 코드나 선언 파일, package identity, 직접 dependency 또는 production closure가 달라지면 manifest를 명시적으로 검토·갱신하지 않는 한 CI가 실패합니다.

이 manifest는 로컬 pack·deploy 내용 계약이며 tarball 서명, SBOM, npm registry 게시, 외부 다운로드와 모든 platform의 실행 성공을 증명하지 않습니다. CLI가 참조하는 private workspace package를 어떤 단위로 배포할지도 별도 결정이 필요합니다.
