# ADR-0130: CLI stage 승인 transition 통합

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

ADR-0129의 `public_release_confirmed`는 공개 결과 증거지만 기존 transition union은 direct publication의 execution receipt와 reviewed resolution만 이해합니다. Stage 경로를 별도 완료 상태로 만들면 bootstrap consumption과 상시 Trusted Publisher gate가 갈라집니다.

## 결정

`stage_approval_reconciliation`을 세 번째 exact-key union member로 추가합니다. Member는 reconciliation report, stage review, 사람 decision, approval authorization, immutable attempt·terminal 전체를 재계산합니다. Review가 보존한 publication authorization digest를 원래 publication authorization에 대조하고 repository·source commit·package·version·registry·dist-tag·artifact를 bootstrap에 결속합니다. Confirmed outcome만 transition evidence가 됩니다.

이 upstream 결속을 추가한 현재 stage review 생성 문서는 v2로 올립니다. 기존 v1 reader 의미는 유지하지만 v1에는 publication authorization digest가 없으므로 승인 authorization과 transition의 source로 사용할 수 없습니다.

Stage 경로도 transition 시점의 fresh public release, stage-only workflow, npm `createStagedPackage` trust와 GitHub environment 네 gate를 그대로 통과해야 합니다. Direct arming 문서는 stage 경로에 요구하거나 provenance로 기록하지 않습니다. CLI는 세 evidence source 집합을 상호 배타적으로 파싱합니다.

기존 v2 receipt의 union enum 의미를 바꾸지 않습니다. Execution·resolution은 계속 v2이고 stage member는 v3로만 생성합니다. V2에 stage type을 넣거나 v3에 기존 type을 넣은 문서는 거부합니다. 세 경로는 provenance를 보존하면서 bootstrap consumed·Trusted Publisher stage-only·direct publish forbidden으로만 수렴합니다.

## 결과

Stage source reader, union validator, CLI option family와 receipt compatibility를 확장했습니다. 테스트는 confirmed member, original authorization·bootstrap 결속, direct arming 부재, v3, mixed·partial 입력, unconfirmed report와 기존 두 v2 경로 회귀를 검증합니다.
