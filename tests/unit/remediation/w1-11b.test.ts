import { expect, test } from "bun:test";

import { buildItemIndex } from "../../../src/semantic";
import { CoreTypeCatalog } from "../../../src/semantic/names/core-types";
import { referenceKindFromResolved } from "../../../src/semantic/names/expression-resolver";
import { resolveNames } from "../../../src/semantic/names/name-resolver";
import { platformPrimitiveNameCatalog } from "../../../src/semantic/names/platform-primitives";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";

test("W1-11b maps local references to the local reference kind", () => {
  const graph = parseModuleGraphForTest([
    [
      "main.wr",
      [
        "fn source() -> u32",
        "fn run() -> u32:",
        "    take source() as result:",
        "        return result",
      ].join("\n"),
    ],
  ]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });

  expect(nameResult.diagnostics).toEqual([]);
  const localReference = nameResult.references
    .entries()
    .find((entry) => entry.reference.kind === "local")?.reference;
  expect(localReference).toBeDefined();
  expect(referenceKindFromResolved(localReference!, { index: indexResult.index })).toBe("local");
});

test("W1-11b pattern bindings shadow parameters inside match arms", () => {
  const graph = parseModuleGraphForTest([
    [
      "main.wr",
      [
        "enum Maybe:",
        "    some(u32)",
        "fn run(value: Maybe, payload: u32) -> u32:",
        "    match value:",
        "        case some(payload):",
        "            return payload",
      ].join("\n"),
    ],
  ]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });

  expect(nameResult.diagnostics).toEqual([]);
  const parameterReferences = nameResult.references
    .entries()
    .filter((entry) => entry.reference.kind === "parameter");
  expect(parameterReferences).toHaveLength(1);
  const payloadReference = nameResult.references
    .entries()
    .find((entry) => entry.key.kind === "local" && entry.reference.kind === "local");
  expect(payloadReference?.reference).toMatchObject({ kind: "local", name: "payload" });
});

test("W1-11b parameter references remain parameters when no local shadows them", () => {
  const graph = parseModuleGraphForTest([
    ["main.wr", "fn run(payload: u32) -> u32:\n    return payload\n"],
  ]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });

  expect(nameResult.diagnostics).toEqual([]);
  expect(
    nameResult.references
      .entries()
      .some((entry) => entry.key.kind === "parameter" && entry.reference.kind === "parameter"),
  ).toBe(true);
});
