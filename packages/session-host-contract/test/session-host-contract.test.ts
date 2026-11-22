import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  clientMessageSchemas,
  hostMessageSchemas,
  sessionHostProtocolDocument,
} from "@lervo/session-host-contract";

const packageRoot = join(import.meta.dirname, "..");
const fixtureRoot = join(import.meta.dirname, "fixtures");

async function fixtures(directory: string): Promise<readonly (readonly [string, unknown])[]> {
  const names = (await readdir(join(fixtureRoot, directory))).filter((name) =>
    name.endsWith(".json"),
  );
  names.sort();
  return Promise.all(
    names.map(
      async (name) =>
        [name, JSON.parse(await readFile(join(fixtureRoot, directory, name), "utf8"))] as const,
    ),
  );
}

function compiledValidators() {
  const document = sessionHostProtocolDocument();
  const id = String(document.$id);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(document);
  const find = (reference: string) => {
    const validator = ajv.getSchema(reference);
    if (validator === undefined) throw new Error(`Missing schema ${reference}.`);
    return validator;
  };
  return {
    any: find(id),
    client: find(`${id}#/$defs/ClientMessage`),
    host: find(`${id}#/$defs/HostMessage`),
  };
}

function kinds(
  schemas: readonly {
    readonly properties: { readonly kind: { readonly enum: readonly [string] } };
  }[],
) {
  return schemas.map((schema) => schema.properties.kind.enum[0]).toSorted();
}

describe("session-host protocol contract", () => {
  const validators = compiledValidators();

  it("accepts every client fixture as a client message", async () => {
    for (const [name, value] of await fixtures("client")) {
      expect(validators.client(value), `${name}: ${JSON.stringify(validators.client.errors)}`).toBe(
        true,
      );
      expect(validators.host(value), name).toBe(false);
    }
  });

  it("accepts every host fixture as a host message", async () => {
    for (const [name, value] of await fixtures("host")) {
      expect(validators.host(value), `${name}: ${JSON.stringify(validators.host.errors)}`).toBe(
        true,
      );
      expect(validators.client(value), name).toBe(false);
    }
  });

  it("rejects every invalid fixture", async () => {
    for (const [name, value] of await fixtures("invalid"))
      expect(validators.any(value), name).toBe(false);
  });

  it("has a valid fixture for every message kind", async () => {
    const seen = async (directory: string) =>
      [
        ...new Set(
          (await fixtures(directory)).map(([, value]) => (value as { kind: string }).kind),
        ),
      ].toSorted();
    expect(await seen("client")).toEqual(kinds(clientMessageSchemas));
    expect(await seen("host")).toEqual(kinds(hostMessageSchemas));
  });

  it("keeps the generated document for the Rust session host current", async () => {
    const committed = JSON.parse(
      await readFile(join(packageRoot, "generated/session-host-protocol.schema.json"), "utf8"),
    );
    expect(
      committed,
      "Run `pnpm --filter @lervo/session-host-contract build` to regenerate the document.",
    ).toEqual(sessionHostProtocolDocument());
  });
});
