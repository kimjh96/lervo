import {
  inspectRuntimeModuleArtifact,
  publishRuntimeModuleArtifact,
  readRuntimeModuleArtifact,
  type RuntimeModuleArtifact,
} from "@lervo/runtime-security";
import { failNodeFleetApply } from "./node-fleet-apply-contract.js";

export type NodeRuntimeModule = RuntimeModuleArtifact;
export const readNodeRuntimeModule = readRuntimeModuleArtifact;

export const inspectNodeRuntimeModule = inspectRuntimeModuleArtifact;

export async function materializeNodeRuntimeModule(directory: string, expected: NodeRuntimeModule) {
  try {
    await publishRuntimeModuleArtifact(directory, expected);
  } catch {
    failNodeFleetApply(
      "node_fleet_executable_invalid",
      "The installed repository runtime module differs from the expected content.",
    );
  }
}
