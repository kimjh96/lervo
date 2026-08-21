# ADR-0131: CLI stage 증거 bundle manifest

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

Stage approval transition은 다섯 경로로 여섯 원본을 받습니다. 이 인자 집합을 반복 입력하면 운영 실수가 늘지만 원본을 한 문서에 복제하면 파일이 계속 커지고 각 원본의 수명주기와 불변성이 흐려집니다.

## 결정

`first_publication_stage_evidence_bundle` manifest를 파생 편의 계층으로 추가합니다. Manifest는 자기 파일이 있는 디렉터리를 기준으로 stage review, decision, authorization, approval result directory와 reconciliation report의 안전한 상대 좌표를 기록합니다. 각 file reference는 canonical 문서 digest를, result reference는 attempt·terminal digest를 가집니다. 본문·절대 경로·target·outcome·actor·stage ID와 외부 응답은 복제하지 않습니다.

상대 경로는 manifest 디렉터리 안에만 머물고 절대 경로, 빈 segment, `.`·`..`, backslash와 NUL을 허용하지 않습니다. Manifest는 canonical JSON 16 KiB 이하, mode `0600`, exclusive-create 파일 하나입니다. 원본 문서와 result store는 그대로 유지합니다.

생성기와 transition 소비자는 같은 stage approval evidence-set validator를 사용합니다. 생성 시 전체 원본을 검증하고 쓰기 직전에 다시 확인합니다. 소비 시 manifest digest와 각 참조 digest만 믿지 않고 원본을 다시 열어 전체 관계를 재계산합니다. Online transition 관측 뒤에는 manifest와 모든 원본을 다시 대조합니다. 기존 다섯 인자와 bundle 입력은 상호 배타적입니다.

## 결과

운영자는 긴 stage source 인자 집합을 bundle 하나로 전달할 수 있지만 원본성·freshness·authority 의미는 바뀌지 않습니다. Bundle은 게시, 승인 재시도, transition 완료 권한이나 runtime state가 아닙니다. Source 변경, 경로 탈출, redigest, 혼합 입력과 기존 output은 fail-closed합니다.
