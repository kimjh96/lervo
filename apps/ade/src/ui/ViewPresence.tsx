import { Component, createRef, type ReactNode } from "react";

import { motion } from "../design/generated/motion";
import styles from "./ViewPresence.module.css";

/** A still copy of a view that left, and the scroll offsets it had, in tree order. */
interface Ghost {
  readonly id: number;
  readonly nodes: readonly Node[];
  readonly scrolls: readonly (readonly [number, number, number])[];
}

let nextGhost = 0;

function elementsOf(root: Element): Element[] {
  const elements: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node: Node | null = walker.currentNode; node !== null; node = walker.nextNode())
    elements.push(node as Element);
  return elements;
}

const CONTROLS = "select, input, textarea";

/**
 * Gives a copy the state its controls show, which a copy does not keep: it copies attributes, so a
 * select would show its first option, as an agent's model choice showed the first model while its
 * profile left (2026-11-28).
 */
function keepControls(original: Node, copy: Node): void {
  if (!(original instanceof Element) || !(copy instanceof Element)) return;
  const from = [
    ...(original.matches(CONTROLS) ? [original] : []),
    ...original.querySelectorAll(CONTROLS),
  ];
  const to = [...(copy.matches(CONTROLS) ? [copy] : []), ...copy.querySelectorAll(CONTROLS)];
  from.forEach((control, index) => {
    const target = to[index];
    if (control instanceof HTMLSelectElement && target instanceof HTMLSelectElement)
      target.selectedIndex = control.selectedIndex;
    else if (control instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement)
      target.value = control.value;
    else if (
      control instanceof HTMLInputElement &&
      target instanceof HTMLInputElement &&
      control.type !== "file"
    ) {
      target.value = control.value;
      target.checked = control.checked;
    }
  });
}

/** Copies how a view looks now, with its scroll offsets and controls, which a copy does not keep. */
function copyOf(layer: HTMLElement): Ghost {
  const scrolls: (readonly [number, number, number])[] = [];
  elementsOf(layer).forEach((element, index) => {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0)
      scrolls.push([index, element.scrollTop, element.scrollLeft]);
  });
  const nodes = [...layer.childNodes].map((node) => {
    const copy = node.cloneNode(true);
    keepControls(node, copy);
    return copy;
  });
  nextGhost += 1;
  return { id: nextGhost, nodes, scrolls };
}

/**
 * Puts a copy in its layer as it looked: the scroll offsets return, and the copy's own motion, such
 * as an arrival that would replay or a highlight that would sweep, stands at its end.
 */
function place(layer: HTMLElement | null, ghost: Ghost): void {
  if (layer === null || layer.childNodes.length > 0) return;
  layer.replaceChildren(...ghost.nodes);
  const elements = elementsOf(layer);
  for (const [index, top, left] of ghost.scrolls) {
    const element = elements[index];
    if (element === undefined) continue;
    element.scrollTop = top;
    element.scrollLeft = left;
  }
  for (const animation of layer.getAnimations({ subtree: true })) {
    if (animation.effect instanceof KeyframeEffect && animation.effect.target === layer) continue;
    const iterations = animation.effect?.getComputedTiming().iterations;
    if (iterations === Infinity) animation.pause();
    else animation.finish();
  }
}

interface Props {
  view: string;
  children: ReactNode;
}

interface State {
  readonly view: string;
  /** Whether the view has changed since the first, so views now arrive. */
  readonly changed: boolean;
  readonly ghosts: readonly Ghost[];
}

/**
 * The main area's views (ADE motion, "Changing views"). When `view` changes, the new view fades in
 * over `motion.duration.enter`, starting halfway through the old view's leaving, and the old view
 * fades out over `motion.duration.leave` as a still copy of how it last looked. The copy is inert
 * markup, not React: the old view unmounts at once, so its sessions close as before, and data it
 * loses, such as a removed workspace, never empties it while it fades. The first view shows with
 * the window, which arrives on its own.
 *
 * It is a class because only `getSnapshotBeforeUpdate` reads the old view's markup after React
 * decides the change and before React removes it.
 */
export class ViewPresence extends Component<Props, State> {
  override state: State = { view: this.props.view, changed: false, ghosts: [] };
  private readonly current = createRef<HTMLDivElement>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.view === state.view ? null : { view: props.view, changed: true };
  }

  override getSnapshotBeforeUpdate(previous: Props): Ghost | null {
    const layer = this.current.current;
    return previous.view === this.props.view || layer === null ? null : copyOf(layer);
  }

  override componentDidUpdate(_previous: Props, _state: State, ghost: Ghost | null): void {
    if (ghost === null) return;
    this.setState((state) => ({ ghosts: [...state.ghosts, ghost] }));
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.setState((state) => ({ ghosts: state.ghosts.filter((item) => item !== ghost) }));
    }, motion.leaveMs);
    this.timers.add(timer);
  }

  override componentWillUnmount(): void {
    for (const timer of this.timers) clearTimeout(timer);
  }

  override render(): ReactNode {
    const { changed, ghosts, view } = this.state;
    return (
      <div className={styles.views}>
        {ghosts.map((ghost) => (
          <div
            key={ghost.id}
            ref={(layer) => place(layer, ghost)}
            className={styles.view}
            data-leaving=""
            aria-hidden
            inert
          />
        ))}
        <div
          key={view}
          ref={this.current}
          className={styles.view}
          data-enter={changed ? "" : undefined}
          data-after={changed ? "" : undefined}
        >
          {this.props.children}
        </div>
      </div>
    );
  }
}
