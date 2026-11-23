/**
 * The interface's icons: a 24 px grid with 2 px round-capped strokes, drawn in the current text
 * color (visual language, "Icons"). Each is decorative; its control carries the accessible name.
 */

import type { ReactNode } from "react";

interface IconProps {
  readonly size?: 12 | 14 | 16;
}

function Icon(props: IconProps & { readonly children: ReactNode; strokeWidth?: number }) {
  const size = props.size ?? 14;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {props.children}
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props} strokeWidth={2.4}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </Icon>
  );
}
