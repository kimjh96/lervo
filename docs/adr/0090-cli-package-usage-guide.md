# ADR-0090: CLI package 사용 안내 계약

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

공개 `@lervo/cli` tarball에는 실행 bundle과 package manifest만 있었습니다. 설치한 사용자는 npm package 화면이나 로컬 설치본에서 준비 조건과 첫 명령을 확인할 수 없고, 저장소의 루트 README는 구현 현황과 90개의 ADR 링크까지 포함해 설치 안내로 사용하기에는 너무 깁니다.

Package metadata에도 이름, version과 Node 조건 외에 제품 설명, 검색어와 라이선스 상태가 없었습니다. 반면 이 저장소에는 공개 repository, homepage, issue tracker URL과 오픈소스 라이선스 결정이 없습니다. 존재하지 않는 주소나 허가 조건을 추정해서 배포하면 사용자를 잘못 안내하게 됩니다.

## 결정

`apps/cli/README.md`를 package 전용 안내서로 둡니다. 루트 README의 일부를 자동 복사하지 않고 다음 정보만 사람이 읽는 짧은 문장으로 관리합니다.

- Node.js 22.13 이상 준비
- `npm install --global @lervo/cli` 설치
- 프로젝트 폴더에서 `lervo init --name my-project` 실행
- 쓰기 전에 확인하는 `lervo init --dry-run --name my-project`
- 전체 명령을 확인하는 `lervo --help`
- 초기화와 도움말 확인은 Hub 없이 가능하지만 provider 실행은 별도 구성이 필요하다는 경계

안내서는 4 KiB를 넘지 않고 `준비`, `설치`, `첫 실행` 세 부분으로 유지합니다. 긴 명령 목록, 내부 구현 현황, ADR 목록과 변경 이력은 복제하지 않습니다. 상세한 운영 설명은 저장소 문서에서 계속 관리합니다.

Package manifest에는 한 문장의 한국어 설명과 `ai-agents`, `local-first`, `orchestration` 검색어를 고정합니다. 공개 배포 가능 여부와 사용 허가는 다른 문제이므로 결정되지 않은 라이선스를 추정하지 않고 `UNLICENSED`로 명시합니다. Canonical URL이 없는 `repository`, `homepage`, `bugs` metadata도 만들지 않습니다. 나중에 실제 URL이나 라이선스를 정하면 별도 release 변경으로 검토합니다.

Release artifact manifest를 schema version 3으로 올립니다. Artifact identity에 설명·검색어·라이선스를 추가하고 archive 내용에 `README.md`의 byte 수와 SHA-256을 포함합니다. 최종 artifact digest는 갱신된 identity와 archive digest에 결속됩니다. 공개 archive는 `README.md`, `dist/bin.js`, `package.json` 세 파일만 허용합니다.

Packed consumer smoke는 실제 설치 manifest의 metadata와 세 파일을 확인합니다. 설치된 README의 byte 크기, 제목·세 부분과 위 필수 문장을 검사합니다. Production deploy smoke도 README가 빠지지 않았고 핵심 설치·초기화 명령이 있는지 확인합니다. 검증은 runtime event, project 상태나 telemetry를 만들지 않습니다.

## 결과

사용자는 npm package 화면과 설치본에서 별도 저장소 탐색 없이 첫 초기화까지 진행할 수 있습니다. 안내가 길어지거나 실제 CLI와 달라지고, README 또는 metadata가 검토 없이 바뀌면 release manifest나 smoke가 실패합니다.

이 계약은 로컬 pack·deploy의 문서와 metadata를 검증합니다. npm registry 게시·다운로드, package 소유권, provider 인증·실행, 지원 채널과 법적 라이선스 확정은 증명하지 않습니다.
