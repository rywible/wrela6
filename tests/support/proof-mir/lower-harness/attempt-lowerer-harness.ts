import { attemptId, hirExpressionId } from "../../../../src/hir/ids";
import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../../src/mono/ids";
import type {
  MonoAttempt,
  MonoBlock,
  MonoExpression,
  MonoFunctionInstance,
} from "../../../../src/mono/mono-hir";
import type { MonomorphizedHirProgram } from "../../../../src/mono/mono-hir";
import { proofMetadataIdKey } from "../../../../src/mono/proof-metadata-tables";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import { createProofMirCallTargetIndex } from "../../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../../src/proof-mir/domains/effects-resources";
import { createProofMirFactRecorder } from "../../../../src/proof-mir/domains/fact-recording";
import { createProofMirGraphSsa } from "../../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../../src/proof-mir/draft/draft-builder-context";
import {
  createDraftGraphBuilder,
  type DraftGraphEdgeView,
  type DraftGraphTerminator,
} from "../../../../src/proof-mir/draft/draft-graph-builder";
import type { DraftProofMirGraphStatementSnapshot } from "../../../../src/proof-mir/draft/draft-statement";
import { createProofMirExpressionLowerer } from "../../../../src/proof-mir/lower/expression-lowerer";
import { createProofMirLocalClassifier } from "../../../../src/proof-mir/lower/local-classifier";
import {
  createProofMirLoweringContext,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import { createProofMirScopePlaceLowerer } from "../../../../src/proof-mir/lower/scope-place-lowerer";
import { targetId } from "../../../../src/semantic/ids";
import { createProofMirAttemptLowerer } from "../../../../src/proof-mir/lower/attempt-lowerer";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function pendingResultCanonicalKey(
  functionInstanceId: MonoInstanceId,
  attempt: MonoAttempt,
): ProofMirCanonicalKey {
  return proofMirCanonicalKey(
    `function:${String(functionInstanceId)}/attempt:pending:${proofMetadataIdKey(attempt.attemptId)}`,
  );
}

export interface AttemptLowererTestFixture {
  readonly attempt: MonoAttempt;
  readonly functionInstanceId?: MonoInstanceId;
  readonly expressionLowerer?: ProofMirExpressionLowerer;
}

export interface AttemptLoweringTestResult {
  readonly kind: "ok" | "error";
  readonly statement?: DraftProofMirGraphStatementSnapshot;
  readonly terminator?: DraftGraphTerminator;
  readonly successEdge?: DraftGraphEdgeView;
  readonly errorEdge?: DraftGraphEdgeView;
  readonly pendingResultPlaceKey?: ProofMirCanonicalKey;
  readonly diagnostics?: readonly ProofMirDiagnostic[];
}
function functionInstanceForAttemptTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
}): MonoFunctionInstance {
  return {
    instanceId: input.functionInstanceId,
    locals: { entries: () => [], get: () => undefined },
    body: input.body,
    bodyIndex: {
      statements: { entries: () => input.body.statements, get: () => undefined },
      expressions: { entries: () => [], get: () => undefined },
    },
    bodyStatus: "sourceBody",
    signature: {
      modifiers: {
        isTerminal: false,
        isPlatform: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      parameters: [],
    },
  } as unknown as MonoFunctionInstance;
}

function buildAttemptLoweringContextForTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
}): ProofMirLoweringResult<{
  readonly context: ProofMirLoweringContext;
  readonly entryBlockKey: ProofMirCanonicalKey;
}> {
  const program = {
    functions: { entries: () => [], get: () => undefined },
  } as unknown as MonomorphizedHirProgram;
  const layout = {} as LayoutFactProgram;
  const target = {
    targetId: targetId("x64-test"),
    features: [] as readonly string[],
    runtimeCatalog: {
      targetId: targetId("x64-test"),
      features: [] as readonly string[],
      get: () => undefined,
      entries: () => [],
    },
  };

  const functionInstance = functionInstanceForAttemptTest({
    functionInstanceId: input.functionInstanceId,
    body: input.body,
  });

  const classifierResult = createProofMirLocalClassifier({ functionInstance });
  if (classifierResult.kind === "error") {
    return classifierResult;
  }

  const originMap = createProofMirOriginMap();
  const graph = createDraftGraphBuilder({ functionInstanceId: input.functionInstanceId });
  const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId: input.functionInstanceId,
    body: input.body,
    originMap,
  });
  if (scopePlaceLowererResult.kind === "error") {
    return scopePlaceLowererResult;
  }

  const entryBlockKey = graph.createBlock({
    role: "entry",
    scope: graph.rootScopeKey(),
    origin: originMap.fromHirOrigin({
      owner: { kind: "function", functionInstanceId: input.functionInstanceId },
      sourceOrigin: "source:test" as never,
    }),
  });

  const context = createProofMirLoweringContext({
    program,
    layout,
    target,
    buildContext: createDraftProofMirBuildContext({ program, layout, target }),
    functionInstanceId: input.functionInstanceId,
    originMap,
    layoutBindingIndex: createProofMirLayoutBindingIndex({ layout }),
    callTargetIndex: createProofMirCallTargetIndex({
      program,
      layout,
      target,
      callerFunctionInstanceId: input.functionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: {
      functionInstanceId: input.functionInstanceId,
      storageForLocal: () => "scalarSsa",
      storageForParameter: () => undefined,
      collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
      placeBackedLocals: emptyPlaceBackedLocals,
    },
    scopePlaceLowerer: {
      functionInstanceId: input.functionInstanceId,
      lowerMonoPlace(placeInput) {
        const lowered = scopePlaceLowererResult.value.lowerMonoPlace({
          monoPlace: placeInput.monoPlace,
          originKey: placeInput.originKey,
        });
        if (lowered.kind !== "ok") {
          return lowered;
        }
        return loweringOk(lowered.value.placeKey);
      },
    },
    functionScopePlaceLowerer: scopePlaceLowererResult.value,
    graph,
    ssa: createProofMirGraphSsa({
      functionInstanceId: input.functionInstanceId,
      ownerKey: `function:${String(input.functionInstanceId)}`,
    }),
    effects: createProofMirEffectsResources({ functionInstanceId: input.functionInstanceId }),
  });

  context.ssa.registerBlock(entryBlockKey);

  return loweringOk({ context, entryBlockKey });
}

function monoExpressionId(functionInstanceId: MonoInstanceId, value: number) {
  return instantiatedHirId(functionInstanceId, hirExpressionId(value));
}

function literalExpression(functionInstanceId: MonoInstanceId, ordinal: number): MonoExpression {
  return {
    expressionId: monoExpressionId(functionInstanceId, ordinal),
    kind: { kind: "literal", literal: { kind: "integer", text: String(ordinal) } },
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:literal:${ordinal}`,
  };
}

function branchyFallibleExpression(
  functionInstanceId: MonoInstanceId,
  ordinal: number,
): MonoExpression {
  return {
    expressionId: monoExpressionId(functionInstanceId, ordinal),
    kind: {
      kind: "binary",
      operator: "+",
      left: {
        expressionId: monoExpressionId(functionInstanceId, ordinal * 10 + 1),
        kind: {
          kind: "comparison",
          operator: ">",
          left: literalExpression(functionInstanceId, ordinal * 10 + 2),
          right: literalExpression(functionInstanceId, ordinal * 10 + 3),
        },
        type: { kind: "primitive", name: "bool" } as never,
        resourceKind: "Copy",
        sourceOrigin: `source:branchy:left:${ordinal}`,
      },
      right: literalExpression(functionInstanceId, ordinal * 10 + 4),
    },
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: `source:branchy:${ordinal}`,
  };
}

export function attemptWithBranchyFallibleExpressionFixture(): AttemptLowererTestFixture {
  const functionInstanceId = monoInstanceId("fn:main");
  const ordinal = 7;
  return {
    functionInstanceId,
    attempt: {
      attemptId: {
        owner: { kind: "function", instanceId: functionInstanceId },
        hirId: attemptId(ordinal),
        instanceId: functionInstanceId,
      },
      attemptExpressionId: monoExpressionId(functionInstanceId, ordinal),
      fallibleExpression: branchyFallibleExpression(functionInstanceId, ordinal),
      declaredInputPlaces: [],
      sourceOrigin: `source:attempt:${ordinal}`,
    },
  };
}

export function lowerProofMirAttemptForTest(
  fixture: AttemptLowererTestFixture,
): AttemptLoweringTestResult {
  const functionInstanceId = fixture.functionInstanceId ?? monoInstanceId("fn:attempt-test");
  const body: MonoBlock = { statements: [], sourceOrigin: "source:test" };
  const contextResult = buildAttemptLoweringContextForTest({
    functionInstanceId,
    body,
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics };
  }

  const { context, entryBlockKey } = contextResult.value;
  const expressionLowerer = fixture.expressionLowerer ?? createProofMirExpressionLowerer();

  const lowerer = createProofMirAttemptLowerer({ expression: expressionLowerer });
  const lowered = lowerer.lowerAttempt({
    context,
    attempt: fixture.attempt,
    blockKey: entryBlockKey,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  const recorded = lowerer.recorder.entries[0];
  if (recorded === undefined) {
    return {
      kind: "error",
      diagnostics: [
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_MISSING_ATTEMPT_START",
          message: "Attempt lowering did not record an attempt statement.",
          functionInstanceId,
          ownerKey: `function:${String(functionInstanceId)}`,
          rootCauseKey: "attempt-recorder",
          stableDetail: "missing-recorded-statement",
        }),
      ],
    };
  }

  const block = context.graph.block(entryBlockKey);
  const successEdgeKey =
    block.terminator?.kind === "matchAttempt"
      ? block.terminator.match.successTarget.edge
      : undefined;
  const errorEdgeKey =
    block.terminator?.kind === "matchAttempt" ? block.terminator.match.errorTarget.edge : undefined;

  return {
    kind: "ok",
    statement: recorded,
    terminator: block.terminator,
    successEdge: successEdgeKey === undefined ? undefined : context.graph.edge(successEdgeKey),
    errorEdge: errorEdgeKey === undefined ? undefined : context.graph.edge(errorEdgeKey),
    pendingResultPlaceKey: pendingResultCanonicalKey(functionInstanceId, fixture.attempt),
  };
}
