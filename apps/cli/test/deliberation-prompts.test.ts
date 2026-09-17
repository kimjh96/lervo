import { describe, expect, it } from "vitest";

import {
  decisionPrompt,
  proposalPrompt,
  reviewPrompt,
  revisionPrompt,
  verificationPrompt,
} from "../src/deliberation-prompts.js";
import { publicationRepairPrompt } from "../src/deliberation-publication-guidance.js";

const role = {
  name: "Technical decision",
  description: "Makes a bounded repository decision.",
};

describe("deliberation prompts", () => {
  it("requires plain definitions and repository-relative evidence in every publishable turn", () => {
    const prompts = [
      proposalPrompt("Choose hybrid retrieval.", role, "en"),
      reviewPrompt("Choose hybrid retrieval.", 1, role, "en"),
      revisionPrompt("Choose hybrid retrieval.", role, "en"),
      verificationPrompt("Choose hybrid retrieval.", "project.quick", role, "en"),
      decisionPrompt("Choose hybrid retrieval.", role, "en"),
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain("does not already know this repository's internal vocabulary");
      expect(prompt).toContain("Omit unnecessary abbreviations");
      expect(prompt).toContain("machine identifiers");
      expect(prompt).toContain("only when its exact location is necessary");
      expect(prompt).toContain("never list a bare path");
      expect(prompt).toContain("published verbatim in the originating conversation");
      expect(prompt).toContain("Do not report internal round numbers");
      expect(prompt).toContain("user-visible impact directly");
      expect(prompt).toContain("objective approval condition or missing evidence");
      expect(prompt).toContain("Do not inspect the repository, filesystem, terminal, or tools");
      expect(prompt).not.toContain("/Users/");
    }
    expect(prompts[0]).toContain("under 450 words and eight paragraphs");
    expect(prompts[1]).toContain("under 350 words and six paragraphs");
    expect(prompts[0]).toContain("Do not copy the internal wording");
  });

  it("gives one failed publication a bounded plain-language repair instruction", () => {
    const prompt = publicationRepairPrompt("Review the proposal.", ["direct_result_and_action"]);
    expect(prompt).toContain("Review the proposal.");
    expect(prompt).toContain("previous independent draft");
    expect(prompt).toContain("audit every remaining internal term");
    expect(prompt).toContain("Do not direct or delegate the next action");
    expect(prompt).toContain("approval conditions or missing evidence");
  });

  it("generates and repairs Korean deliberation turns in Korean", () => {
    const proposal = proposalPrompt("설계를 검토하세요.", role, "ko");
    const review = reviewPrompt("설계를 검토하세요.", 1, role, "ko");
    const repair = publicationRepairPrompt(proposal, ["direct_result_and_action"]);

    expect(proposal).toContain("자연스러운 한국어");
    expect(proposal).toContain("원래 대화 채널에 해당 역할의 발언으로 그대로 게시됩니다");
    expect(proposal).toContain("작성 검사 통과 여부 같은 내부 진행 정보는 쓰지 마세요");
    expect(proposal).toContain("결론과 사용자가 체감할 영향을 직접 밝히세요");
    expect(proposal).toContain("450어절과 여덟 문단 이내");
    expect(proposal).toContain("저장소, 파일 시스템, 터미널 또는 도구를 직접 탐색하지 마세요");
    expect(review).toContain("판정: 승인");
    expect(review).toContain("판정: 수정 필요");
    expect(repair).toContain("결과와 사용자가 체감할 영향");
    expect(repair).toContain("이름이 구체적인 역할도 예외가 아닙니다");
    expect(repair).toContain("승인 조건이나 아직 필요한 증거");
    expect(repair).not.toContain("Write a fresh answer");
  });

  it("makes a Korean plain-language repair remove or explain every internal coordinate", () => {
    const repair = publicationRepairPrompt("설계를 검토하세요.", ["plain_audience_language"]);

    expect(repair).toContain("내부 용어를 그대로 복사하지 마세요");
    expect(repair).toContain("코드나 문서 경로");
    expect(repair).toContain("앞선 경로 제시 지침보다 이 보완 지침이 우선합니다");
    expect(repair).toContain("실행 근거의 정확한 연결은 Lervo가 별도로 보존합니다");
    expect(repair).toContain("단계 번호, 버전 표기는");
    expect(repair).toContain("단순 번역이나 띄어쓰기 변경은 설명이 아닙니다");
    expect(repair).toContain("450어절 이내");
    expect(repair).toContain("일부 용어만 설명한 별도 용어 목록으로 대신하지 마세요");
    expect(repair).toContain("설명할 수 없는 표현은 삭제하세요");
  });
});
