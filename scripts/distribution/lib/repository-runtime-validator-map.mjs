import { createRequire } from "node:module";
import selected from "../../../packages/schemas/dist/generated/selected-validators.js";

/** Loading changes at the artifact boundary; generated validator functions remain canonical. */
export function createRuntimeValidatorMap(selectedValidators, loadFull) {
  let complete;
  return new Proxy(Object.freeze(selectedValidators), {
    get(target, name) {
      if (Object.hasOwn(target, name)) return target[name];
      complete ??= loadFull();
      return complete[name];
    },
  });
}

const require = createRequire(import.meta.url);
export default createRuntimeValidatorMap(
  selected,
  () => require("./repository-runtime-validators.cjs").default,
);
