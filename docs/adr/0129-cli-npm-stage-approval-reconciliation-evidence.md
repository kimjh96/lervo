# ADR-0129: CLI npm stage 승인 결과 대조 증거

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

Approval CLI exit zero는 공개 package의 독립 증명이 아니고 응답 유실 terminal도 결과를 모릅니다. Public registry만 보면 승인 대상 stage가 남았는지 알 수 없고, stage list만 보면 공개 version digest와 dist-tag를 확인할 수 없습니다.

## 결정

Success·unknown terminal을 exact attempt·authorization·review에 다시 결속합니다. Authenticated observer는 first stage list, anonymous public version·dist-tag 관측, second stage list 순서로 읽고 두 normalized list 전체가 같아야 합니다. 승인 대상 ID digest 원문은 버리고 absent·present·replacement·ambiguous만 남깁니다.

순수 report는 public integrity·shasum·dist-tag와 approval stage absence가 모두 matched일 때만 `public_release_confirmed`입니다. Public version·tag가 모두 보이지 않고 exact stage가 남아 있으면 `approval_not_confirmed`, 부분·불일치·unavailable은 `unknown`입니다. 어느 결과도 retry나 transition completion 권한이 아닙니다.

명령은 source와 store snapshot, user config를 끝에 다시 확인하고 temporary root를 제거합니다. Attempt·terminal·stage·npm settings를 바꾸거나 approve·reject를 호출하지 않습니다.

## 결과

Public observer 재사용, authenticated stage observer, source reader, report·standalone validator, CLI와 formatter를 분리했습니다. 테스트는 confirmed·not-confirmed·unknown, stage list·config race, raw ID 폐기, source 결속과 outcome redigest 거부를 검증합니다.
