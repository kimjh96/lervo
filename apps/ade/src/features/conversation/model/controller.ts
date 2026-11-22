import type { ConversationItem, HostMessage } from "@lervo/session-host-contract";

import {
  ask,
  RequestFailure,
  requestId,
  type SessionHostClient,
} from "../../../platform/session-host";
import { DeltaBuffer } from "./deltas";
import { useConversationStore } from "./store";
import { applyAppended, applyDelta, applyPage, emptyWindow, PAGE_ITEMS } from "./window";

/** The workspace a conversation belongs to. */
export interface ConversationTarget {
  readonly workspaceId: string;
  readonly sessionId: string;
}

/**
 * Shows one workspace's native conversation. It attaches to the session, loads the newest page,
 * and applies live items and frame-bound deltas. When the session is not running, it opens it
 * through the core, which resumes the provider's session.
 */
export class ConversationController {
  private sessionId: string;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly deltas: DeltaBuffer;

  constructor(
    private readonly client: SessionHostClient,
    private readonly target: ConversationTarget,
    nextFrame: (run: () => void) => void = (run) => requestAnimationFrame(run),
  ) {
    this.sessionId = target.sessionId;
    this.deltas = new DeltaBuffer((deltas) => {
      let window = useConversationStore.getState().window;
      for (const [itemId, text] of deltas) window = applyDelta(window, itemId, text);
      useConversationStore.setState({ window });
    }, nextFrame);
  }

  async open(): Promise<void> {
    useConversationStore.setState({
      sessionId: null,
      window: emptyWindow,
      arrived: new Set(),
      error: null,
    });
    this.unsubscribe.push(this.client.onMessage((message) => this.receive(message)));
    this.unsubscribe.push(
      this.client.onState((state) => {
        if (state === "connected") void this.load();
      }),
    );
    await this.load();
  }

  close(): void {
    for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe();
    void this.client
      .send({ kind: "session.detach", sessionId: this.sessionId })
      .catch(() => undefined);
  }

  async send(text: string): Promise<void> {
    await ask(this.client, {
      kind: "session.send",
      requestId: requestId(),
      sessionId: this.sessionId,
      text,
    }).catch((failure: unknown) => {
      if (!(failure instanceof RequestFailure && failure.code === "request_timeout")) throw failure;
    });
  }

  async loadEarlier(): Promise<void> {
    const state = useConversationStore.getState();
    const first = state.window.items[0];
    if (!state.window.hasEarlier || state.loadingEarlier || first === undefined) return;
    useConversationStore.setState({ loadingEarlier: true });
    try {
      const page = await this.range("before", first.itemId);
      useConversationStore.setState({
        window: applyPage(useConversationStore.getState().window, page, "before"),
      });
    } finally {
      useConversationStore.setState({ loadingEarlier: false });
    }
  }

  /** Attaches and loads the newest page, opening the session first when it does not run. */
  private async load(): Promise<void> {
    try {
      await this.attachAndLoad();
    } catch (failure) {
      if (!(failure instanceof RequestFailure) || failure.code !== "session_not_found") {
        useConversationStore.setState({
          error: failure instanceof RequestFailure ? failure.code : "session_open_failed",
        });
        return;
      }
      try {
        const opened = await ask(this.client, {
          kind: "session.open",
          requestId: requestId(),
          workspaceId: this.target.workspaceId,
        });
        if (opened.kind === "session.opened") this.sessionId = opened.sessionId;
        await this.attachAndLoad();
      } catch (reopening) {
        useConversationStore.setState({
          error: reopening instanceof RequestFailure ? reopening.code : "session_open_failed",
        });
      }
    }
  }

  private async attachAndLoad(): Promise<void> {
    await this.client.send({
      kind: "session.attach",
      requestId: requestId(),
      sessionId: this.sessionId,
      afterSequence: 0,
    });
    const page = await this.range("latest");
    useConversationStore.setState({
      sessionId: this.sessionId,
      window: applyPage(emptyWindow, page, "latest"),
      error: null,
    });
  }

  private async range(side: "latest" | "before", anchor?: string) {
    const answer = await ask(this.client, {
      kind: "conversation.range",
      requestId: requestId(),
      sessionId: this.sessionId,
      // The newest page and each earlier page both read toward the start.
      direction: "before",
      limit: PAGE_ITEMS,
      ...(anchor === undefined ? {} : { anchorItemId: anchor }),
    });
    if (answer.kind !== "conversation.page") throw new RequestFailure("range_invalid");
    return answer;
  }

  private receive(message: HostMessage): void {
    if (!("sessionId" in message) || message.sessionId !== this.sessionId) return;
    if (message.kind === "conversation.delta") {
      this.deltas.add(message.itemId, message.append);
      return;
    }
    if (message.kind !== "conversation.appended") return;
    this.deltas.release();
    const state = useConversationStore.getState();
    const known = new Set(state.window.items.map((item: ConversationItem) => item.itemId));
    const arrived = new Set(state.arrived);
    for (const item of message.items) if (!known.has(item.itemId)) arrived.add(item.itemId);
    useConversationStore.setState({ window: applyAppended(state.window, message.items), arrived });
  }
}
