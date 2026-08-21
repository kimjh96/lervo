const changeMessages = {
  repository: (value) => `GitHub 저장소를 ${value.url}로 설정합니다.`,
  license: (value) => `라이선스를 ${value}로 설정합니다.`,
  "publishConfig.registry": (value) => `npm 게시 registry를 ${value}로 고정합니다.`,
  "publishConfig.provenance": () => "npm provenance를 명시적으로 켭니다.",
};

const currentStateMessages = {
  missing: "현재 값이 없습니다.",
  different: "현재 값이 선택과 다릅니다.",
};

export function formatFirstPublicationMetadataChange(change, { currentState = false } = {}) {
  const message = changeMessages[change.field]?.(change.value) ??
    `${change.field} 값을 설정합니다.`;
  if (!currentState) return message;
  const state = currentStateMessages[change.currentState] ?? "현재 값을 바꿉니다.";
  return `${message} ${state}`;
}
