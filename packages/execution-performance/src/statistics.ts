export interface PerformanceDistribution {
  sampleCount: number;
  p50: number;
  p95: number;
  p99: number | null;
  maximum: number;
}

function percentile(sorted: readonly number[], quantile: number): number {
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]!;
}

function distribution(values: readonly number[], allowNegative: boolean): PerformanceDistribution {
  if (
    values.length === 0 ||
    values.some(
      (value) =>
        typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value < 0),
    )
  ) {
    throw new TypeError(
      "Performance samples must be a nonempty list of finite nonnegative values.",
    );
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    sampleCount: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: sorted.length >= 100 ? percentile(sorted, 0.99) : null,
    maximum: sorted.at(-1)!,
  };
}

export function performanceDistribution(values: readonly number[]): PerformanceDistribution {
  return distribution(values, false);
}

export function performanceDifferenceDistribution(
  values: readonly number[],
): PerformanceDistribution {
  return distribution(values, true);
}
