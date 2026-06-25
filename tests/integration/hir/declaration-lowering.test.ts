import { expect, test } from "bun:test";
import { lowerTypedHir } from "../../../src/hir/typed-hir-builder";
import { parseAndResolveSurfaceFixture } from "../../support/semantic/semantic-surface-fakes";
import { checkSemanticSurface } from "../../../src/semantic/surface";

test("lowerTypedHir creates function shells from checked signatures", () => {
  const fixture = parseAndResolveSurfaceFixture([
    [
      "main.wr",
      "fn helper() -> bool:\n    return true\nuefi image Boot:\n    fn main() -> Never\n",
    ],
  ]);
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });

  const result = lowerTypedHir({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: surface.program,
    image: surface.image,
  });

  expect(result.program.declarations.entries().map((declaration) => declaration.name)).toContain(
    "helper",
  );
  expect(result.program.functions.entries().map((func) => func.bodyStatus)).toContain("sourceBody");
  expect(result.diagnostics).toEqual([]);
});
