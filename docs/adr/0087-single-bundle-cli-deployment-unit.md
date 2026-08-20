# ADR-0087: 단일 bundle CLI 배포 단위

- 상태: 승인
- 날짜: 2026-08-20

후속 결정: [ADR-0088](./0088-packed-cli-consumer-installation.md)은 Claude Agent SDK의 peer 세 개도 정확한 직접 dependency로 고정합니다. Bundle 밖 import가 Claude Agent SDK 하나라는 결정은 유지합니다.

## 맥락

CLI 실행 경로는 24개의 private `@lervo/*` workspace 패키지를 사용합니다. 이 패키지를 모두 따로 게시하면 사용자는 내부 구현 단위까지 설치해야 합니다. 한 번의 CLI 출시에 여러 패키지 버전과 게시 순서도 맞춰야 합니다. 반대로 저장소의 모듈 경계를 없애면 관심사 분리와 독립적인 계약 테스트가 약해집니다.

실행에 필요한 외부 모듈도 성격이 다릅니다. Ajv와 YAML은 일반 JavaScript라 CLI에 넣을 수 있지만 Claude Agent SDK는 현재 운영체제와 CPU에 맞는 별도 package와 실행 파일을 찾습니다. 이를 억지로 bundle에 넣으면 SDK가 자신의 설치 위치를 찾는 계약을 깨뜨릴 수 있습니다.

## 결정

개발과 검증에서는 기존 workspace 패키지, TypeScript 프로젝트와 계약 테스트 경계를 유지합니다. 모든 workspace 빌드가 끝나면 `apps/cli/src/bin.ts`에서 시작해 내부 실행 코드와 Ajv·YAML을 하나의 ESM `dist/bin.js`로 묶습니다. YAML처럼 CommonJS 방식으로 Node 내장 모듈을 읽는 코드에는 `createRequire(import.meta.url)`로 만든 호환 코드를 제공합니다. 원본 진입점의 shebang은 그대로 유지합니다.

Claude Agent SDK만 bundle 밖에 둡니다. 공개 `@lervo/cli` 패키지의 실행 의존성은 `@anthropic-ai/claude-agent-sdk` 하나입니다. 내부 `@lervo/*`는 빌드할 때만 필요한 개발 의존성입니다. 공개 archive에는 `dist/bin.js`와 npm이 넣는 `package.json`만 들어갑니다. CLI는 라이브러리 진입점이나 선언 파일을 공개하지 않습니다.

Build가 만든 metafile은 배포 검사에만 사용하고 archive에는 넣지 않습니다. Release artifact manifest v2는 다음 경계를 기록합니다.

- bundle entry와 공개 output
- 실제 bundle에 들어간 workspace package의 이름과 version
- Node 내장 모듈을 제외하고 bundle 밖에 남은 import
- 공개 package identity와 직접 production dependency
- bundle 파일 hash와 설치된 production dependency closure

예상하지 않은 외부 import가 생기거나 외부 import가 Claude Agent SDK 하나가 아니면 검사를 실패시킵니다. 임시 설치에 private `@lervo/*` 패키지가 남아도 실패합니다. Bundle 정보와 archive·dependency 정보는 각각 digest를 만들고 최종 artifact digest에 다시 묶습니다. 이전 manifest v1은 bundle 전 archive를 설명하는 과거 기록이며 현재 검사 입력으로 받지 않습니다.

설치 smoke는 임시 production deploy의 `dist/bin.js`를 저장소 밖 cwd에서 실행합니다. `--version`, `trace --capabilities`, 초기화, 기본 trace page와 명시적 full을 확인합니다. Diagnostics reader와 합성 event writer는 설치된 내부 package가 아니라 저장소에서 별도로 빌드한 모듈을 사용합니다. 이 조합은 bundle이 독립 모듈과 같은 저장 형식·report 계약을 지키는지도 확인합니다.

새 runtime event, project 상태와 telemetry는 추가하지 않습니다. Metafile과 manifest에는 사용자 경로, payload, credential을 기록하지 않습니다.

## 결과

사용자는 private Lervo 패키지 24개를 따로 설치하지 않아도 됩니다. 내부 코드는 계속 작은 패키지와 계약 테스트로 유지되고, 배포할 때만 하나의 실행 파일이 됩니다. 현재 공개 archive는 package manifest를 포함해 2개 파일이며 설치 의존성에는 Lervo private 패키지가 없습니다.

이 결정은 로컬 build, pack 목록과 `pnpm deploy` 설치본을 검증합니다. 실제 npm registry의 게시·다운로드, tarball을 빈 소비자 project에 설치한 bin shim, 모든 운영체제의 native SDK 실행, 서명과 SBOM은 아직 증명하지 않습니다.
