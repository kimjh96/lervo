import { digest } from "./context-quality-artifact-identity.mjs";

const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const eventTypes = ["run.requested", "terminal.context.prepared", "workstream.snapshot.recorded"];

export function validateProvenanceProtocol(protocol) {
  if (
    protocol.schemaVersion !== 1 ||
    protocol.auditId !== "context-quality-historical-provenance-v1" ||
    protocol.maximumEvents !== 100000 ||
    !/^wks_[a-f0-9]{24}$/u.test(protocol.workstreamId) ||
    !Array.isArray(protocol.snapshotCandidates) ||
    protocol.snapshotCandidates.length > 8 ||
    !Array.isArray(protocol.historicalReports) ||
    protocol.historicalReports.length !== 2 ||
    protocol.snapshotCandidates.some(
      (s) =>
        !/^evt_[a-f0-9]{32}$/u.test(s.eventId) ||
        !hashPattern.test(s.snapshotHash) ||
        !Number.isSafeInteger(s.revision) ||
        s.revision < 1,
    ) ||
    protocol.historicalReports.some((r) => !hashPattern.test(r.contentHash))
  )
    throw new Error("Invalid bounded provenance audit protocol.");
}

async function readJsonArtifact(storage, hash) {
  const uri = `lervo-cas://sha256/${hash.slice(7)}`;
  if (!(await storage.artifacts.has(uri))) return null;
  const bytes = await storage.artifacts.get(uri);
  if (digest(bytes) !== hash) throw new Error("Artifact identity mismatch.");
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

export async function auditHistoricalProvenance(storage, suite, protocol, validateSnapshot) {
  validateProvenanceProtocol(protocol);
  const head = storage.events.latest();
  const requests = [],
    snapshots = new Map();
  let afterSeq = 0,
    scanned = 0,
    complete = false;
  while (scanned < protocol.maximumEvents) {
    const page = storage.events.list({
      afterSeq,
      limit: Math.min(1000, protocol.maximumEvents - scanned),
      types: eventTypes,
    });
    for (const event of page) {
      if (event.seq > (head?.seq ?? 0)) break;
      scanned++;
      afterSeq = event.seq;
      if (event.type === "workstream.snapshot.recorded")
        snapshots.set(event.payload.snapshotContentHash, event);
      else requests.push(event);
    }
    if (page.length === 0 || page.at(-1).seq >= (head?.seq ?? 0) || page.length < 1000) {
      complete = true;
      break;
    }
  }
  const loaded = new Map();
  async function snapshot(hash, eventId) {
    const key = `${hash}:${eventId ?? ""}`;
    if (loaded.has(key)) return loaded.get(key);
    const event = eventId ? storage.events.get(eventId) : snapshots.get(hash);
    if (!event || event.seq > (head?.seq ?? 0)) return null;
    if (event.type !== "workstream.snapshot.recorded" || event.payload.snapshotContentHash !== hash)
      throw new Error("Historical event does not bind the requested snapshot.");
    const value = await readJsonArtifact(storage, hash);
    if (
      !value ||
      !validateSnapshot(value) ||
      value.workstreamId !== event.payload.workstreamId ||
      value.revision !== event.payload.revision ||
      value.status !== event.payload.status ||
      event.payload.snapshotArtifactId !== `art_${hash.slice(7)}`
    )
      throw new Error("Historical snapshot does not match its canonical event.");
    const result = { event, value };
    loaded.set(key, result);
    return result;
  }
  const candidates = [];
  for (const candidate of protocol.snapshotCandidates) {
    const found = await snapshot(candidate.snapshotHash, candidate.eventId);
    if (
      found &&
      (found.event.eventId !== candidate.eventId ||
        found.value.revision !== candidate.revision ||
        found.value.workstreamId !== protocol.workstreamId)
    )
      throw new Error("Historical candidate binding mismatch.");
    candidates.push({
      ...candidate,
      presentAndBound: found !== null,
      eventHash: found?.event.eventHash ?? null,
      pendingReviewBinding:
        found?.value.pendingApprovals?.some(
          (a) =>
            a.approvalId === suite.review.approvalId && a.bindingHash === suite.review.bindingHash,
        ) ?? false,
      exactMeasurementContext: false,
    });
  }
  const reports = [];
  for (const report of protocol.historicalReports) {
    const value = await readJsonArtifact(storage, report.contentHash);
    if (
      value &&
      (value.reportId !== report.reportId ||
        value.provider !== report.provider ||
        value.suiteBindingHash !== suite.review.bindingHash)
    )
      throw new Error("Historical report binding mismatch.");
    reports.push({
      ...report,
      presentAtDeclaredCasHash: value !== null,
      exactContextCoordinate: value
        ? { workstreamId: value.workstreamId ?? null, revision: value.workstreamRevision ?? null }
        : null,
    });
  }
  const cases = [];
  for (const item of suite.cases) {
    const queryHash = digest(item.query);
    const matches = requests.filter(
      (e) => e.type === "terminal.context.prepared" && e.payload.requestDigest === queryHash,
    );
    const bindings = [];
    const withinBound = matches.length <= 32;
    if (!withinBound) complete = false;
    for (const event of withinBound ? matches : []) {
      const hash = event.payload.workstreamSnapshotHash;
      const found = hashPattern.test(hash ?? "") ? await snapshot(hash) : null;
      const bound =
        found &&
        found.value.workstreamId === event.payload.workstreamId &&
        found.value.revision === event.payload.workstreamRevision;
      bindings.push({
        eventId: event.eventId,
        eventHash: event.eventHash,
        snapshotHash: hash ?? null,
        sourceSnapshotId: event.payload.sourceSnapshotId ?? null,
        contextBound: Boolean(bound),
      });
    }
    cases.push({
      familyId: item.caseId,
      queryHash,
      contextRequirement: item.contextRequirement,
      matchingTerminalEventCount: matches.length,
      maximumDetailedMatches: 32,
      matchingTerminalEvents: bindings,
      originalContext:
        item.contextRequirement === "none"
          ? "not_required"
          : !withinBound
            ? "matching_event_bound_exceeded"
            : bindings.some((b) => b.contextBound)
              ? "request_bound_snapshot_available"
              : "exact_binding_unavailable",
      newHeldOutEligible: false,
      fullAdr0501HumanLabels: false,
    });
  }
  const bodyMatches = new Set();
  const hashes = new Set(
    requests.map((e) => e.payload.requestDigest).filter((h) => hashPattern.test(h ?? "")),
  );
  for (const hash of hashes)
    if (await storage.artifacts.has(`lervo-cas://sha256/${hash.slice(7)}`)) bodyMatches.add(hash);
  const integrity = storage.events.verifyIntegrity();
  return {
    schemaVersion: 1,
    auditId: protocol.auditId,
    observedAt: new Date().toISOString(),
    complete,
    observedHead: head ? { eventId: head.eventId, seq: head.seq, eventHash: head.eventHash } : null,
    integrityValid: integrity.valid,
    scan: {
      selectedEventTypes: eventTypes,
      scannedEvents: scanned,
      maximumEvents: protocol.maximumEvents,
      managedRequestEvents: requests.filter((e) => e.type === "run.requested").length,
      terminalRequestEvents: requests.filter((e) => e.type === "terminal.context.prepared").length,
      uniqueRequestDigests: hashes.size,
      bodiesAtRequestHash: bodyMatches.size,
      interpretation:
        "Artifact presence alone does not establish a real-task family, human labels or held-out eligibility.",
    },
    candidates,
    historicalReports: reports,
    cases,
    qualityQualified: false,
    providerCalls: 0,
    privacy:
      "No task, conversation, workstream body, provider output or derived private query text is emitted.",
  };
}
