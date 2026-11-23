import styles from "./Kbd.module.css";

/** A keyboard shortcut's label, such as "⌘N", beside the action it triggers. */
export function Kbd(props: { children: string }) {
  return <kbd className={styles.kbd}>{props.children}</kbd>;
}
