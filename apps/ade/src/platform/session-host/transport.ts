import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";
import { Channel, invoke } from "@tauri-apps/api/core";

import { RequestFailure } from "../../ports/session-host";

/** What the shell reports after each handshake, before any host message. */
export interface HostIdentified {
  readonly kind: "host.identified";
  readonly hostVersion: string;
  readonly appVersion: string;
  readonly replaceable: boolean;
}

/**
 * A control message from the shell: a host message, the reached session host's identity, or the
 * end of the connection.
 */
export type ShellMessage = HostMessage | HostIdentified | { readonly kind: "host.disconnected" };

/** The shell's relay to the session host, behind an interface so tests need no Tauri. */
export interface HostTransport {
  /** Starts one connection. Messages arrive until `host.disconnected`. */
  connect(onControl: (message: ShellMessage) => void): Promise<void>;
  send(message: ClientMessage): Promise<void>;
  /** Ends the reached session host, or rejects with the shell's code. */
  replace(): Promise<void>;
}

/** The transport through the Tauri shell's commands and channels. */
export function tauriTransport(): HostTransport {
  return {
    async connect(onControl) {
      const control = new Channel<ShellMessage>();
      control.onmessage = onControl;
      await invoke("host_connect", { control });
    },
    send: (message) => invoke("host_send", { message }),
    replace: () =>
      invoke("host_replace").then(
        () => undefined,
        (code: unknown) => {
          throw new RequestFailure(typeof code === "string" ? code : "host_replace_failed");
        },
      ),
  };
}
