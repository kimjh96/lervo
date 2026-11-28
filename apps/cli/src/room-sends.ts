// Work an agent sent to a conversation a teammate already leads, waiting for the sender's turn to
// end (ADR-0657): host-local, owner-only state beside the pending starts. Each holds the request
// until the core delivers it to the lead; then nothing holds it but the provider's transcript.
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import { readPrivateJsonFile, writePrivateJsonFile } from "@lervo/repository-knowledge-runtime";

import { hostedLaunchRecordsPath } from "./hosted-launch-records.js";

/** The sends kept at once; the oldest is dropped past it. */
export const PENDING_SEND_LIMIT = 16;
/** How long a send waits for its sender's turn to end before it is dropped. */
export const PENDING_SEND_MS = 60 * 60 * 1000;
/** How much work one agent may send in an hour: a backstop against a runaway loop, not a gate. */
export const AGENT_SENDS_PER_HOUR = 24;
const HOUR_MS = 60 * 60 * 1000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface PendingSend {
  readonly sendId: string;
  /** The conversation the work goes to, and its lead, who receives it. */
  readonly workspaceId: string;
  readonly agentId: string;
  /** The lead's session there, or null when it has none the core knows. */
  readonly sessionId: string | null;
  /** The conversation's title, as its line in the sender's conversation names it. */
  readonly title: string;
  readonly sentBy: string;
  readonly text: string;
  readonly preparedAt: string;
}

interface SendsFile {
  readonly sends: PendingSend[];
  /** When each agent sent, within the last hour, for the backstop. */
  readonly sent: { readonly agentId: string; readonly at: string }[];
}

/** Where pending sends live: beside the hosted launch records. */
export function pendingSendsPath(environment: NodeJS.ProcessEnv = process.env): string {
  return resolve(dirname(hostedLaunchRecordsPath(environment)), "room-sends.json");
}

function isSend(value: unknown): value is PendingSend {
  const send = value as Partial<PendingSend> | null;
  return (
    typeof send?.sendId === "string" &&
    typeof send.workspaceId === "string" &&
    typeof send.agentId === "string" &&
    (send.sessionId === null || typeof send.sessionId === "string") &&
    typeof send.title === "string" &&
    typeof send.sentBy === "string" &&
    typeof send.text === "string" &&
    typeof send.preparedAt === "string"
  );
}

const within = (at: string, now: Date, ms: number) => now.getTime() - Date.parse(at) < ms;

async function readSends(path: string, now: Date): Promise<SendsFile> {
  const file = await readPrivateJsonFile(path, MAX_FILE_BYTES);
  if (file.status !== "read") return { sends: [], sent: [] };
  const value = file.value as { sends?: unknown; sent?: unknown };
  const sends = (Array.isArray(value.sends) ? value.sends.filter(isSend) : []).filter((send) =>
    within(send.preparedAt, now, PENDING_SEND_MS),
  );
  const sent = (Array.isArray(value.sent) ? value.sent : []).filter(
    (entry): entry is SendsFile["sent"][number] =>
      typeof (entry as { agentId?: unknown }).agentId === "string" &&
      typeof (entry as { at?: unknown }).at === "string" &&
      within((entry as { at: string }).at, now, HOUR_MS),
  );
  return { sends, sent };
}

async function writeSends(path: string, file: SendsFile): Promise<void> {
  await writePrivateJsonFile(path, { schemaVersion: 1, ...file });
}

/**
 * Adds a send, keeping the newest {@link PENDING_SEND_LIMIT}. It refuses past
 * {@link AGENT_SENDS_PER_HOUR} sends of one agent in an hour by returning null.
 */
export async function recordPendingSend(
  path: string,
  send: Omit<PendingSend, "sendId" | "preparedAt">,
  now = new Date(),
): Promise<PendingSend | null> {
  const file = await readSends(path, now);
  if (file.sent.filter((entry) => entry.agentId === send.sentBy).length >= AGENT_SENDS_PER_HOUR)
    return null;
  const recorded: PendingSend = {
    ...send,
    sendId: `snd_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    preparedAt: now.toISOString(),
  };
  await writeSends(path, {
    sends: [...file.sends, recorded].slice(-PENDING_SEND_LIMIT),
    sent: [...file.sent, { agentId: send.sentBy, at: recorded.preparedAt }],
  });
  return recorded;
}

/** The sends `agentId` made that still wait, oldest first, for its turn's end to deliver. */
export async function pendingSendsOf(
  path: string,
  agentId: string,
  now = new Date(),
): Promise<PendingSend[]> {
  return (await readSends(path, now)).sends.filter((send) => send.sentBy === agentId);
}

/** Drops a send once the core delivered it. */
export async function dropPendingSend(
  path: string,
  sendId: string,
  now = new Date(),
): Promise<void> {
  const file = await readSends(path, now);
  const sends = file.sends.filter((send) => send.sendId !== sendId);
  if (sends.length !== file.sends.length) await writeSends(path, { ...file, sends });
}
