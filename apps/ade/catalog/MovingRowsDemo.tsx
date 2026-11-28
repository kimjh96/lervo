// The demo of a row that changes its place (ADE motion, "Moving a row"): pinning a row leaves its
// place and arrives at the top with its space, so the rows between slide and none jumps.
import { type ReactNode, useMemo, useState } from "react";

import { useDepartingInPlace } from "../src/ui/departing";
import { ListRow } from "../src/ui/ListRow";
import { useMoved } from "../src/ui/moving";
import { useItemSpace } from "../src/ui/space";
import styles from "./Catalog.module.css";

interface DemoRow {
  readonly id: string;
  readonly title: string;
  readonly pinned: boolean;
}

const ROWS: readonly Omit<DemoRow, "pinned">[] = [
  { id: "a", title: "Fix the flaky test" },
  { id: "b", title: "Review the release" },
  { id: "c", title: "Tidy the docs" },
  { id: "d", title: "Plan the next sprint" },
];

const placeKey = (row: DemoRow) => `${row.pinned ? "pinned" : "listed"}:${row.id}`;
const idOf = (row: DemoRow) => row.id;

function Place(props: { arrived: boolean; leaving: boolean; children: ReactNode }) {
  const space = useItemSpace<HTMLDivElement>(props.arrived, props.leaving);
  return (
    <div
      ref={space}
      className={styles.movingRow}
      data-arrived={props.arrived ? "true" : undefined}
      data-leaving={props.leaving ? "" : undefined}
      aria-hidden={props.leaving ? true : undefined}
      inert={props.leaving}
    >
      {props.children}
    </div>
  );
}

/** Four rows; pressing one pins it to the top or returns it to its place. */
export function MovingRowsDemo() {
  const [pinned, setPinned] = useState<readonly string[]>([]);
  const rows = useMemo(() => {
    const all = ROWS.map((row) => ({ ...row, pinned: pinned.includes(row.id) }));
    const order = (row: DemoRow) => pinned.indexOf(row.id);
    return [
      ...all.filter((row) => row.pinned).sort((left, right) => order(right) - order(left)),
      ...all.filter((row) => !row.pinned),
    ];
  }, [pinned]);
  const shown = useDepartingInPlace(rows, placeKey);
  const moved = useMoved(rows, placeKey, idOf);
  const toggle = (id: string) =>
    setPinned((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  return (
    <div style={{ width: "var(--layout-sidebar-width)" }}>
      {shown.map(({ item, leaving }) => (
        <Place key={placeKey(item)} arrived={moved.has(placeKey(item))} leaving={leaving}>
          <ListRow
            current={false}
            label={item.pinned ? `${item.title} (pinned)` : item.title}
            onClick={() => toggle(item.id)}
          />
        </Place>
      ))}
    </div>
  );
}
