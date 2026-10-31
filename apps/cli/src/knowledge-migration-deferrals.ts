import type { RepositoryLayoutMigrationPlan } from "@lervo/repository-knowledge";

import { documentRouteDeferralLines } from "./document-route-deferral-attention.js";
import type { CliIo } from "./types.js";

/** Later migration stages keep layout debt visible without turning a deferral into a gate. */
export function migrationDeferralOutput(
  io: CliIo,
  layout: RepositoryLayoutMigrationPlan | null,
  json: boolean,
): CliIo {
  if (layout === null || layout.deferredDocumentCount === 0) return io;
  return {
    ...io,
    stdout: (message) => {
      if (!json) {
        io.stdout(
          `Deferred documents: ${layout.deferredDocumentCount}\n${documentRouteDeferralLines(layout.deferredDocuments, "  ").join("\n")}\n${message}`,
        );
        return;
      }
      const value = JSON.parse(message) as Record<string, unknown>;
      io.stdout(
        `${JSON.stringify(
          {
            ...value,
            coverage: {
              ...(typeof value.coverage === "object" ? value.coverage : {}),
              complete: false,
            },
            deferredDocuments: layout.deferredDocuments,
            deferredDocumentCount: layout.deferredDocumentCount,
          },
          null,
          2,
        )}\n`,
      );
    },
  };
}
