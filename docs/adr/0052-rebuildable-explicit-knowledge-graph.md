# ADR-0052: 재생성 가능한 명시적 지식 그래프

- 상태: 채택
- 날짜: 2026-08-20

## 배경

실행 이력에는 run, 문서, 역할, 검증, 숙의와 지식 수명주기를 잇는 좌표가 이미 있다. 그러나 사람이 이 관계를 확인하려면 여러 event payload를 직접 따라가야 했다. 전문 검색이나 임베딩으로 관계를 추정하면 아직 증명하지 못한 연결을 사실처럼 보일 수 있고, 별도 그래프 저장소를 원본으로 삼으면 로컬 실행과 복구 경계도 복잡해진다.

따라서 첫 그래프는 원본 event가 명시한 좌표만 읽고, 언제든 다시 만들 수 있으며, 한 화면과 한 응답이 계속 커지지 않아야 한다.

## 결정

### 원본과 투영 경계

`@lervo/knowledge-graph`는 provider, Hub와 저장 구현을 모르는 결정적 projector다. 입력은 allowlist 검증을 마친 `EventEnvelope`이고 출력은 다음 필드만 가진 관계다. 각 controlled 관계 종류는 허용되는 from/to node 종류와 방향도 함께 고정한다.

- `schemaVersion`, `relationId`, `projectId`, controlled `type`
- `from`, `to`: controlled `kind`와 명시적 ID
- `evidence`: 관계를 증명하는 `eventId`, `eventType`, `runId`, `seq`

Projector는 event payload에 실제로 있는 ID와 경로만 연결한다. 문서 선택·로드·주입은 각각 다른 관계이며 `used`를 추정하지 않는다. 문자열 유사도, 임베딩, 모델 판단, 전문 검색 결과와 화면 동작으로 새 관계를 만들지 않는다. 원본 event와 문서·artifact가 source of truth이고 그래프는 파생 인덱스다.

`relationId`는 project, 관계 종류와 두 끝점의 canonical 좌표에서 결정한다. 같은 관계가 여러 event에 나타나면 가장 이른 seq를 증거로 유지하므로 재동기화와 재구축 뒤에도 ID가 바뀌지 않는다. 서로 다른 canonical 관계가 같은 ID에 도달하면 무결성 실패로 닫는다.

### 저장과 복구

Hub SQLite는 `hub_knowledge_graph_relations`에 파생 관계만 저장한다. Event batch를 받을 때 event 원본, 기존 trace index와 그래프 관계를 같은 transaction에서 반영한다. 투영할 수 없는 payload나 관계 충돌이 있으면 batch 전체를 rollback하며 durable ack를 만들지 않는다.

인덱스 version이 없거나 오래되면 저장된 event를 순서대로 스트리밍해 version 1을 한 transaction에서 다시 만든다. 평상시 시작 검사는 bounded metadata만 확인하고, 명시적 전체 audit는 모든 event를 다시 투영해 누락·추가·변조 관계와 증거 좌표를 대조한다. 그래프 테이블을 잃어도 event 원본은 손실되지 않으며 재구축할 수 있다. 별도 그래프 데이터베이스는 도입하지 않는다.

### 조회 계약

`HubTraceSource`의 그래프 조회는 project와 focus node 한 개에 인접한 1-hop 관계만 반환한다. 기본 focus는 해당 project node다. Cursor는 마지막 `relationId`이고 기본 50개, 최대 100개를 안정된 ID 순서로 읽는다. 존재하는 project에서 관계가 없는 focus는 빈 page이며, 이는 focus 원본의 존재를 증명하지 않는다.

HTTP는 `GET /v1/trace/projects/<projectId>/graph`를 제공한다. `destinationId`는 필수이고 `focusKind`와 `focusId`는 함께 쓰거나 모두 생략한다. 기존 `trace.read` bearer 인증과 project scope를 source 조회보다 먼저 확인한다. 응답은 focus, 현재 page 관계와 그 관계에 필요한 node만 포함하고 다음 cursor를 제공한다. 조회와 화면 열기는 새 event를 만들지 않는다.

### 화면과 정보 범위

`/trace`는 focus 중심의 현재 page만 SVG와 접근 가능한 관계 목록으로 표시한다. 이웃 node를 선택하면 그 node를 새 focus로 조회한다. 다음 page는 기존 DOM을 교체하며 이전 page를 누적하지 않는다. 그래프 상태, cursor와 bearer token은 현재 탭 메모리에만 있고 URL, storage, cookie와 HTML shell에 들어가지 않는다.

관계에는 이미 allowlist event에 있는 project 상대 경로와 식별자만 허용한다. 문서·artifact 본문, content hash, prompt, provider 응답, 내부 추론, authorization, credential과 외부 사용자 원문은 저장하거나 응답하지 않는다. Project scope 밖 관계는 반환하지 않는다.

## 실패 의미

- `invalid_node`: focus 또는 관계 끝점의 종류·ID가 계약에 맞지 않는다. 조회나 투영을 시작하지 않는다.
- `projection_invalid`: event의 명시적 좌표로 유효한 관계를 만들 수 없다. Event batch transaction을 되돌리고 인덱싱 완료를 주장하지 않는다.
- `invalid_query`: focus 쌍, limit 또는 graph cursor가 유효하지 않다.
- `project_forbidden`: 인증 principal의 project scope 밖이다. Source를 호출하지 않는다.
- `project_not_found`: 권한 확인 뒤 project 원본이 없다.
- `source_inconsistent`: 관계 ID, project, focus 인접성, 정렬, cursor 또는 page 상한이 source 결과와 다르다. 일부 page를 반환하지 않는다.
- `integrity_failed`: 파생 테이블이 event 재투영 결과와 다르거나 관계 ID가 충돌한다. 정상 그래프 조회를 주장하지 않고 재구축 또는 운영자 진단이 필요하다.

이 결정은 새 전역 event나 실행 상태를 추가하지 않는다.

## 결과와 한계

로컬 event만으로 같은 관계를 투영할 수 있고 Hub가 없어도 기존 실행은 완료된다. Hub는 인증된 bounded 조회와 시각화만 제공한다. 현재 화면은 1-hop 탐색이고 서버 측 다중 hop, 의미 기반 관계, 전문 검색과 임베딩/RAG는 포함하지 않는다. 이후 검색 기능은 실제 검색 실패 데이터를 별도로 관측한 뒤 이 명시적 그래프를 원본이 아닌 검증 가능한 보조 신호로만 사용할 수 있다.

## 검증

- 동일 event의 결정적 투영과 같은 관계의 안정된 ID
- context, 문서, handoff, 숙의, 검증과 지식 candidate·review·verified·stale 관계 계약
- 증거 좌표 변조 탐지, 파생 테이블 삭제 뒤 event 기반 재구축과 전체 audit
- 인증·project scope 선확인, focus 인접성, bounded cursor page와 HTTP cursor 왕복
- 현재 page 교체, text node 기반 렌더링, token 비저장과 고정 asset 보안 헤더
