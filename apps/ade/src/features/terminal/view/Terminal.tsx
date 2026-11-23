import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { FormattedMessage } from "react-intl";

import { terminalFont, terminalThemes } from "../../../design/generated/terminal-theme";
import { useSessionHost } from "../../../ports";
import { InlineAlert } from "../../../ui/InlineAlert";
import { TerminalController } from "../model/controller";
import { FrameBoundWriter } from "../model/frames";
import styles from "./Terminal.module.css";

const dark = window.matchMedia("(prefers-color-scheme: dark)");

/** No background of its own: the surface token behind the terminal draws it on the glass. */
const SEE_THROUGH = "rgba(0, 0, 0, 0)";

/** The terminal palette of the current mode, over a transparent background. */
function themed() {
  return {
    ...(dark.matches ? terminalThemes.dark : terminalThemes.light),
    background: SEE_THROUGH,
  };
}

/** The CLI conversation: the provider's own terminal interface, in the terminal theme. */
export function Terminal(props: { workspaceId: string }) {
  const host = useSessionHost();
  const container = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const terminal = new XTerm({
      ...terminalFont,
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
    const controller = new TerminalController(host, props.workspaceId, {
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
  }, [host, props.workspaceId]);

  return (
    <div className={styles.frame}>
      {failure === null ? null : (
        <InlineAlert size="meta" className={styles.failure}>
          <FormattedMessage id="terminal.failed" values={{ code: failure }} />
        </InlineAlert>
      )}
      <div ref={container} className={styles.terminal} />
    </div>
  );
}
