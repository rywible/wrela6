import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import type { MonoInstanceId } from "../../../../src/mono/ids";
import type {
  MonoBlock,
  MonoFunctionInstance,
  MonoLocal,
  MonoLocalId,
  MonoStatement,
  MonoTakeStatement,
  MonomorphizedHirProgram,
} from "../../../../src/mono/mono-hir";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { type ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import { createProofMirCallTargetIndex } from "../../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../../src/proof-mir/domains/effects-resources";
import { createProofMirFactRecorder } from "../../../../src/proof-mir/domains/fact-recording";
import { createProofMirGraphSsa } from "../../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../../src/proof-mir/draft/draft-builder-context";
import { createDraftGraphBuilder } from "../../../../src/proof-mir/draft/draft-graph-builder";
import { createProofMirLocalClassifier } from "../../../../src/proof-mir/lower/local-classifier";
import {
  createProofMirLoweringContext,
  type ProofMirCallLowerer,
  type ProofMirBlockTrackingRefs,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import { createProofMirScopePlaceLowerer } from "../../../../src/proof-mir/lower/scope-place-lowerer";
import { targetId } from "../../../../src/semantic/ids";
import {
  createProofMirTakeLowerer,
  createTakeBodyRecorder,
  type DraftRecordedProofMirTakeExit,
  type DraftRecordedProofMirTakeStatement,
} from "../../../../src/proof-mir/lower/take-lowerer";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

export interface TakeLowererFixture {
  readonly functionInstanceId: MonoInstanceId;
  readonly takeStatement: MonoTakeStatement;
  readonly monoStatement: MonoStatement;
  readonly program: MonomorphizedHirProgram;
  readonly locals: readonly MonoLocal[];
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
  readonly statement?: ProofMirStatementLowerer;
}

export interface TakeLowererSequenceFixture {
  readonly functionInstanceId: MonoInstanceId;
  readonly takeStatements: readonly MonoTakeStatement[];
  readonly monoStatements: readonly MonoStatement[];
  readonly program: MonomorphizedHirProgram;
  readonly locals: readonly MonoLocal[];
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
  readonly statement?: ProofMirStatementLowerer;
}

export type TakeLoweringTestResult =
  | {
      readonly kind: "ok";
      readonly statements: readonly DraftRecordedProofMirTakeStatement[];
      readonly exits: readonly DraftRecordedProofMirTakeExit[];
      readonly operandEvaluated?: boolean;
      readonly aliasStorage?: "scalarSsa" | "placeBacked";
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

function functionInstanceForTakeTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
  readonly locals: readonly MonoLocal[];
}): MonoFunctionInstance {
  return {
    instanceId: input.functionInstanceId,
    locals: {
      entries: () => input.locals,
      get: (localId: MonoLocalId) => input.locals.find((local) => local.localId === localId),
    },
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

function buildLoweringContextForTakeTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
  readonly locals: readonly MonoLocal[];
  readonly program: MonomorphizedHirProgram;
  readonly blockTracking?: ProofMirBlockTrackingRefs;
}): ProofMirLoweringResult<{
  readonly context: ProofMirLoweringContext;
  readonly entryBlockKey: ProofMirCanonicalKey;
}> {
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

  const functionInstance = functionInstanceForTakeTest({
    functionInstanceId: input.functionInstanceId,
    body: input.body,
    locals: input.locals,
  });

  const classifierResult = createProofMirLocalClassifier({ functionInstance });
  if (classifierResult.kind === "error") {
    return classifierResult;
  }

  const originMap = createProofMirOriginMap();
  const graph = createDraftGraphBuilder({ functionInstanceId: input.functionInstanceId });
  const ownerKey = `function:${String(input.functionInstanceId)}`;
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
    program: input.program,
    layout,
    target,
    buildContext: createDraftProofMirBuildContext({ program: input.program, layout, target }),
    functionInstanceId: input.functionInstanceId,
    originMap,
    layoutBindingIndex: createProofMirLayoutBindingIndex({ layout }),
    callTargetIndex: createProofMirCallTargetIndex({
      program: input.program,
      layout,
      target,
      callerFunctionInstanceId: input.functionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: {
      functionInstanceId: input.functionInstanceId,
      storageForLocal(monoLocalId) {
        return classifierResult.value.classification().localById(monoLocalId)?.storage;
      },
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
    ssa: createProofMirGraphSsa({ functionInstanceId: input.functionInstanceId, ownerKey }),
    effects: createProofMirEffectsResources({ functionInstanceId: input.functionInstanceId }),
    ...(input.blockTracking === undefined ? {} : { blockTracking: input.blockTracking }),
  });

  context.ssa.registerBlock(entryBlockKey);

  return loweringOk({ context, entryBlockKey });
}

export function lowerProofMirTakeForTest(input: TakeLowererFixture): TakeLoweringTestResult {
  const body: MonoBlock = {
    statements: [input.monoStatement],
    sourceOrigin: "source:test",
  };
  const contextResult = buildLoweringContextForTakeTest({
    functionInstanceId: input.functionInstanceId,
    body,
    locals: input.locals,
    program: input.program,
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics };
  }

  const { context, entryBlockKey } = contextResult.value;
  const recorder = createTakeBodyRecorder(context.graph);
  const takeLowerer = createProofMirTakeLowerer({
    expression: input.expression,
    ...(input.call === undefined ? {} : { call: input.call }),
    ...(input.statement === undefined ? {} : { statement: input.statement }),
    recorder,
  });

  const lowered = takeLowerer.lowerTake({
    context,
    statement: input.takeStatement,
    blockKey: entryBlockKey,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  const aliasStorage =
    input.takeStatement.aliasLocal === undefined
      ? undefined
      : context.localClassifier.storageForLocal(input.takeStatement.aliasLocal.localId);

  return {
    kind: "ok",
    statements: recorder.statements,
    exits: recorder.exits,
    operandEvaluated: true,
    ...(aliasStorage === undefined ? {} : { aliasStorage }),
  };
}

export function lowerProofMirTakeSequenceForTest(
  input: TakeLowererSequenceFixture,
): TakeLoweringTestResult {
  const body: MonoBlock = {
    statements: input.monoStatements,
    sourceOrigin: "source:test",
  };
  const currentBlockRef: { blockKey?: ProofMirCanonicalKey } = {};
  const continuationBlockRef: { blockKey?: ProofMirCanonicalKey } = {};
  const contextResult = buildLoweringContextForTakeTest({
    functionInstanceId: input.functionInstanceId,
    body,
    locals: input.locals,
    program: input.program,
    blockTracking: { currentBlockRef, continuationBlockRef },
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics };
  }

  const { context, entryBlockKey } = contextResult.value;
  currentBlockRef.blockKey = entryBlockKey;
  const recorder = createTakeBodyRecorder(context.graph);
  const takeLowerer = createProofMirTakeLowerer({
    expression: input.expression,
    ...(input.call === undefined ? {} : { call: input.call }),
    ...(input.statement === undefined ? {} : { statement: input.statement }),
    recorder,
  });

  for (const takeStatement of input.takeStatements) {
    const blockKey = currentBlockRef.blockKey;
    if (blockKey === undefined) {
      throw new RangeError("Take lowering sequence lost the current block.");
    }
    const lowered = takeLowerer.lowerTake({
      context,
      statement: takeStatement,
      blockKey,
    });
    if (lowered.kind === "error") {
      return { kind: "error", diagnostics: lowered.diagnostics };
    }
  }

  return {
    kind: "ok",
    statements: recorder.statements,
    exits: recorder.exits,
    operandEvaluated: true,
  };
}
