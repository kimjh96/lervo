const SVG_NS = "http://www.w3.org/2000/svg";

const nodeLabels = {
  artifact: "산출물",
  deliberation: "숙의",
  deliberation_artifact: "숙의 산출물",
  deliberation_outcome: "숙의 결과",
  document: "문서",
  event: "근거 이벤트",
  handoff: "인계",
  knowledge: "검증된 지식",
  knowledge_candidate: "지식 후보",
  knowledge_review: "지식 검토",
  knowledge_staleness: "노후화 판정",
  project: "프로젝트",
  repository_path: "저장소 경로",
  role: "역할",
  run: "실행",
  shared_context: "공유 맥락",
  verification: "검증",
};

const relationLabels = {
  affects_path: "영향 경로",
  approved_by: "승인 근거",
  changed_path: "변경 경로",
  cites_event: "근거 이벤트",
  completed_verification: "검증 완료",
  completed_with: "종료 결과",
  contains_run: "포함한 실행",
  covers_path: "검증 범위",
  created_candidate: "생성한 후보",
  created_handoff: "생성한 인계",
  decision_artifact: "결정 산출물",
  derived_from: "도출 근거",
  detected_stale: "노후화 감지",
  detected_stale_document: "노후 문서 감지",
  from_role: "보낸 역할",
  includes_context: "포함한 맥락",
  injected_document: "주입한 문서",
  loaded_document: "적재한 문서",
  missing_path: "누락 경로",
  participant_role: "참여 역할",
  produced_artifact: "생성 산출물",
  produced_by: "생산 역할",
  promoted_from: "승격 원본",
  published_context: "발행한 맥락",
  recorded_artifact: "기록 산출물",
  references_document: "참조 문서",
  resolved_conflict: "해소한 충돌",
  reviewed_by: "검토 근거",
  selected_document: "선택한 문서",
  stale_result: "노후화 결과",
  started_deliberation: "시작한 숙의",
  stored_as: "저장 산출물",
  to_role: "받는 역할",
  verification_artifact: "검증 산출물",
  verified_knowledge: "검증한 지식",
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
  const group = svgElement("g", { class: focus ? "graph-node focus" : "graph-node", transform: `translate(${x} ${y})` });
  if (!focus) {
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${nodeTitle(node)} 관계 보기`);
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
  const kind = svgElement("text", { x: 0, y: -4, class: "graph-node-kind", "text-anchor": "middle" });
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
    empty.textContent = "이 항목에 연결된 명시적 관계가 없습니다.";
    element.append(empty);
    return;
  }

  const height = Math.max(180, relations.length * 68 + 40);
  const svg = svgElement("svg", {
    class: "knowledge-graph",
    viewBox: `0 0 960 ${height}`,
    role: "img",
    "aria-label": `${nodeTitle(focus)}의 명시적 관계 ${relations.length}개`,
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
