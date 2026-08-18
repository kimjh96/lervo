# ADR-0021: CommonMark 기반 managed block 판정

- 상태: 채택
- 기준일: 2026-08-19

## 맥락

Marker 문자열이 있다는 사실만으로 문서 일부를 Lervo 소유라고 판단하면 code fence의 예시나 inline code까지 실제 block으로 오인할 수 있습니다. 반대로 문자 위치를 그대로 byte 위치로 사용하면 한글 같은 다중 byte 문자가 앞에 있을 때 다른 내용을 수정하게 됩니다. 본문을 바꾸는 compiler보다 먼저, 원본 bytes에서 안전하게 소유 경계를 증명하는 읽기 전용 parser가 필요합니다.

기존 제품 marker가 남은 저장소도 발견해야 하지만 새 이름과 섞어 쓰거나 이전 marker를 새 출력에 계속 만들면 안 됩니다. MDX는 CommonMark만으로 구조를 확정할 수 없으므로 같은 신뢰도를 부여하지 않습니다.

## 결정

`@lervo/documents`의 parser는 scanner가 확정한 최대 4 MiB `Uint8Array`만 받습니다. 파일 시스템, event recorder와 쓰기 port를 받지 않으며 입력 bytes를 바꾸지 않습니다. `mdast-util-from-markdown`이 만든 CommonMark syntax tree의 위치를 이용해 HTML comment와 code 영역을 구분하고, 반환 위치는 모두 끝 위치를 포함하지 않는 UTF-8 byte range로 변환합니다.

표준 marker는 다음 두 줄뿐입니다.

```text
<!-- lervo:begin block=<blockId> schema=1 -->
<!-- lervo:end block=<blockId> -->
```

이전 제품의 `<!-- roven:begin ... -->`과 `<!-- roven:end ... -->`은 `previous_product_v1` family로 읽기만 합니다. 새 출력 형식으로 사용할 수 없고 import adapter는 `legacy_marker_requires_migration`을 남깁니다. 한 문서에서 표준 family와 이전 family가 함께 발견되면 부분 전환으로 간주해 실패합니다.

Marker는 들여쓰기나 앞뒤 문자가 없는 독립된 줄이고 CommonMark HTML node여야 합니다. Fenced/indented code와 inline code에 있는 marker 모양 문자열은 오류가 아니라 `ignoredMarkers`로 반환합니다. 정상 결과는 block ID와 start marker, content, end marker, 전체 block의 byte range 및 전체 block 밖 byte range를 제공합니다. Block 밖 범위는 모든 구조 검사가 성공한 때만 반환합니다.

다음 상태는 `invalid`이며 compiler 입력으로 사용할 수 없습니다.

- UTF-8 오류, 4 MiB 초과 또는 marker 후보 256개 초과
- 독립된 HTML comment가 아닌 marker와 계약에 맞지 않는 문법
- 중첩, 중복 block ID, begin/end ID 불일치, 한쪽 marker 누락
- begin/end의 family 불일치 또는 한 문서의 family 혼용
- managed content 8 KiB 초과

Parser 결과는 입력에서 다시 계산할 수 있는 일시적 판정입니다. 새 event나 영속 상태를 만들지 않고 원문, block 내용과 block ID를 telemetry에 기록하지 않습니다. 오류 코드는 Markdown import candidate의 warning으로만 전달됩니다. MDX adapter는 아직 이 parser를 사용하지 않으며 marker가 보이더라도 `marker_structure_not_verified` 상태를 유지합니다.

## 결과

- 예제 코드 속 marker를 managed ownership의 근거로 사용하지 않습니다.
- 한글과 CRLF가 섞인 문서에서도 소유 경계가 원본 UTF-8 bytes에 정확히 대응합니다.
- 불완전하거나 혼합된 문서에서는 block 밖 범위도 안전하다고 주장하지 않습니다.
- 다음 compiler는 parser가 반환한 range와 source hash를 사용해 byte 보존 patch candidate를 만들 수 있습니다.
- 이전 marker를 발견할 수 있지만 명시적 migration 전에는 다시 쓰지 않습니다.
