import { callSiteRequirementId, hirRequirementId, obligationId } from "../../../../src/hir/ids";
import { monoInstanceId } from "../../../../src/mono/ids";
import { proofMetadataIdKey } from "../../../../src/mono/proof-metadata-tables";
import { monoResolvedCallTargetTableFromEntries } from "../../../../src/mono/resolved-call-targets";
import type { MonoBlock, MonoForIteration, MonoLocal } from "../../../../src/mono/mono-hir";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { createProofMirCallLowerer } from "../../../../src/proof-mir/lower/call-lowerer";
import {
  lowerForImpl,
  lowerOrdinaryForStatement,
  obligationIdsForIterator,
} from "../../../../src/proof-mir/lower/iterator-lowerer";
import type { ProofMirTakeLowerer } from "../../../../src/proof-mir/lower/lowering-context";
import { type ActiveLoopFrame } from "../../../../src/proof-mir/lower/loop-lowerer";
import { withLoopIfStatementLowering } from "../../../../src/proof-mir/lower/loop-if-statement-lowering";
import {
  collectIteratorLowererBindings,
  expressionIdFor,
  parseIteratorLowererSource,
} from "./iterator-lowerer-harness-bindings";
import {
  emptyProgramForIteratorLowererTest,
  iteratorMetadataForTest,
  layoutForIteratorLowererTest,
  streamIterationForTest,
} from "./iterator-lowerer-harness-program";
import { blockView, buildIteratorLoweringTestContext } from "./iterator-lowerer-harness-context";
import type {
  IteratorLoweringTestResult,
  LowerProofMirOrdinaryForForTestInput,
} from "./iterator-lowerer-harness-types";

export function lowerProofMirOrdinaryForForTest(
  input: LowerProofMirOrdinaryForForTestInput,
): IteratorLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:iterator-test");
  const nextFunctionInstanceId = monoInstanceId("fn:iterator-next");
  const iterableFunctionInstanceId = monoInstanceId("fn:packet-bytes");
  const scalarLocals = input.scalarLocals ?? [];
  const placeBackedLocals = input.placeBackedLocals ?? [];
  const forMatch = input.source.map((line) => line.trim()).find((line) => /^for\s+/.test(line));
  const bindingMatch =
    forMatch === undefined ? undefined : /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+/.exec(forMatch);
  const bindings = collectIteratorLowererBindings({
    functionInstanceId,
    scalarLocalNames:
      input.iteratorProtocol === "stream" ? [...scalarLocals, "packets"] : scalarLocals,
    placeBackedLocalNames: placeBackedLocals,
    bindingName: bindingMatch?.[1],
  });
  const iteration: MonoForIteration =
    input.iteratorProtocol === "stream"
      ? streamIterationForTest(functionInstanceId)
      : { kind: "ordinary" };
  const parsed = parseIteratorLowererSource({
    functionInstanceId,
    bindings,
    source: input.source,
    iteration,
  });
  const body: MonoBlock = {
    statements: [parsed.monoStatement, ...parsed.postamble],
    sourceOrigin: "source:function:body",
  };

  const iteratorObligationId = {
    owner: { kind: "function" as const, instanceId: functionInstanceId },
    hirId: obligationId(42),
    instanceId: functionInstanceId,
  };
  const nextExpressionId = expressionIdFor(functionInstanceId, 100);
  const iterableCallExpression = parsed.forStatement.iterable;
  const iterableResolvedTarget =
    iterableCallExpression.kind.kind === "call"
      ? iterableCallExpression.kind.call.resolvedTarget
      : undefined;
  if (input.iteratorProtocol !== "stream" && iterableResolvedTarget === undefined) {
    throw new RangeError("Iterator lowerer test for-loop iterable must be a resolved call.");
  }
  const programBase = emptyProgramForIteratorLowererTest({
    functionInstanceId,
    nextFunctionInstanceId,
    iterableFunctionInstanceId,
    iteratorObligation: {
      obligationId: iteratorObligationId,
      kind: "callRequirement",
      sourceOrigin: "source:obligation:iterator",
    },
    callSiteRequirements: [
      {
        callSiteRequirementId: {
          owner: { kind: "function", instanceId: functionInstanceId },
          hirId: callSiteRequirementId(1),
          instanceId: functionInstanceId,
        },
        callExpressionId: iterableCallExpression.expressionId,
        requirement: {
          requirementId: {
            owner: { kind: "function", instanceId: functionInstanceId },
            hirId: hirRequirementId(1),
            instanceId: functionInstanceId,
          },
          owner: { kind: "function", functionInstanceId: functionInstanceId },
          expression: { kind: "opaque", text: "iterator-open" },
          sourceOrigin: "source:requirement:iterator",
        },
        sourceOrigin: "source:call-site:iterator",
      },
      {
        callSiteRequirementId: {
          owner: { kind: "function", instanceId: functionInstanceId },
          hirId: callSiteRequirementId(2),
          instanceId: functionInstanceId,
        },
        callExpressionId: nextExpressionId,
        requirement: {
          requirementId: {
            owner: { kind: "function", instanceId: functionInstanceId },
            hirId: hirRequirementId(2),
            instanceId: functionInstanceId,
          },
          owner: { kind: "function", functionInstanceId: functionInstanceId },
          expression: {
            kind: "opaque",
            text: `iterator-next:${String(nextFunctionInstanceId)}`,
          },
          sourceOrigin: "source:requirement:iterator-next",
        },
        sourceOrigin: "source:call-site:iterator-next",
      },
    ],
  });
  const program = {
    ...programBase,
    resolvedCallTargets:
      iterableResolvedTarget === undefined
        ? programBase.resolvedCallTargets
        : monoResolvedCallTargetTableFromEntries([
            {
              callerInstanceId: functionInstanceId,
              callExpressionId: iterableCallExpression.expressionId,
              resolvedTarget: iterableResolvedTarget,
            },
            {
              callerInstanceId: functionInstanceId,
              callExpressionId: nextExpressionId,
              resolvedTarget: {
                kind: "sourceFunction",
                targetFunctionInstanceId: nextFunctionInstanceId,
              },
            },
          ]),
  };

  const layout = layoutForIteratorLowererTest({
    functionInstanceId,
    nextFunctionInstanceId,
    iterableFunctionInstanceId,
  });
  const contextResult = buildIteratorLoweringTestContext({
    functionInstanceId,
    program,
    layout,
    locals: bindings.locals,
    body,
    placeBackedLocalNames: bindings.placeBackedLocalNames,
    targetFeatures: input.targetFeatures,
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics };
  }

  const { context, entryBlockKey, expressionLowerer, statementLowerer, terminalLowerer } =
    contextResult.value;

  const continuationBlockKey = context.graph.createBlock({
    role: "continuation",
    scope: context.graph.rootScopeKey(),
    origin: context.graph.allocateSyntheticOrigin("continuation"),
  });
  context.ssa.registerBlock(continuationBlockKey);

  const loopCarriedLocals = (input.loopCarriedLocals ?? [])
    .map((name) => bindings.localsByName.get(name))
    .filter((local): local is MonoLocal => local !== undefined);

  const callRecorder = {
    callGraphEdges: [],
    platformEdges: [],
    runtimeCalls: [],
    ensuredFacts: [],
    recordCallGraphEdge() {},
    recordPlatformEdge() {},
    recordRuntimeCall() {},
    recordEnsuredFact() {},
  };
  const callLowerer = createProofMirCallLowerer({
    expression: expressionLowerer,
    recorder: callRecorder,
  });

  const activeLoopRef: { frame?: ActiveLoopFrame } = {};
  const shared = withLoopIfStatementLowering({
    scopeRoleByKey: new Map(),
    expression: expressionLowerer,
    statementLowerer,
    terminalLowerer,
    activeLoopRef,
  });

  const iteratorMetadata = iteratorMetadataForTest({
    functionInstanceId,
    nextFunctionInstanceId,
    iteratorObligationId,
  });

  if (input.iteratorProtocol === "stream" && !input.targetFeatures?.includes("streamLoop")) {
    const unusedTakeLowerer: ProofMirTakeLowerer = {
      lowerTake() {
        throw new Error("disabled stream-loop gate must not invoke take lowering");
      },
    };
    const gateResult = lowerForImpl({
      context,
      forStatement: parsed.forStatement,
      monoStatement: parsed.monoStatement,
      blockKey: entryBlockKey,
      shared,
      call: callLowerer,
      take: unusedTakeLowerer,
      callRecorder,
      loopCarriedLocals,
      iteratorMetadata,
      continuationBlockKey,
    });
    if (gateResult.kind === "error") {
      return { kind: "error", diagnostics: gateResult.diagnostics };
    }
  }

  const boundarySessionMembers = (() => {
    if (parsed.forStatement.iteration.kind !== "stream") {
      return undefined;
    }
    const originKey = context.graph.allocateSyntheticOrigin("stream:test-boundary");
    return [
      {
        sessionProofKey: proofMetadataIdKey(parsed.forStatement.iteration.sessionId),
        brandProofKey: proofMetadataIdKey(parsed.forStatement.iteration.itemBrandId),
        obligationProofKey: proofMetadataIdKey(parsed.forStatement.iteration.closureObligationId),
        ...(parsed.forStatement.iterable.place === undefined
          ? {}
          : {
              placeKey: context.effects.placeFromMono({
                monoPlace: parsed.forStatement.iterable.place,
                originKey,
              }),
            }),
        originKey,
      },
    ];
  })();

  const loopResult = lowerOrdinaryForStatement({
    context,
    monoStatement: parsed.monoStatement,
    forStatement: parsed.forStatement,
    blockKey: entryBlockKey,
    continuationBlockKey,
    shared,
    call: callLowerer,
    callRecorder,
    loopCarriedLocals,
    iteratorMetadata,
    obligationIds: obligationIdsForIterator({
      program,
      iteratorMetadata,
    }),
    boundarySessionMembers,
  });
  if (loopResult.kind === "error") {
    return { kind: "error", diagnostics: loopResult.diagnostics };
  }

  for (const statement of parsed.postamble) {
    const loweredReturn = terminalLowerer.lowerReturn({
      context,
      expression: statement.kind.kind === "return" ? statement.kind.expression : undefined,
      blockKey: loopResult.value.exitBlockKey,
      terminal: false,
    });
    if (loweredReturn.kind === "error") {
      return { kind: "error", diagnostics: loweredReturn.diagnostics };
    }
  }

  const graph = context.graph;
  return {
    kind: "ok",
    header: blockView(
      context,
      loopResult.value.headerBlockKey,
      "loopHeader",
      loopResult.value.boundaryResources,
    ),
    body: blockView(context, loopResult.value.bodyBlockKey, "loopBody"),
    exit: blockView(context, loopResult.value.exitBlockKey, "loopExit"),
    nextCall: loopResult.value.nextCall,
    itemEdge: loopResult.value.itemEdge,
    finishedEdge: loopResult.value.finishedEdge,
    ...(loopResult.value.errorEdge === undefined ? {} : { errorEdge: loopResult.value.errorEdge }),
    iteratorPlaceKey: loopResult.value.iteratorPlaceKey,
    blockTerminator(blockKey: ProofMirCanonicalKey) {
      return graph.block(blockKey).terminator;
    },
  };
}
