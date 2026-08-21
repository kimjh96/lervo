# ADR-0134: 분할 정책 기반 다중 역할 숙의 CLI

- 상태: 승인
- 날짜: 2026-08-21

## 맥락

첫 사용자용 숙의 명령은 Codex 제안자와 Claude 검토자처럼 두 역할을 CLI 인자로 고정했습니다. 여러 전문 관점이 함께 검토하려면 역할 ID, 공급자, 책임과 회차를 코드 수정 없이 선언할 원본이 필요합니다. 실행 이력이나 여러 정책을 한 파일에 계속 덧붙이는 방식은 피해야 합니다.

## 결정

사용자 정책은 `.lervo/deliberations/<policy-id>.yaml`에 하나씩 둡니다. 파일에는 schema version, 같은 policy ID, 최대 5회, 필수 verification suite와 최대 16개 참여자의 역할 ID·이름·관점·Codex 또는 Claude·책임만 둡니다. Project ID와 writing 계약 hash는 현재 검증 원본에서 실행 시 조립합니다.

저장 정책은 정확히 한 제안·결정 역할, 한 명 이상의 독립 검토 역할과 이들과 다른 검증 역할을 요구합니다. 두 provider가 모두 참여해야 합니다. 모든 검토자는 정책 순서대로 별도 managed session에서 같은 최신 공개 claim을 읽고 명시적 판정을 냅니다. 한 명이라도 차단하면 제안자가 반론 전체를 해소하고 모든 검토자가 다시 확인합니다. 모두 승인한 뒤에만 별도 검증 역할이 실제 suite를 실행하고 결정 책임자가 최종 결정을 작성합니다.

Source loader는 실제 project 아래의 정책 디렉터리와 64 KiB 이하 일반 파일만 읽습니다. Symlink를 따르지 않고 열린 파일의 device·inode·크기·수정 시각을 앞뒤로 대조합니다. 파일명·ID 불일치, 추가 필드, 중복 역할·suite, 책임 결합 오류와 지원하지 않는 provider는 실행 전에 거부합니다.

한 산출물은 `context.published`로 한 번만 공개하되 publication audience와 `handoff.created`는 전체 참여 역할을 열거합니다. 각 역할의 다음 실행은 자기 E2/E3를 새로 만들어야 합니다. 생산 provider의 반대 provider가 writing 의미 평가를 별도 session에서 수행하는 기존 경계를 유지합니다. 정책을 읽었다는 사실은 application 입력 검증이며 모델이 정책 원문을 읽거나 사용했다는 telemetry 주장이 아닙니다.

## 결과

`lervo deliberate --policy <policy-id> <주제>`로 코드 변경 없이 여러 전문 관점과 공급자 배치를 구성할 수 있습니다. 정책, 실행 상태, 산출물과 평가 요청은 서로 다른 파일 수명주기를 유지합니다. 이번 topology는 책임 기반 제안→다중 검토→수정→검증→결정 순서로 고정하며 임의 그래프, 중단 재개와 외부 채팅 시작은 다음 경계로 남깁니다.
