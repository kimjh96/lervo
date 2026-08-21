export function proposalPrompt(topic: string): string {
  return [
    "아래 주제에 대해 저장소 근거를 확인한 뒤 실행 가능한 제안을 작성하세요.",
    "결론을 먼저 말하고 이유, 영향과 확인 방법을 자연스러운 한국어 문단으로 이어서 설명하세요.",
    "내부 추론이나 JSON은 쓰지 마세요.",
    "",
    `주제: ${topic}`,
  ].join("\n");
}

export function reviewPrompt(topic: string, round: number): string {
  return [
    "공유된 최신 제안 또는 수정안을 독립적으로 검토하세요.",
    "첫 문장은 반드시 '판정: 승인' 또는 '판정: 수정 필요' 중 하나로 작성하세요.",
    "수정이 필요하면 실제로 결론을 막는 문제와 필요한 수정을 구체적으로 설명하세요.",
    "승인이라면 확인한 근거와 남은 한계를 설명하세요. JSON은 쓰지 마세요.",
    "",
    `검토 회차: ${round}`,
    `주제: ${topic}`,
  ].join("\n");
}

export function revisionPrompt(topic: string): string {
  return [
    "공유된 제안과 차단 반론을 모두 다시 읽고, 반론을 해소한 수정안을 작성하세요.",
    "무엇을 바꿨는지와 왜 반론이 해소되는지를 자연스러운 한국어 문단으로 설명하세요.",
    "내부 추론이나 JSON은 쓰지 마세요.",
    "",
    `주제: ${topic}`,
  ].join("\n");
}

export function verificationPrompt(topic: string, suiteId: string): string {
  return [
    "공유된 최신 제안과 독립 검토 결과를 읽으세요.",
    `Lervo가 별도로 실행하는 ${suiteId} 검증의 범위와 결과가 결론에 어떤 의미인지 설명하세요.`,
    "검증을 실행했다고 미리 주장하거나 JSON을 쓰지 마세요.",
    "",
    `주제: ${topic}`,
  ].join("\n");
}

export function decisionPrompt(topic: string): string {
  return [
    "공유된 최신 제안, 승인 검토와 실제 verification 결과를 모두 읽으세요.",
    "채택하는 결론을 먼저 말하고 적용 범위, 근거와 다음 행동을 자연스러운 한국어로 설명하세요.",
    "검증되지 않은 사실이나 내부 추론, JSON은 쓰지 마세요.",
    "",
    `주제: ${topic}`,
  ].join("\n");
}
