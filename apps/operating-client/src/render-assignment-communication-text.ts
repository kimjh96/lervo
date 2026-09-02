import type { AssignmentCommunicationReportV1 } from "@lervo/application-contract";

export function formatAssignmentThreads(report: AssignmentCommunicationReportV1): string {
  const lines = [
    `Assignment threads · ${report.validity.status} · ${report.threads.length} threads`,
  ];
  for (const thread of report.threads) {
    lines.push(
      `${thread.threadId} · ${thread.assignmentId} · ${thread.assignmentStatus} · ${thread.routes.length} routes`,
    );
    for (const route of thread.routes) {
      lines.push(
        `  ${route.handoffId} · ${route.fromAgentId} -> ${route.toAgentId} · route ${route.routeState} · delivery ${route.deliveryState}`,
      );
    }
  }
  if (report.threads.length === 0) lines.push("No assignment interaction thread.");
  return `${lines.join("\n")}\n`;
}

export function formatAssignmentInbox(report: AssignmentCommunicationReportV1): string {
  const lines = [`Assignment inbox · ${report.validity.status} · ${report.inbox.length} routes`];
  for (const item of report.inbox) {
    lines.push(
      `${item.inboxItemId} · ${item.assignmentId} · from ${item.fromAgentId} · route ${item.routeState} · delivery ${item.deliveryState}`,
    );
  }
  if (report.inbox.length === 0) lines.push("No routed assignment interaction.");
  return `${lines.join("\n")}\n`;
}
