import { expect, it } from "vitest";

import { ownerHostObservation } from "../src/continuity-owner-host-observation.js";

it("names a missing own Hub credential, never the refused probe of a borrowed token (ADR-0654)", () => {
  const host = {
    config: {
      coordination: {
        mode: "hub" as const,
        hub: {
          baseUrl: "https://hub.example/",
          bearerTokenFile: "/nodes/prj_this/secrets/hub-sync.token",
          destinationId: "hub:primary",
          hubIdentityHash: `sha256:${"a".repeat(64)}`,
        },
      },
    },
  };
  const observation = ownerHostObservation(
    {
      derivation: { status: "derived", mode: "hub", source: "host_repository" },
      hubFailure: { failureCode: "token_file_unreadable", httpStatus: null },
      credentialAbsent: true,
      publication: "unavailable",
    },
    host as Parameters<typeof ownerHostObservation>[1],
  );
  expect(observation.hubFailureCode).toBe("hub_credential_absent");
});
