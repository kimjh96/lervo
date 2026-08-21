# ADR-0102: CLI 최초 공개 게시 실행 계획과 arming 비활성 경계

- 상태: 승인
- 날짜: 2026-08-21

> 후속 결정: plan 자체는 계속 `not_armed`입니다. [ADR-0112](./0112-cli-first-publication-arming-authorization.md)는 exact plan을 검토한 별도 사람 decision에서만 짧은 arming authorization을 만듭니다.

## 맥락

ADR-0101의 사전 점검은 현재 준비 상태를 설명하지만 실행 허가가 아닙니다. 실제 실행 코어에는 사람 확인, public package 재확인, durable 예약, 게시 호출과 결과 저장이 순서대로 존재합니다. 이 순서를 운영자가 알기 쉬운 형태로 고정하지 않으면 예약 이후에도 단순 취소가 가능하다고 오해하거나, 게시 호출 뒤 실패를 안전하게 재시도할 수 있다고 오해할 수 있습니다.

반대로 실행 계획을 `armed` token처럼 만들면 짧게 유효한 public package 관측과 동시 예약 상태를 건너뛸 위험이 있습니다. 현재 package identity·license·scope owner의 실제 운영 결정도 완료되지 않았으므로 게시 권한을 여는 기능은 이 작업의 범위가 아닙니다.

## 결정

Execution plan schema v1은 exact bootstrap과 publication authorization을 다시 대조하고 다음 상태를 고정합니다.

```json
{
  "status": "not_armed",
  "activation": "not_implemented",
  "sideEffects": {
    "reservation": "not_created",
    "publication": "not_attempted",
    "externalSettings": "not_changed"
  }
}
```

Plan은 bootstrap·publication authorization digest, target, artifact SHA-256, 사전 점검의 비권한성, 사람 확인, 실행 단계와 취소 경계를 canonical digest에 묶습니다. Reader는 plan digest만 확인하지 않고 bootstrap과 authorization에서 전체 plan을 다시 만들어 대조합니다. `status`나 `activation`을 바꾸고 digest를 다시 계산해도 거부합니다.

이전 preflight report는 permit가 아닙니다. 실제 실행은 다음을 모두 다시 수행해야 합니다.

- bootstrap 유효 시간
- npm 대화형 준비 상태
- public package 부재
- durable 예약 가능 여부
- release artifact 무결성

실행 단계는 다음 순서이며 plan 생성 자체는 어느 단계도 실행하지 않습니다.

1. 실행 입력 재검증
2. 대화형 publisher 준비와 첫 사람 확인
3. public package 부재 재관측
4. durable 예약 생성
5. release artifact 재검증
6. 외부 게시 시도
7. registry 결과 확인
8. terminal 결과 저장

사람 확인 문구는 실제 npm adapter와 공통 모듈을 사용합니다. 첫 확인은 exact package·version, 대화형 2FA 한 번과 bypass token 미사용 의도를 예약 전에 묻습니다. 거부하면 실행 상태가 생기지 않습니다. 두 번째 확인은 게시 시도 뒤 사용자가 본 2FA challenge 완료에 대한 진술이며 거부하거나 확인할 수 없으면 결과를 `publication_unknown`, 재시도 금지로 다룹니다. 어느 확인도 npm이 발급한 2FA proof나 bypass token 부재 증거가 아닙니다.

취소 경계는 세 가지입니다.

- `before_reservation`: 상태 변경 없이 취소할 수 있으며 같은 bootstrap도 새 preflight가 필요함
- `after_reservation_before_publication`: `aborted_before_publication`을 저장하고 새 bootstrap이 필요함
- `after_publication_started`: 취소·재시도할 수 없고 registry reconciliation이 필요함

Plan에는 승인자 identity, profile, user config, credential, npm 출력·오류 원문과 preflight 원본을 넣지 않습니다. 새 runtime event·project 상태·telemetry는 없습니다.

## 결과

Plan은 운영자가 위험 경계를 검토하는 정적이고 결정적인 문서이며 실행 permission, freshness proof, reservation이나 2FA proof가 아닙니다. 이 결정은 생성 API와 reader까지만 정의했습니다. 후속 [ADR-0103](./0103-cli-first-publication-execution-plan-command.md)은 이를 출력하되 arming하지 않는 명령을 추가합니다.

Fixture는 정확한 8단계, 세 취소 경계, preflight 재검증 의무, 두 확인 문구의 실제 adapter 공유, 다른 authorization, redigest activation 위조와 개인정보·과장된 proof 비저장을 검증합니다. 기존 실행 fixture의 예약 전 거부, 예약 뒤 abort와 게시 시작 뒤 unknown 의미는 바뀌지 않습니다.
