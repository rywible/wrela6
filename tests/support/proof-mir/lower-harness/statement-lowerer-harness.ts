import { monoInstanceId, type MonoInstanceId } from "../../../../src/mono/ids";
import type {
  MonoBlock,
  MonoFunctionInstance,
  MonoLocal,
  MonoLocalId,
  MonoStatement,
} from "../../../../src/mono/mono-hir";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import type { ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import { createProofMirCallTargetIndex } from "../../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../../src/proof-mir/domains/effects-resources";
import { createProofMirFactRecorder } from "../../../../src/proof-mir/domains/fact-recording";
import { createProofMirGraphSsa } from "../../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../../src/proof-mir/draft/draft-builder-context";
import { createDraftGraphBuilder } from "../../../../src/proof-mir/draft/draft-graph-builder";
import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import type { MonomorphizedHirProgram } from "../../../../src/mono/mono-hir";
import { targetId } from "../../../../src/semantic/ids";
import { createProofMirLocalClassifier } from "../../../../src/proof-mir/lower/local-classifier";
import {
  createProofMirLoweringContext,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import { createProofMirExpressionLowerer } from "../../../../src/proof-mir/lower/expression-lowerer";
import { createProofMirScopePlaceLowerer } from "../../../../src/proof-mir/lower/scope-place-lowerer";
import {
  createProofMirStatementLowerer,
  type DraftRecordedProofMirStatement,
} from "../../../../src/proof-mir/lower/statement-lowerer";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function createStatementBodyRecorder(): {
  readonly entries: readonly DraftRecordedProofMirStatement[];
  record(entry: DraftRecordedProofMirStatement): void;
} {
  const entries: DraftRecordedProofMirStatement[] = [];
  return {
    get entries() {
      return entries.slice();
    },
    record(entry) {
      entries.push(entry);
    },
  };
}

export type StatementLoweringTestResult =
  | {
      readonly kind: "ok";
      readonly recordedStatements: readonly DraftRecordedProofMirStatement[];
      readonly ssaDefinitions: readonly {
        readonly localKey: ProofMirCanonicalKey;
        readonly valueKey: ProofMirCanonicalKey;
        readonly blockKey: ProofMirCanonicalKey;
      }[];
      readonly graphStatements: readonly ProofMirCanonicalKey[];
      readonly scopes: readonly {
        readonly role: string;
        readonly scopeKey: ProofMirCanonicalKey;
      }[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

function functionInstanceForStatementTest(input: {
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

export function buildLoweringContextForTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly body: MonoBlock;
  readonly locals: readonly MonoLocal[];
}): ProofMirLoweringResult<{
  readonly context: ReturnType<typeof createProofMirLoweringContext>;
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

  const functionInstance = functionInstanceForStatementTest({
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
  const effects = createProofMirEffectsResources({ functionInstanceId: input.functionInstanceId });
  const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId: input.functionInstanceId,
    body: input.body,
    originMap,
    effectsResources: effects,
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
    effects,
  });

  context.ssa.registerBlock(entryBlockKey);

  return loweringOk({ context, entryBlockKey });
}

export function lowerProofMirStatementForTest(input: {
  readonly functionInstanceId?: MonoInstanceId;
  readonly locals?: readonly MonoLocal[];
  readonly statement: MonoStatement;
  readonly expression: ProofMirExpressionLowerer;
  readonly lowerer?: ProofMirStatementLowerer;
}): StatementLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:test");
  const locals = input.locals ?? [];
  const body: MonoBlock = { statements: [input.statement], sourceOrigin: "source:test" };
  const contextResult = buildLoweringContextForTest({
    functionInstanceId,
    body,
    locals,
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics };
  }

  const { context, entryBlockKey } = contextResult.value;
  const recorder = createStatementBodyRecorder();
  const lowerer =
    input.lowerer ??
    createProofMirStatementLowerer({
      expression: input.expression,
      recorder,
    });

  const lowered = lowerer.lowerStatement({
    context,
    statement: input.statement,
    blockKey: entryBlockKey,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  const ssaDefinitions = recorder.entries
    .filter(
      (entry): entry is Extract<DraftRecordedProofMirStatement, { kind: "defineScalar" }> =>
        entry.kind === "defineScalar",
    )
    .map((entry) => ({
      localKey: entry.localKey,
      valueKey: entry.valueKey,
      blockKey: entry.blockKey,
    }));

  const scopes = context.graph
    .functionDraft()
    .scopes.entries()
    .filter((scope) => scope.role !== "function")
    .map((scope) => ({ role: scope.role, scopeKey: scope.key }));

  return {
    kind: "ok",
    recordedStatements: recorder.entries,
    ssaDefinitions,
    graphStatements: context.graph
      .block(entryBlockKey)
      .statements.map((statement) => statement.key),
    scopes,
  };
}

export function lowerProofMirStatementsForTest(input: {
  readonly functionInstanceId?: MonoInstanceId;
  readonly locals?: readonly MonoLocal[];
  readonly statements: readonly MonoStatement[];
  readonly expression?: ProofMirExpressionLowerer;
  readonly lowerer?: ProofMirStatementLowerer;
}): StatementLoweringTestResult & {
  readonly graphStatementKinds: readonly string[];
} {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:test");
  const locals = input.locals ?? [];
  const body: MonoBlock = { statements: [...input.statements], sourceOrigin: "source:test" };
  const contextResult = buildLoweringContextForTest({
    functionInstanceId,
    body,
    locals,
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics, graphStatementKinds: [] };
  }

  const { context, entryBlockKey } = contextResult.value;
  const recorder = createStatementBodyRecorder();
  const lowerer =
    input.lowerer ??
    createProofMirStatementLowerer({
      expression: input.expression ?? createProofMirExpressionLowerer(),
      recorder,
    });

  for (const statement of input.statements) {
    const lowered = lowerer.lowerStatement({
      context,
      statement,
      blockKey: entryBlockKey,
    });
    if (lowered.kind === "error") {
      return { kind: "error", diagnostics: lowered.diagnostics, graphStatementKinds: [] };
    }
  }

  const snapshot = context.graph.exportGraphSnapshot();
  const graphStatementKinds = snapshot.blocks.flatMap((block) =>
    block.statements.map((statement) => statement.kind.kind),
  );

  const ssaDefinitions = recorder.entries
    .filter(
      (entry): entry is Extract<DraftRecordedProofMirStatement, { kind: "defineScalar" }> =>
        entry.kind === "defineScalar",
    )
    .map((entry) => ({
      localKey: entry.localKey,
      valueKey: entry.valueKey,
      blockKey: entry.blockKey,
    }));

  const scopes = context.graph
    .functionDraft()
    .scopes.entries()
    .filter((scope) => scope.role !== "function")
    .map((scope) => ({ role: scope.role, scopeKey: scope.key }));

  return {
    kind: "ok",
    recordedStatements: recorder.entries,
    ssaDefinitions,
    graphStatements: context.graph
      .block(entryBlockKey)
      .statements.map((statement) => statement.key),
    scopes,
    graphStatementKinds,
  };
}
