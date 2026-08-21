# ADR-0136: 플랫폼 중립 대화 숙의 제어

> 후속 결정: [ADR-0141](./0141-explicit-durable-conversation-deliberation-resume.md)은 명시적 재개 명령과 별도 권한·durable queue를 추가했습니다. 아래 내용은 최초 시작·조회 경계의 기록입니다.

- 상태: 채택
- 날짜: 2026-08-21

## 맥락

Slack과 Discord는 숙의를 시작하거나 조회하는 수단 중 하나일 뿐입니다. 자체 채팅을 포함한 모든 adapter가 같은 내부 명령을 사용해야 하며, 평범한 대화나 모델의 의도 추정을 실행 명령으로 바꾸면 안 됩니다.

## 결정

`@lervo/conversation-control`이 다음 두 명령을 결정적으로 해석합니다.

- `/lervo deliberate start <policy-id> -- <topic>`
- `/lervo deliberate status <deliberation-id>`

Start는 저장된 분할 policy만 받습니다. 자연어, reaction, mention만으로 숙의를 시작하지 않습니다. 정규화된 `ConversationInboundEvent`와 명령을 공급자·플랫폼 중립 `ConversationDeliberationPort`에 전달하며 Slack·Discord ID나 transport를 포트에 넣지 않습니다.

Project와 human participant는 principal 및 `deliberation.start`·`deliberation.read` 권한에 명시적으로 결속합니다. Backend는 이 principal 좌표를 받아 로컬 실행기나 durable queue에 연결할 수 있습니다. 공통 계약은 실행이 동기인지 비동기인지 추정하지 않고 `running`, `unknown`, `interrupted`, `converged`, `no_consensus`, `failed`와 산출물 수, 다음 행동만 반환합니다. 승인 전 불완전한 이력처럼 생존 여부를 증명할 수 없으면 `unknown`입니다.

Start backend에는 canonical conversation source event ID를 함께 전달합니다. Interaction lease 만료나 worker 재시작으로 같은 responder가 다시 호출될 수 있으므로 backend는 `(projectId, sourceEventId)`를 durable idempotency key로 사용해야 하며, 이 보장이 없는 직접 장시간 실행기를 연결하면 안 됩니다.

응답은 기존 `chat` writing 평가와 content-bound permit를 통과한 CAS 원문으로 만들고 interaction outbox가 전송합니다. Responder는 플랫폼 API를 직접 호출하지 않습니다. 새 전역 event나 숙의 상태를 추가하지 않으며, 명령을 받았다는 사실만으로 역할이 문서를 loaded·injected·used했다고 주장하지 않습니다.

## 결과

새 플랫폼은 기존 conversation adapter 계약으로 inbound event와 delivery port만 구현하면 같은 숙의 명령을 사용할 수 있습니다. 실제 배포는 권한 binding과 backend를 반드시 주입해야 하며, 빠진 경우 명령을 성공으로 보이지 않고 실패합니다.
