# ADR-0100: CLI 최초 공개 게시 읽기 전용 사전 점검 보고서

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0099까지 실제 게시에 필요한 durable 저장과 대화형 npm adapter는 생겼지만, 실행자가 게시 경계를 열기 전에 무엇이 막혔는지 한 번에 확인할 계약은 없었습니다. 실행 함수를 진단 목적으로 호출하면 예약이나 외부 게시를 실수로 시작할 수 있고, 서로 다른 점검 코드가 npm 버전·TTY·2FA 조건을 다르게 해석할 수 있습니다.

사전 점검 결과만 저장해 실행 허가처럼 재사용하는 것도 안전하지 않습니다. Public package 부재와 bootstrap에는 짧은 유효 시간이 있고, 다른 process가 같은 bootstrap을 예약할 수 있기 때문입니다.

## 결정

읽기 전용 inspector는 exact bootstrap·publication authorization·release directory를 받고 다음 다섯 검사를 조합합니다.

- `bootstrap_freshness`: registry 관측 시각 이후이며 `validUntil` 전인지 확인
- `release_artifact`: bounded regular-file read로 exact tarball hash·integrity·shasum 재계산
- `public_package_absence`: public npm의 `not_found`, `existing`, `unavailable` 구분
- `reservation_state`: 결정적 reservation ID의 `missing`, `reserved`, `terminal`, `unavailable` 구분
- `npm_interactive_readiness`: 세 TTY, 비CI, 환경 credential 부재, npm 11.5.1 이상과 pending 아닌 `auth-and-writes` 구분

각 검사는 `ready`, `blocked`, `unknown` 중 하나이며 `unknown`도 전체 상태를 `blocked`로 만듭니다. 보고서 schema v1은 bootstrap·publication authorization digest, `checkedAt`, 순서가 고정된 다섯 검사, `advisoryOnly: true`와 다음 무부작용 경계를 canonical digest에 묶습니다.

```json
{
  "reservation": "not_created",
  "publication": "not_attempted",
  "externalSettings": "not_changed"
}
```

보고서 reader는 문서 hash만 확인하지 않습니다. Bootstrap, authorization과 네 관측 원본을 다시 받아 같은 보고서를 재계산하고 전체 의미를 대조합니다. 따라서 내용을 바꾸고 digest만 다시 계산한 문서는 실행 근거가 될 수 없습니다.

파일 예약 adapter의 `observe`는 root나 해당 reservation이 없을 때 directory를 만들지 않습니다. 기존 예약은 bootstrap·reservation digest와 terminal 상태만 반환합니다. 부분 directory, symlink, 과도한 권한, 손상과 좌표 불일치는 `missing`으로 낮추지 않고 fail-closed하며 inspector가 `reservation_store_unavailable`로 제한합니다.

npm 준비 정책은 실행 adapter와 보고서가 같은 순수 함수에서 계산합니다. 관측값과 보고서에는 profile, 사용자명, 설정 경로, 환경 변수 이름·값, token, OTP와 npm 출력 원문을 넣지 않고 제한된 reason code만 둡니다. `ready`는 현재 진단일 뿐 npm 권한, 실제 2FA challenge, bypass token 부재나 이후 게시 성공의 증거가 아닙니다.

## 결과

Inspector는 artifact·registry·예약·npm 관측 port만 호출하고 예약 생성, publisher, 확인 prompt나 외부 설정 쓰기 port를 갖지 않습니다. 실제 실행은 이 보고서를 소비해 생략할 수 없으며 package 부재 재관측, durable 예약과 사람 확인을 기존 실행 경계에서 다시 수행해야 합니다.

Fixture는 전체 ready, 만료·외부 unknown·기존 예약·non-TTY의 fail-closed 조합, profile·credential 비노출, 관측 원본을 이용한 redigest 변조 거부, artifact 변경, 부분 저장소와 root를 만들지 않는 missing 조회를 검증합니다. 새 runtime event·project 상태·telemetry는 없습니다.
