/**
 * The interface's icons: a 24 px grid with 2 px round-capped strokes, drawn in the current text
 * color (visual language, "Icons"). Each is decorative; its control carries the accessible name.
 */

import type { ReactNode } from "react";

import { sizes } from "../design/generated/sizes";

interface IconProps {
  /** The icon size token for its context: `sm` beside caption text, `md` in rows, `lg` in buttons. */
  readonly size?: keyof typeof sizes.icon;
}

function Icon(props: IconProps & { readonly children: ReactNode; strokeWidth?: number }) {
  const size = sizes.icon[props.size ?? "md"];
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

/** A filled square: stopping what runs. */
export function StopIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </Icon>
  );
}

export function BranchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="7" r="2" />
      <path d="M6 7v10" />
      <path d="M18 9c0 5-6 4-11.2 8.4" />
    </Icon>
  );
}
