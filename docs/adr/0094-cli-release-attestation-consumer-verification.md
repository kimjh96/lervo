# ADR-0094: CLI release attestation 소비자 검증

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0093은 tag CI가 tarball·release manifest·SBOM의 build provenance와 tarball의 SBOM attestation을 만들도록 했습니다. Signed bundle이 존재한다는 사실만으로 소비자가 받은 파일을 신뢰할 수는 없습니다. 소비자는 signature와 trusted root뿐 아니라 누가 어떤 repository·workflow·tag·commit에서 서명했는지, signed subject가 전달받은 bytes와 같은지까지 자신의 기대값으로 확인해야 합니다.

Tag 이름만 확인하면 tag 이동을 구분하지 못합니다. Predicate 내용은 서명되지만 workflow가 작성하는 값이므로 인증서 identity를 대신할 수도 없습니다. 로컬에서 만든 unsigned statement는 digest 검토에는 유용하지만 signature나 인증서가 없어 소비자 신뢰 근거가 아닙니다.

또한 고정한 `actions/attest` v4.2.1의 SBOM 모드는 CycloneDX 입력을 `bomFormat`·`specVersion`·`serialNumber`로 인식합니다. 기존 sidecar는 표준상 선택인 serial을 생략해 이 원격 단계가 실패할 수 있었습니다. SBOM은 임의 serial 대신 serial을 제외한 canonical document digest에서 RFC 4122 UUID v5를 재현합니다. 같은 release document 검사는 같은 serial을 만들고 inventory가 바뀌면 serial도 바뀝니다.

## 결정

검증은 공급자 중립 statement 정책, GitHub 검증 어댑터와 파일 수명주기 조정으로 분리합니다. 암호·인증서·trusted root·transparency timestamp 검증을 자체 구현하지 않고 GitHub CLI `gh attestation verify`에 맡깁니다. Lervo 코어는 verifier가 성공한 JSON 결과의 statement를 별도로 검사합니다.

소비자는 다음 기대값을 모두 명시해야 합니다.

- 절대 release directory
- `owner/repository`
- package version과 같은 `v<version>` tag
- tag가 가리켜야 하는 40자 또는 64자 source commit digest
- 필요하면 별도 경로로 확보한 trusted root

GitHub 어댑터는 build provenance와 CycloneDX bundle에 각각 다음 정책을 전달합니다.

- Exact repository
- `https://token.actions.githubusercontent.com` OIDC issuer
- `https://github.com/<repository>/.github/workflows/cli-release-matrix.yml@refs/tags/<tag>`와 정확히 같은 certificate identity
- `refs/tags/<tag>`와 정확히 같은 source ref
- 명시한 source digest와 같은 source digest·signer workflow digest
- GitHub-hosted runner만 허용
- bundle별 SLSA provenance v1 또는 `https://cyclonedx.org/bom` predicate type

`--signer-workflow`의 부분 일치 의미에 기대지 않고 exact `--cert-identity`를 사용합니다. Local bundle을 넘기며 trusted root가 없으면 GitHub CLI가 현재 root를 구합니다. `--trusted-root <absolute-path>`를 주면 `--custom-trusted-root`로 전달해 사전에 가져온 root와 bundle을 사용한 offline 검증도 가능하게 합니다. Root의 안전한 전달과 갱신은 소비자 책임입니다.

Release directory root에는 tarball·manifest·SBOM·`attestations` directory만, 그 안에는 build provenance와 SBOM Sigstore bundle만 있어야 합니다. Symlink, 빈 파일, 크기 상한 초과와 추가·누락 항목은 거부합니다. Manifest version과 tag를 먼저 대조하고 검증 전 bytes를 읽습니다. 두 bundle 검증 뒤 tarball·manifest·SBOM·bundle과 custom trusted root를 다시 읽어 하나라도 바뀌었으면 전체 결과를 거부합니다.

Build provenance의 signed subject는 전달받은 세 파일의 basename과 SHA-256 집합과 정확히 같아야 합니다. SBOM attestation subject는 같은 tarball 하나여야 하며 signed CycloneDX predicate는 전달받은 SBOM JSON과 순서에 무관하게 같아야 합니다. Verifier 결과는 정확히 한 attestation, 인증서와 하나 이상의 verified timestamp를 가져야 합니다. 로컬 builder ID를 가진 unsigned statement가 bundle 자리에 있으면 외부 verifier를 호출하기 전에 거부합니다.

명령은 다음과 같습니다.

```text
pnpm release:attestation:verify --release-directory <absolute-path> --repository <owner/repo> --tag <v-version> --source-digest <commit>
```

성공 기본 출력은 개수만 표시하고 `--json`은 schema v1의 bounded report를 stdout으로 반환합니다. Report는 실제 verifier가 두 bundle을 성공시키고 추가 정책까지 통과한 경우에만 `status: verified`입니다. 파일을 만들거나 runtime event·project 상태·telemetry를 기록하지 않습니다.

Tag 서명 job은 bundle을 모은 직후 같은 명령을 `GITHUB_REPOSITORY`, `GITHUB_REF_NAME`, `GITHUB_SHA`와 제한된 `GH_TOKEN`으로 실행하고 성공한 release set만 workflow artifact로 올립니다. 로컬 fixture는 어댑터 인자와 추가 정책을 검증할 뿐 실제 GitHub signature 성공을 대신하지 않습니다.

새 실패 의미는 다음과 같습니다.

- `release_attestation_verification_arguments_invalid`: 명령 인자 누락·중복·미지원 조합
- `release_attestation_verification_input_invalid`: 절대 경로 또는 verifier 입력이 잘못됨
- `release_attestation_trust_policy_invalid`: repository·tag·source digest 기대값이 잘못됨
- `release_attestation_release_set_invalid`: release 파일 집합·형식·종류·크기가 잘못됨
- `release_attestation_unsigned_untrusted`: 로컬 unsigned statement를 신뢰 근거로 전달함
- `release_attestation_signature_unverified`: 외부 verifier가 signature·identity 정책을 통과시키지 못함
- `release_attestation_verifier_output_invalid`: 성공 verifier JSON의 필수 인증 결과가 없음
- `release_attestation_verified_statement_invalid`: verified statement subject 구조가 잘못됨
- `release_attestation_verified_subject_mismatch`: signed subject 집합이 전달받은 파일과 다름
- `release_attestation_verified_predicate_mismatch`: signed CycloneDX predicate가 전달받은 SBOM과 다름
- `release_attestation_release_set_changed`: 검증 도중 release file·bundle·trusted root가 바뀜
- `release_attestation_verification_failed`: 안전하게 분류하지 못한 검증 실패

기본 실패는 고정 code와 문장만 출력하며 verifier stderr, bundle 내용, 인증서 원문, credential과 경로를 복사하지 않습니다.

## 결과

소비자는 서명 유무만 보는 대신 artifact bytes, 두 predicate 관계와 GitHub workload identity를 하나의 명시적 정책으로 확인합니다. Tag 이동을 source digest로 닫고 verifier 결과를 Lervo의 exact subject·SBOM 정책으로 다시 제한합니다. 공급자별 암호 도구는 어댑터에 남아 다른 attestation verifier를 추가할 수 있습니다.

이 계약은 실제 signed release set을 받았을 때의 검증 경계입니다. 저장소 fixture와 workflow 구조 검사는 아직 실행되지 않은 원격 서명, GitHub artifact 보존, npm 게시, source commit의 코드 리뷰 상태나 특정 SLSA level을 증명하지 않습니다.
