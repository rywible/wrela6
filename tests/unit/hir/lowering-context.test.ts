import { expect, test } from "bun:test";
import { SourceSpan } from "../../../src/shared/source-span";
import { createHirProgramContext } from "../../../src/hir/lowering-context";
import { functionId, itemId, moduleId } from "../../../src/semantic/ids";
import { parseAndResolveSurfaceFixture } from "../../support/semantic/semantic-surface-fakes";
import { checkSemanticSurface } from "../../../src/semantic/surface";

test("program context owns diagnostics origins metadata and reference lookup", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn use() -> Never\n"]]);
  const surface = checkSemanticSurface({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    platformBindings: fixture.platformBindings,
    coreTypes: fixture.coreTypes,
    targetSurface: fixture.targetSurface,
  });
  const context = createHirProgramContext({
    graph: fixture.graph,
    index: fixture.index,
    references: fixture.references,
    coreTypes: fixture.coreTypes,
    program: surface.program,
    image: surface.image,
  });

  const origin = context.origins.forSynthetic({
    moduleId: moduleId(0),
    span: SourceSpan.from(0, 0),
    stableDetail: "unit",
    ownerItemId: itemId(0),
    ownerFunctionId: functionId(0),
  });
  context.bodyIndex.addEnsureCandidate({
    statementId: context.bodyIndex.nextStatementId(),
    expressionId: context.bodyIndex.nextExpressionId(),
    sourceStatementKind: "ensure",
    sourceOrigin: origin,
  });

  expect(context.diagnostics.entries()).toEqual([]);
  expect(context.origins.get(origin)?.ownerFunctionId).toBe(functionId(0));
  expect(context.proofMetadata.factOrigins.entries()).toEqual([]);
  expect(context.bodyIndex.build().ensureCandidates).toHaveLength(1);
});
