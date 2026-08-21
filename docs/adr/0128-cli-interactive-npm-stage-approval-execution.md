# ADR-0128: CLI interactive npm stage 승인 실행

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

Authorization과 durable record가 있어도 raw stage ID 해석, TTY 2FA와 npm 호출은 provider-specific 책임입니다. Read-only 준비 실패와 공개 요청 뒤 응답 유실을 같은 실패로 처리하면 안전한 재시도 여부를 판단할 수 없습니다.

## 결정

CLI 조정기는 exact review·decision·authorization source를 재계산하고 명시적 online·write를 요구합니다. Provider adapter는 TTY·비자동화·환경 credential 부재, 명시한 user config, 격리 cache·빈 global config, npm 11.15 이상과 exact stage list·view를 확인합니다. Raw stage ID는 adapter closure에만 둡니다.

Execution core는 준비 뒤 source와 authorization을 다시 확인하고 immutable attempt를 저장합니다. 그 뒤 stage view·source·authorization을 한 번 더 확인한 다음에만 closure의 `npm stage approve`를 호출합니다. OTP는 npm의 inherited stdin으로 직접 처리합니다. Child output은 raw stage ID를 streaming redaction해 전달하지만 저장하지 않습니다.

호출 전 실패는 abort, 호출 시작 뒤 실패나 source·config·terminal 불명확성은 unknown입니다. Exit zero도 공개 증명이 아니며 public registry verification을 요구합니다. 모든 post-call 상태는 blind retry를 금지합니다.

## 결과

Source 조정기, provider adapter, execution core, durable store, CLI arguments와 formatter를 분리했습니다. 테스트는 attempt-before-call, exact single approve, TTY·automation, stage·config race, success·abort·unknown, source 재검증과 reject 부재를 검증합니다. Fixture는 실제 npm approve·2FA·공개 성공을 주장하지 않습니다.
