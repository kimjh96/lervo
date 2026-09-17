export function deliberationPublicationGuidance(locale: string): string[] {
  return locale === "ko"
    ? [
        "이 저장소의 내부 용어를 모르는 기술 독자를 대상으로 자연스러운 한국어로 작성하세요.",
        "이 답변은 원래 대화 채널에 해당 역할의 발언으로 그대로 게시됩니다. 시스템 진행 상황을 보고하지 말고, 앞선 제안이나 이견에 직접 답하는 자연스러운 대화로 작성하세요.",
        "토론 회차, 산출물·주장 개수, 작성 검사 통과 여부 같은 내부 진행 정보는 쓰지 마세요.",
        "주제와 공유 근거에 나온 내부 표현을 그대로 따라 쓰지 말고, 필요한 개념만 독자 중심의 평이한 말로 다시 설명하세요.",
        "필요하지 않은 약어, 저장소 전용 상태명, 기계 식별자는 생략하세요. 꼭 필요한 용어는 처음 등장하는 문장에서 뜻을 설명하세요.",
        "제품명과 버전 표기도 그 이름 자체가 결론에 필요할 때만 남기고, 처음 나오는 문장에서 그 이름이 가리키는 사용자 동작이나 호환 범위를 설명하세요.",
        "정확한 근거 위치가 결론 이해에 꼭 필요할 때만 저장소 상대 경로를 제시하고, 그 경로가 어떤 동작이나 판단을 뒷받침하는지 같은 문장에서 설명하세요. 경로만 나열하지 마세요.",
        "이 역할의 결론과 사용자가 체감할 영향을 직접 밝히세요. 다음 행동이 있으면 구체적으로 설명하고, 없다면 이 검토 범위에서 더 할 일이 없다고 명시하세요.",
        "남은 작업은 다른 사람이나 역할에 넘기지 말고 객관적인 승인 조건 또는 아직 필요한 증거로 표현하세요.",
        "로컬 절대 경로를 노출하지 마세요.",
      ]
    : [
        "Write for a technical reader who does not already know this repository's internal vocabulary.",
        "This answer is published verbatim in the originating conversation as this role's contribution. Speak naturally to the preceding proposal or objection instead of narrating system progress.",
        "Do not report internal round numbers, artifact or claim counts, or writing-gate status.",
        "Do not copy the internal wording of the topic or shared evidence. Restate only the necessary concepts in plain reader-facing language.",
        "Omit unnecessary abbreviations, repository-specific state names, and machine identifiers. Explain every necessary term in the sentence where it first appears.",
        "Retain a product name or version label only when the name itself is necessary to the conclusion, and explain the user behavior or compatibility boundary it denotes in the sentence where it first appears.",
        "Use a repository-relative evidence path only when its exact location is necessary to understand the conclusion. Explain in the same sentence which behavior or conclusion it supports, and never list a bare path.",
        "State this role's result and user-visible impact directly. Give a concrete next action when one exists, or state that no further action remains within this review's scope.",
        "Express remaining work as an objective approval condition or missing evidence instead of delegating it to another person or role.",
        "Never expose an absolute local path.",
      ];
}

function directResultAndActionGuidance(korean: boolean): string[] {
  return korean
    ? [
        "결과와 사용자가 체감할 영향을 직접 밝히고, 이 검토 범위에서 실행할 다음 행동이 없다면 그 사실도 명시하세요.",
        "다른 사람, 역할, 소유자, 검토자, 검증자, 사용자 또는 팀에게 다음 행동을 지시하거나 책임을 넘기지 마세요. 이름이 구체적인 역할도 예외가 아닙니다.",
        "남은 작업이나 의존성은 누군가에게 내리는 지시가 아니라 승인 조건이나 아직 필요한 증거로 표현하세요. 예: '최종 승인 전 실제 대화 왕복 시험 결과가 필요합니다.'",
      ]
    : [
        "State the result and its user-visible impact directly, and explicitly say when there is no further action within this review's scope.",
        "Do not direct or delegate the next action to another person, role, owner, reviewer, verifier, user, or team; naming a specific role does not make that delegation acceptable.",
        "Express remaining work or dependencies as approval conditions or missing evidence, not as instructions to another actor. Example: 'A successful live conversation round-trip is required before final approval.'",
      ];
}

function plainAudienceGuidance(korean: boolean): string[] {
  return korean
    ? [
        "주제와 공유 문서의 표현은 근거이지 문체가 아닙니다. 내부 용어를 그대로 복사하지 마세요.",
        "이번 보완 답변에는 코드나 문서 경로, 파일명, 명령 이름, 백틱으로 감싼 이름, 약어, 저장소 전용 상태명, 해시나 기계 식별자를 쓰지 마세요.",
        "앞선 경로 제시 지침보다 이 보완 지침이 우선합니다. 근거는 경로 대신 확인된 동작과 그 동작이 결론을 뒷받침하는 이유를 평이한 말로 설명하세요. 실행 근거의 정확한 연결은 Lervo가 별도로 보존합니다.",
        "제품명, 규약 이름, 단계 번호, 버전 표기는 사용자 결론에 이름 자체가 꼭 필요한 경우가 아니면 기능 설명으로 바꾸세요. 꼭 남길 이름은 처음 나오는 바로 그 문장에서 사용자가 무엇을 할 수 있는지를 설명하세요. 단순 번역이나 띄어쓰기 변경은 설명이 아닙니다.",
        "저장소를 모르는 독자가 앞 문서 없이도 이해할 수 있는 문장만 남기세요. 일부 용어만 설명한 별도 용어 목록으로 대신하지 마세요.",
        "전체 설계를 다시 나열하지 말고 결론, 사용자 영향, 안전한 지속 실행, 근거와 호환성, 다음 행동만 여덟 문단 이내로 요약하세요. 한국어는 공백으로 구분한 450어절 이내로 작성하세요.",
      ]
    : [
        "Treat wording from the topic and shared documents as evidence, not as a style to copy. Do not repeat internal terms verbatim.",
        "Do not use code or document paths, file names, command names, backticked names, abbreviations, repository-specific state names, hashes, or machine identifiers in this repair answer.",
        "This repair rule overrides the earlier path guidance. Describe the observed behavior and why it supports the conclusion in plain language instead; Lervo preserves the exact execution-evidence binding separately.",
        "Replace product names, protocol names, stage numbers, and version labels with behavior unless the name itself is necessary to the user-facing conclusion. Explain what the user can do in the same sentence as every retained name; translation or respelling is not an explanation.",
        "Keep only sentences that a reader can understand without the preceding repository documents. A partial glossary does not satisfy this requirement.",
        "Do not restate the entire design. Summarize only the conclusion, user impact, safe continuation, evidence and compatibility, and next action in no more than eight paragraphs and 450 words.",
      ];
}

function naturalProseGuidance(korean: boolean): string[] {
  return [
    korean
      ? "문장 파편과 체크리스트식 문구를 문단마다 하나의 응집된 논지를 갖는 자연스러운 한국어 문장으로 다시 작성하세요."
      : "Rewrite fragments and checklist-like prose as natural English sentences with one coherent point per paragraph.",
  ];
}

function guidanceForFailedCheck(checkId: string, korean: boolean): string[] {
  if (checkId === "direct_result_and_action") return directResultAndActionGuidance(korean);
  if (checkId === "plain_audience_language") return plainAudienceGuidance(korean);
  if (checkId === "natural_en_prose" || checkId === "natural_ko_prose") {
    return naturalProseGuidance(korean);
  }
  return [
    korean
      ? `새 답변에서 실패한 작성 검사 '${checkId}'를 명시적으로 충족하세요.`
      : `Satisfy the failed writing check '${checkId}' explicitly in the fresh answer.`,
  ];
}

export function publicationRepairPrompt(
  originalInstructions: string,
  failedChecks: readonly string[] = [],
): string {
  const korean = /\p{Script=Hangul}/u.test(originalInstructions);
  const uniqueFailedChecks = [...new Set(failedChecks)];
  return [
    originalInstructions,
    "",
    korean
      ? "이전 독립 초안이 사람에게 공개하기 위한 작성 품질 검사를 통과하지 못했습니다."
      : "A previous independent draft did not pass the human-facing writing publication gate.",
    ...(uniqueFailedChecks.length === 0
      ? []
      : [
          korean
            ? `실패한 검사: ${uniqueFailedChecks.join(", ")}.`
            : `Failed checks: ${uniqueFailedChecks.join(", ")}.`,
        ]),
    korean
      ? "같은 작업에 대해 새 답변을 작성하되 기술적 내용과 근거를 보존하세요."
      : "Write a fresh answer for the same task and preserve the technical substance and evidence.",
    ...uniqueFailedChecks.flatMap((checkId) => guidanceForFailedCheck(checkId, korean)),
    korean
      ? "답변을 반환하기 전에 남아 있는 모든 내부 용어와 근거 경로를 처음부터 끝까지 다시 점검하고, 설명할 수 없는 표현은 삭제하세요."
      : "Before returning the answer, audit every remaining internal term and evidence path from start to finish, and remove anything you cannot explain plainly.",
  ].join("\n");
}
