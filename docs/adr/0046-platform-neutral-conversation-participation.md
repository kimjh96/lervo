# ADR-0046: 플랫폼 중립 대화와 능동 참여 경계

- 상태: 채택
- 기준일: 2026-08-20

## 맥락

Slack과 Discord는 사용자가 에이전트와 만나는 수단일 뿐 제품의 대화 모델이 아닙니다. 채널 payload, webhook 방식과 message ID를 핵심 runtime에 넣으면 새 플랫폼이나 Lervo 자체 채팅 서비스를 추가할 때 참여 정책과 응답 생성까지 다시 구현해야 합니다.

또한 에이전트가 직접 언급된 메시지에만 답하는 방식으로는 팀 대화에 참여할 수 없습니다. 반대로 모든 메시지에 자동으로 답하면 대화 방해, 에이전트 간 무한 응답과 비용 폭증이 생깁니다. 대화를 보았다는 사실과 대상 에이전트가 근거 문서를 실제로 적재·주입받았다는 사실도 구분해야 합니다.

## 결정

### 플랫폼은 adapter 뒤에 둔다

`@lervo/conversation-contract`는 플랫폼 공통 target, inbound event, adapter descriptor, participation policy·decision, 검증된 outbound와 delivery receipt를 정의합니다. Adapter capability는 message 수신·전송, thread, 수정·삭제, reaction, streaming, typing, presence와 interactive action을 각각 선언합니다. 지원하지 않는 기능은 추정하지 않습니다.

외부 message ID는 adapter 안에서 즉시 SHA-256으로 바꾸고 `sourceEventKeyHash`만 정규화 원본에 넣습니다. 본문은 CAS 같은 원문 저장소의 artifact ID, content hash, byte count와 media type으로만 참조합니다. 외부 사용자 ID도 adapter 앞단에서 Lervo participant ID로 매핑하며 interaction DB에는 원문을 넣지 않습니다.

첫 adapter인 `@lervo/adapter-native-chat`은 특정 HTTP나 WebSocket 구현을 소유하지 않습니다. 자체 채팅 서비스가 구현하는 inbound mapping과 delivery port를 같은 계약에 연결합니다. Slack, Discord와 다른 플랫폼도 이후 이 경계를 구현하며, 플랫폼별 인증·서명 검증은 각 adapter 앞단의 transport 책임입니다.

### 관찰과 응답을 분리한다

`ConversationParticipationPolicy`는 역할별 대상 conversation, `mention_only`, `relevant`, `proactive`, `silent` mode, 허용 actor, 구독 signal, cooldown, 시간당 응답 수와 automation depth를 고정합니다. Decision은 항상 `observe` 또는 `respond`와 제한된 reason을 남깁니다.

직접 mention은 relevance 추정 없이 응답 후보가 됩니다. `relevant`와 `proactive` mode의 일반 message는 분리된 relevance evaluator가 `relevant`를 반환해야 응답합니다. 평가기가 없거나 실패하거나 확정하지 못하면 `relevance_unavailable`로 관찰만 합니다. `proactive` signal은 명시적으로 구독한 code만 응답합니다. Actor, cooldown, rate와 automation depth 제한은 이보다 먼저 적용됩니다.

이 결정은 에이전트가 원문을 이해했다는 증거가 아닙니다. Conversation에 메시지가 존재하거나 다른 역할이 답했다는 사실만으로 대상 역할의 `loaded`, `injected`, `used`를 만들지 않습니다. 실제 responder는 별도 작업에서 artifact를 자기 session에 적재·주입한 managed role run과 연결해야 합니다.

### 검증된 글만 outbox에 넣는다

`@lervo/interaction`은 relevance evaluator, responder와 publication verifier를 port로 받습니다. 응답할 때는 `chat` surface의 `WritingPublicationPermit`가 reply artifact ID와 content hash에 정확히 묶여야만 outbound를 만듭니다. 그래서 Codex, Claude, 자체 모델과 모든 채널이 같은 한국어 자연스러움·문단 맥락 검사를 거칩니다.

`@lervo/interaction-sqlite`는 message event와 role의 조합마다 inbox를 따로 두어 같은 대화의 여러 전문 역할이 독립적으로 판단하게 합니다. 처음 claim한 policy ID는 그 처리에 고정하며, 정책이 바뀌어도 이미 완료한 과거 message에 같은 역할이 다시 답하지 않습니다. 한 역할의 완료는 다른 역할의 관찰·응답을 중복으로 막지 않습니다. Inbox claim, participation decision과 outbound 생성은 한 transaction으로 완료합니다. Inbox 상태는 `pending`, `leased`, `completed`, outbox 상태는 `pending`, `leased`, `delivered`입니다. `completed`와 `delivered`는 되돌릴 수 없는 종단 상태이며 update/delete trigger가 원본과 수명주기를 막습니다. 만료 lease는 다른 worker가 다시 가져갈 수 있고 실패는 짧은 code와 다음 시도 시각만 남깁니다.

Delivery receipt에는 외부 전송 ID 원문 대신 `deliveryKeyHash`만 저장합니다. Adapter 실패는 `adapter_delivery_failed`, 잘못된 receipt는 `invalid_delivery_receipt`, 응답 생성 실패는 `response_generation_failed`, 공개 검증 실패는 `publication_verification_failed`로 재예약합니다. Relevance 실패는 실행 실패가 아니라 보수적인 `observe`입니다. 저장 실패는 완료나 전달을 주장하지 않습니다.

## 개인정보와 증거 의미

Interaction DB의 원본 필드는 내부 event/policy/outbound ID, project·integration·conversation 좌표, actor 종류와 Lervo participant/role ID, artifact 좌표, mention 좌표, automation depth와 시각입니다. 원문 message, 외부 사용자 ID, 외부 message/delivery ID, prompt, provider payload와 내부 오류는 저장하지 않습니다.

이번 단계는 전역 실행 event를 추가하지 않습니다. Conversation decision과 delivery 상태는 durable interaction 원본이지만 managed run 완료, Hub event sync, shared context 발행이나 E3를 뜻하지 않습니다. 공유할 가치가 있는 대화 결과는 기존 `SharedContextPublication`으로 별도 발행하고, 각 역할이 자기 E2/E3를 다시 만들어야 합니다.

## 검증

Schema valid/invalid fixture로 raw source key와 publication permit 누락을 거부합니다. 정책 fixture는 mention, relevance 미확정, 구독 signal, actor, cooldown, 시간당 제한과 automation depth를 구분합니다. Native adapter와 SQLite 통합 fixture는 관련성 기반 무호출 참여, 같은 message에 대한 여러 역할의 독립 결정, writing permit 확인, 재시작 뒤 역할별 중복 responder 방지, 전송 실패 재시도, 종단 상태 변조 거부와 전체 감사를 검사합니다. SQLite bytes에 raw source key, 외부 delivery key와 message 본문이 없는지도 확인합니다.

## 결과와 후속 범위

대화 참여 의미와 durable 전달은 특정 채널이나 모델에서 분리됐고, 자체 채팅 서비스도 같은 adapter 계약을 사용할 수 있습니다. 다음 범위는 선택된 message artifact를 역할의 현재 shared context와 함께 별도 E2/E3로 준비하고 Codex 또는 Claude managed session을 실행한 뒤 실제 writing 평가를 통과한 reply만 반환하는 conversation responder bridge입니다. 그 다음 Slack·Discord adapter와 각 transport의 인증·서명 검증을 같은 contract suite에 추가합니다.
