# ADR-0016: 로컬 스킬 해석과 실행별 lock

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Skill manifest 계약은 있었지만 실제 실행이 어떤 스킬 후보를 골랐는지 재현할 discovery와 lock이 없었습니다. Provider가 자동으로 읽은 파일이나 사용자가 직접 실행한 스킬을 Roven이 관측한 선택처럼 기록하면 `resolved`, `invoked`, `used`의 의미도 무너집니다. 사용자 전역 스킬은 저장소 밖에 있으므로 원본 보존, 심볼릭 링크와 개인정보 경계도 함께 고정해야 합니다.

## 결정

### 첫 discovery 범위와 패키지 무결성

`roven run --skill <skill-id>`는 요청한 ID에 한해 프로젝트의 `.agents/skills/*/roven-skill.json`과 사용자의 `~/.agents/skills/*/roven-skill.json`을 읽습니다. Manifest가 없는 디렉터리와 요청하지 않은 ID는 후보로 해석하지 않습니다. 조직 및 외부 registry는 이 계약의 후속 source adapter로 남깁니다.

각 후보 디렉터리의 최상위 `roven-skill.json`을 제외한 모든 일반 파일을 상대 경로 순서로 읽고 경로, byte 수와 본문을 함께 SHA-256 입력으로 사용합니다. Manifest의 `contentHash`가 이 값과 다르면 실행 전에 실패합니다. Discovery root, 후보 디렉터리와 패키지 파일에서 심볼릭 링크를 따라가지 않습니다. 패키지는 최대 256개 파일과 16 MiB, manifest는 1 MiB로 제한하며 읽는 동안 파일 identity, 크기 또는 수정 시각이 바뀌어도 실패합니다. Roven은 manifest와 스킬 본문을 수정하지 않습니다.

### 호환성 및 선택 순서

후보는 enabled scope, provider, Role, 최소 runtime version, platform, 필요한 도구와 Role이 `allow`한 capability를 모두 통과해야 합니다. `require_approval`, 알 수 없는 도구와 알 수 없는 platform은 호환으로 올리지 않습니다. Manifest의 input/output schema reference는 형식만 검증하며 실제 schema 조회와 호출 계약 검사는 invocation 슬라이스에 남깁니다.

호환 후보는 다음 순서로 선택합니다.

1. `pinned`인 프로젝트 후보
2. 그 밖의 프로젝트 후보
3. 사용자 후보

같은 단계에서는 가장 높은 semantic version을 고릅니다. 같은 단계와 version에 서로 다른 content hash가 있으면 임의로 고르지 않고 `ambiguous_skill_selection`으로 실패합니다. 선택되지 않은 호환 후보와 비호환 후보는 `source_shadowed`, `version_shadowed` 또는 구체적인 호환성 사유로 lock에 남깁니다.

### `skills.lock`과 실행 증거

해석 결과는 `.roven/skills.lock`의 독립 JSON Schema로 검증하고 4 MiB로 제한합니다. Lock에는 project ID, 생성 시각, provider/Role/runtime/platform, 알려진 도구와 허용 capability, 선택 항목, 탈락 항목과 기계용 사유가 들어갑니다. URI는 로컬 lock에만 저장합니다. 같은 의미의 lock이 이미 있으면 기존 byte와 `generatedAt`을 유지합니다. 기존 lock이 schema를 통과하지 않거나 일반 파일이 아니면 사용자 내용을 덮어쓰지 않고 실패합니다. 새 값은 같은 디렉터리의 임시 파일을 완성한 뒤 rename합니다.

Lock은 현재 해석 결과인 파생 상태이며 실행 증거가 아닙니다. 실행을 시작할 때 `run.requested`, `run.resolved`와 선택 항목별 `skill.resolved`를 같은 event transaction에 기록합니다. Event에는 skill ID, version, content hash, source kind와 trust level만 넣고 URI, publisher, reviewer와 본문은 넣지 않습니다. 이 transaction이 실패하면 실행하지 않으며, 앞서 만들어진 lock만으로 실행했다고 주장할 수 없습니다.

현재 슬라이스는 스킬 내용을 provider context에 넣거나 호출하지 않습니다. 따라서 `skill.invoked`와 `skill.completed`를 만들지 않으며 CLI도 해석 결과가 호출이나 사용을 뜻하지 않는다고 표시합니다. 이후 invocation은 schema reference 확인, 입력 digest, capability 승인, 출력 artifact와 실제 provider 관측 지점을 별도 계약으로 추가해야 합니다.

### 실패 의미

- `invalid_skill_manifest`: 요청 후보의 manifest JSON 또는 schema가 잘못됨
- `invalid_skill_request`: 요청한 skill ID가 계약 형식에 맞지 않음
- `content_hash_mismatch`: manifest hash와 실제 패키지 내용이 다름
- `unsafe_skill_package`: 경로, 파일 형식, 변경 감지 또는 크기 제한을 통과하지 못함
- `skill_not_found`: 요청 ID의 후보가 없음
- `no_compatible_skill`: 후보는 있지만 현재 실행과 맞는 후보가 없음. 상세에는 비밀 없는 사유 코드만 둠
- `ambiguous_skill_selection`: 같은 우선순위와 version의 내용이 충돌함
- `invalid_skill_lock`: 기존 또는 생성 lock이 계약을 통과하지 못함
- `skill_lock_write_failed`: 원자적 lock 기록에 실패함
- `unsupported_runtime_platform`: 보수적으로 판정할 수 없는 runtime platform임

이 오류의 원문 manifest, 절대 경로, publisher 정보와 스킬 본문은 event payload에 복제하지 않습니다. Provider adapter는 skill resolution과 lock이 성공하기 전에는 시작하지 않습니다.

## 결과

- Hub 없이 프로젝트와 사용자 후보를 같은 계약으로 결정적으로 해석할 수 있습니다.
- 높은 사용자 version이 프로젝트 선택을 조용히 덮어쓰지 못하고 충돌과 비호환 사유를 로컬에서 재현할 수 있습니다.
- 사용자 스킬 원본과 유효하지 않은 기존 lock을 자동 덮어쓰지 않습니다.
- `resolved`와 실제 `invoked` 사이의 증거 경계를 유지합니다.
