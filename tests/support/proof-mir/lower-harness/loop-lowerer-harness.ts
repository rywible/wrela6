import { hirExpressionId, hirLocalId, hirStatementId } from "../../../../src/hir/ids";
import {
  instantiatedHirId,
  instantiatedHirIdKey,
  monoInstanceId,
  type MonoInstanceId,
} from "../../../../src/mono/ids";
import type {
  MonoBlock,
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoFunctionInstance,
  MonoLocal,
  MonoLocalId,
  MonoStatement,
  MonoStatementId,
} from "../../../../src/mono/mono-hir";
import { monoStatementIdFor } from "../../../../src/mono/function-instantiator-shell";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import {
  crossedScopesForDraftEdge,
  type DraftProofMirResourceBoundarySet,
  type ProofMirDraftScopeTree,
} from "../../../../src/proof-mir/domains/effects-resources";
import type { DraftGraphTerminator } from "../../../../src/proof-mir/draft/draft-graph-builder";
import {
  type ActiveLoopFrame,
  type LoopLoweringBlockView,
  type LoopLoweringEdgeView,
  lowerInfiniteLoopStatement,
  lowerWhileStatement,
} from "../../../../src/proof-mir/lower/loop-lowerer";
import { withLoopIfStatementLowering } from "../../../../src/proof-mir/lower/loop-if-statement-lowering";
import {
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTerminalLowerer,
} from "../../../../src/proof-mir/lower/lowering-context";
import { type ProofMirFunctionScopePlaceLowerer } from "../../../../src/proof-mir/lower/scope-place-lowerer";
import { createProofMirLoweringHarnessContext, loweringOk } from "./lowering-harness-context";

export interface LoopLoweringTestSuccess {
  readonly kind: "ok";
  readonly header: LoopLoweringBlockView;
  readonly body?: LoopLoweringBlockView;
  readonly exit?: LoopLoweringBlockView;
  readonly backEdge?: LoopLoweringEdgeView;
  edgesTo(blockKey: ProofMirCanonicalKey): readonly LoopLoweringEdgeView[];
  blockTerminator(blockKey: ProofMirCanonicalKey): DraftGraphTerminator | undefined;
}

export type LoopLoweringTestResult =
  | LoopLoweringTestSuccess
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface LowerProofMirLoopForTestInput {
  readonly functionInstanceId?: MonoInstanceId;
  readonly source: readonly string[];
  readonly scalarLocals?: readonly string[];
  readonly loopCarriedLocals?: readonly string[];
  readonly placeBackedLocals?: readonly string[];
}
function crossedScopeRoles(input: {
  readonly scopeTree: ProofMirDraftScopeTree;
  readonly scopeRoleByKey: ReadonlyMap<string, string>;
  readonly sourceScopeKey: ProofMirCanonicalKey;
  readonly targetScopeKey: ProofMirCanonicalKey;
}): readonly string[] {
  const sourceRole = input.scopeRoleByKey.get(String(input.sourceScopeKey));
  const targetRole = input.scopeRoleByKey.get(String(input.targetScopeKey));
  if (sourceRole === undefined || targetRole === undefined) {
    return [];
  }
  return crossedScopesForDraftEdge(input.scopeTree, {
    from: sourceRole,
    targetRole,
  });
}
interface LoopLowererBindings {
  readonly locals: MonoLocal[];
  readonly localsByName: Map<string, MonoLocal>;
  readonly placeBackedLocalNames: ReadonlySet<string>;
}

function scalarType(): MonoCheckedType {
  return { kind: "core", coreTypeId: "u8" } as MonoCheckedType;
}

function collectLoopLowererBindings(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly scalarLocalNames: readonly string[];
  readonly placeBackedLocalNames: readonly string[];
}): LoopLowererBindings {
  const locals: MonoLocal[] = [];
  const localsByName = new Map<string, MonoLocal>();
  const placeBackedLocalNames = new Set(input.placeBackedLocalNames);
  let nextLocalIndex = 1;
  for (const name of [...input.scalarLocalNames, ...input.placeBackedLocalNames]) {
    if (localsByName.has(name)) {
      continue;
    }
    const local: MonoLocal = {
      localId: instantiatedHirId(input.functionInstanceId, hirLocalId(nextLocalIndex++)),
      name,
      type: scalarType(),
      resourceKind: placeBackedLocalNames.has(name) ? "Affine" : "Copy",
      mode: "ordinary",
      introducedBy: "sourceLet",
      sourceOrigin: `source:local:${name}`,
    };
    locals.push(local);
    localsByName.set(name, local);
  }
  return { locals, localsByName, placeBackedLocalNames };
}

function buildExpressionForLoopLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: LoopLowererBindings;
  readonly expressionText: string;
}): MonoExpression {
  let nextExpressionIndex = 1;
  function nextExpressionId(): MonoExpressionId {
    return instantiatedHirId(input.functionInstanceId, hirExpressionId(nextExpressionIndex++));
  }
  function expressionFromText(text: string, origin: string): MonoExpression {
    const trimmed = text.trim();
    const comparisonMatch = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(trimmed);
    if (comparisonMatch !== null) {
      return {
        expressionId: nextExpressionId(),
        kind: {
          kind: "comparison",
          operator: comparisonMatch[2]!,
          left: expressionFromText(comparisonMatch[1]!, origin),
          right: expressionFromText(comparisonMatch[3]!, origin),
        },
        type: { kind: "core", coreTypeId: "bool" } as MonoCheckedType,
        resourceKind: "Copy",
        sourceOrigin: origin,
      };
    }
    const binaryMatch = /^(.+?)\s*([+\-*/])\s*(.+)$/.exec(trimmed);
    if (binaryMatch !== null) {
      return {
        expressionId: nextExpressionId(),
        kind: {
          kind: "binary",
          operator: binaryMatch[2]!,
          left: expressionFromText(binaryMatch[1]!, origin),
          right: expressionFromText(binaryMatch[3]!, origin),
        },
        type: scalarType(),
        resourceKind: "Copy",
        sourceOrigin: origin,
      };
    }
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
    throw new RangeError(`Unsupported loop lowerer test expression: ${trimmed}.`);
  }
  return expressionFromText(input.expressionText, "source:expr:test");
}

function statementIdFor(functionInstanceId: MonoInstanceId, ordinal: number): MonoStatementId {
  return monoStatementIdFor(functionInstanceId, hirStatementId(ordinal));
}

function parseLoopLowererSource(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: LoopLowererBindings;
  readonly source: readonly string[];
}): {
  readonly preamble: readonly MonoStatement[];
  readonly loopStatement: MonoStatement;
  readonly postamble: readonly MonoStatement[];
} {
  let statementOrdinal = 1;
  function nextStatementId(): MonoStatementId {
    return statementIdFor(input.functionInstanceId, statementOrdinal++);
  }

  function parseBlock(
    lines: readonly string[],
    startIndex: number,
  ): {
    readonly block: MonoBlock;
    readonly nextIndex: number;
  } {
    const statements: MonoStatement[] = [];
    let index = startIndex;
    let blockIndent: number | undefined;
    while (index < lines.length) {
      const line = lines[index]!;
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        index += 1;
        continue;
      }
      const lineIndent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (blockIndent === undefined) {
        blockIndent = lineIndent;
      }
      if (index > startIndex && lineIndent < blockIndent) {
        break;
      }
      if (!/^\s/.test(line) && index > startIndex) {
        break;
      }
      if (/^else:\s*$/.test(trimmed)) {
        break;
      }
      const ifMatch = /^if\s+(.+):\s*$/.exec(trimmed);
      if (ifMatch !== null) {
        const thenParsed = parseBlock(lines, index + 1);
        index = thenParsed.nextIndex;
        let elseBlock: MonoBlock | undefined;
        if (index < lines.length && /^else:\s*$/.test(lines[index]!.trim())) {
          const elseParsed = parseBlock(lines, index + 1);
          elseBlock = elseParsed.block;
          index = elseParsed.nextIndex;
        }
        statements.push({
          statementId: nextStatementId(),
          kind: {
            kind: "if",
            statement: {
              condition: buildExpressionForLoopLowererTest({
                functionInstanceId: input.functionInstanceId,
                bindings: input.bindings,
                expressionText: ifMatch[1]!,
              }),
              thenBlock: thenParsed.block,
              ...(elseBlock === undefined ? {} : { elseBlock }),
            },
          },
          sourceOrigin: "source:stmt:if",
        });
        continue;
      }
      if (trimmed === "break") {
        statements.push({
          statementId: nextStatementId(),
          kind: { kind: "break" },
          sourceOrigin: "source:stmt:break",
        });
        index += 1;
        continue;
      }
      if (trimmed === "continue") {
        statements.push({
          statementId: nextStatementId(),
          kind: { kind: "continue" },
          sourceOrigin: "source:stmt:continue",
        });
        index += 1;
        continue;
      }
      const assignmentMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(trimmed);
      if (assignmentMatch !== null) {
        const local = input.bindings.localsByName.get(assignmentMatch[1]!);
        if (local === undefined) {
          throw new RangeError(`Unknown local in loop lowerer test source: ${assignmentMatch[1]}.`);
        }
        statements.push({
          statementId: nextStatementId(),
          kind: {
            kind: "assignment",
            statement: {
              target: buildExpressionForLoopLowererTest({
                functionInstanceId: input.functionInstanceId,
                bindings: input.bindings,
                expressionText: assignmentMatch[1]!,
              }),
              value: buildExpressionForLoopLowererTest({
                functionInstanceId: input.functionInstanceId,
                bindings: input.bindings,
                expressionText: assignmentMatch[2]!,
              }),
            },
          },
          sourceOrigin: `source:stmt:assign:${assignmentMatch[1]}`,
        });
        index += 1;
        continue;
      }
      const returnMatch = /^return\s+(.+)$/.exec(trimmed);
      if (returnMatch !== null) {
        statements.push({
          statementId: nextStatementId(),
          kind: {
            kind: "return",
            expression: buildExpressionForLoopLowererTest({
              functionInstanceId: input.functionInstanceId,
              bindings: input.bindings,
              expressionText: returnMatch[1]!,
            }),
          },
          sourceOrigin: "source:stmt:return",
        });
        index += 1;
        continue;
      }
      throw new RangeError(`Unsupported loop lowerer test statement: ${trimmed}.`);
    }
    return {
      block: { statements, sourceOrigin: "source:block" },
      nextIndex: index,
    };
  }

  const preamble: MonoStatement[] = [];
  let index = 0;
  while (index < input.source.length) {
    const line = input.source[index]!;
    const trimmed = line.trim();
    const letMatch = /^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(trimmed);
    if (letMatch !== null) {
      const local = input.bindings.localsByName.get(letMatch[1]!);
      if (local === undefined) {
        throw new RangeError(`Unknown local in loop lowerer test source: ${letMatch[1]}.`);
      }
      preamble.push({
        statementId: nextStatementId(),
        kind: {
          kind: "let",
          statement: {
            local,
            value: buildExpressionForLoopLowererTest({
              functionInstanceId: input.functionInstanceId,
              bindings: input.bindings,
              expressionText: letMatch[2]!,
            }),
          },
        },
        sourceOrigin: `source:stmt:let:${letMatch[1]}`,
      });
      index += 1;
      continue;
    }
    const whileMatch = /^while\s+(.+):\s*$/.exec(trimmed);
    if (whileMatch !== null) {
      const bodyParsed = parseBlock(input.source, index + 1);
      index = bodyParsed.nextIndex;
      const loopStatement: MonoStatement = {
        statementId: nextStatementId(),
        kind: {
          kind: "while",
          statement: {
            condition: buildExpressionForLoopLowererTest({
              functionInstanceId: input.functionInstanceId,
              bindings: input.bindings,
              expressionText: whileMatch[1]!,
            }),
            body: bodyParsed.block,
          },
        },
        sourceOrigin: "source:stmt:while",
      };
      const postamble: MonoStatement[] = [];
      while (index < input.source.length) {
        const postLine = input.source[index]!.trim();
        const returnMatch = /^return\s+(.+)$/.exec(postLine);
        if (returnMatch !== null) {
          postamble.push({
            statementId: nextStatementId(),
            kind: {
              kind: "return",
              expression: buildExpressionForLoopLowererTest({
                functionInstanceId: input.functionInstanceId,
                bindings: input.bindings,
                expressionText: returnMatch[1]!,
              }),
            },
            sourceOrigin: "source:stmt:return",
          });
          index += 1;
          continue;
        }
        throw new RangeError(`Unsupported loop lowerer test postamble: ${postLine}.`);
      }
      return { preamble, loopStatement, postamble };
    }
    const loopMatch = /^loop:\s*$/.exec(trimmed);
    if (loopMatch !== null) {
      const bodyParsed = parseBlock(input.source, index + 1);
      index = bodyParsed.nextIndex;
      const loopStatement: MonoStatement = {
        statementId: nextStatementId(),
        kind: {
          kind: "loop",
          body: bodyParsed.block,
        },
        sourceOrigin: "source:stmt:loop",
      };
      const postamble: MonoStatement[] = [];
      while (index < input.source.length) {
        const postLine = input.source[index]!.trim();
        const returnMatch = /^return\s+(.+)$/.exec(postLine);
        if (returnMatch !== null) {
          postamble.push({
            statementId: nextStatementId(),
            kind: {
              kind: "return",
              expression: buildExpressionForLoopLowererTest({
                functionInstanceId: input.functionInstanceId,
                bindings: input.bindings,
                expressionText: returnMatch[1]!,
              }),
            },
            sourceOrigin: "source:stmt:return",
          });
          index += 1;
          continue;
        }
        throw new RangeError(`Unsupported loop lowerer test postamble: ${postLine}.`);
      }
      return { preamble, loopStatement, postamble };
    }
    throw new RangeError(`Unsupported loop lowerer test preamble: ${trimmed}.`);
  }
  throw new RangeError("Loop lowerer test source must include a loop statement.");
}

function functionInstanceForLoopLowererTest(input: {
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

function buildScopeRoleByKey(
  scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer,
  rootScopeKey: ProofMirCanonicalKey,
): ReadonlyMap<string, string> {
  const scopeRoleByKey = new Map<string, string>();
  scopeRoleByKey.set(String(rootScopeKey), "function");
  for (const entry of scopePlaceLowerer.scopeEntries) {
    scopeRoleByKey.set(String(scopePlaceLowerer.scopeTree.scopeKey(entry.role)), entry.role);
  }
  return scopeRoleByKey;
}

function buildLoopLoweringTestContext(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly locals: readonly MonoLocal[];
  readonly body: MonoBlock;
  readonly placeBackedLocalNames: ReadonlySet<string>;
}): ProofMirLoweringResult<{
  readonly context: ProofMirLoweringContext;
  readonly entryBlockKey: ProofMirCanonicalKey;
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
  readonly scopeRoleByKey: ReadonlyMap<string, string>;
}> {
  const harnessResult = createProofMirLoweringHarnessContext({
    functionInstanceId: input.functionInstanceId,
    functionInstance: functionInstanceForLoopLowererTest({
      functionInstanceId: input.functionInstanceId,
      locals: input.locals,
      body: input.body,
    }),
    locals: input.locals,
    placeBackedLocalNames: input.placeBackedLocalNames,
  });
  if (harnessResult.kind === "error") {
    return harnessResult;
  }

  const { context, registry, entryBlockKey, scopePlaceLowerer } = harnessResult.value;
  const scopeRoleByKey = buildScopeRoleByKey(scopePlaceLowerer, context.graph.rootScopeKey());

  return loweringOk({
    context,
    entryBlockKey,
    expressionLowerer: registry.expression,
    statementLowerer: registry.statement,
    terminalLowerer: registry.terminal,
    scopePlaceLowerer,
    scopeRoleByKey,
  });
}

function resolveLoopCarriedLocals(
  bindings: LoopLowererBindings,
  loopCarriedNames: readonly string[] | undefined,
): readonly MonoLocal[] {
  if (loopCarriedNames === undefined) {
    return [];
  }
  return loopCarriedNames
    .map((name) => bindings.localsByName.get(name))
    .filter((local): local is MonoLocal => local !== undefined);
}

function buildLoopLoweringTestSuccess(input: {
  readonly context: ProofMirLoweringContext;
  readonly scopeTree: ProofMirDraftScopeTree;
  readonly scopeRoleByKey: ReadonlyMap<string, string>;
  readonly loopResult: {
    readonly headerBlockKey: ProofMirCanonicalKey;
    readonly bodyBlockKey: ProofMirCanonicalKey;
    readonly exitBlockKey: ProofMirCanonicalKey;
    readonly backEdgeKey?: ProofMirCanonicalKey;
    readonly boundaryResources: DraftProofMirResourceBoundarySet;
  };
}): LoopLoweringTestSuccess {
  const graph = input.context.graph;
  const ssa = input.context.ssa;

  function edgeView(edgeKey: ProofMirCanonicalKey): LoopLoweringEdgeView {
    const edge = graph.edge(edgeKey);
    return {
      edgeKey,
      kind: edge.kind,
      arguments: edge.argumentKeys,
      crossedScopes: crossedScopeRoles({
        scopeTree: input.scopeTree,
        scopeRoleByKey: input.scopeRoleByKey,
        sourceScopeKey: edge.sourceScopeKey,
        targetScopeKey: edge.targetScopeKey,
      }),
    };
  }

  function blockView(
    blockKey: ProofMirCanonicalKey,
    kind: LoopLoweringBlockView["kind"],
    boundaryResources?: DraftProofMirResourceBoundarySet,
  ): LoopLoweringBlockView {
    return {
      blockKey,
      kind,
      parameters: ssa.blockParameters(blockKey).map((parameter) => ({
        parameterKind: { kind: parameter.parameterKind },
        predeclared: parameter.predeclared,
      })),
      ...(boundaryResources === undefined ? {} : { boundaryResources }),
    };
  }

  function edgesTo(blockKey: ProofMirCanonicalKey): readonly LoopLoweringEdgeView[] {
    const edges: LoopLoweringEdgeView[] = [];
    for (const edgeKey of graph
      .functionDraft()
      .controlEdges.entries()
      .map((entry) => entry.key)) {
      const edge = graph.edge(edgeKey);
      if (edge.toBlockKey === blockKey) {
        edges.push(edgeView(edgeKey));
      }
    }
    edges.sort((left, right) => String(left.edgeKey).localeCompare(String(right.edgeKey)));
    return edges;
  }

  const backEdgeKey =
    input.loopResult.backEdgeKey ??
    graph
      .functionDraft()
      .controlEdges.entries()
      .map((entry) => entry.key)
      .find((edgeKey) => {
        const edge = graph.edge(edgeKey);
        return (
          edge.fromBlockKey === input.loopResult.bodyBlockKey &&
          edge.toBlockKey === input.loopResult.headerBlockKey
        );
      });

  return {
    kind: "ok",
    header: blockView(
      input.loopResult.headerBlockKey,
      "loopHeader",
      input.loopResult.boundaryResources,
    ),
    body: blockView(input.loopResult.bodyBlockKey, "loopBody"),
    exit: blockView(input.loopResult.exitBlockKey, "loopExit"),
    ...(backEdgeKey === undefined ? {} : { backEdge: edgeView(backEdgeKey) }),
    edgesTo,
    blockTerminator(blockKey: ProofMirCanonicalKey) {
      return graph.block(blockKey).terminator;
    },
  };
}

export function lowerProofMirLoopForTest(
  input: LowerProofMirLoopForTestInput,
): LoopLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:loop-test");
  const scalarLocals = input.scalarLocals ?? [];
  const placeBackedLocals = input.placeBackedLocals ?? [];
  const bindings = collectLoopLowererBindings({
    functionInstanceId,
    scalarLocalNames: scalarLocals,
    placeBackedLocalNames: placeBackedLocals,
  });
  const parsed = parseLoopLowererSource({
    functionInstanceId,
    bindings,
    source: input.source,
  });
  const body: MonoBlock = {
    statements: [...parsed.preamble, parsed.loopStatement, ...parsed.postamble],
    sourceOrigin: "source:function:body",
  };

  const contextResult = buildLoopLoweringTestContext({
    functionInstanceId,
    locals: bindings.locals,
    body,
    placeBackedLocalNames: bindings.placeBackedLocalNames,
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics };
  }

  const {
    context,
    entryBlockKey,
    expressionLowerer,
    statementLowerer,
    terminalLowerer,
    scopePlaceLowerer,
    scopeRoleByKey,
  } = contextResult.value;

  const continuationBlockKey = context.graph.createBlock({
    role: "continuation",
    scope: context.graph.rootScopeKey(),
    origin: context.graph.allocateSyntheticOrigin("continuation"),
  });
  context.ssa.registerBlock(continuationBlockKey);

  const loopCarriedLocals = resolveLoopCarriedLocals(bindings, input.loopCarriedLocals);
  const placeBackedLocalList = bindings.locals.filter((local) =>
    bindings.placeBackedLocalNames.has(local.name),
  );
  const loopCarriedLocalsByStatementId = new Map<string, readonly MonoLocal[]>([
    [instantiatedHirIdKey(parsed.loopStatement.statementId), loopCarriedLocals],
  ]);

  const activeLoopRef: { frame?: ActiveLoopFrame } = {};
  const shared = withLoopIfStatementLowering({
    scopeRoleByKey,
    expression: expressionLowerer,
    statementLowerer,
    terminalLowerer,
    activeLoopRef,
  });

  let currentBlockKey = entryBlockKey;
  for (const statement of parsed.preamble) {
    if (statement.kind.kind === "let") {
      const lowered = statementLowerer.lowerStatement({
        context,
        statement,
        blockKey: currentBlockKey,
      });
      if (lowered.kind === "error") {
        return { kind: "error", diagnostics: lowered.diagnostics };
      }
      continue;
    }
    const lowered = statementLowerer.lowerStatement({
      context,
      statement,
      blockKey: currentBlockKey,
    });
    if (lowered.kind === "error") {
      return { kind: "error", diagnostics: lowered.diagnostics };
    }
  }

  let loopResult:
    | {
        readonly headerBlockKey: ProofMirCanonicalKey;
        readonly bodyBlockKey: ProofMirCanonicalKey;
        readonly exitBlockKey: ProofMirCanonicalKey;
        readonly backEdgeKey?: ProofMirCanonicalKey;
        readonly boundaryResources: DraftProofMirResourceBoundarySet;
      }
    | undefined;

  switch (parsed.loopStatement.kind.kind) {
    case "while": {
      const lowered = lowerWhileStatement({
        context,
        statement: parsed.loopStatement,
        whileStatement: parsed.loopStatement.kind.statement,
        blockKey: currentBlockKey,
        continuationBlockKey,
        shared,
        loopCarriedLocals,
        placeBackedLocals: placeBackedLocalList,
      });
      if (lowered.kind === "error") {
        return { kind: "error", diagnostics: lowered.diagnostics };
      }
      currentBlockKey = lowered.value.afterBlockKey;
      loopResult = lowered.value;
      break;
    }
    case "loop": {
      const lowered = lowerInfiniteLoopStatement({
        context,
        statement: parsed.loopStatement,
        body: parsed.loopStatement.kind.body,
        blockKey: currentBlockKey,
        continuationBlockKey,
        shared,
        loopCarriedLocals,
        placeBackedLocals: placeBackedLocalList,
      });
      if (lowered.kind === "error") {
        return { kind: "error", diagnostics: lowered.diagnostics };
      }
      currentBlockKey = lowered.value.afterBlockKey;
      loopResult = lowered.value;
      break;
    }
    default:
      return {
        kind: "error",
        diagnostics: [
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
            message: "Loop lowerer test source must contain a while or loop statement.",
            functionInstanceId,
            ownerKey: `function:${String(functionInstanceId)}`,
            rootCauseKey: "loop-statement",
            stableDetail: parsed.loopStatement.kind.kind,
          }),
        ],
      };
  }

  void loopCarriedLocalsByStatementId;

  for (const statement of parsed.postamble) {
    const lowered = terminalLowerer.lowerReturn({
      context,
      expression: statement.kind.kind === "return" ? statement.kind.expression : undefined,
      blockKey: currentBlockKey,
      terminal: false,
    });
    if (lowered.kind === "error") {
      return { kind: "error", diagnostics: lowered.diagnostics };
    }
  }

  if (loopResult === undefined) {
    return {
      kind: "error",
      diagnostics: [
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
          message: "Loop lowering did not produce a loop result.",
          functionInstanceId,
          ownerKey: `function:${String(functionInstanceId)}`,
          rootCauseKey: "loop-result",
          stableDetail: "missing",
        }),
      ],
    };
  }

  return buildLoopLoweringTestSuccess({
    context,
    scopeTree: scopePlaceLowerer.scopeTree,
    scopeRoleByKey,
    loopResult,
  });
}
