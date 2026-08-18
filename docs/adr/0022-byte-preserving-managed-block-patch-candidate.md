# ADR-0022: Byte 보존 managed block patch candidate

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

CommonMark parser가 managed block 경계를 찾아도 곧바로 파일을 수정해서는 안 됩니다. 검토자는 어떤 source와 block을 대상으로 무엇이 바뀌며 사용자 영역이 보존됐는지 확인할 수 있어야 합니다. 생성 시점 이후 source가 달라졌다면 오래된 결과를 적용할 수도 없어야 합니다.

본문 전체나 replacement 원문을 event와 metadata에 복제하면 문서가 길어지고 민감정보 노출 범위가 넓어집니다. 반대로 hash만 있고 검토할 결과 bytes가 없다면 실제 변경 내용을 확인할 수 없습니다. 기계용 증거와 로컬 검토 payload를 분리합니다.

## 결정

`@lervo/documents`는 파일 시스템 권한이 없는 `createManagedBlockPatchCandidate`를 제공합니다. 입력은 scanner가 확정한 source path/hash/byte count/bytes, 표준 block ID와 replacement bytes입니다. 생성기는 다음 순서로 후보를 만듭니다.

1. Source bytes가 입력 hash와 byte count에 맞는지 확인합니다.
2. CommonMark parser가 전체 source를 정상으로 판정하고 대상 block을 하나 찾았는지 확인합니다.
3. 대상의 marker family가 `lervo_v1`인지 확인합니다. 이전 제품 marker는 읽을 수만 있고 쓸 수 없습니다.
4. 기존 content byte range만 replacement로 바꿉니다.
5. 결과 전체를 다시 parse해 block 순서·ID·family와 모든 marker bytes가 그대로인지 확인합니다.
6. 대상 content 앞뒤 bytes가 원본과 같은지, 결과 content가 replacement와 같은지 확인합니다.

Replacement는 유효한 UTF-8이며 최대 8 KiB입니다. 빈 content는 허용하지만, end marker를 독립된 줄로 유지하지 못하거나 새 managed marker를 주입해 구조를 바꾸는 replacement는 거부합니다. 기존 content와 같은 replacement도 변경 후보로 만들지 않습니다.

성공 결과는 두 부분으로 나뉩니다.

- `ManagedBlockPatchCandidateArtifact`: source, parser, 원본 target range/content hash, replacement hash/크기, 결과 hash/크기/range와 세 가지 검증 상수를 담은 canonical JSON artifact
- `outputBytes`: 검토와 이후 적용을 위한 전체 결과 bytes. Candidate의 output hash에 결속되지만 JSON이나 event payload 안에 복제하지 않음

Candidate ID와 artifact ID는 생성 시각이 아니라 canonical 내용 hash에서 결정됩니다. Candidate의 `disposition`은 `review_required`, `writesAllowed`는 `false`로 고정합니다. `onlyTargetContentChanged`, `markerBytesUnchanged`, `outputStructureValid`는 실제 검사를 통과한 경우에만 `true`로 생성됩니다.

이 단계는 파일, CAS와 event store에 쓰지 않으며 승인을 받거나 적용됐다는 상태를 만들지 않습니다. Candidate metadata에는 source/replacement/output hash와 byte 좌표만 두고 원문, replacement 내용, 절대 경로를 넣지 않습니다. `outputBytes`의 저장·공개 정책과 승인된 원자적 적용은 별도 계약으로 남깁니다.

실패 의미는 다음과 같습니다.

- `invalid_patch_request`: block ID나 source 상대 경로가 계약에 맞지 않습니다.
- `source_changed`: source bytes가 요청의 hash 또는 byte count와 다릅니다.
- `source_structure_invalid` / `block_not_found`: parser가 source 소유 경계를 확정하지 못했거나 대상 block이 없습니다.
- `legacy_marker_not_writable`: 이전 marker이므로 migration 전에는 출력할 수 없습니다.
- `replacement_invalid_utf8` / `replacement_too_large`: replacement 입력 계약을 어겼습니다.
- `no_changes`: replacement와 기존 content bytes가 같습니다.
- `output_structure_invalid`: 결과 parse, marker 동일성 또는 대상 밖 byte 보존을 증명하지 못했습니다.
- `candidate_contract_invalid`: 생성한 candidate나 artifact가 JSON Schema를 통과하지 못했습니다.

## 결과

- 사용자 영역과 다른 managed block을 건드리지 않은 결과만 검토 후보가 됩니다.
- Source, replacement와 전체 output이 서로 다른 hash로 명확히 결속됩니다.
- Candidate 생성은 결정적이며 로컬에서 파일 쓰기 없이 완료됩니다.
- 이전 marker나 구조가 애매한 Markdown을 새 형식으로 조용히 다시 쓰지 않습니다.
- 후속 적용기는 candidate artifact와 output bytes를 다시 검증하고 명시적 승인 뒤에만 파일을 바꿔야 합니다.
