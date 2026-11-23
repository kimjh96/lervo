import { ChevronDownIcon } from "./icons";
import styles from "./Select.module.css";

/**
 * A compact chooser drawn as a chip: a native select, so the platform's menu, keyboard, and
 * screen-reader behavior come with it. Use it inside a card's action bar; a form field that
 * needs a visible label is a different component.
 */
export function Select(props: {
  label: string;
  value: string;
  options: readonly { value: string; text: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <span className={styles.chip}>
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.text}
          </option>
        ))}
      </select>
      <ChevronDownIcon size="sm" />
    </span>
  );
}
