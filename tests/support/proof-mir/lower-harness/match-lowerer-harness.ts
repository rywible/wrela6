import {
  hirExpressionId,
  hirLocalId,
  hirStatementId,
  type FactOriginId,
} from "../../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../../src/mono/ids";
import type {
  MonoBlock,
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoLocal,
  MonoLocalId,
  MonoMatchArm,
  MonoStatement,
  MonoStatementId,
  MonoTypeInstance,
} from "../../../../src/mono/mono-hir";
import type { MonomorphizedHirProgram } from "../../../../src/mono/mono-hir";
import { monoStatementIdFor } from "../../../../src/mono/function-instantiator-shell";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../../../../src/proof-mir/diagnostics";
import {
  crossedScopesForDraftEdge,
  type ProofMirDraftScopeTree,
} from "../../../../src/proof-mir/domains/effects-resources";
import { type DraftProofMirFact } from "../../../../src/proof-mir/domains/fact-recording";
import {
  type DraftGraphEdgeView,
  type DraftGraphTerminator,
} from "../../../../src/proof-mir/draft/draft-graph-builder";
import {
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTerminalLowerer,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import { type ProofMirFunctionScopePlaceLowerer } from "../../../../src/proof-mir/lower/scope-place-lowerer";
import { createProofMirLoweringHarnessContext, loweringOk } from "./lowering-harness-context";
import {
  lowerMatchStatement,
  type MatchLoweringArmView,
  type MatchLoweringEdgeView,
} from "../../../../src/proof-mir/lower/match-lowerer";
import {
  createLoweringIdAllocator,
  type ProofMirLoweringIdAllocator,
} from "../../../../src/proof-mir/lower/expression-lowerer-helpers";

interface NormalizedMatchCase {
  readonly pattern: string;
  readonly bindingLocals: readonly string[];
  readonly body: readonly string[];
}

interface MatchLowererBindings {
  readonly locals: readonly MonoLocal[];
  readonly localsByName: Map<string, MonoLocal>;
}

function scalarType(): MonoCheckedType {
  return { kind: "core", coreTypeId: "u8" } as MonoCheckedType;
}

function collectMatchLowererBindings(
  functionInstanceId: MonoInstanceId,
  scalarLocalNames: readonly string[],
  localTypes?: ReadonlyMap<string, MonoCheckedType>,
): MatchLowererBindings {
  const locals: MonoLocal[] = [];
  const localsByName = new Map<string, MonoLocal>();
  let nextLocalIndex = 1;
  for (const name of scalarLocalNames) {
    const local: MonoLocal = {
      localId: instantiatedHirId(functionInstanceId, hirLocalId(nextLocalIndex++)),
      name,
      type: localTypes?.get(name) ?? scalarType(),
      resourceKind: "Copy",
      mode: "ordinary",
      introducedBy: "sourceLet",
      sourceOrigin: `source:local:${name}`,
    };
    locals.push(local);
    localsByName.set(name, local);
  }
  return { locals, localsByName };
}

function normalizeMatchCases(
  cases: readonly LowerProofMirMatchCaseInput[],
): readonly NormalizedMatchCase[] {
  return cases.map((caseInput) => {
    if (typeof caseInput === "string") {
      return { pattern: caseInput, bindingLocals: [], body: [] };
    }
    return {
      pattern: caseInput.pattern,
      bindingLocals: caseInput.bindingLocals ?? [],
      body: caseInput.body ?? [],
    };
  });
}

function buildExpressionForMatchLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: MatchLowererBindings;
  readonly expressionText: string;
}): MonoExpression {
  let nextExpressionIndex = 1;
  function nextExpressionId(): MonoExpressionId {
    return instantiatedHirId(input.functionInstanceId, hirExpressionId(nextExpressionIndex++));
  }
  function expressionFromText(text: string, origin: string): MonoExpression {
    const trimmed = text.trim();
    const integerMatch = /^[0-9]+$/.exec(trimmed);
    if (integerMatch !== null) {
      return {
        expressionId: nextExpressionId(),
        kind: { kind: "literal", literal: { kind: "integer", text: trimmed } },
        type: scalarType(),
        resourceKind: "Copy",
        sourceOrigin: origin,
      };
    }
    const local = input.bindings.localsByName.get(trimmed);
    if (local !== undefined) {
      return {
        expressionId: nextExpressionId(),
        kind: { kind: "name", name: local.name, localId: local.localId },
        type: local.type,
        resourceKind: local.resourceKind,
        sourceOrigin: origin,
      };
    }
    throw new RangeError(`Unsupported match lowerer test expression: ${trimmed}.`);
  }
  return expressionFromText(input.expressionText, "source:expr:test");
}

function statementIdFor(functionInstanceId: MonoInstanceId, ordinal: number): MonoStatementId {
  return monoStatementIdFor(functionInstanceId, hirStatementId(ordinal));
}

function parseMatchLowererSource(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: MatchLowererBindings;
  readonly scrutinee: string;
  readonly cases: readonly NormalizedMatchCase[];
  readonly postamble: readonly string[];
}): {
  readonly body: MonoBlock;
  readonly matchStatement: MonoStatement;
} {
  let statementOrdinal = 1;
  function nextStatementId(): MonoStatementId {
    return statementIdFor(input.functionInstanceId, statementOrdinal++);
  }

  function parseStatements(lines: readonly string[]): MonoStatement[] {
    const statements: MonoStatement[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const returnMatch = /^return\s+(.+)$/.exec(trimmed);
      if (returnMatch !== null) {
        statements.push({
          statementId: nextStatementId(),
          kind: {
            kind: "return",
            expression: buildExpressionForMatchLowererTest({
              functionInstanceId: input.functionInstanceId,
              bindings: input.bindings,
              expressionText: returnMatch[1]!,
            }),
          },
          sourceOrigin: "source:stmt:return",
        });
        continue;
      }
      throw new RangeError(`Unsupported match lowerer test statement: ${trimmed}.`);
    }
    return statements;
  }

  const scrutineeLocal = input.bindings.localsByName.get(input.scrutinee);
  if (scrutineeLocal === undefined) {
    throw new RangeError(`Unknown scrutinee local: ${input.scrutinee}.`);
  }
  const scrutineeExpression: MonoExpression = {
    expressionId: instantiatedHirId(input.functionInstanceId, hirExpressionId(1)),
    kind: { kind: "name", name: scrutineeLocal.name, localId: scrutineeLocal.localId },
    type: scrutineeLocal.type,
    resourceKind: scrutineeLocal.resourceKind,
    sourceOrigin: "source:expr:scrutinee",
  };

  const arms: MonoMatchArm[] = input.cases.map((caseEntry, index) => {
    const bindingLocals = caseEntry.bindingLocals.map((name) => {
      const local = input.bindings.localsByName.get(name);
      if (local === undefined) {
        throw new RangeError(`Unknown binding local: ${name}.`);
      }
      return local;
    });
    return {
      patternText: caseEntry.pattern,
      body: {
        statements: parseStatements(caseEntry.body),
        sourceOrigin: `source:match:arm:${index}`,
      },
      bindingLocals,
      sourceOrigin: `source:match:arm:${index}`,
    };
  });

  const matchStatement: MonoStatement = {
    statementId: nextStatementId(),
    kind: {
      kind: "match",
      statement: {
        scrutinee: scrutineeExpression,
        arms,
      },
    },
    sourceOrigin: "source:stmt:match",
  };

  const body: MonoBlock = {
    statements: [matchStatement, ...parseStatements(input.postamble)],
    sourceOrigin: "source:body",
  };

  return { body, matchStatement };
}

function functionInstanceForMatchLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly locals: readonly MonoLocal[];
  readonly body: MonoBlock;
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

function programForMatchLowererTest(types: readonly MonoTypeInstance[]): MonomorphizedHirProgram {
  return {
    types: {
      entries: () => types,
      get: (instanceId: MonoInstanceId) =>
        types.find((typeInstance) => typeInstance.instanceId === instanceId),
    },
    functions: { entries: () => [], get: () => undefined },
    proofMetadata: {
      factOrigins: { entries: () => [], get: () => undefined },
      resourcePlaces: { entries: () => [], get: () => undefined },
    },
  } as unknown as MonomorphizedHirProgram;
}

export interface MatchLoweringTestSuccess {
  readonly kind: "ok";
  readonly context: ProofMirLoweringContext;
  readonly scopeTree: ProofMirDraftScopeTree;
  readonly switch?: {
    readonly terminator: DraftGraphTerminator;
    readonly cases: readonly MatchLoweringEdgeView[];
    readonly fallback?: MatchLoweringEdgeView;
  };
  readonly arms: readonly MatchLoweringArmView[];
  readonly continuation?: { readonly blockKey: ProofMirCanonicalKey };
  edgesTo(blockKey: ProofMirCanonicalKey): readonly MatchLoweringEdgeView[];
  scopeRoleForBlock(blockKey: ProofMirCanonicalKey): string | undefined;
  factForKey(factKey: ProofMirCanonicalKey): DraftProofMirFact | undefined;
}

export type MatchLoweringTestResult =
  | MatchLoweringTestSuccess
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export type LowerProofMirMatchCaseInput =
  | string
  | {
      readonly pattern: string;
      readonly bindingLocals?: readonly string[];
      readonly body?: readonly string[];
    };

export interface LowerProofMirMatchForTestInput {
  readonly functionInstanceId?: MonoInstanceId;
  readonly scrutinee: string;
  readonly scrutineeType?: MonoCheckedType;
  readonly cases: readonly LowerProofMirMatchCaseInput[];
  readonly monoExhaustive?: boolean;
  readonly scalarLocals?: readonly string[];
  readonly postamble?: readonly string[];
  readonly programTypes?: readonly MonoTypeInstance[];
  readonly matchRefinements?: readonly {
    readonly caseLabel: string;
    readonly originId: MonoInstantiatedProofId<FactOriginId>;
  }[];
}

function roleForBlockScopeKey(
  scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer,
  scopeKey: ProofMirCanonicalKey,
): string | undefined {
  for (const entry of scopePlaceLowerer.scopeEntries) {
    if (scopePlaceLowerer.scopeTree.scopeKey(entry.role) === scopeKey) {
      return entry.role;
    }
  }
  return undefined;
}

function buildMatchLoweringTestContext(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly locals: readonly MonoLocal[];
  readonly body: MonoBlock;
  readonly programTypes: readonly MonoTypeInstance[];
}): ProofMirLoweringResult<{
  readonly context: ProofMirLoweringContext;
  readonly scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
  readonly entryBlockKey: ProofMirCanonicalKey;
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly idAllocator: ProofMirLoweringIdAllocator;
}> {
  const harnessResult = createProofMirLoweringHarnessContext({
    functionInstanceId: input.functionInstanceId,
    functionInstance: functionInstanceForMatchLowererTest({
      functionInstanceId: input.functionInstanceId,
      locals: input.locals,
      body: input.body,
    }),
    locals: input.locals,
    program: programForMatchLowererTest(input.programTypes),
    collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
    placeBackedLocals: emptyPlaceBackedLocals,
  });
  if (harnessResult.kind === "error") {
    return harnessResult;
  }

  const { context, registry, entryBlockKey, scopePlaceLowerer } = harnessResult.value;

  return loweringOk({
    context,
    scopePlaceLowerer,
    entryBlockKey,
    expressionLowerer: registry.expression,
    statementLowerer: registry.statement,
    terminalLowerer: registry.terminal,
    idAllocator: createLoweringIdAllocator(),
  });
}

function buildMatchLoweringTestSuccess(input: {
  readonly context: ProofMirLoweringContext;
  readonly scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly matchResult: {
    readonly switchTerminator: DraftGraphTerminator;
    readonly caseEdges: readonly { readonly label: string; readonly edge: DraftGraphEdgeView }[];
    readonly fallbackEdge?: DraftGraphEdgeView;
    readonly arms: readonly MatchLoweringArmView[];
  };
}): MatchLoweringTestSuccess {
  const graph = input.context.graph;
  const factRecorder = input.context.factRecorder;
  const scopePlaceLowerer = input.scopePlaceLowerer;

  function edgeView(edge: DraftGraphEdgeView): MatchLoweringEdgeView {
    const fromRole = roleForBlockScopeKey(
      scopePlaceLowerer,
      graph.block(edge.fromBlockKey).scopeKey,
    );
    const toRole =
      edge.toBlockKey === undefined
        ? undefined
        : roleForBlockScopeKey(scopePlaceLowerer, graph.block(edge.toBlockKey).scopeKey);
    const crossedScopeRoles =
      fromRole === undefined || toRole === undefined
        ? []
        : crossedScopesForDraftEdge(scopePlaceLowerer.scopeTree, {
            from: fromRole,
            targetRole: toRole,
          });
    return {
      edgeKey: edge.key,
      kind: edge.kind,
      factKeys: edge.factKeys,
      fromBlockKey: edge.fromBlockKey,
      toBlockKey: edge.toBlockKey,
      crossedScopeRoles,
    };
  }

  function edgesTo(blockKey: ProofMirCanonicalKey): readonly MatchLoweringEdgeView[] {
    const edges: MatchLoweringEdgeView[] = [];
    for (const edgeKey of graph
      .functionDraft()
      .controlEdges.entries()
      .map((entry) => entry.key)) {
      const edge = graph.edge(edgeKey);
      if (edge.toBlockKey === blockKey) {
        edges.push(edgeView(edge));
      }
    }
    edges.sort((left, right) => String(left.edgeKey).localeCompare(String(right.edgeKey)));
    return edges;
  }

  const switchTerminator = input.matchResult.switchTerminator;
  return {
    kind: "ok",
    context: input.context,
    scopeTree: scopePlaceLowerer.scopeTree,
    ...(switchTerminator.kind === "switch"
      ? {
          switch: {
            terminator: switchTerminator,
            cases: input.matchResult.caseEdges.map((caseEntry) => edgeView(caseEntry.edge)),
            ...(input.matchResult.fallbackEdge === undefined
              ? {}
              : { fallback: edgeView(input.matchResult.fallbackEdge) }),
          },
        }
      : {}),
    arms: input.matchResult.arms,
    continuation: { blockKey: input.continuationBlockKey },
    edgesTo,
    scopeRoleForBlock(blockKey: ProofMirCanonicalKey) {
      return roleForBlockScopeKey(scopePlaceLowerer, graph.block(blockKey).scopeKey);
    },
    factForKey(factKey: ProofMirCanonicalKey) {
      return factRecorder.draftFact(factKey);
    },
  };
}

export function lowerProofMirMatchForTest(
  input: LowerProofMirMatchForTestInput,
): MatchLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:match-test");
  const scalarLocals = input.scalarLocals ?? [input.scrutinee];
  const normalizedCases = normalizeMatchCases(input.cases);
  const localNames = new Set(scalarLocals);
  for (const caseEntry of normalizedCases) {
    for (const bindingLocal of caseEntry.bindingLocals) {
      localNames.add(bindingLocal);
    }
  }
  const localTypes = new Map<string, MonoCheckedType>();
  if (input.scrutineeType !== undefined) {
    localTypes.set(input.scrutinee, input.scrutineeType);
  }
  const bindings = collectMatchLowererBindings(functionInstanceId, [...localNames], localTypes);
  const parsed = parseMatchLowererSource({
    functionInstanceId,
    bindings,
    scrutinee: input.scrutinee,
    cases: normalizedCases,
    postamble: input.postamble ?? [],
  });

  const contextResult = buildMatchLoweringTestContext({
    functionInstanceId,
    locals: bindings.locals,
    body: parsed.body,
    programTypes: input.programTypes ?? [],
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics };
  }

  const {
    context,
    scopePlaceLowerer,
    entryBlockKey,
    expressionLowerer,
    statementLowerer,
    terminalLowerer,
    idAllocator,
  } = contextResult.value;
  const continuationBlockKey = context.graph.createBlock({
    role: "continuation",
    scope: context.graph.rootScopeKey(),
    origin: context.graph.allocateSyntheticOrigin("continuation"),
  });
  context.ssa.registerBlock(continuationBlockKey);

  if (parsed.matchStatement.kind.kind !== "match") {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
          message: "Match lowerer test source did not produce a match statement.",
          functionInstanceId,
          ownerKey: `function:${String(functionInstanceId)}`,
          rootCauseKey: "match-test",
          stableDetail: parsed.matchStatement.kind.kind,
        }),
      ]),
    };
  }

  const lowered = lowerMatchStatement({
    context,
    scopePlaceLowerer,
    statement: parsed.matchStatement,
    matchStatement: parsed.matchStatement.kind.statement,
    blockKey: entryBlockKey,
    expression: expressionLowerer,
    statementLowerer,
    terminalLowerer,
    continuationBlockKey,
    idAllocator,
    monoExhaustiveOverride: input.monoExhaustive,
    matchRefinements: input.matchRefinements,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  return buildMatchLoweringTestSuccess({
    context,
    scopePlaceLowerer,
    continuationBlockKey,
    matchResult: lowered.value,
  });
}
