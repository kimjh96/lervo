# ADR-0088: Packed CLI 소비자 설치 계약

- 상태: 승인
- 날짜: 2026-08-20

후속 결정: [ADR-0089](./0089-cli-multi-platform-release-matrix.md)은 packed smoke에 현재 platform의 Claude native 실행 파일 검사를 추가하고 같은 검사를 Linux·macOS·Windows에 배치합니다. [ADR-0090](./0090-cli-package-usage-guide.md)은 tarball의 공개 파일을 세 개로 늘리고 package README와 metadata 검사를 추가합니다.

## 맥락

임시 `pnpm deploy`는 빌드한 CLI와 저장소 lockfile의 dependency 조합을 확인합니다. `pnpm pack --dry-run`은 archive에 들어갈 파일을 알려 줍니다. 하지만 둘 다 실제 tarball을 빈 프로젝트에 설치했을 때 package manifest가 어떻게 바뀌는지, local bin이 생기는지, 그 명령이 실행되는지는 보여 주지 못합니다.

첫 소비자 설치 시험에서는 Claude Agent SDK의 넓은 peer 범위가 저장소에서 검증하지 않은 최신 Anthropic SDK를 고르면서 오프라인 설치가 실패했습니다. Peer 선택을 소비자 lockfile에 맡기면 같은 CLI version도 설치 시점에 따라 다른 조합이 될 수 있습니다.

## 결정

공개 CLI의 직접 dependency는 다음 네 개로 제한합니다.

- `@anthropic-ai/claude-agent-sdk@0.3.226`
- `@anthropic-ai/sdk@0.117.1`
- `@modelcontextprotocol/sdk@1.30.0`
- `zod@4.4.3`

뒤의 세 dependency는 Claude Agent SDK가 요구하는 peer입니다. CLI bundle에서 직접 import하지는 않지만 저장소에서 함께 검증한 조합을 소비자에게 제공합니다. Release manifest v2는 네 좌표를 모두 고정합니다. Bundle의 외부 import는 계속 Claude Agent SDK 하나입니다.

CLI package는 지원 Node version을 `>=22.13`으로 명시합니다. Build target과 package manifest, deploy smoke, tarball smoke와 release manifest가 모두 같은 값을 확인합니다.

`pnpm smoke:packed-cli`는 build 뒤 다음 순서로 실행합니다.

1. `pnpm pack`으로 실제 tarball을 만들고 pack report의 이름·version·파일 두 개를 확인합니다.
2. package manifest만 있는 빈 임시 프로젝트에 tarball을 정확한 dependency로 설치합니다.
3. 설치된 CLI package의 identity, Node version, bin, 직접 dependency, 공개 파일과 shebang을 확인합니다. `workspace:` 좌표와 CLI 자체의 install lifecycle script도 없어야 합니다.
4. `node_modules/@lervo`에 CLI 외의 private package가 없는지 확인합니다.
5. 생성된 local `lervo` 명령으로 `--version`, `trace --capabilities`와 `init`을 실행합니다.

설치는 로컬 package store를 우선합니다. 다만 tarball은 소비자의 lockfile을 포함하지 않고 외부 package의 하위 dependency 범위도 바꾸지 않으므로, cache에 없는 파일까지 오프라인 설치된다고 주장하지 않습니다. 일반 소비자와 같은 dependency 해석을 검증하기 위해 첫 설치는 registry를 사용할 수 있습니다. 설치가 끝난 뒤 검사하는 세 명령은 registry, Hub나 provider session을 사용하지 않습니다.

Tarball, 소비자 프로젝트와 초기화 결과는 임시 디렉터리 안에서만 만들고 성공·실패 모두 제거합니다. 새 runtime event, project 상태 형식이나 telemetry는 추가하지 않습니다.

## 결과

Release 검사는 pack 예상 목록뿐 아니라 실제 tarball의 설치와 local bin 실행까지 다룹니다. Claude SDK peer가 임의의 최신 version으로 바뀌는 범위도 줄었고, 지원하지 않는 Node에서 설치할 때 package manager가 요구 version을 알 수 있습니다.

이 검사는 로컬 파일 tarball을 현재 운영체제에 설치합니다. npm registry에 게시된 package의 다운로드, 모든 transitive dependency의 영구 고정, 다른 운영체제의 bin과 native SDK 실행, provider 인증·network 실행, 서명과 SBOM은 증명하지 않습니다.
