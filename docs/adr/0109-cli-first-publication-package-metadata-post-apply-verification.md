# ADR-0109: CLI 최초 공개 게시 package metadata 사후 검증

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0108의 apply receipt는 성공한 조정기가 stdout에 만든 결과입니다. Receipt만 다시 읽으면 현재 세 파일이 이후에도 같은지, release manifest가 production generator 결과인지, SBOM이 현재 lockfile과 맞는지 알 수 없습니다. 반대로 현재 metadata만 검사하면 어떤 reviewed candidate와 permit을 거쳐 나온 bytes인지 연결되지 않습니다.

Apply receipt는 서명되거나 durable store가 발급한 문서도 아닙니다. Canonical digest를 다시 계산할 수 있다는 이유로 실제 transaction 실행이나 발급 주체의 진위를 증명한다고 표현하면 안 됩니다.

## 결정

저장한 apply receipt와 현재 원본을 함께 읽는 검증 명령을 추가합니다.

```text
pnpm --silent release:bootstrap:metadata-verify \
  --receipt <absolute-path> \
  --json
```

Receipt reader는 v1의 고정 필드, 세 target의 순서·상대 경로, before/after byte count·SHA-256, transaction·effect 처분과 receipt digest를 독립적으로 검증합니다. 이는 receipt 내용이 스스로 일관적이라는 뜻이며 signer나 발급 주체, 실제 apply 실행을 증명하지 않습니다.

Source reader는 package manifest, release manifest, release SBOM, lockfile과 receipt를 제한된 regular-file snapshot으로 읽습니다. Receipt와 SBOM은 공백 2칸 JSON과 마지막 LF까지 요구합니다. 현재 세 output의 exact byte count와 SHA-256은 receipt의 after binding과 모두 같아야 합니다. Receipt의 before binding은 현재 상태를 설명하는 값이 아니므로 현재 파일에 대조하지 않습니다.

읽기 전용 transaction inspector는 fixed apply transaction directory가 없는 상태만 `clear`로 판정합니다. Directory가 남아 있으면 빈 directory도 중단 가능성을 배제할 수 없어 recovery가 필요합니다. Symlink나 일반 파일이면 좌표를 신뢰하지 않습니다. Inspector는 journal을 읽어 처분을 추정하거나 directory를 정리하지 않습니다. 조정기는 source read 전과 report 반환 직전에 inspector를 실행하여 검증 중 생긴 transaction도 막습니다.

현재 package manifest는 override로 기존 production deploy·pack release generator에 전달합니다. 다시 만든 release manifest 전체가 현재 manifest와 같아야 하고, 현재 SBOM은 그 manifest와 같은 snapshot lockfile의 기존 validator를 통과해야 합니다. 생성이 끝난 뒤 모든 source bytes가 처음과 같은지도 다시 확인합니다. Generator의 임시 deploy는 성공·실패 모두 제거하고 저장소 source는 쓰지 않습니다.

Post-apply report v1은 다음을 canonical digest에 결속합니다.

- `status=verified`, `activation=not_implemented`
- package·version·repository·license·registry target
- receipt·plan·permit·candidate digest
- package manifest·release manifest·release SBOM·lockfile SHA-256
- 네 local metadata check와 transaction·receipt output·release reproduction·SBOM consistency check
- 별도로 필요한 `license_approval`, `public_package_availability`, `scope_control_confirmation`, `first_publication_approval`
- `receiptAuthenticity=not_verified`, `externalState=not_observed`
- 파일·온라인 관측·승인·activation·게시 무부작용

Local metadata check가 모두 ready일 때만 report를 만들지만 이는 activation permit가 아닙니다. License 문자열을 metadata에 넣은 일과 그 라이선스를 공개 배포에 쓸 수 있다는 승인은 구분합니다. First-publication approval도 실제 게시 직전의 전체 입력과 최신 외부 관측에 다시 결속해야 합니다.

기본 한국어 출력은 확인한 로컬 상태와 아직 필요한 외부 작업을 문장으로 설명합니다. Digest와 경로는 사람용 출력에 넣지 않습니다. JSON에는 자동 검증을 위한 digest가 있지만 파일 본문·경로, PID, credential, approval 원문, 외부 응답 원문은 넣지 않습니다. 새 report 파일, runtime event·project 상태·telemetry는 만들지 않습니다.

## 실패 의미

- `first_publication_package_metadata_post_apply_arguments_invalid`: absolute receipt가 없거나 중복·알 수 없는 인자 또는 `--online`이 있습니다. Transaction·source read 전에 실패합니다.
- `first_publication_package_metadata_post_apply_source_invalid`: source 좌표나 receipt·SBOM JSON 포맷이 올바르지 않습니다.
- `first_publication_package_metadata_apply_receipt_invalid`: receipt 구조, 고정 처분, file binding 또는 digest가 올바르지 않습니다.
- `first_publication_package_metadata_post_apply_transaction_pending`: apply transaction directory가 남아 있습니다. 아무것도 정리하지 않고 명시적 recovery를 요구합니다.
- `first_publication_package_metadata_post_apply_transaction_invalid`: transaction 좌표가 절대 경로가 아니거나 directory가 아닌 객체를 가리켜 상태를 신뢰할 수 없습니다.
- `first_publication_package_metadata_post_apply_source_mismatch`: 현재 output bytes 하나 이상이 receipt after binding과 다릅니다.
- `first_publication_package_metadata_post_apply_release_inconsistent`: production generator 결과, 현재 release manifest, SBOM과 lockfile이 서로 일치하지 않습니다.
- `first_publication_package_metadata_post_apply_local_metadata_incomplete`: repository·license·public package identity·게시 설정 중 로컬 차단 항목이 남았습니다.
- `first_publication_package_metadata_post_apply_report_invalid`: report가 같은 원본의 재계산 결과와 다릅니다.
- Bounded source의 부재·종류·크기·검증 중 변경은 기존 release set 오류를 유지합니다.

오류에는 receipt·source 본문, 경로·PID·digest를 복사하지 않습니다. 실패는 activation이나 publish 실패가 아니라 로컬 사후 검증을 완료하지 못했다는 뜻입니다.

## 결과

Receipt effect를 바꾸고 digest를 다시 만든 위조, current output 변경, report activation 상향 위조, 시작 전·검증 중 pending transaction, 검증 중 lockfile 변경을 거부합니다. Production generator 결과 재현과 source 무변경을 실제 fixture로 확인합니다. 검증 성공 뒤에도 네 외부 요구사항은 required이고 activation은 구현되지 않은 상태입니다.

다음 단계는 이 report를 license decision, public npm 이름 관측, npm scope control 확인과 first-publication approval의 독립 원본에 결속하되 activation을 열지 않는 external requirement evidence report입니다.
