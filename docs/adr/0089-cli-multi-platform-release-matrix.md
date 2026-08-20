# ADR-0089: CLI 다중 플랫폼 배포 matrix 계약

- 상태: 승인
- 날짜: 2026-08-20

후속 결정: [ADR-0090](./0090-cli-package-usage-guide.md)은 같은 matrix가 검사하는 tarball에 package README와 공개 metadata 계약을 추가합니다.

## 맥락

Packed CLI smoke는 실제 tarball과 local bin을 검증하지만 실행한 운영체제의 결과만 보여 줍니다. Claude Agent SDK는 OS, CPU와 Linux libc에 따라 다른 optional package를 설치합니다. macOS 한 곳의 성공으로 Linux나 Windows package 이름, 실행 권한과 bin 동작까지 성공했다고 볼 수 없습니다.

운영 코드는 현재 platform을 읽어 native package를 고릅니다. Matrix 검사가 같은 함수를 그대로 사용하면 이름 계산이 함께 잘못돼도 테스트가 통과할 수 있으므로, 소비자 검사는 별도 계산과 설치 목록으로 결과를 확인해야 합니다.

## 결정

Packed CLI smoke에 독립적인 Claude native runtime 검사를 추가합니다. 대상 이름은 다음 규칙으로 계산합니다.

- macOS: `darwin-arm64`, `darwin-x64`
- Linux glibc: `linux-arm64`, `linux-x64`
- Linux musl: `linux-arm64-musl`, `linux-x64-musl`
- Windows: `win32-arm64`, `win32-x64`

지원하지 않는 OS나 CPU 조합에 이름을 만들어 주지 않습니다. 설치된 전체 production closure에서 해당 native family가 정확히 하나인지 확인합니다. 그 package manifest의 name, SDK와 같은 version, 현재 OS·CPU를 검사하고 macOS·Linux에서는 실행 권한도 확인합니다. 마지막으로 package 안의 `claude` 또는 `claude.exe`를 `--version`으로 직접 실행합니다. 이 검사는 인증이나 provider session을 시작하지 않습니다.

`.github/workflows/cli-release-matrix.yml`은 `ubuntu-latest`, `macos-latest`, `windows-latest` 세 job을 `fail-fast: false`로 실행합니다. 한 OS의 실패가 다른 OS의 결과를 가리지 않게 하기 위해서입니다. 각 job은 다음 순서를 따릅니다.

1. 쓰기 credential을 남기지 않고 repository를 checkout합니다.
2. 공개 CLI의 최소 지원선인 Node 22.13.0과 package manifest에 고정한 pnpm 11.18.0을 준비합니다.
3. Frozen lockfile로 dependency를 설치하고 전체 workspace를 build합니다.
4. Release manifest와 실제 packed CLI 소비자 설치를 검사합니다.

Workflow는 pull request, main branch push와 수동 요청에서 실행합니다. 권한은 `contents: read`만 사용하고 job timeout은 20분입니다. Checkout, Node setup과 pnpm setup action은 version tag가 아니라 검토한 전체 commit SHA로 고정합니다.

Workflow 파일도 실행 코드로 취급합니다. 로컬 계약 테스트는 YAML을 읽어 trigger, OS 목록, 읽기 전용 권한, checkout credential 제거, action SHA, Node version과 네 실행 명령을 확인합니다. Native package 이름 계산은 macOS·Windows, Linux glibc·musl과 지원하지 않는 조합을 별도 단위 테스트로 확인합니다.

로컬 검사가 통과해도 아직 실행하지 않은 원격 job을 성공으로 기록하지 않습니다. 각 OS는 자기 job이 실제로 완료된 뒤에만 검증된 platform으로 볼 수 있습니다. Matrix job은 project event나 telemetry를 만들지 않으며 사용자 payload, credential이나 절대 경로를 artifact로 올리지 않습니다.

## 결과

현재 로컬 검사는 macOS arm64 tarball에서 정확한 native package 하나와 `claude --version` 실행을 확인합니다. Linux와 Windows를 포함한 동일 검사는 workflow에 구성되어 있으며, 실제 성공 여부는 GitHub Actions 결과가 생긴 뒤 판단합니다.

이 계약은 세 hosted runner의 현재 architecture를 검사하지만 모든 지원 architecture를 한 번에 실행하지는 않습니다. Alpine 같은 musl runner의 실제 실행, npm registry 게시본, provider 인증·network session, artifact 서명과 SBOM도 아직 증명하지 않습니다.
