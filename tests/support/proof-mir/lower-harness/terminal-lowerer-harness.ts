import type { HirTerminalCallId, ObligationId } from "../../../../src/hir/ids";
import {
  instantiatedHirIdKey,
  monoInstanceId,
  type MonoInstanceId,
} from "../../../../src/mono/ids";
import type {
  MonoExpression,
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoTerminalCall,
} from "../../../../src/mono/mono-hir";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../../../../src/proof-mir/diagnostics";
import { createProofMirCallTargetIndex } from "../../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../../src/proof-mir/domains/effects-resources";
import {
  createProofMirFactRecorder,
  type DraftProofMirFactKey,
} from "../../../../src/proof-mir/domains/fact-recording";
import { createProofMirGraphSsa } from "../../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../../src/proof-mir/draft/draft-builder-context";
import {
  createDraftGraphBuilder,
  type DraftGraphControlEdgeKind,
  type DraftGraphTerminator,
} from "../../../../src/proof-mir/draft/draft-graph-builder";
import {
  createProofMirLoweringContext,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirTerminalLowerer,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import type { MonomorphizedHirProgram } from "../../../../src/mono/mono-hir";
import { targetId } from "../../../../src/semantic/ids";
import {
  createProofMirTerminalLowerer,
  type DraftRecordedProofMirExit,
  type ProofMirExitRecorder,
} from "../../../../src/proof-mir/lower/terminal-lowerer";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function createExitRecorder(): ProofMirExitRecorder {
  const entries: DraftRecordedProofMirExit[] = [];
  return {
    get entries() {
      return entries.slice();
    },
    record(entry) {
      entries.push(entry);
    },
  };
}

export type ReturnLoweringTestResult =
  | {
      readonly kind: "ok";
      readonly terminator?: DraftGraphTerminator;
      readonly returnEdge?: {
        readonly key: ProofMirCanonicalKey;
        readonly kind: DraftGraphControlEdgeKind;
      };
      readonly exits?: readonly DraftRecordedProofMirExit[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

function buildTerminalLoweringContextForTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly program?: MonomorphizedHirProgram;
}): ProofMirLoweringContext {
  const program =
    input.program ??
    ({
      functions: { entries: () => [], get: () => undefined },
      proofMetadata: {
        terminalCalls: { entries: () => [], get: () => undefined },
      },
    } as unknown as MonomorphizedHirProgram);
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
  const functionInstanceId = input.functionInstanceId;
  const graph = createDraftGraphBuilder({ functionInstanceId });
  const origin = graph.allocateSyntheticOrigin("entry");
  graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });

  return createProofMirLoweringContext({
    program,
    layout,
    target,
    buildContext: createDraftProofMirBuildContext({ program, layout, target }),
    functionInstanceId,
    originMap: createProofMirOriginMap(),
    layoutBindingIndex: createProofMirLayoutBindingIndex({ layout }),
    callTargetIndex: createProofMirCallTargetIndex({
      program,
      layout,
      target,
      callerFunctionInstanceId: functionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: {
      functionInstanceId,
      storageForLocal: () => "scalarSsa",
      storageForParameter: () => undefined,
      collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
      placeBackedLocals: emptyPlaceBackedLocals,
    },
    scopePlaceLowerer: {
      functionInstanceId,
      lowerMonoPlace: () => loweringOk("place:test" as never),
    },
    functionScopePlaceLowerer: {
      functionInstanceId,
      scopeTree: {
        scopeKey: () => "scope:test" as never,
        parentRole: () => undefined,
        scopeStack: () => [],
      },
      scopeEntries: [],
      effectsResources: {} as never,
      scopeKind: () => undefined,
      allocateSyntheticOrigin: () => "origin:test" as never,
      lowerMonoPlace: () => ({ kind: "ok", value: { placeKey: "place:test" as never } as never }),
      collectLoopBoundarySet: () => ({
        places: [],
        loans: [],
        obligations: [],
        sessionMembers: [],
        privateStateGenerations: [],
      }),
    },
    graph,
    ssa: createProofMirGraphSsa({
      functionInstanceId,
      ownerKey: `function:${String(functionInstanceId)}`,
    }),
    effects: createProofMirEffectsResources({ functionInstanceId }),
  });
}

export function lowerProofMirReturnForTest(input: {
  readonly functionInstanceId?: MonoInstanceId;
  readonly terminal: boolean;
  readonly expression?: MonoExpression;
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly lowerer?: ProofMirTerminalLowerer;
}): ReturnLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:test");
  const context = buildTerminalLoweringContextForTest({ functionInstanceId });
  const entryBlockKey = context.graph.functionDraft().blocks.entries()[0]!.key;
  const recorder = createExitRecorder();
  const lowerer =
    input.lowerer ??
    createProofMirTerminalLowerer({
      expression: input.expressionLowerer,
      recorder,
    });

  const lowered = lowerer.lowerReturn({
    context,
    expression: input.expression,
    blockKey: entryBlockKey,
    terminal: input.terminal,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  const block = context.graph.block(entryBlockKey);
  const exitEdgeKey = block.terminator?.kind === "return" ? block.terminator.edge : undefined;
  const returnEdge =
    exitEdgeKey === undefined
      ? undefined
      : {
          key: exitEdgeKey,
          kind: context.graph.edge(exitEdgeKey).kind,
        };

  return {
    kind: "ok",
    terminator: block.terminator,
    returnEdge,
    exits: recorder.entries,
  };
}

export function lowerProofMirTerminalPanicForTest(input: {
  readonly functionInstanceId?: MonoInstanceId;
  readonly reason?: string;
  readonly lowerer?: ProofMirTerminalLowerer;
}): ReturnLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:test");
  const context = buildTerminalLoweringContextForTest({ functionInstanceId });
  const entryBlockKey = context.graph.functionDraft().blocks.entries()[0]!.key;

  const recorder = createExitRecorder();
  const lowerer =
    input.lowerer ??
    createProofMirTerminalLowerer({
      expression: {
        lowerExpression: () => ({
          kind: "ok",
          value: { kind: "value", value: "value:unused" as never },
        }),
        lowerExpressionAsPlace: () => ({ kind: "error", diagnostics: [] }),
      },
      recorder,
    });

  const lowered = lowerer.lowerPanic({
    context,
    reason: input.reason,
    blockKey: entryBlockKey,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  const block = context.graph.block(entryBlockKey);
  const exitEdgeKey = block.terminator?.kind === "panic" ? block.terminator.edge : undefined;
  const returnEdge =
    exitEdgeKey === undefined
      ? undefined
      : {
          key: exitEdgeKey,
          kind: context.graph.edge(exitEdgeKey).kind,
        };

  return {
    kind: "ok",
    terminator: block.terminator,
    returnEdge,
    exits: recorder.entries,
  };
}

export function lowerProofMirReachableMonoErrorForTest(input: {
  readonly functionInstanceId?: MonoInstanceId;
  readonly reason?: string;
  readonly lowerer?: ProofMirTerminalLowerer;
}): { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] } {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:test");
  const context = buildTerminalLoweringContextForTest({ functionInstanceId });
  const entryBlockKey = context.graph.functionDraft().blocks.entries()[0]!.key;
  const lowerer =
    input.lowerer ??
    createProofMirTerminalLowerer({
      expression: {
        lowerExpression: () => ({
          kind: "ok",
          value: { kind: "value", value: "value:unused" as never },
        }),
        lowerExpressionAsPlace: () => ({ kind: "error", diagnostics: [] }),
      },
    });
  const lowered = lowerer.lowerReachableMonoError({
    context,
    reason: input.reason,
    blockKey: entryBlockKey,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: sortProofMirDiagnostics(lowered.diagnostics) };
  }
  return { kind: "error", diagnostics: [] };
}

export function proofMirTerminalLowererExits(
  lowerer: ProofMirTerminalLowerer,
): readonly DraftRecordedProofMirExit[] {
  void lowerer;
  return [];
}

export interface RecordedProofMirTerminalCall {
  readonly terminalCallId: MonoInstantiatedProofId<HirTerminalCallId>;
  readonly closureObligationId: MonoInstantiatedProofId<ObligationId>;
  readonly factKey: DraftProofMirFactKey;
}

export function recordProofMirTerminalCallFromMono(input: {
  readonly context: ProofMirLoweringContext;
  readonly callExpressionId: MonoExpressionId;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<RecordedProofMirTerminalCall> {
  const terminalCall = input.context.program.proofMetadata.terminalCalls
    .entries()
    .find(
      (entry) =>
        instantiatedHirIdKey(entry.callExpressionId) ===
        instantiatedHirIdKey(input.callExpressionId),
    );
  if (terminalCall === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
        message: "Proof MIR terminal call lowering could not resolve mono terminal call metadata.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "terminal-call",
        stableDetail: `missing:${String(input.callExpressionId)}`,
      }),
    ]);
  }

  const factKey = input.context.factRecorder.recordTerminalCallFact({
    role: "requirement",
    terminalCallId: terminalCall.terminalCallId,
    dependsOn: [],
    origin: input.originKey,
  });
  if (factKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
        message: "Proof MIR terminal call fact recording failed.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "terminal-call",
        stableDetail: "fact-record",
      }),
    ]);
  }

  return loweringOk({
    terminalCallId: terminalCall.terminalCallId,
    closureObligationId: terminalCall.closureObligationId,
    factKey,
  });
}

export function recordProofMirTerminalCallForTest(input: {
  readonly functionInstanceId?: MonoInstanceId;
  readonly program: MonomorphizedHirProgram;
  readonly terminalCall: MonoTerminalCall;
  readonly callExpressionId: MonoExpressionId;
}): ProofMirLoweringResult<RecordedProofMirTerminalCall> {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:test");
  const context = buildTerminalLoweringContextForTest({
    functionInstanceId,
    program: input.program,
  });
  const originKey = context.graph.allocateSyntheticOrigin("terminal-call");

  return recordProofMirTerminalCallFromMono({
    context,
    callExpressionId: input.callExpressionId,
    originKey,
  });
}
