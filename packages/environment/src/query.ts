import { EnvironmentError } from "./errors.js";
import type {
  EnvironmentObservation,
  EnvironmentSourceAdapter,
  EnvironmentSourceManifest,
} from "./types.js";
import { validateEnvironmentObservation, validateEnvironmentSourceManifest } from "./validation.js";

export class EnvironmentAdapterRegistry {
  readonly #adapters = new Map<string, EnvironmentSourceAdapter>();

  constructor(adapters: EnvironmentSourceAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: EnvironmentSourceAdapter): void {
    if (this.#adapters.has(adapter.id)) throw new Error(`Environment adapter is duplicated: ${adapter.id}`);
    this.#adapters.set(adapter.id, adapter);
  }

  get(adapterId: string): EnvironmentSourceAdapter {
    const adapter = this.#adapters.get(adapterId);
    if (adapter === undefined) throw new EnvironmentError("environment_adapter_not_found", `Environment adapter was not found: ${adapterId}`);
    return adapter;
  }
}

export async function queryEnvironmentSource(input: {
  source: EnvironmentSourceManifest;
  registry: EnvironmentAdapterRegistry;
  observedAt?: Date;
  signal?: AbortSignal;
}): Promise<EnvironmentObservation> {
  const source = validateEnvironmentSourceManifest(input.source);
  const adapter = input.registry.get(source.adapterId);
  if (adapter.id !== source.adapterId) throw new EnvironmentError("environment_adapter_mismatch", "The environment adapter ID differs from the source declaration.");
  const observedAt = input.observedAt ?? new Date();
  const snapshot = await adapter.query({ source, ...(input.signal === undefined ? {} : { signal: input.signal }) });
  const allowed = new Set(source.capabilities);
  for (const subject of snapshot.subjects) {
    if (subject.capabilities.some((capability) => !allowed.has(capability))) {
      throw new EnvironmentError("invalid_environment_observation", "The adapter returned a capability not declared by the source.");
    }
  }
  const observation: EnvironmentObservation = {
    schemaVersion: 1,
    sourceId: source.sourceId,
    adapterId: source.adapterId,
    scope: source.scope,
    status: snapshot.status,
    observedAt: observedAt.toISOString(),
    validUntil: new Date(observedAt.getTime() + source.maximumValiditySeconds * 1000).toISOString(),
    subjects: snapshot.status === "available" ? snapshot.subjects : [],
    verification: snapshot.verification.map((item) => ({ ...item, checkedAt: observedAt.toISOString() })),
  };
  return validateEnvironmentObservation(observation);
}
