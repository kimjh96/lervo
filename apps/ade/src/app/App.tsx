import styles from "./App.module.css";
import { LogoMark } from "./LogoMark";

/** The application root. S1.5 replaces this placeholder with the start screen and workspaces. */
export function App() {
  return (
    <main className={styles.root}>
      <LogoMark size={48} />
    </main>
  );
}
