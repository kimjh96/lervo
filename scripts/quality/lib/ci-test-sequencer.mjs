import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer } from "vitest/node";

import { assignCiTestShards } from "./ci-test-shards.mjs";

export default class CiTestSequencer extends BaseSequencer {
  async shard(files) {
    const { index, count } = this.ctx.config.shard;
    const profile = JSON.parse(
      readFileSync(new URL("../ci-test-durations.json", import.meta.url), "utf8"),
    );
    if (profile.schemaVersion !== 1 || Object.keys(profile.durations).length > 128)
      throw new Error("ci_duration_profile_invalid");
    const specifications = files.map((file) => ({
      id: `${file.project.name}:${file.moduleId}`,
      path: relative(this.ctx.config.root, file.moduleId).replaceAll("\\", "/"),
    }));
    const selected = new Set(
      assignCiTestShards(specifications, profile.durations, count)[index - 1],
    );
    return files.filter((file) => selected.has(`${file.project.name}:${file.moduleId}`));
  }
}
