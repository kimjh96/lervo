const reviewedCases = [
  {
    caseId: "drv8case_implementation_release",
    expectedDocumentIds: ["doc_25f38925e70a785fd86947b5", "doc_2f28481c6d37161b234f0a4f"],
    sourceReceiptDigests: [
      "sha256:2ff5de1a06ce60785d4adef7ec334a86fa5ec55697e18bfc8d3e9fbe24f7d7dd",
      "sha256:42e18ad2010e348cdd3d86fc954cf7fa5313aa201051c049f242290cf189f6d1",
    ],
  },
  {
    caseId: "drv8case_terse_release",
    expectedDocumentIds: ["doc_25f38925e70a785fd86947b5", "doc_2f28481c6d37161b234f0a4f"],
    sourceReceiptDigests: [
      "sha256:e32f678e98d435418973c89ec2d9946d1fe34d0fe8394a5a6c49f69364a6f4d6",
      "sha256:f1139c903a7a7d3bc9060c6dc3efd8a78f0304f90e371efd566ab5006a2538c2",
    ],
  },
  {
    caseId: "drv8case_rationale_hybrid_search",
    expectedDocumentIds: ["doc_c5ab2b3f317701e29dec66e0"],
    sourceReceiptDigests: [
      "sha256:1913021ee2dd50ba44019a77b641b3faed1f9ebda98beb6598437d404b820358",
      "sha256:50e305ac3a9ecd90fdc5e60c613f9cd8c9ae565c70c3da490c6a961e95e7c818",
    ],
  },
  {
    caseId: "drv8case_boundary_fuzzy_merge",
    expectedDocumentIds: ["doc_f50e6220a318ba83a9f075ef", "doc_72ff491137fc89887edbe649"],
    sourceReceiptDigests: [
      "sha256:763e0ed3ff6ccf75a0049a7614680eec03b0492dd80ea489ce2d5af486cf2b65",
      "sha256:4a1f41faf053849ea92ed85101b34c4374aaf612cfb8a0c606532657b0febdb7",
    ],
  },
];

const providers = {
  codex: "gpt-5.6-sol",
  claude: "opus",
};

export const reviewedProviderShadowV18ScheduleFixture = reviewedCases.flatMap((sourceCase) =>
  sourceCase.sourceReceiptDigests.flatMap((sourceReceiptDigest, repetitionIndex) => {
    const repetition = repetitionIndex + 1;
    const providerOrder = repetition % 2 === 1 ? ["codex", "claude"] : ["claude", "codex"];
    return providerOrder.map((provider) => ({
      sourceSampleId: `psv18_${sourceCase.caseId}_r${repetition}`,
      caseId: sourceCase.caseId,
      repetition,
      provider,
      model: providers[provider],
      expectedDocumentIds: [...sourceCase.expectedDocumentIds],
      sourceReceiptDigest,
    }));
  }),
);
