const SVG_NS = "http://www.w3.org/2000/svg";

const nodeLabels = {
  artifact: "Artifact",
  deliberation: "Deliberation",
  deliberation_artifact: "Deliberation artifact",
  deliberation_outcome: "Deliberation outcome",
  document: "Document",
  event: "Evidence event",
  handoff: "Handoff",
  knowledge: "Verified knowledge",
  knowledge_candidate: "Knowledge candidate",
  knowledge_review: "Knowledge review",
  knowledge_staleness: "Staleness assessment",
  project: "Project",
  repository_path: "Repository path",
  role: "Role",
  run: "Run",
  shared_context: "Shared context",
  verification: "Verification",
};

const relationLabels = {
  affects_path: "Affects path",
  approved_by: "Approved by",
  changed_path: "Changed path",
  cites_event: "Cites event",
  completed_verification: "Completed verification",
  completed_with: "Completed with",
  contains_run: "Contains run",
  covers_path: "Covers path",
  created_candidate: "Created candidate",
  created_handoff: "Created handoff",
  decision_artifact: "Decision artifact",
  derived_from: "Derived from",
  detected_stale: "Detected stale knowledge",
  detected_stale_document: "Detected stale document",
  from_role: "From role",
  includes_context: "Includes context",
  injected_document: "Injected document",
  loaded_document: "Loaded document",
  missing_path: "Missing path",
  participant_role: "Participant role",
  produced_artifact: "Produced artifact",
  produced_by: "Produced by",
  promoted_from: "Promoted from",
  published_context: "Published context",
  recorded_artifact: "Recorded artifact",
  references_document: "References document",
  resolved_conflict: "Resolved conflict",
  reviewed_by: "Reviewed by",
  selected_document: "Selected document",
  stale_result: "Staleness result",
  started_deliberation: "Started deliberation",
  stored_as: "Stored as",
  to_role: "To role",
  verification_artifact: "Verification artifact",
  verified_knowledge: "Verified knowledge",
};

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function shortId(value) {
  return value.length <= 42 ? value : `${value.slice(0, 19)}…${value.slice(-19)}`;
}

function sameNode(left, right) {
  return left.kind === right.kind && left.id === right.id;
}

function nodeTitle(node) {
  return `${nodeLabels[node.kind] ?? node.kind}: ${node.id}`;
}

function drawNode(svg, node, x, y, focus, onSelect) {
  const group = svgElement("g", {
    class: focus ? "graph-node focus" : "graph-node",
    transform: `translate(${x} ${y})`,
  });
  if (!focus) {
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `View relationships for ${nodeTitle(node)}`);
    const activate = () => onSelect(node);
    group.addEventListener("click", activate);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  }
  const title = svgElement("title");
  title.textContent = nodeTitle(node);
  const box = svgElement("rect", { x: -145, y: -24, width: 290, height: 48, rx: 10 });
  const kind = svgElement("text", {
    x: 0,
    y: -4,
    class: "graph-node-kind",
    "text-anchor": "middle",
  });
  kind.textContent = nodeLabels[node.kind] ?? node.kind;
  const id = svgElement("text", { x: 0, y: 14, class: "graph-node-id", "text-anchor": "middle" });
  id.textContent = shortId(node.id);
  group.append(title, box, kind, id);
  svg.append(group);
}

export function renderKnowledgeGraph(element, focus, relations, onSelect) {
  element.replaceChildren();
  if (relations.length === 0) {
    const empty = document.createElement("p");
    empty.className = "graph-empty";
    empty.textContent = "This item has no explicit relationships.";
    element.append(empty);
    return;
  }

  const height = Math.max(180, relations.length * 68 + 40);
  const svg = svgElement("svg", {
    class: "knowledge-graph",
    viewBox: `0 0 960 ${height}`,
    role: "img",
    "aria-label": `${relations.length} explicit relationships for ${nodeTitle(focus)}`,
  });
  const definitions = svgElement("defs");
  const marker = svgElement("marker", {
    id: "graph-arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 6,
    markerHeight: 6,
    orient: "auto-start-reverse",
  });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "graph-arrow" }));
  definitions.append(marker);
  svg.append(definitions);
  const focusY = height / 2;
  relations.forEach((relation, index) => {
    const neighbor = sameNode(relation.from, focus) ? relation.to : relation.from;
    const neighborY = 54 + index * 68;
    const outward = sameNode(relation.from, focus);
    const line = svgElement("line", {
      x1: outward ? 335 : 625,
      y1: outward ? focusY : neighborY,
      x2: outward ? 625 : 335,
      y2: outward ? neighborY : focusY,
      class: "graph-edge",
      "marker-end": "url(#graph-arrow)",
    });
    const label = svgElement("text", {
      x: 480,
      y: (focusY + neighborY) / 2 - 7,
      class: "graph-edge-label",
      "text-anchor": "middle",
    });
    label.textContent = relationLabels[relation.type] ?? relation.type;
    svg.append(line, label);
    drawNode(svg, neighbor, 770, neighborY, false, onSelect);
  });
  drawNode(svg, focus, 190, focusY, true, onSelect);

  const list = document.createElement("ol");
  list.className = "graph-relation-list";
  for (const relation of relations) {
    const neighbor = sameNode(relation.from, focus) ? relation.to : relation.from;
    const direction = sameNode(relation.from, focus) ? "→" : "←";
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "graph-relation-button";
    button.textContent = `${direction} ${relationLabels[relation.type] ?? relation.type} · ${nodeTitle(neighbor)} · event #${relation.evidence.seq}`;
    button.addEventListener("click", () => onSelect(neighbor));
    item.append(button);
    list.append(item);
  }
  element.append(svg, list);
}
