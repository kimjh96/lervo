import { useState } from "react";

import styles from "./Catalog.module.css";
import { entries } from "./entries";
import { Colors, Radii, Space, Type } from "./foundations";

const foundations = [
  { id: "color", name: "Color roles", render: Colors },
  { id: "type", name: "Type roles", render: Type },
  { id: "space", name: "Space", render: Space },
  { id: "radius", name: "Radii", render: Radii },
] as const;

/** The design system catalog: foundations, then every component in every variant and state. */
export function Catalog() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };
  return (
    <div className={styles.catalog}>
      <nav className={styles.index}>
        <button type="button" className={styles.theme} onClick={toggle}>
          {theme === "light" ? "Dark mode" : "Light mode"}
        </button>
        <h2 className={styles.indexTitle}>Foundations</h2>
        {foundations.map((foundation) => (
          <a key={foundation.id} href={`#${foundation.id}`}>
            {foundation.name}
          </a>
        ))}
        <h2 className={styles.indexTitle}>Components</h2>
        {entries.map((entry) => (
          <a key={entry.module} href={`#${entry.module}`}>
            {entry.name}
          </a>
        ))}
      </nav>
      <main className={styles.content}>
        <h1 className={styles.title}>Lervo design system</h1>
        {foundations.map(({ id, name, render: Render }) => (
          <section key={id} id={id} className={styles.section}>
            <h2 className={styles.sectionTitle}>{name}</h2>
            <Render />
          </section>
        ))}
        {entries.map((entry) => (
          <section key={entry.module} id={entry.module} className={styles.section}>
            <h2 className={styles.sectionTitle}>{entry.name}</h2>
            <p className={styles.purpose}>{entry.purpose}</p>
            <div className={styles.usage}>
              <ul>
                {entry.use.map((line) => (
                  <li key={line}>Use for: {line}</li>
                ))}
              </ul>
              <ul>
                {entry.avoid.map((line) => (
                  <li key={line}>Not for: {line}</li>
                ))}
              </ul>
            </div>
            <div className={styles.variants}>
              {entry.variants.map((variant) => (
                <figure key={variant.name} className={styles.variant}>
                  <div className={styles.stage}>{variant.render()}</div>
                  <figcaption>{variant.name}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
