import type { ProviderSummary } from "@lervo/session-host-contract";
import { create } from "zustand";

/**
 * The core's hosted providers. `older` means a core from before the provider list, which starts
 * its default provider; `failed` keeps the start screen working without a choice.
 */
export type ProviderRegistry =
  | { readonly status: "unknown" }
  | { readonly status: "older" }
  | { readonly status: "failed"; readonly code: string }
  | {
      readonly status: "loaded";
      readonly providers: readonly ProviderSummary[];
      readonly defaultProvider: string;
    };

export const useProviderStore = create<{ readonly registry: ProviderRegistry }>(() => ({
  registry: { status: "unknown" },
}));
