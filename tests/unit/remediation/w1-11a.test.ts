import { expect, test } from "bun:test";

import { buildItemIndex } from "../../../src/semantic";
import { CoreTypeCatalog } from "../../../src/semantic/names/core-types";
import { resolveNames } from "../../../src/semantic/names/name-resolver";
import { platformPrimitiveNameCatalog } from "../../../src/semantic/names/platform-primitives";
import type { ResolvedReferenceEntry } from "../../../src/semantic/names/reference";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";

test("W1-11a resolves a block local before a same-named module function", () => {
  const graph = parseModuleGraphForTest([
    [
      "main.wr",
      [
        "fn source() -> u32",
        "fn helper() -> u32",
        "fn run() -> u32:",
        "    take source() as helper:",
        "        return helper",
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
  const helperReferences = nameResult.references.entries().filter(
    (
      entry,
    ): entry is ResolvedReferenceEntry & {
      readonly reference: Extract<ResolvedReferenceEntry["reference"], { kind: "local" }>;
    } => entry.key.kind === "local" && entry.reference.kind === "local",
  );
  expect(helperReferences).toHaveLength(1);
  expect(helperReferences[0]!.reference.name).toBe("helper");
});
