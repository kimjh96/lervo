// The catalog's entries for the small windows that hold a short form over Lervo.
import type { Entry } from "./entries";
import { SheetDemo } from "./demos";

export const sheetEntries: readonly Entry[] = [
  {
    module: "Sheet",
    name: "Sheet",
    purpose: "A small glass window over Lervo with a heading, labeled fields, and its actions.",
    use: ["A short form the person fills in once, such as hiring an agent or a new project"],
    avoid: [
      "A choice a menu offers",
      "Anything the person reads while working, which belongs in a view",
    ],
    variants: [{ name: "Hire an Agent", render: () => <SheetDemo /> }],
  },
];
