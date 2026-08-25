import type { DoctorIssueCode, DoctorRecoveryActionCode } from "./types.js";

type GuidanceMap = Partial<
  Record<
    DoctorIssueCode,
    {
      actionCode: DoctorRecoveryActionCode;
      message: string;
    }
  >
>;

export const environmentRecoveryGuidance = {
  document_registry_invalid: {
    actionCode: "inspect_document_registry",
    message: "Check the document registration format and per-document file layout.",
  },
  document_source_invalid: {
    actionCode: "inspect_document_source",
    message:
      "Check that each registered document source exists as a safe regular file in the repository.",
  },
  skill_package_invalid: {
    actionCode: "inspect_skill_package",
    message: "Check the skill configuration, content digest, and package path layout.",
  },
  skill_lock_missing: {
    actionCode: "refresh_skill_lock",
    message:
      "Check the current skill configuration, then confirm that the next Lervo-managed run records the resolution result.",
  },
  skill_lock_invalid: {
    actionCode: "refresh_skill_lock",
    message:
      "Check the skill package first, then resolve the skill configuration again in a new Lervo-managed run.",
  },
  skill_lock_stale: {
    actionCode: "refresh_skill_lock",
    message:
      "Review the changed skill configuration, then resolve it again in a new Lervo-managed run.",
  },
  provider_executable_missing: {
    actionCode: "check_provider_executable",
    message:
      "Check the installation status and executable-path configuration of the affected agent.",
  },
  provider_probe_failed: {
    actionCode: "check_provider_executable",
    message:
      "Check whether the affected agent executable responds successfully to a version probe.",
  },
  provider_platform_unsupported: {
    actionCode: "check_provider_platform",
    message: "Check whether the agent connection method supports the current operating system.",
  },
} satisfies GuidanceMap;
