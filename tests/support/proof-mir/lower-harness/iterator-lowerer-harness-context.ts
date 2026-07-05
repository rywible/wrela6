import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import type { MonoBlock, MonoLocal, MonomorphizedHirProgram } from "../../../../src/mono/mono-hir";
import type { MonoInstanceId } from "../../../../src/mono/ids";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import {
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTerminalLowerer,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import { type LoopLoweringBlockView } from "../../../../src/proof-mir/lower/loop-lowerer";
import { type ProofMirFunctionScopePlaceLowerer } from "../../../../src/proof-mir/lower/scope-place-lowerer";
import { createProofMirLoweringHarnessContext, loweringOk } from "./lowering-harness-context";
import { runtimeCatalogForFixture, runtimeOperationForFixture } from "./call-lowerer-harness";
import { functionInstanceForIteratorLowererTest } from "./iterator-lowerer-harness-program";
import { proofMirRuntimeOperationId } from "../../../../src/proof-mir/ids";
import { targetId } from "../../../../src/semantic/ids";
import type { ProofMirLoweringTargetContext } from "../../../../src/proof-mir/lower/lowering-context";

function iteratorFinishTargetForLoweringHarness(input?: {
  readonly features?: readonly string[];
}): ProofMirLoweringTargetContext {
  const finishRuntimeOperationId = proofMirRuntimeOperationId(1);
  return {
    targetId: targetId("x64-test"),
    features: input?.features ?? [],
    runtimeCatalog: runtimeCatalogForFixture([
      runtimeOperationForFixture({
        runtimeId: finishRuntimeOperationId,
        name: "iterator_finish",
        loweringOwner: "validatedBufferHelper",
      }),
    ]),
  };
}

export function buildIteratorLoweringTestContext(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly locals: readonly MonoLocal[];
  readonly body: MonoBlock;
  readonly placeBackedLocalNames: ReadonlySet<string>;
  readonly targetFeatures?: readonly string[];
}): ProofMirLoweringResult<{
  readonly context: ProofMirLoweringContext;
  readonly entryBlockKey: ProofMirCanonicalKey;
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
}> {
  const harnessResult = createProofMirLoweringHarnessContext({
    functionInstanceId: input.functionInstanceId,
    functionInstance: functionInstanceForIteratorLowererTest({
      functionInstanceId: input.functionInstanceId,
      locals: input.locals,
      body: input.body,
    }),
    locals: input.locals,
    program: input.program,
    layout: input.layout,
    target: iteratorFinishTargetForLoweringHarness({ features: input.targetFeatures }),
    placeBackedLocalNames: input.placeBackedLocalNames,
    collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
    placeBackedLocals: emptyPlaceBackedLocals,
  });
  if (harnessResult.kind === "error") {
    return harnessResult;
  }

  const { context, registry, entryBlockKey, scopePlaceLowerer } = harnessResult.value;

  return loweringOk({
    context,
    entryBlockKey,
    expressionLowerer: registry.expression,
    statementLowerer: registry.statement,
    terminalLowerer: registry.terminal,
    scopePlaceLowerer,
  });
}

export function blockView(
  context: ProofMirLoweringContext,
  blockKey: ProofMirCanonicalKey,
  kind: LoopLoweringBlockView["kind"],
  boundaryResources?: ReturnType<ProofMirFunctionScopePlaceLowerer["collectLoopBoundarySet"]>,
): LoopLoweringBlockView {
  return {
    blockKey,
    kind,
    parameters: context.ssa.blockParameters(blockKey).map((parameter) => ({
      parameterKind: { kind: parameter.parameterKind },
      predeclared: parameter.predeclared,
    })),
    ...(boundaryResources === undefined ? {} : { boundaryResources }),
  };
}
