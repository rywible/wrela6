import { expect, test } from "bun:test";

import { buildItemIndex } from "../../../src/semantic";
import { CoreTypeCatalog } from "../../../src/semantic/names/core-types";
import { resolveNames } from "../../../src/semantic/names/name-resolver";
import { platformPrimitiveNameCatalog } from "../../../src/semantic/names/platform-primitives";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";

test("W1-16a records a repeated pattern member reference at the current segment span", () => {
  const source = [
    "class A:",
    "    b: A",
    "fn run(value: A) -> A:",
    "    match value:",
    "        case A.b.b:",
    "            return value",
  ].join("\n");
  const graph = parseModuleGraphForTest([["main.wr", source]]);
  const indexResult = buildItemIndex({ graph });
  const nameResult = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes: CoreTypeCatalog.default(),
    platformPrimitiveNames: platformPrimitiveNameCatalog([]),
  });

  expect(nameResult.diagnostics).toEqual([]);
  const fieldReferences = nameResult.references
    .entries()
    .filter((entry) => entry.key.kind === "fieldName" && entry.reference.kind === "field");
  const fieldSpanTexts = fieldReferences.map((entry) =>
    source.slice(entry.key.span.start, entry.key.span.end),
  );

  expect(fieldSpanTexts).toEqual(["b", "b"]);
  expect(fieldReferences[1]!.key.span.start).toBeGreaterThan(fieldReferences[0]!.key.span.start);
});
