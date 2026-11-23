import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";

/** A control message from the shell: a host message, or the end of the connection. */
export type ShellMessage = HostMessage | { readonly kind: "host.disconnected" };

/** The shell's relay to the session host, behind an interface so tests need no Tauri. */
export interface HostTransport {
  /** Starts one connection. Messages arrive until `host.disconnected`. */
  connect(onControl: (message: ShellMessage) => void): Promise<void>;
  send(message: ClientMessage): Promise<void>;
}

/** The transport through the Tauri shell's commands and channels. */
export async function tauriTransport(): Promise<HostTransport> {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  return {
    async connect(onControl) {
      const control = new Channel<ShellMessage>();
      control.onmessage = onControl;
      await invoke("host_connect", { control });
    },
    send: (message) => invoke("host_send", { message }),
  };
}
