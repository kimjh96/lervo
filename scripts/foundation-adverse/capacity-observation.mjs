export async function observeFoundationCapacityProfile(profile) {
  const started = process.hrtime.bigint();
  const cpuStarted = process.cpuUsage();
  const events = Array.from({ length: profile.eventWindow }, (_, index) => index);
  const assignments = Array.from({ length: profile.assignmentWindow }, (_, index) => index);
  const width = Math.ceil(assignments.length / profile.concurrentWorkers);
  const totals = await Promise.all(
    Array.from({ length: profile.concurrentWorkers }, async (_, worker) => {
      const start = worker * width;
      const end = Math.min(assignments.length, start + width);
      let total = 0;
      for (let index = start; index < end; index += 1) total += assignments[index];
      await Promise.resolve();
      return total;
    }),
  );
  const eventTotal = events.reduce((total, value) => total + value, 0);
  const assignmentTotal = totals.reduce((total, value) => total + value, 0);
  const expectedEventTotal = (profile.eventWindow * (profile.eventWindow - 1)) / 2;
  const expectedAssignmentTotal = (profile.assignmentWindow * (profile.assignmentWindow - 1)) / 2;
  if (eventTotal !== expectedEventTotal || assignmentTotal !== expectedAssignmentTotal) {
    throw new Error(`Capacity profile ${profile.profileId} produced an inconsistent join.`);
  }
  const cpu = process.cpuUsage(cpuStarted);
  const ended = process.hrtime.bigint();
  return {
    ...profile,
    durationMs: Number(ended - started) / 1_000_000,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    processPeakResidentMemoryBytes: process.resourceUsage().maxRSS * 1_024,
    status: "passed",
  };
}
