/**
 * Overlap independent reads without opening one descriptor per repository artifact. Every input
 * is visited, and results retain input order. Workers and results belong to this call only.
 */
export async function mapKnowledgeReads<T, R>(
  inputs: readonly T[],
  read: (input: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(inputs.length);
  let next = 0;
  let failed = false;
  const failures: Array<{ index: number; error: unknown }> = [];
  const worker = async (): Promise<void> => {
    while (!failed && next < inputs.length) {
      const index = next++;
      try {
        results[index] = await read(inputs[index]!);
      } catch (error) {
        failed = true;
        failures.push({ index, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, inputs.length) }, worker));
  if (failures.length > 0) {
    failures.sort((left, right) => left.index - right.index);
    throw failures[0]!.error;
  }
  return results;
}
