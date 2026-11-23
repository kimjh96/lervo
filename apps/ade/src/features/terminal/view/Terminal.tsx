import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";

import { useSessionHostClient } from "../../../app/session-host-context";
import { terminalThemes } from "../../../design/generated/terminal-theme";
import { TerminalController } from "../model/controller";
import { FrameBoundWriter } from "../model/frames";
import styles from "./Terminal.module.css";

const dark = window.matchMedia("(prefers-color-scheme: dark)");

/** The terminal palette of the current mode, over a transparent background. */
function themed() {
  return {
    ...(dark.matches ? terminalThemes.dark : terminalThemes.light),
    background: "rgba(0, 0, 0, 0)",
  };
}

/** The CLI conversation: the provider's own terminal interface, in the terminal theme. */
export function Terminal(props: { workspaceId: string }) {
  const client = useSessionHostClient();
  const container = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const styles = getComputedStyle(document.documentElement);
    const terminal = new XTerm({
      fontFamily: styles.getPropertyValue("--font-family-mono"),
      fontSize: Number.parseFloat(styles.getPropertyValue("--type-mono-size")) || 13,
      lineHeight: Number.parseFloat(styles.getPropertyValue("--type-mono-line-height")) || 1.4,
      theme: themed(),
      // The terminal sits on the window glass (approved mockup "2b"), so its own background is
      // transparent and the surface token behind it draws the tint.
      allowTransparency: true,
      scrollback: 5000,
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // Without WebGL, xterm.js keeps its DOM renderer.
    }
    const output = new FrameBoundWriter(
      (bytes) => terminal.write(bytes),
      (run) => requestAnimationFrame(run),
    );
    const controller = new TerminalController(client, props.workspaceId, {
      write: (bytes) => {
        setFailure(null);
        output.add(bytes);
      },
      failed: setFailure,
    });
    const encoder = new TextEncoder();
    const input = terminal.onData((data) => controller.input(encoder.encode(data)));
    const size = terminal.onResize(({ cols, rows }) => controller.resize(cols, rows));
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    const theme = () => (terminal.options.theme = themed());
    dark.addEventListener("change", theme);
    fit.fit();
    void controller.open().then(() => controller.resize(terminal.cols, terminal.rows));
    terminal.focus();
    return () => {
      dark.removeEventListener("change", theme);
      observer.disconnect();
      input.dispose();
      size.dispose();
      controller.close();
      terminal.dispose();
    };
  }, [client, props.workspaceId]);

  return (
    <div className={styles.frame}>
      {failure === null ? null : (
        <p className={styles.failure} role="alert">
          <FormattedMessage id="terminal.failed" values={{ code: failure }} />
        </p>
      )}
      <div ref={container} className={styles.terminal} />
    </div>
  );
}
