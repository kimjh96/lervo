import * as prettier from "prettier";

export async function formatFoundationEvidenceJson(value, outputPath) {
  const options = (await prettier.resolveConfig(outputPath)) ?? {};
  return prettier.format(JSON.stringify(value), { ...options, filepath: outputPath });
}
