import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";

import { createClaudeHostedSessionAdapter } from "@lervo/adapter-claude";
import { createCodexHostedSessionAdapter } from "@lervo/adapter-codex";
import {
  hasStreamDecoder,
  type HostedConversationMode,
  hostedConversationModes,
  type HostedSessionAdapter,
  type HostedSessionCapabilities,
  type HostedStreamDecoder,
  preferredConversationMode,
} from "@lervo/adapter-contract";

import { CommandFailure } from "./command-error-output.js";

interface HostedProvider {
  /** The executable name on `PATH`. */
  readonly executable: string;
  readonly create: (executable: string) => HostedSessionAdapter;
}

/**
 * The admitted hosted-session adapters by provider. A new provider adds one entry here and its
 * adapter package; callers read the adapter's capabilities, never the provider name.
 */
const hostedProviders: ReadonlyMap<string, HostedProvider> = new Map([
  ["claude", { executable: "claude", create: createClaudeHostedSessionAdapter }],
  ["codex", { executable: "codex", create: createCodexHostedSessionAdapter }],
]);

/** The provider a workspace starts with when the request names none. */
export const defaultHostedProvider = "claude";

export function hostedProviderNames(): string[] {
  return [...hostedProviders.keys()];
}

/** One admitted provider as `provider.list` reports it. */
export interface HostedProviderSummary {
  provider: string;
  displayName: string;
  capabilities: HostedSessionCapabilities;
  conversationModes: HostedConversationMode[];
  preferredMode: HostedConversationMode;
  /** Whether the provider's CLI is on `PATH`, where a launch looks for it. */
  installed: boolean;
  /** Whether someone is signed in to it: `null` when its adapter cannot tell or it is missing. */
  signedIn: boolean | null;
}

/** How long one sign-in answer stands, so lists and launches do not ask the CLI each time. */
const SIGN_IN_CACHE_MS = 60_000;
const signInAnswers = new Map<string, { value: boolean | null; at: number }>();

/** The adapter's sign-in state, kept for a minute per executable (Lervo ADE projects). */
async function signInState(
  executable: string,
  adapter: HostedSessionAdapter,
  environment: NodeJS.ProcessEnv,
): Promise<boolean | null> {
  if (adapter.signInState === undefined) return null;
  const cached = signInAnswers.get(executable);
  if (cached !== undefined && Date.now() - cached.at < SIGN_IN_CACHE_MS) return cached.value;
  const value = await adapter.signInState(environment);
  signInAnswers.set(executable, { value, at: Date.now() });
  return value;
}

/**
 * Every admitted hosted provider, in registry order, and the default one. Reading capabilities
 * needs no provider CLI; `installed` looks for each CLI on `PATH`, and `signedIn` asks its adapter.
 */
export async function listHostedProviders(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ providers: HostedProviderSummary[]; defaultProvider: string }> {
  const providers = await Promise.all(
    [...hostedProviders.entries()].map(async ([provider, entry]) => {
      const located = await findOnPath(entry.executable, environment);
      const adapter = entry.create(located ?? entry.executable);
      return {
        provider,
        displayName: adapter.displayName,
        capabilities: { ...adapter.capabilities },
        conversationModes: hostedConversationModes(adapter.capabilities),
        preferredMode: preferredConversationMode(adapter.capabilities),
        installed: located !== null,
        signedIn: located === null ? null : await signInState(located, adapter, environment),
      };
    }),
  );
  return { providers, defaultProvider: defaultHostedProvider };
}

/** The conversation modes `provider` offers, or null for a provider no adapter admits. */
export function hostedProviderModes(provider: string): HostedConversationMode[] | null {
  const entry = hostedProviders.get(provider);
  return entry === undefined
    ? null
    : hostedConversationModes(entry.create(entry.executable).capabilities);
}

/** The first executable file named `name` on `PATH`, or null. */
async function findOnPath(name: string, environment: NodeJS.ProcessEnv): Promise<string | null> {
  const path = environment.PATH ?? environment.Path ?? "";
  for (const directory of path.split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = resolve(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

/**
 * The adapter for `provider`, bound to the provider CLI's absolute path, so the session host
 * runs the same binary whatever its own `PATH` is.
 */
export async function resolveHostedSessionAdapter(
  provider: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<HostedSessionAdapter> {
  const entry = hostedProviders.get(provider);
  if (entry === undefined)
    throw new CommandFailure(
      "provider_unknown",
      `No hosted-session adapter exists for ${provider}.`,
      {
        providers: hostedProviderNames(),
      },
    );
  const executable = await findOnPath(entry.executable, environment);
  if (executable === null)
    throw new CommandFailure(
      "provider_cli_unavailable",
      `The ${entry.executable} CLI was not found on PATH.`,
      { provider },
    );
  const adapter = entry.create(executable);
  // An unknown sign-in state never blocks a launch; only a provider that says no one is signed
  // in does.
  if ((await signInState(executable, adapter, environment)) === false)
    throw new CommandFailure(
      "provider_login_unavailable",
      `No one is signed in to the ${entry.executable} CLI.`,
      { provider },
    );
  return adapter;
}

/**
 * A stream decoder for `provider`'s native conversation. Decoding needs no provider CLI, so this
 * does not look for one.
 */
export function createHostedStreamDecoder(provider: string): HostedStreamDecoder {
  const entry = hostedProviders.get(provider);
  if (entry === undefined)
    throw new CommandFailure(
      "provider_unknown",
      `No hosted-session adapter exists for ${provider}.`,
      {
        providers: hostedProviderNames(),
      },
    );
  const adapter = entry.create(entry.executable);
  if (!hasStreamDecoder(adapter))
    throw new CommandFailure(
      "conversation_mode_unsupported",
      `The ${provider} adapter offers only the CLI conversation.`,
    );
  return adapter.createStreamDecoder();
}
