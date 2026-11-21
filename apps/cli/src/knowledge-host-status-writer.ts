import { holdProcessPresence } from "@lervo/project-storage";
import {
  writeHostKnowledgeResidentStatus,
  type HostKnowledgeResidentStatus,
} from "@lervo/repository-knowledge-runtime";

/**
 * ADR-0602: the host resident's status, written only when it changes, with the process presence
 * that proves the host resident runs. The presence token is recorded only once its socket
 * listens; a presence that could not be held is reported, and readers keep the earlier rules.
 */
export function hostResidentStatusWriter(input: {
  path: string | null;
  startedAt: string;
  launch: HostKnowledgeResidentStatus["launch"];
  now: () => Date;
  onFailure: (error: unknown) => void;
}): {
  presenceToken: Promise<string | null>;
  write(status: Pick<HostKnowledgeResidentStatus, "role" | "repositories" | "scan">): Promise<void>;
  release(): void;
} {
  const presence = holdProcessPresence();
  const presenceToken = presence.ready.then(() => {
    const issue = presence.issue();
    if (issue === null) return presence.token;
    input.onFailure(Object.assign(new Error(issue), { code: "process_presence_unavailable" }));
    return null;
  });
  let written: string | null = null;
  return {
    presenceToken,
    write: async (status) => {
      if (input.path === null) return;
      const token = await presenceToken;
      const record = {
        schemaVersion: 1 as const,
        pid: process.pid,
        startedAt: input.startedAt,
        launch: input.launch,
        ...(token === null ? {} : { presence: token }),
        ...status,
      };
      const key = JSON.stringify(record);
      if (key === written) return;
      await writeHostKnowledgeResidentStatus(input.path, {
        ...record,
        heartbeatAt: input.now().toISOString(),
      }).then(
        () => {
          written = key;
        },
        (error: unknown) => input.onFailure(error),
      );
    },
    release: () => presence.release(),
  };
}
