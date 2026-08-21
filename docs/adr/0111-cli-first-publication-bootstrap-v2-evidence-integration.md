# ADR-0111: CLI 최초 공개 게시 bootstrap v2 증거 결속

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

Bootstrap v1은 first-publication approval 한 문서에서 license, npm 이름 가용성, scope control과 전체 게시 결정을 직접 해석했습니다. ADR-0110은 이 요구를 license approval, scope confirmation, 전체 approval과 public npm 관측으로 분리하고 하나의 external evidence report에 결속했습니다. 두 경계가 같은 사람 문서를 따로 해석하면 검증 규칙과 만료 의미가 달라질 수 있습니다.

V0 단계에는 실제 npm 게시나 arming을 여는 운영 호환성 요구가 없습니다. 따라서 v1을 조용히 허용해 새 evidence 경계를 우회하는 것보다 명시적인 schema 전환이 안전합니다.

## 결정

`release:bootstrap:authorize`는 `--approval` 대신 절대 경로의 `--external-evidence`를 요구합니다. 입력 흐름은 다음과 같습니다.

1. Package manifest, release manifest, publication authorization, external evidence report와 exact tarball을 bounded snapshot으로 읽습니다.
2. External evidence report v1의 전체 구조, canonical digest, target, 유효기간, 고정된 한계와 무부작용을 독립 reader로 검증합니다.
3. Report의 publication authorization·artifact·source digest와 package·version·repository·license가 현재 release 원본과 같은지 확인합니다.
4. Local 검증이 끝난 뒤에만 인증 없는 public npm observer를 한 번 호출합니다.
5. 404인 경우 bootstrap v2를 만들고 모든 입력 bytes가 관측 전과 같은지 다시 확인합니다.
6. 새 절대 output을 `wx`로 한 번만 씁니다.

Bootstrap 정책은 license approval, scope confirmation과 first-publication approval 원문을 다시 읽거나 해석하지 않습니다. External evidence reader는 report가 다음 한계를 그대로 선언할 때만 받습니다.

- Receipt 발급 주체와 signer를 검증하지 않음
- 사람 actor 신원을 인증하지 않음
- Scope control을 npm registry 권한으로 검증하지 않음
- Private package 부재를 관측하지 않음
- External evidence 단계에서는 release artifact bytes를 다시 검증하지 않았음

Bootstrap 조정기는 마지막 항목을 현재 exact tarball과 publication authorization 재검증으로 보완합니다. 다른 네 한계를 상향된 사실로 바꾸지는 않습니다.

결과 schema v2는 공통 target·identity·release·execution·transition 필드를 유지하고 v1의 `approval`을 `evidence`로 교체합니다. Evidence에는 external evidence report, post-apply report, receipt, license approval, scope confirmation, first-publication approval의 canonical digest와 report 확인·만료 시각을 둡니다. Actor ID, 문서 본문·경로, credential, npm 응답 본문과 내부 오류는 넣지 않습니다.

Registry observation은 bootstrap 시점에 새로 얻은 `public_package_not_found`와 관측·만료 시각을 가집니다. Bootstrap 만료는 evidence report 만료와 새 관측 뒤 10분 중 더 이른 시각입니다. V2도 수동 대화형 2FA 직접 게시 1회와 재사용 금지, 게시 뒤 stage-only 전환 의무만 표현합니다.

Bootstrap v1 reader는 `first_publication_bootstrap_schema_unsupported`로 거부합니다. 이전 `--approval` 인자도 `first_publication_bootstrap_arguments_invalid`로 source read 전에 거부합니다. 별도 migration은 v1 문서를 변환하는 것이 아니라 최신 external evidence report를 만들고 bootstrap을 새로 발급하는 절차입니다. 짧은 public package 관측과 승인 수명을 재사용해야 하므로 자동 변환은 허용하지 않습니다.

추가 실패 의미는 다음과 같습니다.

- `first_publication_external_evidence_report_invalid`: report의 schema, digest, 시각, target, 한계 또는 무부작용이 올바르지 않습니다.
- `first_publication_external_evidence_target_mismatch`: report가 현재 publication authorization, artifact, source 또는 package identity와 다릅니다.
- `first_publication_external_evidence_expired`: report가 bootstrap 확인 시각에 만료됐거나 미래 시각의 검사 결과입니다.
- `first_publication_bootstrap_schema_unsupported`: 실행·preflight·plan 등 bootstrap consumer가 v2 아닌 문서를 받았습니다.

기존 public package 관측 불가·이미 존재, release 변경, source 변경과 output 재사용 오류는 원래 code를 유지합니다. 오류에는 report·actor·경로·digest·외부 응답 원문을 복사하지 않습니다.

이 전환은 npm credential, 사람 승인 생성, reservation, arming, activation, 실제 publication, Trusted Publisher나 GitHub 설정 변경을 실행하지 않습니다. 새 runtime event·project 상태·telemetry도 추가하지 않습니다.

## 결과

External evidence의 책임, bootstrap의 exact release·freshness 책임과 CLI의 파일·온라인 수명주기가 분리됐습니다. 하위 preflight·execution plan·reservation·publisher는 공통 target·release·관측 계약을 계속 사용하지만 reader를 통해 v2 evidence를 반드시 검증합니다.

테스트는 v2 결정성, evidence 만료, 유효하게 재계산한 다른 release report, public package 등장, v1 거부, 제한 상향 위조, observer 이전 local 실패, 관측 뒤 source snapshot 확인과 output 비덮어쓰기를 검증합니다. 실제 npm 게시와 arming은 여전히 비활성입니다.
