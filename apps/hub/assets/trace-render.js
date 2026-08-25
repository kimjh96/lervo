import { eventLabel, fieldLabel } from "/assets/trace-labels.js";

function clear(element) {
  element.replaceChildren();
}

function text(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = String(value);
  if (className !== undefined) element.className = className;
  return element;
}

function formattedTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function displayValue(value) {
  if (value === null) return "None";
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "Value cannot be displayed";
    }
  }
  return String(value);
}

function itemButton(title, id, metrics, selected, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "item-button";
  button.setAttribute("aria-current", selected ? "true" : "false");
  button.append(text("span", title, "item-title"), text("span", id, "item-id"));
  const metricRow = document.createElement("span");
  metricRow.className = "metrics";
  for (const metric of metrics) metricRow.append(text("span", metric));
  button.append(metricRow);
  button.addEventListener("click", onSelect);
  return button;
}

export function renderProjects(element, projects, selectedProject, onSelect) {
  clear(element);
  for (const project of projects) {
    const selected =
      selectedProject !== null &&
      selectedProject.destinationId === project.destinationId &&
      selectedProject.projectId === project.projectId;
    const item = document.createElement("li");
    item.append(
      itemButton(
        project.projectName,
        project.projectId,
        [
          `${project.runCount} runs`,
          `${project.storedEventCount} events`,
          `${project.bufferedEventCount} buffered`,
        ],
        selected,
        () => onSelect(project),
      ),
    );
    element.append(item);
  }
}

export function renderRuns(element, runs, selectedRunId, onSelect) {
  clear(element);
  for (const run of runs) {
    const item = document.createElement("li");
    item.append(
      itemButton(
        formattedTime(run.firstOccurredAt),
        run.runId,
        [
          `${run.sessionCount} sessions`,
          `${run.eventCount} events`,
          `${run.bufferedEventCount} buffered`,
        ],
        selectedRunId === run.runId,
        () => onSelect(run),
      ),
    );
    element.append(item);
  }
}

export function renderEvents(element, events) {
  clear(element);
  for (const traceEvent of events) {
    const event = traceEvent.event;
    const item = document.createElement("li");
    item.className = `event-card${traceEvent.chainPosition === "buffered" ? " buffered" : ""}`;
    const heading = document.createElement("div");
    heading.className = "event-heading";
    const titleGroup = document.createElement("div");
    titleGroup.append(
      text("h3", eventLabel(event.type), "event-title"),
      text("p", `#${event.seq} · ${formattedTime(event.occurredAt)}`, "event-meta"),
    );
    const badgeText =
      traceEvent.chainPosition === "buffered" ? "Awaiting chain link" : "Continuous history";
    const badge = text(
      "span",
      badgeText,
      `badge${traceEvent.chainPosition === "buffered" ? " buffered" : ""}`,
    );
    heading.append(titleGroup, badge);
    item.append(heading);

    const fields = document.createElement("dl");
    fields.className = "event-fields";
    for (const [key, value] of Object.entries(event.payload ?? {})) {
      fields.append(text("dt", fieldLabel(key)));
      const description = text("dd", displayValue(value));
      if (/id|hash|digest|revision/i.test(key)) description.classList.add("mono");
      fields.append(description);
    }
    item.append(fields);
    element.append(item);
  }
}

export function setPaneState(element, message, error = false) {
  element.textContent = message;
  element.classList.toggle("error", error);
}

export function setPagination(prefix, navigation) {
  const previous = document.getElementById(`${prefix}-previous`);
  const next = document.getElementById(`${prefix}-next`);
  const label = document.getElementById(`${prefix}-page`);
  previous.disabled = navigation.loading || !navigation.hasPrevious;
  next.disabled = navigation.loading || !navigation.hasNext;
  label.textContent = `Page ${navigation.pageNumber}`;
}

export function clearTracePane(list, state, pageLabel, message) {
  clear(list);
  setPaneState(state, message);
  pageLabel.textContent = "";
}
