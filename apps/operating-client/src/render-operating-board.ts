import type { GovernedLoopActionV1 } from "@lervo/application-contract";

import type { OperatingBoardNodeV1, OperatingBoardViewV1 } from "./types.js";

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function tone(value: string): "good" | "warn" | "bad" | "neutral" {
  if (["ready", "complete", "completed", "passed", "verified", "valid", "active"].includes(value)) {
    return "good";
  }
  if (["waiting", "queued", "leased", "partial", "expired", "not_run"].includes(value)) {
    return "warn";
  }
  if (
    [
      "blocked",
      "failed",
      "invalid",
      "cancelled",
      "escalation_required",
      "unavailable",
      "missing",
    ].includes(value)
  ) {
    return "bad";
  }
  return "neutral";
}

function badge(value: string): string {
  return `<span class="badge ${tone(value)}">${escapeHtml(value)}</span>`;
}

function emptyOrList(items: string[], emptyMessage: string): string {
  if (items.length === 0) return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function actionLabel(action: GovernedLoopActionV1): string {
  return `${action.kind} · ${action.reasonCode}`;
}

function renderNode(
  node: OperatingBoardNodeV1,
  index: number,
  nodeIndexes: ReadonlyMap<string, number>,
): string {
  const dependencies = node.dependencyIds.map((dependencyId) => {
    const dependencyIndex = nodeIndexes.get(dependencyId);
    const label = escapeHtml(dependencyId);
    return dependencyIndex === undefined
      ? `<code>${label}</code> <span class="muted">not in projection</span>`
      : `<a href="#assignment-${dependencyIndex + 1}"><code>${label}</code></a>`;
  });
  const attempts = node.attempts.map(
    (attempt) =>
      `<code>${escapeHtml(attempt.runId)}</code> ${badge(attempt.terminalStatus)} ${badge(
        attempt.verificationStatus,
      )} <span class="muted">attempt ${attempt.attemptOrdinal} · ${escapeHtml(
        attempt.relationship,
      )}</span>`,
  );
  const approvals = node.approvals.map((approval) =>
    approval.status === "verified"
      ? `${badge(approval.status)} <code>${escapeHtml(approval.requirementDigest)}</code>`
      : `${badge(approval.status)} <code>${escapeHtml(approval.requirementDigest)}</code> <span class="muted">${escapeHtml(
          approval.reasonCode,
        )}</span>`,
  );
  const completions = node.completionEvidence.map(
    (evidence) =>
      `<code>${escapeHtml(evidence.completionEvidenceId)}</code> ${badge(
        "prepared",
      )} <span class="muted">run ${escapeHtml(evidence.runId)}</span>`,
  );
  const actions = node.actions.map((action) => escapeHtml(actionLabel(action)));
  const interactionRoutes = node.interactionRoutes.map(
    (route) =>
      `<code>${escapeHtml(route.handoffId)}</code> ${badge(route.routeState)} ${badge(
        route.deliveryState,
      )} <span class="muted">${escapeHtml(route.fromAgentId)} → ${escapeHtml(route.toAgentId)} · ${route.artifactReferences.length} artifacts</span>`,
  );
  const topology = [node.isRoot ? "root" : "", node.isJoin ? "join" : ""].filter(Boolean);

  return `<article class="assignment" id="assignment-${index + 1}">
    <header class="assignment-header">
      <div>
        <p class="eyebrow">${escapeHtml(node.taskType)} · ${escapeHtml(node.roleId)}</p>
        <h3><code>${escapeHtml(node.assignmentId)}</code></h3>
      </div>
      <div class="badges">${badge(node.status)}${topology.map(badge).join("")}</div>
    </header>
    <dl class="facts">
      <div><dt>Revision</dt><dd>${node.assignmentRevision}</dd></div>
      <div><dt>Priority</dt><dd>${node.priority}</dd></div>
      <div><dt>Lease</dt><dd>${badge(node.leaseState)}</dd></div>
      <div><dt>Attempts</dt><dd>${node.declaredAttemptCount}</dd></div>
    </dl>
    <p class="identity"><span>Agent</span> <code>${escapeHtml(node.assigneeAgentId ?? "unassigned")}</code><br><span>Lease ID</span> <code>${escapeHtml(node.leaseId ?? "none")}</code></p>
    <div class="evidence-grid">
      <section><h4>Dependencies</h4>${emptyOrList(dependencies, "No dependencies")}</section>
      <section><h4>Recommended actions</h4>${emptyOrList(actions, "No assignment action")}</section>
      <section><h4>Managed attempts</h4>${emptyOrList(attempts, "No managed attempt evidence")}</section>
      <section><h4>Approvals</h4>${emptyOrList(approvals, node.approvalRequirementDigests.length === 0 ? "No approval requirement" : "No approval observation")}</section>
      <section><h4>Prepared completion</h4>${emptyOrList(completions, "No prepared completion evidence")}</section>
      <section><h4>Interaction routes</h4>${emptyOrList(interactionRoutes, "No recorded assignment route")}</section>
    </div>
  </article>`;
}

function renderResources(view: OperatingBoardViewV1): string {
  const items = view.resources.map(
    (resource) => `<li>
      <div>${badge(resource.provider)} ${badge(resource.completeness)}</div>
      <strong>${escapeHtml(resource.totalTokens ?? "unavailable")} tokens</strong>
      <span>${escapeHtml(resource.scope)} · ${escapeHtml(resource.source)} · ${escapeHtml(resource.accountingMode)} · ${resource.runCount} runs</span>
      <code>${escapeHtml(resource.accountingDescriptorHash)}</code>
      ${resource.reasonCodes.length === 0 ? "" : `<small>${escapeHtml(resource.reasonCodes.join(", "))}</small>`}
    </li>`,
  );
  return emptyOrList(items, "Resource usage is unobserved in this report.");
}

function renderBudgets(view: OperatingBoardViewV1): string {
  const items = view.budgets.map(
    (budget) => `<li>
      <div>${badge(budget.provider)} ${badge(budget.thresholdState)} ${badge(budget.completeness)}</div>
      <strong>${escapeHtml(budget.observedTokens ?? "unknown")} / ${budget.limitTokens} tokens</strong>
      <span>${escapeHtml(budget.scope ?? "unscoped legacy")} · remaining observed: ${escapeHtml(budget.remainingObservedTokens ?? "unknown")}</span>
      <code>${escapeHtml(budget.accountingDescriptorHash)}</code>
    </li>`,
  );
  return emptyOrList(items, "No exact token admission limit is configured.");
}

function renderInbox(view: OperatingBoardViewV1): string {
  const items = view.inbox.map(
    (item) => `<li>
      <div>${badge(item.routeState)} ${badge(item.deliveryState)} ${badge(item.recipientAgentStatus)}</div>
      <strong><code>${escapeHtml(item.assignmentId)}</code></strong>
      <span>${escapeHtml(item.fromAgentId)} → ${escapeHtml(item.recipientAgentId)} · ${item.artifactCount} artifacts</span>
      <code>${escapeHtml(item.handoffId)}</code>
    </li>`,
  );
  return emptyOrList(items, "No recorded inbox route.");
}

function renderObjective(view: OperatingBoardViewV1): string {
  const objective = view.objective;
  if (objective === null) return "";
  const actions = objective.nextActions.map(escapeHtml);
  const blockers = objective.blockers.map(escapeHtml);
  return `<section class="side-panel objective-panel">
    <p class="eyebrow">Current objective · revision ${objective.workstreamRevision}</p>
    <h2>${escapeHtml(objective.title)}</h2>
    <p>${escapeHtml(objective.objective)}</p>
    <div class="evidence-grid"><section><h4>Declared next actions</h4>${emptyOrList(actions, "No declared next action")}</section><section><h4>Declared blockers</h4>${emptyOrList(blockers, "No declared blocker")}</section></div>
    <p class="muted">${objective.pendingDecisions.length} pending decisions · ${objective.pendingApprovals.length} pending approvals · updated ${escapeHtml(objective.updatedAt)}</p>
  </section>`;
}

const styles = `
:root{color-scheme:dark;--bg:#0b0d0f;--panel:#14181c;--panel2:#191f24;--line:#2a3239;--text:#f3f5f7;--muted:#9ba7b0;--accent:#a8ff60;--good:#79e2a0;--warn:#ffd166;--bad:#ff7b72;--neutral:#a9b4bd;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -10%,#203322 0,transparent 34rem),var(--bg);color:var(--text);line-height:1.5}a{color:var(--accent)}code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.88em;overflow-wrap:anywhere}main{width:min(1500px,calc(100% - 2rem));margin:auto;padding:3rem 0 5rem}.masthead{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2rem;align-items:end;border-bottom:1px solid var(--line);padding-bottom:2rem}.eyebrow{color:var(--accent);font-size:.75rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;margin:0 0 .45rem}h1{font-size:clamp(2.25rem,6vw,5.25rem);letter-spacing:-.06em;line-height:.95;margin:0;max-width:10ch}h2{font-size:1.55rem;margin:0 0 1rem}h3{font-size:1rem;margin:.15rem 0 0}h4{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 .55rem}.source{font-size:.78rem;color:var(--muted);text-align:right;max-width:34rem}.source code{color:var(--text)}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1.5rem 0}.metric{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1rem}.metric strong{display:block;font-size:1.85rem;letter-spacing:-.04em}.metric span{color:var(--muted);font-size:.78rem}.status-strip{display:flex;gap:.55rem;align-items:center;flex-wrap:wrap;margin:1rem 0}.objective-panel{margin:0 0 2.5rem}.badge{display:inline-block;padding:.15rem .5rem;border:1px solid currentColor;border-radius:999px;font-size:.68rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin:.1rem}.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.neutral{color:var(--neutral)}.layout{display:grid;grid-template-columns:minmax(0,2.35fr) minmax(18rem,1fr);gap:1.2rem}.assignments{display:grid;gap:1rem}.assignment,.side-panel{background:color-mix(in srgb,var(--panel) 94%,transparent);border:1px solid var(--line);border-radius:14px;padding:1.15rem}.assignment:target{outline:2px solid var(--accent);outline-offset:2px}.assignment-header{display:flex;justify-content:space-between;gap:1rem}.badges{text-align:right}.facts{display:grid;grid-template-columns:repeat(4,1fr);gap:.65rem;margin:1rem 0}.facts div{background:var(--panel2);border-radius:8px;padding:.6rem}.facts dt{font-size:.68rem;color:var(--muted);text-transform:uppercase}.facts dd{margin:.15rem 0 0;font-weight:700}.identity{font-size:.78rem;color:var(--muted);border-left:2px solid var(--line);padding-left:.75rem}.identity span{display:inline-block;width:4.5rem}.identity code{color:var(--text)}.evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.9rem;margin-top:1.2rem}.evidence-grid section{border-top:1px solid var(--line);padding-top:.75rem}.evidence-grid section:last-child{grid-column:1/-1}ul{margin:.35rem 0 0;padding-left:1.1rem}li{margin:.38rem 0}.empty,.muted{color:var(--muted);font-size:.76rem}.empty{margin:.25rem 0}.sidebar{display:grid;align-content:start;gap:1rem;position:sticky;top:1rem;height:max-content}.side-panel>ul{padding:0;list-style:none}.side-panel>ul>li{display:grid;gap:.35rem;padding:.75rem 0;border-top:1px solid var(--line)}.side-panel>ul>li:first-child{border-top:0}.side-panel span,.side-panel small{color:var(--muted);font-size:.76rem}.notice{border-color:#475235;background:#172016}.notice p{color:var(--muted);font-size:.8rem}.notice strong{color:var(--accent)}@media(max-width:1000px){.summary{grid-template-columns:repeat(3,1fr)}.layout{grid-template-columns:1fr}.sidebar{position:static}}@media(max-width:640px){main{width:min(100% - 1rem,1500px);padding-top:1.2rem}.masthead{grid-template-columns:1fr}.source{text-align:left}.summary{grid-template-columns:repeat(2,1fr)}.facts,.evidence-grid{grid-template-columns:1fr}.evidence-grid section:last-child{grid-column:auto}.assignment-header{display:block}.badges{text-align:left;margin-top:.7rem}}
`;

export function renderOperatingBoardHtml(view: OperatingBoardViewV1): string {
  const nodeIndexes = new Map(view.nodes.map((node, index) => [node.assignmentId, index]));
  const globalActions = view.actions.map((action) => {
    const assignment = action.assignmentId === null ? "workstream" : action.assignmentId;
    return `${badge(action.kind)} <code>${escapeHtml(assignment)}</code><span>${escapeHtml(
      action.reasonCode,
    )}</span>`;
  });
  const limitations = view.limitations.map((limitation) => escapeHtml(limitation));
  const graphReasons = view.state.graphReasonCodes.map((reason) => escapeHtml(reason));
  const summary = view.summary;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <title>Lervo operating board · ${escapeHtml(view.source.workstreamId)}</title>
  <style>${styles}</style>
</head>
<body>
<main>
  <header class="masthead">
    <div><p class="eyebrow">Local governed work</p><h1>Operating board</h1></div>
    <div class="source"><div>Observed ${escapeHtml(view.source.observedAt)}</div><div>Workstream <code>${escapeHtml(view.source.workstreamId)}</code></div><div>Graph <code>${escapeHtml(view.source.graphId)}</code></div></div>
  </header>
  <section class="summary" aria-label="Work summary">
    <div class="metric"><strong>${summary.assignmentCount}</strong><span>assignments</span></div>
    <div class="metric"><strong>${summary.attemptCount}</strong><span>managed attempts</span></div>
    <div class="metric"><strong>${summary.preparedCompletionCount}</strong><span>prepared completions</span></div>
    <div class="metric"><strong>${summary.verifiedApprovalCount}</strong><span>verified approvals</span></div>
    <div class="metric"><strong>${summary.attentionApprovalCount}</strong><span>approval issues</span></div>
    <div class="metric"><strong>${summary.resourceGroupCount}</strong><span>resource groups</span></div>
    <div class="metric"><strong>${summary.interactionRouteCount}</strong><span>interaction routes</span></div>
    <div class="metric"><strong>${summary.inboxRouteCount}</strong><span>inbox routes</span></div>
  </section>
  <div class="status-strip"><span>Decision</span>${badge(view.state.decisionStatus)}<span>Graph</span>${badge(view.state.graphValidity)}${graphReasons.map((reason) => `<code>${reason}</code>`).join("")}${view.communicationValidity === null ? "" : `<span>Communication</span>${badge(view.communicationValidity.status)}${view.communicationValidity.reasonCodes.map((reason) => `<code>${escapeHtml(reason)}</code>`).join("")}`}</div>
  ${renderObjective(view)}
  <div class="layout">
    <section><h2>Assignment graph</h2><div class="assignments">${view.nodes.length === 0 ? '<p class="empty">No assignments in this projection.</p>' : view.nodes.map((node, index) => renderNode(node, index, nodeIndexes)).join("")}</div></section>
    <aside class="sidebar">
      <section class="side-panel"><h2>Next actions</h2>${emptyOrList(globalActions, "No governed action")}</section>
      <section class="side-panel"><h2>Resource evidence</h2>${renderResources(view)}</section>
      <section class="side-panel"><h2>Token admission limits</h2>${renderBudgets(view)}</section>
      <section class="side-panel"><h2>Assignment inbox</h2>${renderInbox(view)}</section>
      <section class="side-panel notice"><p class="eyebrow">Evidence boundary</p><h2>Projection, not authority</h2><p><strong>No control in this document mutates repository state.</strong></p>${emptyOrList(limitations, "No declared limitation")}</section>
    </aside>
  </div>
</main>
</body>
</html>
`;
}
