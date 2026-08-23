import {
  EnvironmentAdapterRegistry,
  queryEnvironmentSource,
  type EnvironmentObservation,
  type EnvironmentSourceManifest,
} from "@lervo/environment";
import { TailscaleEnvironmentAdapter } from "@lervo/environment-adapter-tailscale";

export async function executeEnvironmentQuery(input: {
  source: EnvironmentSourceManifest;
  observedAt?: Date;
}): Promise<EnvironmentObservation> {
  return queryEnvironmentSource({
    source: input.source,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    registry: new EnvironmentAdapterRegistry([new TailscaleEnvironmentAdapter()]),
  });
}
