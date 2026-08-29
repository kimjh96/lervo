const descriptors = [
  [
    1,
    "benchmarks/search/linked-evidence-managed-canary-v1.json",
    "sha256:697781710b1c2a16d44ac9d4c11affd79235bdb6af6f4378f5db1ac42a733b51",
    "linked-evidence-managed-canary-v1-prepared-20260829",
    "ADR-0278",
  ],
  [
    2,
    "benchmarks/search/linked-evidence-managed-canary-v2.json",
    "sha256:ebd64581198b9d7afcc8d3bb17c85a828cfd4099f6d15fa55561321c06eeedc3",
    "linked-evidence-managed-canary-v2-prepared-20260829",
    "ADR-0281",
  ],
  [
    3,
    "benchmarks/search/linked-evidence-managed-canary-v3.json",
    "sha256:dffb19dca3982782447cee986feb41a1874bf15f79cb0bb65d3e5a1be22d91d5",
    "linked-evidence-managed-canary-v3-native-session-20260829",
    "ADR-0282",
  ],
  [
    4,
    "benchmarks/search/linked-evidence-managed-canary-v4.json",
    "sha256:68c267e1a502e5e656d27eacf97f476f787501daf6b866d6cbc48a42eff5b095",
    "linked-evidence-managed-canary-v4-deterministic-20260829",
    "ADR-0283",
  ],
  [
    5,
    "benchmarks/search/linked-evidence-managed-canary-v5.json",
    "sha256:b138691902267a299b7e6a660cb2ca65fe3ebcf58e8e120fbbff43dc7e3749a5",
    "linked-evidence-managed-canary-v5-native-session-20260829",
    "ADR-0284",
  ],
  [
    6,
    "benchmarks/search/linked-evidence-managed-canary-v6.json",
    "sha256:6b36a75ef60a0aff60671e9b18fd0f348e0aad07c4a8d0798e049bdca1e2f557",
    "linked-evidence-managed-canary-v6-native-session-20260829",
    "ADR-0285",
  ],
  [
    7,
    "benchmarks/search/linked-evidence-managed-canary-v7.json",
    "sha256:6324d68f0f244f420032486bd55e39001a37f4648bb0e958e137c496b9261edc",
    "linked-evidence-managed-canary-v7-native-session-20260829",
    "ADR-0286",
  ],
  [
    8,
    "benchmarks/search/linked-evidence-managed-canary-v8.json",
    "sha256:85c731da11fec2c8d0e2dbcd3f15fda4e4620e3700ee42c39e617e1ad47a2e6d",
    "linked-evidence-managed-canary-v8-native-session-20260829",
    "ADR-0287",
  ],
  [
    9,
    "benchmarks/search/linked-evidence-managed-canary-v9.json",
    "sha256:79908bd93f50a6a8fcab2ce3c80c2b8fc5527175dd3b68bb76ffc208b6e9b943",
    "linked-evidence-managed-canary-v9-native-session-20260829",
    "ADR-0288",
  ],
  [
    10,
    "benchmarks/search/linked-evidence-managed-canary-v10.json",
    "sha256:ab20d2628647415f43e22eb33fe7ad440765e08c901c1826e50b546da231b38e",
    "linked-evidence-managed-canary-v10-native-session-20260829",
    "ADR-0289",
  ],
  [
    11,
    "benchmarks/search/linked-evidence-managed-canary-v11.json",
    "sha256:533e4b40852668e57c6dd5293b83cc0a36f77b366299b0e42e60380e99c09995",
    "linked-evidence-managed-canary-v11-native-session-20260829",
    "ADR-0290",
  ],
  [
    12,
    "benchmarks/search/linked-evidence-managed-canary-v12.json",
    "sha256:a9e2dd5815a9610f8e85da1cb1abc2b38771ccede186ac855507116fc275a67a",
    "linked-evidence-managed-canary-v12-native-session-20260829",
    "ADR-0291",
  ],
  [
    13,
    "benchmarks/search/linked-evidence-managed-canary-v13.json",
    "sha256:123bf12f49794c45e4e8d14235b2497ea55a94a4a968bbc7f842c91ce8798fd3",
    "linked-evidence-managed-canary-v13-typed-context-20260829",
    "ADR-0294",
  ],
  [
    14,
    "benchmarks/search/linked-evidence-managed-canary-v14.json",
    "sha256:0c6880b1c52447dbd81f9c25346fcab50eb6dfed20f0f2cd6088336d62a55c1e",
    "linked-evidence-managed-canary-v14-typed-execution-20260829",
    "ADR-0295",
  ],
  [
    15,
    "benchmarks/search/linked-evidence-managed-canary-v15.json",
    "sha256:8cc1ff1dec1f656d7a57f4ddc564a91cd8d1b583a9589e794a363043caa7bc79",
    "linked-evidence-managed-canary-v15-claim-eligibility-20260830",
    "ADR-0297",
  ],
  [
    16,
    "benchmarks/search/linked-evidence-managed-canary-v16.json",
    "sha256:28ce09d0213e5fc5e41174483a58dea22407b0665bb81f494f6221a38db164f2",
    "linked-evidence-managed-canary-v16-claim-eligibility-20260830",
    "ADR-0298",
  ],
  [
    17,
    "benchmarks/search/linked-evidence-managed-canary-v17.json",
    "sha256:8eeee14298091a043208c11a289a3def0afff0a63affa4397416ef3e2afc8604",
    "linked-evidence-managed-canary-v17-capacity-safe-20260830",
    "ADR-0299",
  ],
  [
    18,
    "benchmarks/search/linked-evidence-managed-canary-v18.json",
    "sha256:0a56ec6e2de6307ade4f64d794a148553fbaca9e23113c177cf1364413713244",
    "linked-evidence-managed-canary-v18-event-capacity-safe-20260830",
    "ADR-0300",
  ],
].map(([version, path, reviewedDigest, checkpointId, decisionId]) => ({
  version,
  path,
  reviewedDigest,
  checkpointId,
  decisionId,
}));

const descriptorsByPath = new Map(descriptors.map((descriptor) => [descriptor.path, descriptor]));

export function managedCanaryCheckpointDescriptor(requestedPath) {
  return descriptorsByPath.get(requestedPath) ?? descriptors[0];
}

export const managedCanaryCheckpointContractPath = descriptors[0].path;
export const reviewedManagedCanaryCheckpointContractDigest = descriptors[0].reviewedDigest;
export const managedCanaryV2CheckpointContractPath = descriptors[1].path;
export const reviewedManagedCanaryV2CheckpointContractDigest = descriptors[1].reviewedDigest;
export const managedCanaryV3CheckpointContractPath = descriptors[2].path;
export const reviewedManagedCanaryV3CheckpointContractDigest = descriptors[2].reviewedDigest;
export const managedCanaryV4CheckpointContractPath = descriptors[3].path;
export const reviewedManagedCanaryV4CheckpointContractDigest = descriptors[3].reviewedDigest;
export const managedCanaryV5CheckpointContractPath = descriptors[4].path;
export const reviewedManagedCanaryV5CheckpointContractDigest = descriptors[4].reviewedDigest;
export const managedCanaryV6CheckpointContractPath = descriptors[5].path;
export const reviewedManagedCanaryV6CheckpointContractDigest = descriptors[5].reviewedDigest;
export const managedCanaryV7CheckpointContractPath = descriptors[6].path;
export const reviewedManagedCanaryV7CheckpointContractDigest = descriptors[6].reviewedDigest;
export const managedCanaryV8CheckpointContractPath = descriptors[7].path;
export const reviewedManagedCanaryV8CheckpointContractDigest = descriptors[7].reviewedDigest;
export const managedCanaryV9CheckpointContractPath = descriptors[8].path;
export const reviewedManagedCanaryV9CheckpointContractDigest = descriptors[8].reviewedDigest;
export const managedCanaryV10CheckpointContractPath = descriptors[9].path;
export const reviewedManagedCanaryV10CheckpointContractDigest = descriptors[9].reviewedDigest;
export const managedCanaryV11CheckpointContractPath = descriptors[10].path;
export const reviewedManagedCanaryV11CheckpointContractDigest = descriptors[10].reviewedDigest;
export const managedCanaryV12CheckpointContractPath = descriptors[11].path;
export const reviewedManagedCanaryV12CheckpointContractDigest = descriptors[11].reviewedDigest;
export const managedCanaryV13CheckpointContractPath = descriptors[12].path;
export const reviewedManagedCanaryV13CheckpointContractDigest = descriptors[12].reviewedDigest;
export const managedCanaryV14CheckpointContractPath = descriptors[13].path;
export const reviewedManagedCanaryV14CheckpointContractDigest = descriptors[13].reviewedDigest;
export const managedCanaryV15CheckpointContractPath = descriptors[14].path;
export const reviewedManagedCanaryV15CheckpointContractDigest = descriptors[14].reviewedDigest;
export const managedCanaryV16CheckpointContractPath = descriptors[15].path;
export const reviewedManagedCanaryV16CheckpointContractDigest = descriptors[15].reviewedDigest;
export const managedCanaryV17CheckpointContractPath = descriptors[16].path;
export const reviewedManagedCanaryV17CheckpointContractDigest = descriptors[16].reviewedDigest;
export const managedCanaryV18CheckpointContractPath = descriptors[17].path;
export const reviewedManagedCanaryV18CheckpointContractDigest = descriptors[17].reviewedDigest;
