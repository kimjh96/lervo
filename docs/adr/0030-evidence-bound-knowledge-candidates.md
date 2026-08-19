# ADR-0030: 수렴 결과 기반 지식 candidate와 로컬 진단

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

`knowledge.candidate.created` event 이름은 초기 계약에 있었지만 candidate 원본 schema와 생성 경계가 없었습니다. 숙의가 끝났다는 event 하나만 보고 후보를 만들면 `no_consensus`나 실패 결과를 결론으로 오인하거나, 현재 claim과 다른 검증 revision을 재사용할 수 있습니다.

또한 candidate가 CAS에 있어도 converged outcome, decision, verification과 실제 event 원본을 다시 연결할 수 없다면 운영 중 증거 손실을 발견하기 어렵습니다. Trace와 doctor는 별도 인덱스가 아니라 로컬 원본에서 이 관계를 재구성해야 합니다.

## 결정

### 채택 claim마다 작은 candidate 원본을 만든다

`@lervo/knowledge`는 전체 `DeliberationPolicy`, artifact history, verification evidence와 outcome을 다시 검증합니다. Outcome이 `converged`인 경우에만 decision이 채택한 현재 claim별 candidate를 만듭니다. 각 candidate는 다음을 포함합니다.

- claim ID와 현재 digest
- converged outcome, decision artifact와 decision CAS 원문 좌표
- 영향받는 repository 상대 path
- 완료·decision·verification evidence event ID
- verification artifact/result ID와 hash, 공통 repository revision
- review interval과 명시된 충돌 candidate ID

Candidate ID는 나머지 canonical JSON의 hash에서 결정합니다. Candidate JSON은 claim별 CAS object로 저장하고 다시 읽어 검증합니다. 하나의 Markdown이나 JSON 파일 끝에 계속 append하지 않습니다.

### 실행 완료와 candidate 생성을 분리한다

Candidate 생성기는 `deliberation.completed` event가 현재 SQLite 원본과 같은지 확인합니다. Decision과 verification artifact도 각각 정확히 하나의 `deliberation.artifact.recorded` event가 있어야 하며, candidate가 참조하는 모든 evidence event가 존재해야 합니다. Decision CAS bytes와 artifact 좌표도 다시 확인합니다.

`no_consensus`와 `failed`는 `candidate_not_eligible/outcome_not_converged`로 중단합니다. 채택 claim의 path가 없거나 verification evidence가 누락됐거나 서로 다른 repository revision이면 candidate를 만들지 않습니다. 같은 결정적 candidate가 이미 기록돼도 중복 event를 만들지 않습니다.

Candidate CAS 저장과 event transaction은 서로 다른 저장 경계입니다. CAS 저장 뒤 event 기록이 실패하면 content-addressed object는 남을 수 있지만 생성 완료를 반환하지 않으며 event 없는 object를 지식으로 취급하지 않습니다.

### Trace와 doctor는 원본을 읽는다

`@lervo/diagnostics`의 trace는 event hash chain을 확인하고 `last` 또는 명시한 run ID의 allowlist event를 seq 순서로 반환합니다. Doctor는 project storage를 연 뒤 다음을 확인합니다.

1. SQLite event hash chain
2. Candidate CAS JSON의 schema, canonical bytes, content hash와 candidate ID
3. Candidate event와 CAS 원본의 claim/outcome/decision/path/revision 좌표
4. Evidence event의 존재와 converged 완료 상태
5. Decision·verification artifact event와 decision CAS 원문

이 ADR에서 구현한 doctor의 첫 범위는 로컬 지식 증거입니다. 문서 manifest, skill lock과 provider 실행 파일 검사는 [ADR-0033](./0033-bounded-environment-doctor.md)에서 별도 항목으로 확장했습니다. Hub 연결 상태는 아직 검사하지 않으며 정상이라고 표시하지 않습니다.

## Event 필드와 개인정보

`knowledge.candidate.created`의 필수 payload를 다음으로 고정합니다.

| 필드 | 의미 |
|---|---|
| `candidateId`, `candidateArtifactId`, `candidateContentHash` | Candidate 원본과 CAS 좌표 |
| `claimDigest`, `paths` | 현재 주장 hash와 영향 상대 경로 |
| `evidenceIds` | 완료·decision·verification을 포함한 event 원본 ID |
| `sourceOutcomeId`, `decisionArtifactId` | 수렴 결과와 최종 결정 좌표 |
| `verificationArtifactIds`, `verifiedRevision` | 채택 주장의 검증 artifact와 repository revision |

Claim/decision 본문, candidate JSON, prompt, provider payload, tool input, credential과 내부 추론은 event에 넣지 않습니다. Candidate artifact ID가 content hash와 다르거나 필수 필드가 누락되면 redaction 뒤 schema 검증에서 event 전체를 거부합니다.

## 실패 의미

- `candidate_not_eligible/outcome_not_converged`: 합의 실패나 실행 실패를 지식 후보로 만들려 했습니다.
- `candidate_evidence_invalid`: Outcome event, decision/verification 기록, CAS 원문 또는 repository revision이 실제 원본과 다릅니다.
- `candidate_contract_invalid`: Claim path, candidate schema, 자기 참조 또는 중복 candidate 계약이 잘못됐습니다.
- `artifact_storage_failed`: Candidate CAS 저장과 재검증이 실패했습니다.
- `event_recording_failed`: Candidate 생성 event transaction이 실패했습니다.

어느 실패도 candidate, reviewed, verified 또는 current 상태를 주장하지 않습니다.

## 검증

실제 filesystem CAS와 SQLite fixture에서 converged history의 decision 원문과 verification revision을 확인해 claim별 candidate를 만들고, candidate CAS와 event hash chain을 다시 읽습니다. 같은 candidate의 중복 생성은 거부합니다. `no_consensus`와 `failed`는 event와 candidate를 만들지 않습니다.

Doctor는 정상 candidate를 `healthy`로 판정하고, schema-valid event가 존재해도 candidate CAS가 없으면 종료 코드 1과 `candidate_artifact_invalid`를 반환합니다. Trace는 실제 초기화된 프로젝트의 최신 run을 텍스트로 재구성합니다. Event에는 decision이나 candidate 원문이 남지 않습니다.

## 결과

숙의 수렴과 지식 candidate 사이에 검증 가능한 경계가 생겼고, 로컬 원본만으로 그 연결 손실을 진단할 수 있습니다. Candidate는 아직 검토 대상입니다. 다음 단계는 reviewer 승인, verified 원본과 현재 revision을 결속하고 영향 path 변경 시 stale로 전이하는 계약입니다.
