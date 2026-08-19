# ADR-0047: 역할별 managed 대화 응답과 공개 증거

- 상태: 채택
- 기준일: 2026-08-20

## 맥락

플랫폼 중립 참여 runtime은 어떤 역할이 답할지만 결정하며, 실제 Codex·Claude 실행과 shared context 주입을 증명하지 않았습니다. 단순 responder가 문자열과 permit만 반환하면 다른 역할의 맥락을 재사용하거나 평가 원본 없이 공개 허가를 주장할 수 있습니다.

## 결정

`@lervo/conversation-responder`를 interaction, provider adapter와 writing 계층 사이의 application bridge로 둡니다. Bridge는 message artifact의 bytes·hash·UTF-8을 확인하고 event·policy·decision·role·message hash에 묶인 managed request를 만듭니다. Message는 controlled turn 입력이지만 repository 문서가 아니므로 E2/E3라고 부르지 않습니다.

응답 역할은 파일 쓰기와 provider의 직접 외부 메시지 전송을 거부해야 합니다. 각 응답은 새 provider session에서 실행하며, 역할에 허용된 문서와 shared context만 기존 context preparation과 adapter injection 계약으로 전달합니다. 실행 뒤 공통 검증기는 E2/E3 receipt, 원본 context event, run 완료 artifact, context generation과 공유 원본의 document/hash 결속을 다시 확인합니다. Read-only run은 예상 write path가 없어도 유효합니다.

Provider 결과는 `chat` surface writing 평가를 통과해야 합니다. Reply candidate는 결과 artifact, evaluation, evaluation artifact와 content-bound permit를 함께 전달합니다. 별도 verifier는 현재 정책에서 해석한 writing contract로 이 원본을 CAS에서 다시 읽습니다. 이 검증 전에는 durable outbox를 만들지 않습니다.

## 개인정보와 실패 의미

새 event는 추가하지 않습니다. 기존 `run.requested`에는 원문 대신 message hash가 포함된 request digest만 남고, context와 run event에도 message·prompt·provider 응답을 넣지 않습니다. 원문과 결과·평가는 CAS, 실행 증거는 managed run event, 전송 상태는 interaction DB가 원본입니다.

Message CAS 불일치, 역할·정책 좌표 불일치, write 가능 역할, provider session 재사용, 저장소 변경, E2/E3 원본 불일치와 writing 차단은 fail-closed입니다. Interaction 단계의 생성 실패는 `response_generation_failed`, 반환 뒤 평가 원본 변조는 `publication_verification_failed`로 재예약하며 outbox를 만들지 않습니다.

## 검증

실제 Codex·Claude adapter 구현을 가짜 provider transport와 연결해 같은 message를 두 역할의 독립 read-only session에서 처리했습니다. 각 adapter가 자기 역할의 restricted shared context만 받는지, 두 결과가 실제 writing permit를 얻는지, raw message가 event에 없는지 확인했습니다. Evaluation artifact hash를 변조한 fixture는 outbox 없이 publication retry로 남습니다. 기존 숙의 runtime도 새 공통 managed evidence 검증기를 사용합니다.

## 결과와 후속 범위

참여 판단, provider 실행, context 증거와 writing 공개 검증의 책임이 분리됐습니다. 다음 범위는 Slack·Discord의 인증 요청과 외부 participant mapping을 기존 conversation adapter 계약에 연결하는 일입니다.
