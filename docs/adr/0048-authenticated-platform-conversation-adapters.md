# ADR-0048: Slack·Discord 인증 대화 adapter 경계

- 상태: 채택
- 기준일: 2026-08-20

## 맥락

자체 채팅 adapter만으로는 Slack·Discord의 실제 인증 방식과 외부 식별자 경계를 검증할 수 없습니다. Slack Events API는 요청마다 서명하지만 Discord의 일반 채팅은 interaction webhook이 아니라 인증된 Gateway session으로 전달됩니다. 두 방식을 억지로 하나의 webhook 모델로 만들면 Discord의 수동 대화 참여를 구현했다고 잘못 주장하게 됩니다.

## 결정

`@lervo/conversation-platform`은 플랫폼 공통 CAS 본문, descriptor·delivery receipt와 양방향 identity port만 소유합니다. 외부 tenant·channel·thread·participant ID는 identity port 밖의 normalized event와 interaction DB에 넣지 않습니다. Outbound correlation은 automation depth 복원과 재시작 복구를 위해 receipt 전에 durable·idempotent하게 기록합니다.

Descriptor는 adapter가 실제 구현한 `messages.receive`, `messages.send`, `threads`의 부분집합만 선언할 수 있습니다. 수정·삭제, reaction, streaming, typing, presence와 action은 구현 전에는 capability로 켤 수 없습니다.

`@lervo/adapter-slack`은 raw body 상한, HMAC-SHA256, constant-time 비교, 요청 시각 ±300초와 app/team scope를 순서대로 확인합니다. 그 뒤 Events API의 새 message와 app mention만 공통 inbound로 바꿉니다. Slack 서명 규칙은 [공식 request verification 문서](https://api.slack.com/docs/verifying-requests-from-slack)를 따릅니다.

`@lervo/adapter-discord`는 Gateway WebSocket을 흉내 내지 않습니다. 별도 transport port가 bot Identify/Ready 또는 Resume, heartbeat, application ID와 sequence를 확인하고 adapter는 인증된 `MESSAGE_CREATE`만 정규화합니다. 이 구분은 [Discord Gateway 공식 문서](https://docs.discord.com/developers/events/gateway)를 따릅니다.

Delivery port가 OAuth 또는 bot-token API 호출을 소유합니다. 두 port는 `outboundId`를 멱등 키로 사용해 재시작 뒤에도 같은 외부 message ID를 반환해야 합니다. Slack은 plain formatting을, Discord는 `allowed_mentions=none`과 enforced nonce 또는 durable lookup을 요구합니다.

## 개인정보와 실패 의미

인증과 app/team/guild/DM scope 확인 전에는 identity mapping과 CAS 쓰기를 호출하지 않습니다. 원문 message는 CAS에만 저장하고 normalized event에는 artifact 좌표만 둡니다. 외부 event·participant·message ID, signing secret, OAuth·bot token, Gateway session handle과 raw payload는 interaction DB와 전역 event에 넣지 않습니다.

인증·scope 불일치는 `platform_authentication_failed`, 크기·JSON·필드 오류는 `invalid_platform_payload`, 지원하지 않는 event는 `unsupported_platform_event`입니다. Mapping, CAS와 delivery 실패는 `identity_mapping_failed`, `artifact_storage_failed`, `platform_delivery_failed`이며 성공으로 추정하지 않습니다. 새 전역 event나 interaction 상태는 추가하지 않습니다.

## 검증

공통 contract fixture는 유효한 Slack 서명, challenge, 오래되거나 다른 secret의 서명, app/team scope와 동일 Events API 재전송을 확인합니다. Discord fixture는 인증되지 않은 session, 인증된 sequence, guild scope와 Resume 중복을 확인합니다. 두 adapter 모두 외부 ID가 normalized event에 없는지, CAS에만 본문이 있는지, outbound 재시도에 같은 내부 멱등 키를 전달하는지, Discord mention 억제와 correlation 기록을 검사합니다.

## 결과와 후속 범위

Slack, Discord와 자체 채팅이 같은 participation·responder·writing·outbox 계약으로 수렴합니다. 실제 deployment는 credential transport와 durable identity mapping 구현을 application entrypoint에 조합해야 하며, adapter core는 token이나 WebSocket 수명주기를 직접 소유하지 않습니다.
