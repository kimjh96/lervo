import { writingContractForLanguage } from "@lervo/core";

export function terminalPublicationInstruction(language: string): string {
  const policy = writingContractForLanguage(language);
  return [
    `Repository publication policy: publication.language=${policy.locale}; writingPolicyId=${policy.writingPolicyId}.`,
    "Write new or revised repository documentation in English, even when the request or conversation is in another language, unless the user explicitly requests an exception.",
    "This policy does not choose the chat response language or authorize translation of unrelated user-owned content.",
  ].join(" ");
}
