# ADR-0092: CLI release SBOM 계약

- 상태: 승인
- 날짜: 2026-08-20

후속 결정: [ADR-0093](./0093-cli-release-attestation-boundary.md)은 실제 tarball과 이 SBOM을 같은 release subject 집합에 결속하고, tag CI에서 tarball을 대상으로 별도 SBOM attestation도 생성합니다.

## 맥락

Release artifact manifest는 공개 파일과 production dependency closure를 Lervo 내부 형식으로 고정합니다. 이 원본만으로는 일반 SBOM 도구가 구성요소와 dependency graph를 바로 읽을 수 없습니다. 단일 bundle 안의 workspace package와 외부 package도 설치 목록에 나타나지 않으므로 lockfile만 변환하면 실제 배포물 일부가 빠집니다.

SBOM 생성 때 설치 명령을 다시 실행하면 registry와 현재 운영체제에 따라 결과가 달라질 수 있습니다. 생성 시각이나 임의 serial을 넣은 파일을 실행마다 보존하는 방식도 같은 source에서 같은 결과를 만들지 못하고 저장소에 파일을 계속 쌓습니다.

## 결정

현재 CLI 배포물의 SBOM은 CycloneDX 1.7 JSON 한 파일 `apps/cli/release-sbom.cdx.json`으로 관리합니다. 이 파일은 현재 release 원본을 나타내는 교체형 sidecar이며 npm archive에는 넣지 않습니다. `pnpm release:sbom:update`만 파일 전체를 교체하고, `pnpm release:sbom:check`와 기본 검사는 원본을 수정하지 않습니다.

인벤토리는 두 재생성 가능한 source를 조합합니다.

- `pnpm-lock.yaml`의 `apps/cli` importer에서 시작한 production dependency graph
- esbuild metafile에서 release manifest v4에 결속한 workspace package와 외부 bundle package

Lockfile graph는 direct production dependency에서 `dependencies`와 `optionalDependencies`만 순회합니다. `devDependencies`는 포함하지 않습니다. 일반 production node는 `required`, 운영체제별 Claude native package 여덟 개는 `optional` scope로 기록합니다. 모든 lockfile component에는 SHA-512 integrity를 16진수로 변환해 넣습니다.

Bundle에 들어간 workspace package는 설치 graph와 별도 component로 기록합니다. Ajv처럼 lockfile graph에도 있는 외부 package는 같은 component에 bundled 속성을 더하고, YAML처럼 bundle에만 있는 package도 lockfile integrity를 확인한 뒤 component로 포함합니다. Bundle 내부 workspace package끼리의 관계는 metafile만으로 정확히 복원하지 않으므로 `lervo:release:workspace-relationships=not-asserted`라고 명시합니다. 알 수 없는 관계를 추정해 dependency graph로 만들지 않습니다.

Root application은 공개 package의 npm PURL, `dist/bin.js` SHA-256과 현재 `UNLICENSED` 상태를 가집니다. 다음 digest를 속성으로 결속합니다.

- release artifact digest
- bundle digest
- portable production dependency digest

Component와 dependency node는 PURL 순으로 정렬합니다. 생성 시각과 `serialNumber`는 생략하고 document version은 1로 고정해 같은 manifest와 lockfile에서 같은 bytes를 만듭니다. Dependency license는 lockfile이 증명하지 않으므로 추정해서 넣지 않습니다.

검사는 먼저 release manifest 자체를 검증합니다. 그 뒤 lockfile graph의 required 목록이 manifest의 portable closure와 같고, optional 목록이 승인된 native family 여덟 개와 같으며, root가 직접 dependency 목록과 같은지 확인합니다. 새 bundle 외부 package는 manifest v4의 검토 목록을 갱신하지 않으면 실패합니다. 마지막으로 committed SBOM의 metadata, component, dependency와 속성을 새로 만든 결과와 정확히 비교합니다.

현재 생성 결과는 CycloneDX 1.7 공식 JSON Schema로 별도 검증했습니다. CI의 기본 검사는 원격 schema를 내려받지 않고 위의 고정 생성 결과와 source 일치성을 검사하므로 network 없이 완료됩니다. 새 runtime event, project 상태와 telemetry는 추가하지 않습니다.

## 결과

현재 SBOM은 root를 제외한 component 133개와 dependency node 109개를 기록합니다. 구성은 bundled workspace package 24개, portable production package 100개, optional native package 8개와 bundle 전용 YAML 1개입니다. 공개 archive를 바꾸지 않으면서 표준 도구가 현재 CLI 구성과 dependency graph를 읽을 수 있습니다.

이 계약은 component inventory와 source 일치성을 검증합니다. 취약점 없음, dependency 라이선스 준수, workspace 내부 호출 관계, 실제 npm 게시물의 출처, 서명과 CI 빌드 출처는 증명하지 않습니다. Linux와 Windows 실행 성공도 각 원격 matrix job이 실제 완료되기 전에는 주장하지 않습니다.
