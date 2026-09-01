import { canonicalJson } from "@lervo/event-contract";
import type { EventWriterCoordinate } from "@lervo/schemas";

import { readEventWriterCoordinate } from "./event-writer-coordinate-contract.js";
import {
  createEventWriterActivationId,
  eventWriterSha256,
  readEventWriterActivationEvidence,
} from "./event-writer-evidence.js";
import { failEventWriterActivation } from "./event-writer-errors.js";

export interface EventWriterActivationPlan {
  schemaVersion: 1;
  planKind: "event_writer_selection";
  planId: string;
  repositoryRoot: string;
  projectId: string;
  status: "ready" | "current" | "blocked";
  blockers: Array<{ code: string; message: string }>;
  currentCoordinate: EventWriterCoordinate;
  currentContentHash: string | null;
  desiredCoordinate: EventWriterCoordinate;
  desiredContent: string;
  desiredContentHash: string;
  evidenceHash: string | null;
  operation: {
    path: ".lervo/data/event-contract.json";
    action: "create" | "update" | "unchanged";
    expectedCurrentHash: string | null;
    desiredHash: string;
  };
}

export function createEventWriterActivationPlan(input: {
  repositoryRoot: string;
  projectId: string;
  hubSyncEnabled: boolean;
  currentCoordinate: EventWriterCoordinate;
  currentContentHash: string | null;
  evidence: unknown;
}): EventWriterActivationPlan {
  const evidence = readEventWriterActivationEvidence(input.evidence);
  if (evidence.projectId !== input.projectId) {
    failEventWriterActivation(
      "event_writer_evidence_invalid",
      "Activation evidence belongs to another project.",
    );
  }
  const evidenceHash = eventWriterSha256(canonicalJson(evidence));
  if (input.currentCoordinate.selectedEventSchemaVersion === 2) {
    const desiredContent = `${JSON.stringify(input.currentCoordinate, null, 2)}\n`;
    const desiredContentHash = eventWriterSha256(desiredContent);
    return {
      schemaVersion: 1,
      planKind: "event_writer_selection",
      planId: `evplan_${desiredContentHash.slice(7, 31)}`,
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      status: "current",
      blockers: [],
      currentCoordinate: structuredClone(input.currentCoordinate),
      currentContentHash: input.currentContentHash,
      desiredCoordinate: structuredClone(input.currentCoordinate),
      desiredContent,
      desiredContentHash,
      evidenceHash,
      operation: {
        path: ".lervo/data/event-contract.json",
        action: "unchanged",
        expectedCurrentHash: input.currentContentHash,
        desiredHash: desiredContentHash,
      },
    };
  }

  const blockers = input.hubSyncEnabled
    ? [
        {
          code: "reader_inventory_authority_unavailable",
          message:
            "Hub synchronization is enabled, but the local CLI cannot prove the complete configured Node and Hub reader inventory.",
        },
      ]
    : evidence.readers.some((reader) => reader.readerKind !== "local")
      ? [
          {
            code: "unexpected_remote_reader",
            message: "A local-only repository cannot activate from remote reader evidence.",
          },
        ]
      : [];
  const configurationHash = eventWriterSha256(
    canonicalJson({
      projectId: input.projectId,
      hubSyncEnabled: input.hubSyncEnabled,
      readers: evidence.readers.map(({ readerId, readerKind, peerIdentityHash }) => ({
        readerId,
        readerKind,
        peerIdentityHash,
      })),
    }),
  );
  const desiredCoordinate = readEventWriterCoordinate({
    schemaVersion: 1,
    projectId: input.projectId,
    selectedEventSchemaVersion: 2,
    activationEvidence: {
      activationId: createEventWriterActivationId({
        projectId: input.projectId,
        observedAt: evidence.observedAt,
        configurationHash,
        readers: evidence.readers,
      }),
      observedAt: evidence.observedAt,
      configurationHash,
      readers: evidence.readers,
    },
  });
  const desiredContent = `${JSON.stringify(desiredCoordinate, null, 2)}\n`;
  const desiredContentHash = eventWriterSha256(desiredContent);
  const planHash = eventWriterSha256(
    canonicalJson({
      projectId: input.projectId,
      currentContentHash: input.currentContentHash,
      desiredContentHash,
      evidenceHash,
    }),
  );
  return {
    schemaVersion: 1,
    planKind: "event_writer_selection",
    planId: `evplan_${planHash.slice(7, 31)}`,
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    currentCoordinate: structuredClone(input.currentCoordinate),
    currentContentHash: input.currentContentHash,
    desiredCoordinate,
    desiredContent,
    desiredContentHash,
    evidenceHash,
    operation: {
      path: ".lervo/data/event-contract.json",
      action: input.currentContentHash === null ? "create" : "update",
      expectedCurrentHash: input.currentContentHash,
      desiredHash: desiredContentHash,
    },
  };
}

export function createEventWriterRollbackPlan(input: {
  repositoryRoot: string;
  projectId: string;
  currentCoordinate: EventWriterCoordinate;
  currentContentHash: string | null;
}): EventWriterActivationPlan {
  const desiredCoordinate: EventWriterCoordinate = {
    schemaVersion: 1,
    projectId: input.projectId,
    selectedEventSchemaVersion: 1,
    activationEvidence: null,
  };
  const desiredContent = `${JSON.stringify(desiredCoordinate, null, 2)}\n`;
  const desiredContentHash = eventWriterSha256(desiredContent);
  const current = input.currentCoordinate.selectedEventSchemaVersion === 1;
  const planHash = eventWriterSha256(
    canonicalJson({
      action: "rollback",
      projectId: input.projectId,
      currentContentHash: input.currentContentHash,
      desiredContentHash,
    }),
  );
  return {
    schemaVersion: 1,
    planKind: "event_writer_selection",
    planId: `evplan_${planHash.slice(7, 31)}`,
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    status: current ? "current" : "ready",
    blockers: [],
    currentCoordinate: structuredClone(input.currentCoordinate),
    currentContentHash: input.currentContentHash,
    desiredCoordinate,
    desiredContent,
    desiredContentHash,
    evidenceHash: null,
    operation: {
      path: ".lervo/data/event-contract.json",
      action: current ? "unchanged" : input.currentContentHash === null ? "create" : "update",
      expectedCurrentHash: input.currentContentHash,
      desiredHash: desiredContentHash,
    },
  };
}
