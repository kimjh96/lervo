# ADR-0126: CLI npm stage 승인 권한

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0125의 review evidence는 exact staged package와 tarball 관측이지만 사람의 공개 결정이나 실행 권한이 아닙니다. `npm stage approve`는 package를 공개하고 2FA를 요구하므로 검토 증거만으로 실행해서는 안 됩니다.

## 결정

Canonical 사람 decision을 exact review evidence digest, 비식별 stage ID digest, package·version과 다섯 확인 문구에 최대 10분 결속합니다. 확인에는 공개 전환, interactive 2FA, reject 금지와 결과 별도 확인이 포함됩니다. Actor는 `human_operator` 종류만 남기고 identity·stage ID 원문·OTP를 저장하지 않습니다.

`release:bootstrap:stage-approve-authorize`는 review와 decision의 bounded canonical source를 읽고 target·시각·digest를 다시 계산합니다. Authorization은 review 관측부터 10분, 발급부터 5분, decision 만료 중 가장 이른 시각까지만 유효하며 `npm_stage_approve_once`만 허용합니다. Reject·direct publish와 시도 뒤 대조 없는 retry는 금지합니다.

명령은 두 source를 끝에 다시 확인하고 새 절대 output만 mode `0600`, exclusive-create로 기록합니다. Network, npm client, prompt, approve·reject와 공개 확인은 없습니다.

## 결과

사람 decision, 순수 authorization, source reader, CLI writer와 formatter를 분리했습니다. 테스트는 freshness·expiry·binding, 권한 상향 redigest, source race, immutable output과 무 npm side effect를 검증합니다.

다음 단계는 외부 호출 전에 attempt를 보존하고 한 terminal로 결과를 닫는 durable record 경계입니다.
