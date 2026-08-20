# ADR-0093: CLI release 출처 증명 경계

- 상태: 승인
- 날짜: 2026-08-21

후속 결정: [ADR-0094](./0094-cli-release-attestation-consumer-verification.md)는 signed bundle을 exact GitHub identity와 source commit에 대조하고, verified subject·CycloneDX predicate를 전달받은 파일과 다시 결속합니다.

## 맥락

Release manifest와 SBOM은 공개 파일과 구성요소를 검토 가능한 원본에 결속하지만, 실제 tarball이 어디에서 어떤 절차로 만들어졌는지는 증명하지 않습니다. Tarball, manifest와 SBOM을 함께 전달하더라도 서로 다른 실행 결과가 섞이지 않았다는 서명도 없습니다.

같은 source에서 `pnpm pack`을 두 번 실행해 확인한 결과 tarball SHA-256은 서로 달랐습니다. Archive metadata가 달라질 수 있는 현재 pack 결과의 digest를 저장소 파일에 고정하면 다음 실행에서 오래된 subject를 정상 결과처럼 보이게 됩니다. 반대로 로컬 작업 코드가 builder identity와 서명을 스스로 만들면 CI 신뢰 경계를 대신할 수 없습니다.

## 결정

출처 증명은 in-toto Statement v1과 SLSA provenance v1을 사용합니다. Subject는 다음 세 release 파일이며 각 실행에서 실제 bytes의 SHA-256을 계산합니다.

- `lervo-cli-<version>.tgz`
- `release-artifact-manifest.json`
- `release-sbom.cdx.json`

실행별 statement나 서명 bundle을 저장소에 커밋하지 않습니다. 로컬과 CI의 책임은 다음처럼 나눕니다.

### 로컬 unsigned statement

`pnpm release:attestation:check`는 먼저 release manifest와 SBOM을 각 source에서 다시 검증합니다. 그 뒤 임시 directory에서 실제 tarball을 만들고 세 subject와 release assembly 입력 여섯 개의 digest를 가진 statement를 생성·재검증한 다음 모두 제거합니다. 입력은 CLI package manifest, package README, bundle, release manifest, SBOM과 pnpm lockfile입니다. 이름은 저장소 상대 경로만 사용하며 사용자 절대 경로를 넣지 않습니다.

로컬 statement의 builder ID는 `urn:lervo:builder:local-unsigned:v1`, build type은 `urn:lervo:build-type:cli-release:v1`입니다. 이 build type은 고정된 현재 CLI build 뒤 검증된 세 release 파일을 조립하는 절차를 뜻합니다. External parameter는 없고 Node·pnpm·운영체제·architecture만 internal parameter로 기록합니다. 실행 시각과 invocation ID는 넣지 않습니다.

`pnpm release:attestation:local`은 같은 statement를 stdout으로 보여 주지만 DSSE payload, signature나 signature 배열을 만들지 않습니다. Reader도 이 필드가 추가된 로컬 결과를 거부합니다. 따라서 이 출력은 digest와 구조를 검토하는 statement일 뿐 인증된 attestation이나 SLSA level 근거가 아닙니다.

`pnpm release:attestation:prepare <absolute-new-directory>`는 검사를 통과한 세 subject만 새 directory에 복사합니다. 기존 directory는 덮어쓰지 않습니다. CI는 `--expected-tag v<package-version>`을 함께 사용하며 tag와 package version이 다르면 subject를 만들지 않습니다.

### GitHub 서명 경계

기존 Ubuntu·macOS·Windows matrix는 로컬 unsigned statement 검사까지 contents read 권한으로 실행합니다. 별도 `attested-cli` job은 세 matrix job이 모두 통과한 뒤, 사용자가 tag를 선택해 `workflow_dispatch`를 실행한 경우에만 시작합니다. 이 job에만 `id-token: write`, `attestations: write`, `artifact-metadata: write`를 부여합니다.

서명 job은 Ubuntu에서 다시 build하고 manifest·SBOM·tag를 검증한 뒤 exact subject 세 개를 준비합니다. 로컬 predicate를 서명하지 않고 GitHub `actions/attest`가 workflow identity와 OIDC를 사용해 SLSA build provenance를 직접 생성하도록 합니다. 같은 tarball을 subject로 하고 CycloneDX 파일을 predicate로 사용하는 별도 SBOM attestation도 생성합니다. SBOM의 재현 가능한 UUID v5 serial은 고정한 action의 CycloneDX 입력 인식 조건을 충족합니다. 두 Sigstore bundle은 ADR-0094의 소비자 정책으로 즉시 검증한 뒤 세 release 파일과 함께 30일 보존 workflow artifact로 올립니다. Action은 전체 commit SHA로 고정합니다.

Signed bundle은 GitHub가 실제 원격 job에서 생성한 뒤에만 존재합니다. 로컬 workflow 구조 검사나 unsigned statement 성공을 서명, GitHub 게시 또는 원격 build 성공으로 표현하지 않습니다. 새 runtime event, project 상태와 telemetry는 없습니다.

새 실패 의미는 다음과 같습니다.

- `release_attestation_input_invalid`: statement 생성 입력의 형식이 잘못됨
- `release_attestation_statement_invalid`: 필수 statement 구조나 digest·정렬 계약이 잘못됨
- `release_attestation_statement_mismatch`: statement가 현재 tarball·manifest·SBOM 또는 assembly 입력과 다름
- `release_attestation_envelope_unexpected`: 로컬 unsigned statement가 서명 envelope 필드를 주장함
- `release_attestation_arguments_invalid`: 지원하지 않는 명령 조합
- `release_attestation_identity_mismatch`: package, release manifest 또는 pnpm identity가 다름
- `release_attestation_output_invalid`: prepare 대상이 절대 경로가 아님
- `release_attestation_output_unavailable`: 새 prepare directory를 만들 수 없거나 기존 대상이 있음
- `release_attestation_tag_mismatch`: 선택한 tag와 package version이 다름
- `release_attestation_check_failed`: 하위 도구의 안전하게 분류하지 못한 실패

기본 오류는 고정 code와 문장만 출력하며 하위 도구 원문, temporary path와 credential을 복사하지 않습니다.

## 결과

로컬 검사는 실제 tarball digest를 보면서도 실행별 파일을 저장소에 누적하지 않습니다. CI의 높은 권한은 tag 서명 job에만 있고 일반 matrix와 pull request는 계속 contents read입니다. Tarball·manifest·SBOM은 하나의 GitHub 생성 provenance statement에서 같은 build output 집합으로 결속되고, tarball과 SBOM 관계는 별도 표준 SBOM attestation으로도 남습니다.

이 계약은 workflow와 생성 경계를 구현한 것입니다. 아직 실행되지 않은 GitHub job의 서명 성공, artifact 보존, npm 게시나 특정 SLSA level을 증명하지 않습니다. Signed bundle의 소비자 검증은 후속 ADR-0094에서 구현합니다.
