// The foundations as the token file defines them: color roles, type roles, the space scale, and
// radii, rendered from the generated custom properties so they always match the interface.
import tokens from "../src/design/tokens.json";
import styles from "./Catalog.module.css";

type Group = Record<string, unknown>;

/** The leaf token paths under `group`, such as `color.text.primary`. */
function paths(group: Group, prefix: string): string[] {
  return Object.entries(group).flatMap(([key, value]) => {
    if (key.startsWith("$") || value === null || typeof value !== "object") return [];
    return "$value" in value ? [`${prefix}.${key}`] : paths(value as Group, `${prefix}.${key}`);
  });
}

const property = (path: string) =>
  `--${path
    .split(".")
    .map((part) => part.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`))
    .join("-")}`;

export function Colors() {
  return (
    <div className={styles.swatches}>
      {paths(tokens.color as Group, "color").map((path) => (
        <figure key={path} className={styles.swatch}>
          <span className={styles.chip} style={{ background: `var(${property(path)})` }} />
          <figcaption>{path}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export function Type() {
  return (
    <div className={styles.stack}>
      {Object.keys(tokens.type)
        .filter((role) => !role.startsWith("$"))
        .map((role) => (
          <p
            key={role}
            className={styles.typeSample}
            style={{
              fontFamily: role === "mono" ? "var(--font-family-mono)" : undefined,
              fontSize: `var(--type-${role}-size)`,
              fontWeight: `var(--type-${role}-weight)`,
              lineHeight: `var(--type-${role}-line-height)`,
            }}
          >
            <span className={styles.label}>type.{role}</span> Lervo keeps repository work durable
          </p>
        ))}
    </div>
  );
}

export function Space() {
  return (
    <div className={styles.stack}>
      {Object.keys(tokens.space)
        .filter((step) => !step.startsWith("$"))
        .map((step) => (
          <div key={step} className={styles.spaceRow}>
            <span className={styles.label}>space.{step}</span>
            <span className={styles.bar} style={{ width: `var(--space-${step})` }} />
          </div>
        ))}
    </div>
  );
}

export function Radii() {
  return (
    <div className={styles.swatches}>
      {Object.keys(tokens.radius)
        .filter((name) => !name.startsWith("$"))
        .map((name) => (
          <figure key={name} className={styles.swatch}>
            <span className={styles.chip} style={{ borderRadius: `var(--radius-${name})` }} />
            <figcaption>radius.{name}</figcaption>
          </figure>
        ))}
    </div>
  );
}
