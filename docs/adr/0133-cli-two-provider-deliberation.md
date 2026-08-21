# ADR-0133: 사용자용 Codex·Claude 교차 숙의 CLI

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

숙의 schema와 runtime, Codex·Claude 교차 검토 fixture는 있었지만 사용자가 저장소에서 두 provider의 역할과 검증 suite를 골라 실행할 명령은 없었습니다. 자유 형식 대화를 단순히 이어 붙이면 합의 표현, 공유한 맥락, writing 품질과 실제 검증을 증거로 구분할 수 없습니다. 실행 문서를 한 파일에 계속 누적하는 방식도 장기 운영과 독립 검토에 적합하지 않습니다.

## 결정

`lervo deliberate`는 서로 다른 Codex·Claude provider를 제안·결정 역할과 독립 검토·검증 역할에 고정합니다. 한 개 이상 16개 이하의 project verification suite와 주제를 필수로 받고 최대 두 회차만 실행합니다. 검토 응답 첫 줄은 정확히 `판정: 승인` 또는 `판정: 수정 필요`여야 합니다. 자연스러운 동의나 반대 표현을 임의로 수렴 판정으로 바꾸지 않습니다.

각 제안, 검토, 수정, 검증과 결정은 새 managed provider session에서 실행합니다. 산출물 생산 provider의 반대 provider가 별도 session에서 한국어 writing 의미 평가를 수행합니다. 평가 결과는 정확한 JSON 객체와 요청한 검사 전체를 요구하며 누락, 추가, 중복, code fence와 상태 모순은 공개 실패입니다. 이는 평가 provider가 산출물을 이해하거나 이후 작업에 사용했다는 주장이 아닙니다.

공개된 산출물 하나에는 `context.published`를 한 번만 기록합니다. 제안자와 검토자가 같은 원문 hash를 받을 수 있도록 역할별 `handoff.created`를 따로 만들며, 실제 다음 run에서 수신 역할마다 새 E2/E3가 있어야 합니다. 생산 역할의 receipt, provider session이나 내부 추론을 공유하지 않습니다.

검토 승인 뒤 명시된 project suite를 실제 실행합니다. `run.completed`는 결과 artifact와 모든 verification result artifact를 포함해야 하고, 각 `verification.completed`의 suite·revision·verification ID·상태·result artifact 좌표가 managed run 원본과 일치해야 합니다. 모든 필수 suite와 최종 결정이 통과해야 `converged`입니다. 검토가 두 회차 안에 승인되지 않거나 검증이 실패하면 `no_consensus`, provider·writing·event·artifact 계약 실패는 `failed`입니다.

실행 문서는 `.lervo/state/deliberations/<숙의 ID>/` 아래 writing 정책, 각 산출물과 의미 평가 요청별 디렉터리에 짧은 manifest와 원문 파일로 원자적으로 게시합니다. 기존 문서에 덧붙이지 않고 파일은 `0600`, 디렉터리는 `0700`을 기본으로 합니다. Event에는 원문, prompt, provider payload, 내부 추론과 절대 경로를 넣지 않습니다. 사람용 출력은 내부 ID·digest·경로를 숨기고 자동화용 `--json`만 구조화 좌표를 제공합니다.

종료 코드는 수렴 0, `no_consensus` 2, 실행·계약 실패 1입니다. 새 event 종류나 skill 사용 주장은 추가하지 않습니다. 기존 provider adapter, context delivery, writing, verification과 deliberation 계약을 application layer에서 조합합니다.

## 결과

사용자는 저장소에서 Codex와 Claude가 독립된 역할과 session으로 제안·검토하고 실제 검증 결과에 따라 수렴하는 경로를 실행할 수 있습니다. 여러 역할이 읽은 맥락은 handoff와 역할별 E2/E3로 확인할 수 있지만, 모델의 숨겨진 대화나 이해를 공유했다고 과장하지 않습니다.

이번 범위는 두 역할과 두 provider의 고정 정책입니다. 임의 참여자 수, 사용자 정의 역할 topology, 장기 숙의 재개와 외부 채팅에서의 숙의 시작은 포함하지 않습니다.
