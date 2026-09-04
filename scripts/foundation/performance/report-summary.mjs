export function renderFoundationPerformanceSummary(report) {
  return `${JSON.stringify(
    {
      reportId: report.reportId,
      allProfilesPassed: report.allProfilesPassed,
      profiles: report.profiles.map((item) => ({
        profileId: item.profile.profileId,
        acceptanceStatus: item.acceptanceStatus,
        budgetStatus: item.budgetStatus,
        measurementEnvironmentStatus: item.measurementEnvironment.status,
        candidateP95: item.candidate.durationMs.p95,
        failureReasons: item.failureReasons,
      })),
    },
    null,
    2,
  )}\n`;
}
