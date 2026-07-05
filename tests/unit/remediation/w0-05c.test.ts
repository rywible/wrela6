import { expect, test } from "bun:test";
import { checkSemanticSurface } from "../../../src/semantic/surface/semantic-surface-checker";
import { sourceAttemptContractsFromSignatures } from "../../../src/semantic/surface/contract-type-identity";
import { checkDataclassResources } from "../../../src/semantic/surface/dataclass-resource-checker";
import { buildSourceResourceKindFixpoint } from "../../../src/semantic/surface/resource-kind-worklist";
import {
  checkSemanticSurfaceForTest,
  parseAndResolveSurfaceFixture,
  semanticSurfaceSummary,
} from "../../support/semantic/semantic-surface-fakes";

test("W0-05c keeps semantic surface orchestration stable across contract and resource seams", () => {
  expect(typeof sourceAttemptContractsFromSignatures).toBe("function");
  expect(typeof checkDataclassResources).toBe("function");
  expect(typeof buildSourceResourceKindFixpoint).toBe("function");

  const files: [string, string][] = [
    [
      "main.wr",
      [
        "class Payload:",
        "    value: u32",
        "validated buffer Packet:",
        "    params:",
        "        expected_len: u16",
        "    layout:",
        "        tag: u8 @ 0",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ];

  const fixture = parseAndResolveSurfaceFixture(files);
  const directResult = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });
  const helperResult = checkSemanticSurfaceForTest(files, {
    targetSurface: fixture.targetSurface,
  });

  expect(semanticSurfaceSummary(directResult)).toEqual(semanticSurfaceSummary(helperResult));
});
