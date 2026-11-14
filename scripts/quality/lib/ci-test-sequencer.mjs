import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer } from "vitest/node";

import { readCiTestDurationProfile } from "./ci-test-duration-profile.mjs";
import { assignCiTestShards } from "./ci-test-shards.mjs";

const profileUrl = new URL("../ci-test-durations.json", import.meta.url);

/** Places files by the committed duration profile; selection and isolation stay Vitest's own. */
export default class CiTestSequencer extends BaseSequencer {
  #durations;

  durations() {
    this.#durations ??= readCiTestDurationProfile(JSON.parse(readFileSync(profileUrl, "utf8")));
    return this.#durations;
  }

  path(file) {
    return relative(this.ctx.config.root, file.moduleId).replaceAll("\\", "/");
  }

  async shard(files) {
    const { index, count } = this.ctx.config.shard;
    const specifications = files.map((file) => ({
      id: `${file.project.name}:${file.moduleId}`,
      path: this.path(file),
    }));
    const selected = new Set(
      assignCiTestShards(specifications, this.durations(), count)[index - 1],
    );
    return files.filter((file) => selected.has(`${file.project.name}:${file.moduleId}`));
  }

  /** Starts the slowest known files first so both workers of a shard finish close together. */
  async sort(files) {
    const durations = this.durations();
    const duration = (file) => durations[this.path(file)] ?? 0;
    return (await super.sort(files)).sort((left, right) => duration(right) - duration(left));
  }
}
