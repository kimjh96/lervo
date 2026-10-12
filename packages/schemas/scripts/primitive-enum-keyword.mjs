import { _ } from "ajv/dist/2020.js";
import { useFunc } from "ajv/dist/compile/util.js";
import enumModule from "ajv/dist/vocabularies/validation/enum.js";

const originalEnum = enumModule.default ?? enumModule;
const enumContains = (value, values) => values.includes(value);
enumContains.code = 'require("lervo-schema-runtime").enumContains';

/** Keep Ajv's errors and general equality; index only static primitive enum lists. */
export function installPrimitiveEnumIndex(ajv) {
  ajv.removeKeyword("enum");
  ajv.addKeyword({
    ...originalEnum,
    code(context) {
      const { schema, $data, gen, data, schemaCode, it } = context;
      if (
        $data ||
        !Array.isArray(schema) ||
        schema.length < it.opts.loopEnum ||
        schema.some((value) => value !== null && typeof value === "object")
      ) {
        originalEnum.code(context);
        return;
      }
      const contains = useFunc(gen, enumContains);
      context.pass(_`${contains}(${data}, ${schemaCode})`);
    },
  });
}
