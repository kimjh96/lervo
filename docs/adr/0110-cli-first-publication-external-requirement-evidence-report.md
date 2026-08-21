# ADR-0110: CLI 최초 공개 게시 외부 요구사항 증거 보고서

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0109의 post-apply report는 현재 package metadata와 release 원본의 로컬 일관성만 확인합니다. License 승인, public npm 이름 가용성, npm scope control과 전체 최초 게시 승인을 `required`로 남기므로 이 네 요구를 서로 구분된 원본에 결속하는 다음 경계가 필요합니다.

기존 first-publication approval v1은 license·package 이름·scope control·직접 게시 1회와 stage-only 전환 확인을 한 파일에 모두 담습니다. 전체 게시 의사결정으로는 유효하지만 license 담당자의 결정과 npm scope 담당자의 확인을 독립적으로 교체·만료·감사하기 어렵습니다. 한 문서에 계속 필드를 추가하는 방식도 피해야 합니다.

## 결정

License approval, npm scope control confirmation과 기존 first-publication approval을 각각 별도 JSON 문서로 유지합니다. Public package availability만 명시적 온라인 관측으로 얻습니다. 결과 report는 이 원본들을 결속하지만 activation이나 게시 권한을 만들지 않습니다.

License approval v1의 형식은 다음과 같습니다.

```json
{
  "schemaVersion": 1,
  "evidenceType": "first_publication_license_approval",
  "approvalId": "lic_<unique-id>",
  "decision": "approve_public_distribution_license",
  "approvedAt": "<UTC timestamp>",
  "approver": { "kind": "user", "id": "<local actor id>" },
  "target": {
    "package": "@lervo/cli",
    "repository": "<owner/repository>",
    "license": "<approved license>",
    "postApplyReportDigest": "sha256:<digest>"
  },
  "basis": "operator_attestation"
}
```

이 문서는 exact post-apply report의 repository·license를 공개 배포에 쓰겠다는 사람 결정을 표현합니다. Actor 신원을 인증하거나 법률 판단을 외부에서 검증한 문서라고 주장하지 않습니다. Post-apply report가 바뀌면 새 license approval이 필요합니다.

Npm scope control confirmation v1의 형식은 다음과 같습니다.

```json
{
  "schemaVersion": 1,
  "evidenceType": "first_publication_npm_scope_control_confirmation",
  "confirmationId": "scp_<unique-id>",
  "decision": "confirm_npm_scope_control",
  "confirmedAt": "<UTC timestamp>",
  "expiresAt": "<UTC timestamp within 24 hours>",
  "confirmer": { "kind": "user", "id": "<local actor id>" },
  "target": {
    "package": "@lervo/cli",
    "scopeOwner": { "kind": "organization|user", "name": "lervo" },
    "postApplyReportDigest": "sha256:<digest>"
  },
  "basis": "operator_attestation"
}
```

이는 별도 사람 확인이며 npm credential, account membership이나 실제 create 권한을 읽어 만든 registry proof가 아닙니다. 최대 24시간만 유효합니다. 기존 first-publication approval은 publication authorization digest와 같은 license·scope owner를 가리키고 license 승인, public 이름 확인, scope control, 직접 게시 1회와 이후 stage-only 전환을 모두 승인해야 합니다.

명령은 다음 여섯 문서 좌표와 온라인 동의를 받습니다.

```text
pnpm --silent release:bootstrap:external-evidence \
  --receipt <absolute-path> \
  --post-apply-report <absolute-path> \
  --publication-authorization <absolute-path> \
  --license-approval <absolute-path> \
  --scope-confirmation <absolute-path> \
  --first-publication-approval <absolute-path> \
  --online \
  --json
```

명령은 문서 경로 여섯 개를 받습니다. Evidence source reader는 post-apply report, publication authorization과 세 사람 문서까지 다섯 개를 읽습니다. Receipt는 post-apply verifier가 현재 package manifest·release manifest·SBOM·lockfile과 함께 따로 읽습니다. 모든 명시적 문서는 64 KiB 이하 regular file이고 공백 2칸 JSON과 마지막 LF를 요구합니다.

조정 순서는 다음과 같습니다.

1. 다섯 문서를 bounded snapshot으로 읽습니다.
2. Receipt와 current source에서 post-apply report를 다시 만들고 저장한 report와 대조합니다.
3. License·scope·first-publication approval의 형식·시각·target과 publication authorization을 검증합니다.
4. 위 local 검증이 끝난 뒤에만 인증 없는 public npm observer를 한 번 호출합니다.
5. 관측 뒤 current source에서 post-apply report를 다시 만들고 관측 전·저장 report와 대조합니다.
6. External evidence report 전체를 재계산하고 다섯 입력 문서가 처음 bytes와 같은지 확인합니다.

Observer는 404만 `public_package_not_found`로 받습니다. 2xx는 이름을 사용할 수 없는 상태, network·그 밖의 응답은 관측 불가로 실패합니다. 404는 private package 부재를 증명하지 않습니다.

External evidence report v1은 다음을 결속합니다.

- `status=evidence_bound`, `activation=not_implemented`, `arming=not_armed`
- package·version·repository·license·public registry target
- post-apply report와 receipt digest
- publication authorization, artifact SHA-256과 source digest
- license approval, scope confirmation과 first-publication approval의 ID·canonical digest·시각
- public npm 관측 digest·시각·10분 유효기간
- 네 requirement의 `bound` 상태
- 관측·scope confirmation·first-publication approval 중 가장 이른 전체 만료 시각
- 파일·승인·activation·publication 무부작용

`bound`는 요구사항 원본이 같은 target에 결속됐다는 뜻이며 기계적으로 권한이 확인됐거나 실행이 허가됐다는 뜻이 아닙니다. Report는 다음 한계를 고정합니다.

- Receipt signer와 발급 주체는 검증하지 않음
- 사람 actor 신원은 인증하지 않음
- Scope control은 npm registry 권한으로 검증하지 않음
- Private package 부재는 관측하지 않음
- Publication authorization이 가리키는 release artifact bytes는 이 명령에서 다시 검증하지 않음

Actor ID는 입력 검증에만 사용하고 report에 복사하지 않습니다. Approval·confirmation ID, 문서·artifact·source digest, repository·license와 시각은 자동 검증을 위해 JSON에 포함됩니다. Credential, actor 원문, npm response body·오류 원문, 파일 본문·경로는 포함하지 않습니다. Human output에는 ID와 digest도 표시하지 않습니다.

명령은 입력이나 저장소 파일을 쓰지 않고 외부 설정 변경, approval 생성, activation, reservation과 publication을 실행하지 않습니다. Report는 stdout에만 출력하며 별도 파일이나 runtime event·project 상태·telemetry를 만들지 않습니다.

## 실패 의미

- `first_publication_external_evidence_arguments_invalid`: 모든 absolute 입력과 `--online`이 없거나 인자가 중복·누락·알 수 없습니다. Source read 전에 실패합니다.
- `first_publication_external_evidence_source_invalid`: 입력 좌표, file 종류·크기 또는 canonical JSON 포맷이 올바르지 않습니다.
- `first_publication_external_evidence_post_apply_invalid`: 저장한 post-apply report가 current source 재계산 결과와 다릅니다.
- `first_publication_external_evidence_license_approval_invalid`: license approval 형식·actor·시각·target·report binding이 올바르지 않습니다.
- `first_publication_external_evidence_scope_confirmation_invalid`: scope confirmation 형식·actor·시각·만료·scope·report binding이 올바르지 않습니다.
- `first_publication_external_evidence_target_mismatch`: publication authorization, post-apply report와 first-publication approval의 package·version·repository·license·scope가 서로 다릅니다.
- `first_publication_external_evidence_observation_unavailable`: public npm 조회를 완료하지 못했습니다.
- `first_publication_external_evidence_package_not_available`: public package가 이미 보이거나 정확한 404가 아닙니다.
- `first_publication_external_evidence_observation_invalid`: 관측 시각을 신뢰할 수 없습니다.
- `first_publication_external_evidence_report_invalid`: report가 같은 원본의 재계산 결과와 다릅니다.
- Publication authorization, first-publication approval, post-apply 검증과 source 변경 오류는 기존 제한된 code를 유지합니다.

오류는 문서·외부 응답 원문, actor, 경로와 digest를 복사하지 않습니다. 실패는 activation이나 게시 실패가 아니라 evidence report를 안전하게 결속하지 못했다는 뜻입니다.

## 결과

Fixture는 네 독립 요구 결속, actor 비노출, license·scope의 다른 report binding, scope 만료, 이미 존재하는 package, 서로 다른 target, activation 상향 위조를 거부합니다. Command 검사는 local 오류의 online 이전 차단, 관측 전후 post-apply 재검증, 관측 중 source 변경과 입력 무변경을 확인합니다.

다음 단계는 기존 bootstrap authorization이 중복된 사람 확인을 직접 해석하지 않고 이 external evidence report를 필수 원본으로 받아 exact release와 fresh public package 상태를 다시 검증하도록 전환하는 bootstrap v2 evidence integration입니다.
