# ADR-0142: 숙의 진단의 snapshot 고정·bounded event 조회

- 상태: 채택
- 날짜: 2026-08-22

## 맥락

숙의 상태·trace와 대화 queue 대조는 프로젝트 event chain을 원본으로 확인합니다. 기존 구현은 결과를 최대 1,000개 event로 제한했지만, 관련 run을 찾기 전에 프로젝트의 모든 event를 한 배열에 모았습니다. 따라서 반환 크기는 작아도 오래 운영한 저장소에서는 메모리 사용량이 전체 이력에 비례했습니다. 조회 중 새 event가 추가될 때 어느 시점의 결과인지도 코드에 명시되어 있지 않았습니다.

## 결정

무결성 검사가 반환한 `eventCount`를 이번 진단의 snapshot 마지막 seq로 사용합니다. Project event seq는 1부터 빠짐없이 이어지므로 이 값보다 뒤에 추가된 event는 현재 결과에 포함하지 않습니다. Reader는 최대 1,000개씩 두 번 순회합니다.

첫 순회는 대상 숙의의 시작·산출물·완료 event와 checkpoint가 직접 가리키는 event에서 관련 run ID만 찾습니다. Checkpoint가 가리킨 event가 snapshot 안에서 모두 확인되지 않으면 현재 판정에 섞지 않고 `deliberation_history_invalid`로 닫습니다. 두 번째 순회는 관련 run의 event만 결과에 보관합니다. 대상 event 또는 최종 trace가 1,000개를 넘으면 일부 결과를 반환하지 않고 기존 `deliberation_trace_too_large`로 실패합니다. Snapshot 끝까지 cursor가 전진하지 않는 경우도 `deliberation_history_invalid`입니다.

이 조회는 event, checkpoint, lease와 파생 인덱스를 만들거나 수정하지 않습니다. Event 원문·provider 응답·prompt를 새 파일이나 telemetry에 복제하지 않으며 기존 숙의 진단 report v1 형식도 바꾸지 않습니다.

## 결과

프로젝트 전체 event 수가 늘어나도 숙의 진단이 메모리에 보관하는 event는 target 좌표와 최대 1,000개의 결과로 제한됩니다. 현재 SQLite event store에서는 두 번의 순차 조회가 필요하므로 시간 비용은 전체 이력에 비례하지만, 특정 저장 구현의 query나 인덱스를 공통 진단 계약에 노출하지 않습니다. 이후 재생성 가능한 deliberation 인덱스를 추가하더라도 같은 snapshot·상한·원본 재검증 의미를 유지해야 합니다.
