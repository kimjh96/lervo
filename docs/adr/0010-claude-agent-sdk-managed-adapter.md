# ADR-0010: Claude Agent SDK managed adapter

- 상태: 채택
- 기준일: 2026-08-18

## 맥락

Codex adapter에서 session, controlled context, target turn과 provider signal 계약을 고정했지만 Claude 실행 경계는 비어 있었습니다. Claude CLI의 단발 실행만 사용하면 모델을 호출하지 않고 context를 먼저 넣었는지, 그 입력을 어느 session이 받았는지 확인하기 어렵습니다. Claude 내부 하위 에이전트를 그대로 허용하면 Roven이 각 역할에 주입한 문서와 writing 정책을 받지 않은 작업이 managed 실행 안에 섞일 수도 있습니다.

Claude Agent SDK는 process를 미리 시작하는 `startup`, 호출자가 정하는 session UUID, streaming user message와 입력 replay를 제공합니다. `shouldQuery=false`인 user message는 모델을 호출하지 않고 transcript에 추가되며 다음 query message와 합쳐집니다. SDK stream에는 session init, tool use/result, turn result와 `compact_boundary`가 포함됩니다. 반면 현재 result의 usage만으로 공통 schema가 요구하는 reasoning token을 알 수 없고, file tool 성공만으로 파일이 새로 생겼는지 기존 파일이 바뀌었는지 확정할 수도 없습니다.

## 결정

### Process와 session 경계

- `@roven/adapter-claude`는 공식 `@anthropic-ai/claude-agent-sdk` 0.3.226을 좁은 client port 뒤에서 사용합니다. 필요한 안정 API를 포함하면서 저장소의 package release-age 정책을 통과한 버전으로 고정합니다.
- Session마다 `startup`으로 process와 initialize handshake를 먼저 완료합니다. Roven이 만든 UUID를 SDK `sessionId`에 전달하고 provider session ID로 사용합니다.
- 기본 permission mode는 읽기 전용 `plan`입니다. Filesystem setting source, 자동 skill과 외부 MCP 설정은 불러오지 않습니다. 권한 요청은 Policy Engine 연결 전까지 모두 거부합니다.
- Claude 내부 `Agent`와 `Task` 도구는 기본 차단합니다. 전문 에이전트는 Roven이 별도 managed session으로 시작하고, 각 session에 같은 방식으로 자기 Role과 현재 context generation의 envelope를 주입합니다. Context를 받지 않은 내부 하위 에이전트를 정상 managed 작업으로 표시하지 않습니다.
- Session resume은 공통 resume 계약이 없으므로 `unsupported`입니다. 취소할 때는 실행 중 query를 interrupt한 뒤 input stream과 process를 닫습니다.

### Controlled context와 turn

- Inline/CAS 문서의 byte count, SHA-256과 손실 없는 UTF-8 검증은 `@roven/adapter-contract`의 공통 materializer가 맡습니다. Codex와 Claude가 같은 검증 함수를 사용합니다.
- 검증된 문서 묶음은 Role ID, writing policy ID와 정책 문서 ID, target turn, generation, 각 문서의 ID·path·hash·scope·원문을 포함한 하나의 synthetic user message로 만듭니다.
- 이 message는 `shouldQuery=false`로 보냅니다. SDK가 같은 session ID·message UUID·원문을 replay하고 init message까지 확인한 뒤에만 `controlledInput=true` receipt를 만듭니다. Replay가 없거나 원문이 다르면 receipt와 turn을 만들지 않습니다.
- 실제 task message는 `shouldQuery=true`로 보냅니다. 그 message UUID를 provider turn ID로 사용하며 같은 target turn의 context receipt 후보가 있어야 보낼 수 있습니다.
- Receipt는 Claude가 문서를 이해하거나 따랐다는 뜻이 아닙니다. 검증한 원문을 다음 model query의 입력 history에 추가했다는 E3 후보입니다.

### Provider signal과 capability

- 첫 init은 `provider.session.started`, query message replay는 `provider.turn.started`, result는 `provider.turn.completed` 또는 `provider.turn.failed`로 바꿉니다.
- `compact_boundary`는 provider가 직접 보고한 압축 경계이므로 `provider.context.compacted`로 바꿉니다. Orchestrator가 session 좌표를 다시 확인한 뒤에만 generation을 무효화합니다.
- Bash tool result는 `provider.command.executed`, 그 밖의 tool result는 `provider.tool.called`로 바꿉니다. Tool use와 result ID가 연결되지 않으면 정상 완료를 만들지 않습니다.
- `contextCompaction`, command와 tool call은 `supported`입니다. File change와 usage는 현재 공통 payload를 정확히 채울 수 없어 `unknown`입니다. Claude file tool은 일반 tool signal로만 남기며 `provider.file_change.reported`를 추정해서 만들지 않습니다.
- 하위 에이전트에서 온 message가 관측되면 `unmanaged_subagent_signal` 오류로 바꿉니다. 상위 session의 정상 tool이나 turn으로 위장하지 않습니다.

### 실패와 개인정보 처리

| 상황 | 의미와 처분 |
|---|---|
| 잘못된 adapter/session/turn 좌표 또는 UUID | `invalid_request`/`session_mismatch`; SDK 입력 전에 거부 |
| 문서 bytes/hash/UTF-8 또는 CAS 읽기 실패 | `context_materialization_failed`; context message와 receipt를 만들지 않음 |
| Init, session ID, input replay 또는 tool/turn 연결 불일치 | `provider_protocol_failed`; controlled receipt 또는 정상 telemetry를 주장하지 않음 |
| SDK startup, stream, interrupt 또는 close 실패 | `provider_process_failed`; 정상 종료를 주장하지 않음 |
| 권한 요청 | Policy Engine 연결 전에는 거부하며 자동 승인하지 않음 |
| 확인되지 않은 usage/file change | capability `unknown`; 숫자 0이나 변경 종류를 추정하지 않음 |

Context 원문과 task prompt는 로컬 SDK process 입력에만 존재합니다. Normalized signal에는 command, output, tool input, model result, 절대 경로와 provider 오류 원문을 넣지 않습니다. 관측 가능한 ID·상태·시간과 저장소 상대 cwd만 남기고 민감할 수 있는 값은 SHA-256 digest로 바꿉니다.

## 결과

- Claude도 Codex와 같은 session/context/turn 계약을 통과하며 Role, writing 정책과 문서 hash를 바꾸지 않습니다.
- Context message 자체는 model query를 일으키지 않고, provider의 정확한 replay 전에는 E3 후보가 생기지 않습니다.
- 여러 전문 에이전트는 Roven이 관리하는 별도 session에서 같은 공유 맥락 규칙을 적용받습니다.
- Claude가 직접 제공하지 않는 file/usage 의미를 꾸며내지 않으므로 capability 차이가 공개적으로 남습니다.

## 근거

- [Claude Agent SDK TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Code hooks와 compaction lifecycle](https://code.claude.com/docs/en/hooks)
