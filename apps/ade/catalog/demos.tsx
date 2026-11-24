// The catalog's interactive demos: components shown with the state a person changes, such as a
// presence that comes and goes or a field that takes text (ADE design system, "Components").
import { useState } from "react";

import { Button } from "../src/ui/Button";
import { IconButton } from "../src/ui/IconButton";
import { ArrowUpIcon } from "../src/ui/icons";
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

export function CardDemo(props: { surface: "input" | "floating"; layout: "stacked" | "inline" }) {
  const [text, setText] = useState("");
  const stacked = props.layout === "stacked";
  return (
    <div style={{ width: "var(--layout-start-max-width)" }}>
      <InputCard surface={props.surface} layout={props.layout} onSubmit={() => setText("")}>
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
