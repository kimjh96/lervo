# ADR-0078: snapshot에 묶인 local trace cursor page

- 상태: 승인
- 날짜: 2026-08-20

## 맥락

완전한 trace report는 1,000개 상한에서 일부 성공을 거부하지만 더 큰 run을 읽을 방법이 필요합니다. 기존 report의 `status`, 시각과 session은 전체 run 집계이므로 event 배열만 page로 바꾸면 같은 schema version의 의미가 달라집니다. 단순 seq cursor는 page 사이에 event가 추가될 때 서로 다른 snapshot을 이어 붙일 수도 있습니다.

## 결정

기존 `TraceReport`와 별도로 `TracePageReport` v1을 정의합니다. Page report는 전체 run 상태를 주장하지 않고 project/run, 전체 저장소 integrity snapshot, page 좌표와 최대 100개 event만 가집니다.

첫 page는 `--page-size 1..100`, 다음 page는 이전 응답의 `--cursor`로 요청합니다. Cursor는 schema version, project/run, 전체 event count와 head hash, 마지막으로 반환한 seq·event hash와 page 크기를 canonical JSON과 SHA-256 checksum에 결속합니다. Checksum은 손상·오타 탐지이며 인증이나 권한 증명이 아닙니다.

다음 조회는 전체 chain을 다시 확인하고 cursor snapshot과 현재 count/head가 다르면 `trace_cursor_stale`로 실패합니다. 형식·checksum·좌표가 틀리거나 다음 event가 없으면 `trace_cursor_invalid`입니다. Page reader는 event schema·allowlist·hash, 증가하는 seq, 확인 가능한 연속 link, 반환 수·hasMore·next cursor 좌표를 다시 검증합니다. Cursor와 page report의 미지원 version은 기존 의미로 추측하지 않습니다.

## 결과

큰 run을 한 번에 적재하지 않고 각 event를 순서대로 읽을 수 있으며 page 사이 append를 같은 조회 결과로 섞지 않습니다. Cursor는 bearer 권한이 아니고 project 접근 제어를 대체하지 않습니다. 조회는 원본을 변경하지 않습니다.
