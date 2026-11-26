// The catalog's interactive demos: components shown with the state a person changes, such as a
// presence that comes and goes or a field that takes text (ADE design system, "Components").
import { useState } from "react";

import { Button } from "../src/ui/Button";
import { IconButton } from "../src/ui/IconButton";
import { ArrowUpIcon } from "../src/ui/icons";
import { AttachmentTray } from "../src/ui/AttachmentTray";
import { FileChip } from "../src/ui/FileChip";
import { ImageViewer } from "../src/ui/ImageViewer";
import { InputCard, InputField } from "../src/ui/InputCard";
import { Presence } from "../src/ui/Presence";
import { SegmentedControl } from "../src/ui/SegmentedControl";
import { Select } from "../src/ui/Select";
import { ViewPresence } from "../src/ui/ViewPresence";

export function PresenceDemo() {
  const [shown, setShown] = useState(true);
  return (
    <span style={{ display: "inline-flex", gap: "var(--space-12)", alignItems: "center" }}>
      <Button variant="outlined" onClick={() => setShown(!shown)}>
        {shown ? "Hide" : "Show"}
      </Button>
      <Presence as="span">{shown ? "Restarted the session host" : null}</Presence>
    </span>
  );
}

export function ViewPresenceDemo() {
  const [view, setView] = useState<"start" | "workspace">("start");
  return (
    <div style={{ display: "grid", gap: "var(--space-12)", justifyItems: "start" }}>
      <Button variant="outlined" onClick={() => setView(view === "start" ? "workspace" : "start")}>
        Change the view
      </Button>
      <div style={{ display: "flex", width: "320px", height: "96px" }}>
        <ViewPresence view={view}>
          {view === "start" ? <p>What should Lervo do?</p> : <p>Fix the flaky test</p>}
        </ViewPresence>
      </div>
    </div>
  );
}

export function SegmentedDemo(props: { disabled?: boolean }) {
  const [value, setValue] = useState<"native" | "cli">("native");
  return (
    <SegmentedControl
      label="Show as"
      options={[
        { value: "native", text: "Conversation" },
        { value: "cli", text: "Terminal" },
      ]}
      value={value}
      onChange={setValue}
      disabled={props.disabled ?? false}
    />
  );
}

export function CardDemo(props: {
  surface: "input" | "floating";
  layout: "stacked" | "inline";
  dropHint?: string;
}) {
  const [text, setText] = useState("");
  const stacked = props.layout === "stacked";
  return (
    <div style={{ width: "var(--layout-start-max-width)" }}>
      <InputCard
        surface={props.surface}
        layout={props.layout}
        dropHint={props.dropHint}
        onSubmit={() => setText("")}
      >
        <InputField
          size={stacked ? "input" : "body"}
          rows={stacked ? 3 : 1}
          maxLines={stacked ? undefined : 8}
          label="Instruction"
          placeholder={
            stacked
              ? "Describe the work, as you would to a colleague"
              : "Reply or give a new instruction"
          }
          value={text}
          onChange={setText}
          onSubmit={() => setText("")}
        />
        <IconButton
          type="submit"
          label="Send"
          icon={<ArrowUpIcon size="lg" />}
          disabled={text.length === 0}
        />
      </InputCard>
    </div>
  );
}

export function SelectDemo() {
  const [value, setValue] = useState("claude");
  return (
    <Select
      label="Agent"
      value={value}
      options={[
        { value: "claude", text: "Claude Code" },
        { value: "codex", text: "Codex (not installed)", disabled: true },
      ]}
      onChange={setValue}
    />
  );
}

/** A small picture for the image demos, drawn inline so the catalog needs no asset. */
export function samplePicture(hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="hsl(${hue} 45% 32%)"/><rect x="24" y="24" width="180" height="14" rx="4" fill="hsl(${hue} 30% 70%)"/><rect x="24" y="52" width="250" height="10" rx="4" fill="hsl(${hue} 25% 55%)"/><rect x="24" y="72" width="210" height="10" rx="4" fill="hsl(${hue} 25% 55%)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function AttachmentTrayDemo() {
  const [images, setImages] = useState([
    {
      key: "a",
      src: samplePicture(220),
      alt: "Image 1, 1568 × 980",
      removeLabel: "Remove image 1",
    },
    {
      key: "c",
      src: samplePicture(20),
      alt: "Preparing image 2",
      removeLabel: "Remove image 2",
      preparing: true,
    },
  ]);
  const [files, setFiles] = useState([
    {
      key: "f",
      name: "report.pdf",
      detail: "Downloads · 1.2 MB",
      badge: "PDF",
      folder: false,
      label: "report.pdf, in Downloads",
      removeLabel: "Remove report.pdf",
    },
    {
      key: "g",
      name: "design-handoff",
      detail: "Documents · Folder",
      badge: "",
      folder: true,
      label: "design-handoff, in Documents",
      removeLabel: "Remove design-handoff",
    },
  ]);
  return (
    <div style={{ width: "var(--layout-start-max-width)" }}>
      <AttachmentTray
        images={images}
        files={files}
        onRemove={(key) => {
          setImages(images.filter((image) => image.key !== key));
          setFiles(files.filter((file) => file.key !== key));
        }}
        onOpenImage={() => undefined}
        onOpenFile={() => undefined}
      />
    </div>
  );
}

export function FileChipDemo(props: { size: "tray" | "message"; missing?: boolean }) {
  return (
    <FileChip
      size={props.size}
      name="signups-2026-11.csv"
      detail={props.missing ? "Moved or deleted" : "Desktop"}
      badge="CSV"
      missing={props.missing}
      label="signups-2026-11.csv, in Desktop"
      onOpen={() => undefined}
    />
  );
}

export function ImageViewerDemo() {
  const [index, setIndex] = useState<number | null>(null);
  const images = [
    { src: samplePicture(220), alt: "Image 1 of 2, 1568 × 980" },
    { src: samplePicture(150), alt: "Image 2 of 2, 1200 × 800" },
  ];
  return (
    <span>
      <Button variant="outlined" onClick={() => setIndex(0)}>
        Open two images
      </Button>
      {index === null ? null : (
        <ImageViewer
          images={images}
          index={index}
          labels={{
            dialog: "Image",
            close: "Close",
            previous: "Previous image",
            next: "Next image",
            count: `${index + 1} / ${images.length}`,
          }}
          onIndex={setIndex}
          onClose={() => setIndex(null)}
        />
      )}
    </span>
  );
}
