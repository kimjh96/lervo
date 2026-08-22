# ADR-0152: 정책을 먼저 확인하는 Node 원격 제어 runtime

- 상태: 채택
- 기준일: 2026-08-22

## 맥락

서명된 정책 동기화, 원격 명령 검증·전달, artifact 로딩과 project-bound replay SQLite는 각각 구현되어 있었습니다. 하지만 설치된 Node 수명주기에는 outbound event sync만 연결돼 있어, 실제 호스트가 이 계약들을 올바른 순서로 조합해야 했습니다. 특히 정책 확인 없이 command lease부터 받거나 provider 실행기를 암묵적으로 선택하면 로컬 제한과 공급자 중립 경계를 우회할 수 있습니다.

## 결정

### 한 제어 cycle은 정책 확인 뒤에만 command를 조회한다

`runRemoteControlLoop`는 매 cycle마다 policy bundle을 먼저 동기화합니다. Hub에 연결할 수 없거나 peer 인증이 끝나지 않으면 `policy_unavailable`만 반환하고 command lease를 요청하지 않습니다. 인증·서명·project scope·snapshot 연속성 검증이 끝난 `unchanged|applied|duplicate`에서만 한 command reconnect cycle을 실행하고 결과를 `command_checked`에 담습니다.

두 단계와 다음 cycle은 직렬입니다. `processed`는 남은 command를 위해 바로 반복하고, `idle`은 bounded poll interval, 전달 지연 상태는 worker가 계산한 시각, policy transport 실패는 bounded retry interval을 사용합니다. Policy signature나 local SQLite 무결성 오류는 offline으로 낮추지 않고 runtime fatal로 닫습니다.

### 실행 권한은 구성 파일만으로 열리지 않는다

`remoteCommands` config에는 Node ID, command·policy Ed25519 public key 파일과 polling·HTTP·receiver 상한만 둡니다. Key scope는 시작 때 읽은 현재 project ID·identity에 고정합니다. Public key 파일도 구성·token과 같은 owner-only UTF-8 일반 파일이어야 하며, key ID 중복·purpose 중복·알 수 없는 필드를 시작 전에 거부합니다.

원격 제어를 활성화하려면 같은 `openNodeRuntime` 호출에 `RemoteCommandExecutor`와 `LocalCommandCapabilityPolicy`를 모두 명시적으로 제공해야 합니다. 구성만 있거나 port만 있으면 network 시작 전에 실패합니다. 기본 `lervo-node` CLI는 provider 실행기를 임의로 선택하지 않으므로 원격 제어 config를 단독으로 활성화하지 않습니다. 실제 provider host가 managed coordinator를 조합하는 작업은 별도입니다.

### 원본 저장소와 process 종료 순서를 유지한다

정책 원본은 `.lervo/state/policy.sqlite`, replay 좌표와 terminal receipt는 `.lervo/state/remote-command-replay.sqlite`에 project-bound로 보존합니다. 기존 계약대로 raw request, signed command envelope, provider 오류, credential은 두 database에 넣지 않습니다.

Outbound sync와 remote control은 같은 AbortSignal로 중단하지만 서로의 cycle을 기다리며 직렬화하지는 않습니다. 한 loop의 치명적 실패는 새 cycle을 모두 막고 진행 중인 bounded cycle을 기다립니다. 그 뒤 replay store, policy store, event store 순서로 닫습니다. Sync 실패는 `sync_runtime_failed`, 원격 제어 실패는 `remote_control_runtime_failed`이며 원인 문자열이나 민감한 좌표를 출력하지 않습니다.

## 상태와 개인정보

새 event나 durable scheduler 상태는 없습니다. `policy_unavailable|command_checked`, cycle count와 마지막 policy·command 결과는 process memory에만 있습니다. Durable 재시작 근거는 기존 signed policy 원본과 replay reservation·receipt입니다. Policy 동기화 성공은 command 실행이 아니며, command receipt도 문서가 `loaded`, `injected`, `used`됐다는 뜻이 아닙니다.

## 검증

Policy peer 인증 실패에서는 command transport가 호출되지 않는지, policy와 command cycle이 겹치지 않는지 확인했습니다. Owner-only command·policy public key를 읽어 실제 policy SQLite와 replay SQLite를 연 뒤 signed snapshot과 signed command를 처리했습니다. 첫 process에서 실행 receipt 저장 뒤 acknowledgement가 유실된 상황을 만들고, 두 번째 process가 같은 command를 `duplicate`로 완료하면서 executor를 다시 호출하지 않는지 검증했습니다.

기존 policy·command HTTP package의 HTTPS, Hub identity, bounded body와 실제 Hub route 검증은 그대로 재사용합니다. 이번 ADR은 production TLS termination, credential hot reload, OS service supervisor 또는 내장 provider executor 완료를 뜻하지 않습니다.

## 결과

Node 조합 root가 정책·명령·replay 순서를 소유하게 됐고, 구성 파일만으로 실행 권한이 열리지 않습니다. 공급자별 실행은 여전히 공통 executor port 뒤에 있으며 Hub 없이 실행되는 기존 local-first CLI 경로는 바뀌지 않습니다.
