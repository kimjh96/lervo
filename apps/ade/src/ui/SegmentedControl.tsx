import styles from "./SegmentedControl.module.css";

/**
 * A choice between a few views of the same thing, such as a conversation and its terminal. The
 * pressed segment is the current one; each segment is a toggle button in a labeled group.
 */
export function SegmentedControl<Value extends string>(props: {
  label: string;
  options: readonly { value: Value; text: string }[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.group} role="group" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segment}
          aria-pressed={option.value === props.value}
          disabled={props.disabled}
          onClick={() => {
            if (option.value !== props.value) props.onChange(option.value);
          }}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}
