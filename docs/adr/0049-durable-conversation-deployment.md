# ADR-0049: 재시작 가능한 대화 배포 조합

- 상태: 채택
- 기준일: 2026-08-20

## 맥락

인증 adapter의 port 계약만으로는 재시작 뒤 외부 답글을 내부 event에 다시 연결할 수 없습니다. API 요청 뒤 응답이 유실되면 단순 재시도는 같은 답변을 두 번 보낼 수도 있습니다. Credential transport, 가역 identity mapping과 전송 상태를 실제 application 경계에서 함께 조합해야 합니다.

## 결정

`ConversationPlatformIdentityPort`는 accepted inbound를 반환하기 전에 외부 message 주소와 canonical event ID를 기록합니다. Outbound 기록은 integration·tenant·conversation·external message, outbound ID, source event ID와 automation depth를 함께 보존합니다. 같은 외부 좌표에 다른 내부 원본을 덮어쓰지 않습니다. Agent participant이지만 Lervo outbound correlation이 없는 message는 automation depth 8로 닫아 외부 bot과 자동 대화를 시작하지 않습니다.

`@lervo/conversation-platform-sqlite`는 conversation·participant·thread binding, message correlation과 delivery replay를 별도 SQLite DB에 둡니다. 외부 ID 원문이 필요한 가역 저장소이므로 interaction DB와 분리하고 파일 mode를 `0600`으로 제한합니다. Thread ID는 처음 본 외부 thread 주소에서 결정적으로 만들고 이후 같은 주소를 재사용합니다.

Delivery replay는 API 호출 전에 platform, integration ID, outbound ID, request hash, `sending`과 시도 시각을 기록합니다. 검증된 외부 message ID를 받은 뒤에만 `delivered`와 전달 시각을 기록합니다. 플랫폼이 명시적으로 거부한 요청은 `rejected`, 응답을 확인하지 못한 요청은 `unknown`이며 둘 다 자동 재전송하지 않습니다. 재시작 뒤 남은 `sending`도 `unknown`으로 취급합니다. 이 선택은 중복 발송을 막지만 운영자 reconciliation 전에는 해당 outbox를 완료할 수 없다는 비용이 있습니다.

Slack transport는 bearer OAuth로 `chat.postMessage`를 호출하고 active markup 문자를 escape하며 mrkdwn을 끕니다. Discord transport는 bot token, 빈 allowed mention parse, reply mention 비활성화와 outbound 기반 enforced nonce로 Create Message를 호출합니다. 응답 크기·시간·content type·message ID를 제한하고 credential은 오류에 넣지 않습니다.

`apps/conversation`은 CAS, SQLite store와 platform adapter·delivery를 integration별로 조합합니다. Discord 수신의 WebSocket 연결, Identify/Resume, heartbeat와 reconnect는 기존 인증 port를 구현하는 별도 driver 책임입니다. Application entrypoint가 그 driver를 구현했다고 주장하지 않습니다.

## 개인정보와 실패 의미

Raw tenant, channel, thread, participant와 message ID는 이 mapping DB에만 있고 normalized event, interaction DB와 전역 event에는 없습니다. Signing secret, OAuth·bot token과 Gateway session handle은 DB에 저장하지 않습니다.

Binding·correlation 충돌은 기존 값을 보존하고 `identity_mapping_failed`로 닫습니다. Credential API의 실패, 응답 계약 불일치와 `unknown` replay는 `platform_delivery_failed`이며 receipt를 만들지 않습니다. 새 전역 event와 interaction 상태는 추가하지 않습니다.

## 검증

SQLite fixture는 process 재시작 뒤 thread·reply event·automation depth와 성공한 delivery receipt가 복원되는지 확인합니다. 충돌 mapping과 request hash는 덮어쓰지 않습니다. Credential fixture는 Slack authorization·plain text, Discord authorization·nonce·mention 억제, 성공 재시도의 단일 API 호출과 응답 유실 뒤 무재발송을 확인합니다. Application fixture는 종료와 재시작을 사이에 둔 Slack thread reply를 원래 canonical event에 연결합니다.

## 후속 범위

Discord Gateway driver, `unknown` 전송의 플랫폼별 조회·운영자 reconciliation, Hub command/approval 대화 UX는 별도 작업입니다. 특히 채팅 메시지나 reaction 자체를 승인 원본으로 사용하지 않고 Hub principal과 서명 승인 계약을 유지해야 합니다.
