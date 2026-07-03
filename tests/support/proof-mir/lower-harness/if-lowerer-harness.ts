import { hirExpressionId, hirLocalId, hirStatementId } from "../../../../src/hir/ids";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../../src/mono/ids";
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
import { type ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import type { DraftGraphTerminator } from "../../../../src/proof-mir/draft/draft-graph-builder";
import type { DraftProofMirFact } from "../../../../src/proof-mir/domains/fact-recording";
import {
  createProofMirControlFlowLowerer,
  lowerIfStatement,
  type IfLoweringBlockParameterView,
  type IfLoweringEdgeView,
} from "../../../../src/proof-mir/lower/if-lowerer";
import {
  type ProofMirControlFlowLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTerminalLowerer,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import { createProofMirLoweringHarnessContext, loweringOk } from "./lowering-harness-context";
import {
  createLoweringIdAllocator,
  type ProofMirLoweringIdAllocator,
} from "../../../../src/proof-mir/lower/expression-lowerer-helpers";

interface IfLowererBindings {
  readonly locals: MonoLocal[];
  readonly localsByName: Map<string, MonoLocal>;
}

export interface IfLoweringTestSuccess {
  readonly kind: "ok";
  readonly branch?: {
    readonly terminator?: DraftGraphTerminator;
    readonly whenTrue: IfLoweringEdgeView;
    readonly whenFalse: IfLoweringEdgeView;
  };
  readonly thenBranch?: { readonly blockKey: ProofMirCanonicalKey };
  readonly else?: { readonly blockKey: ProofMirCanonicalKey };
  readonly join?: {
    readonly blockKey: ProofMirCanonicalKey;
    readonly parameters: readonly IfLoweringBlockParameterView[];
  };
  readonly continuation?: { readonly blockKey: ProofMirCanonicalKey };
  edgesTo(blockKey: ProofMirCanonicalKey): readonly IfLoweringEdgeView[];
  blockTerminator(blockKey: ProofMirCanonicalKey): DraftGraphTerminator | undefined;
  factForKey(factKey: ProofMirCanonicalKey): DraftProofMirFact | undefined;
}

export type IfLoweringTestResult =
  | IfLoweringTestSuccess
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface LowerProofMirIfStatementForTestInput {
  readonly functionInstanceId?: MonoInstanceId;
  readonly source: readonly string[];
  readonly scalarLocals: readonly string[];
}
function scalarType(): MonoCheckedType {
  return { kind: "core", coreTypeId: "u8" } as MonoCheckedType;
}

function collectIfLowererBindings(
  functionInstanceId: MonoInstanceId,
  scalarLocalNames: readonly string[],
): IfLowererBindings {
  const locals: MonoLocal[] = [];
  const localsByName = new Map<string, MonoLocal>();
  let nextLocalIndex = 1;
  for (const name of scalarLocalNames) {
    const local: MonoLocal = {
      localId: instantiatedHirId(functionInstanceId, hirLocalId(nextLocalIndex++)),
      name,
      type: scalarType(),
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

function buildExpressionForIfLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: IfLowererBindings;
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
    throw new RangeError(`Unsupported if lowerer test expression: ${trimmed}.`);
  }
  return expressionFromText(input.expressionText, "source:expr:test");
}

function statementIdFor(functionInstanceId: MonoInstanceId, ordinal: number): MonoStatementId {
  return monoStatementIdFor(functionInstanceId, hirStatementId(ordinal));
}

function parseIfLowererSource(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: IfLowererBindings;
  readonly source: readonly string[];
}): {
  readonly preamble: readonly MonoStatement[];
  readonly ifStatement: MonoStatement;
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
    while (index < lines.length) {
      const line = lines[index]!;
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        index += 1;
        continue;
      }
      if (!/^\s/.test(line) && index > startIndex) {
        break;
      }
      if (/^else:\s*$/.test(trimmed)) {
        break;
      }
      const assignmentMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(trimmed);
      if (assignmentMatch !== null) {
        const local = input.bindings.localsByName.get(assignmentMatch[1]!);
        if (local === undefined) {
          throw new RangeError(`Unknown local in if lowerer test source: ${assignmentMatch[1]}.`);
        }
        statements.push({
          statementId: nextStatementId(),
          kind: {
            kind: "assignment",
            statement: {
              target: buildExpressionForIfLowererTest({
                functionInstanceId: input.functionInstanceId,
                bindings: input.bindings,
                expressionText: assignmentMatch[1]!,
              }),
              value: buildExpressionForIfLowererTest({
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
            expression: buildExpressionForIfLowererTest({
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
      throw new RangeError(`Unsupported if lowerer test statement: ${trimmed}.`);
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
        throw new RangeError(`Unknown local in if lowerer test source: ${letMatch[1]}.`);
      }
      preamble.push({
        statementId: nextStatementId(),
        kind: {
          kind: "let",
          statement: {
            local,
            value: buildExpressionForIfLowererTest({
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
    const ifMatch = /^if\s+(.+):\s*$/.exec(trimmed);
    if (ifMatch !== null) {
      const thenParsed = parseBlock(input.source, index + 1);
      index = thenParsed.nextIndex;
      let elseBlock: MonoBlock | undefined;
      if (index < input.source.length && /^else:\s*$/.test(input.source[index]!.trim())) {
        const elseParsed = parseBlock(input.source, index + 1);
        elseBlock = elseParsed.block;
        index = elseParsed.nextIndex;
      }
      const ifStatement: MonoStatement = {
        statementId: nextStatementId(),
        kind: {
          kind: "if",
          statement: {
            condition: buildExpressionForIfLowererTest({
              functionInstanceId: input.functionInstanceId,
              bindings: input.bindings,
              expressionText: ifMatch[1]!,
            }),
            thenBlock: thenParsed.block,
            ...(elseBlock === undefined ? {} : { elseBlock }),
          },
        },
        sourceOrigin: "source:stmt:if",
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
              expression: buildExpressionForIfLowererTest({
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
        throw new RangeError(`Unsupported if lowerer test postamble: ${postLine}.`);
      }
      return { preamble, ifStatement, postamble };
    }
    throw new RangeError(`Unsupported if lowerer test preamble: ${trimmed}.`);
  }
  throw new RangeError("If lowerer test source must include an if statement.");
}

function functionInstanceForIfLowererTest(input: {
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

function buildIfLoweringTestContext(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly locals: readonly MonoLocal[];
  readonly body: MonoBlock;
}): ProofMirLoweringResult<{
  readonly context: ProofMirLoweringContext;
  readonly entryBlockKey: ProofMirCanonicalKey;
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly idAllocator: ProofMirLoweringIdAllocator;
}> {
  const harnessResult = createProofMirLoweringHarnessContext({
    functionInstanceId: input.functionInstanceId,
    functionInstance: functionInstanceForIfLowererTest({
      functionInstanceId: input.functionInstanceId,
      locals: input.locals,
      body: input.body,
    }),
    locals: input.locals,
    collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
    placeBackedLocals: emptyPlaceBackedLocals,
  });
  if (harnessResult.kind === "error") {
    return harnessResult;
  }

  const { context, registry, entryBlockKey } = harnessResult.value;

  return loweringOk({
    context,
    entryBlockKey,
    expressionLowerer: registry.expression,
    statementLowerer: registry.statement,
    terminalLowerer: registry.terminal,
    idAllocator: createLoweringIdAllocator(),
  });
}

function dispatchStatementForIfTest(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly statementLowerer: ProofMirStatementLowerer;
  readonly terminalLowerer: ProofMirTerminalLowerer;
  readonly controlFlowLowerer: ProofMirControlFlowLowerer;
  readonly idAllocator: ProofMirLoweringIdAllocator;
  readonly scalarLocals: readonly MonoLocal[];
  readonly continuationBlockKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<{
  readonly blockKey: ProofMirCanonicalKey;
  readonly ifResult?: ReturnType<typeof lowerIfStatement> extends ProofMirLoweringResult<
    infer Value
  >
    ? Value
    : never;
}> {
  switch (input.statement.kind.kind) {
    case "if": {
      const lowered = lowerIfStatement({
        context: input.context,
        statement: input.statement,
        ifStatement: input.statement.kind.statement,
        blockKey: input.blockKey,
        expression: input.expressionLowerer,
        statementLowerer: input.statementLowerer,
        terminalLowerer: input.terminalLowerer,
        continuationBlockKey: input.continuationBlockKey,
        idAllocator: input.idAllocator,
        scalarLocals: input.scalarLocals,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk({ blockKey: lowered.value.afterBlockKey, ifResult: lowered.value });
    }
    case "return": {
      const lowered = input.terminalLowerer.lowerReturn({
        context: input.context,
        expression: input.statement.kind.expression,
        blockKey: input.blockKey,
        terminal: false,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk({ blockKey: input.blockKey });
    }
    default: {
      const lowered = input.statementLowerer.lowerStatement({
        context: input.context,
        statement: input.statement,
        blockKey: input.blockKey,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk({ blockKey: input.blockKey });
    }
  }
}

function buildIfLoweringTestSuccess(input: {
  readonly context: ProofMirLoweringContext;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly ifResult?: {
    readonly thenBlockKey: ProofMirCanonicalKey;
    readonly elseBlockKey?: ProofMirCanonicalKey;
    readonly joinBlockKey?: ProofMirCanonicalKey;
    readonly trueEdgeKey: ProofMirCanonicalKey;
    readonly falseEdgeKey: ProofMirCanonicalKey;
  };
}): IfLoweringTestSuccess {
  const graph = input.context.graph;
  const factRecorder = input.context.factRecorder;

  function edgeView(edgeKey: ProofMirCanonicalKey): IfLoweringEdgeView {
    const edge = graph.edge(edgeKey);
    return {
      edgeKey,
      kind: edge.kind,
      factKeys: edge.factKeys,
      arguments: edge.argumentKeys,
    };
  }

  function edgesTo(blockKey: ProofMirCanonicalKey): readonly IfLoweringEdgeView[] {
    const edges: IfLoweringEdgeView[] = [];
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

  const branchBlockKey = graph
    .functionDraft()
    .blocks.entries()
    .find((block) => {
      const terminator = graph.block(block.key).terminator;
      return terminator?.kind === "branch";
    })?.key;
  const branchTerminator =
    branchBlockKey === undefined ? undefined : graph.block(branchBlockKey).terminator;

  const joinBlockKey = input.ifResult?.joinBlockKey;
  const joinParameters =
    joinBlockKey === undefined
      ? undefined
      : input.context.ssa.blockParameters(joinBlockKey).map((parameter) => ({
          parameterKind: { kind: parameter.parameterKind },
        }));

  return {
    kind: "ok",
    ...(branchTerminator?.kind === "branch"
      ? {
          branch: {
            terminator: branchTerminator,
            whenTrue: edgeView(branchTerminator.whenTrue.edge),
            whenFalse: edgeView(branchTerminator.whenFalse.edge),
          },
        }
      : {}),
    ...(input.ifResult === undefined
      ? {}
      : {
          thenBranch: { blockKey: input.ifResult.thenBlockKey },
          ...(input.ifResult.elseBlockKey === undefined
            ? {}
            : { else: { blockKey: input.ifResult.elseBlockKey } }),
        }),
    ...(joinBlockKey === undefined || joinParameters === undefined
      ? {}
      : {
          join: {
            blockKey: joinBlockKey,
            parameters: joinParameters,
          },
        }),
    continuation: { blockKey: input.continuationBlockKey },
    edgesTo,
    blockTerminator(blockKey: ProofMirCanonicalKey) {
      return graph.block(blockKey).terminator;
    },
    factForKey(factKey: ProofMirCanonicalKey) {
      return factRecorder.draftFact(factKey);
    },
  };
}

function runIfLoweringSourceTest(
  input: LowerProofMirIfStatementForTestInput,
): IfLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:if-test");
  const bindings = collectIfLowererBindings(functionInstanceId, input.scalarLocals);
  const parsed = parseIfLowererSource({
    functionInstanceId,
    bindings,
    source: input.source,
  });
  const body: MonoBlock = {
    statements: [...parsed.preamble, parsed.ifStatement, ...parsed.postamble],
    sourceOrigin: "source:function:body",
  };

  const contextResult = buildIfLoweringTestContext({
    functionInstanceId,
    locals: bindings.locals,
    body,
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
    idAllocator,
  } = contextResult.value;
  const continuationBlockKey = context.graph.createBlock({
    role: "continuation",
    scope: context.graph.rootScopeKey(),
    origin: context.graph.allocateSyntheticOrigin("continuation"),
  });
  context.ssa.registerBlock(continuationBlockKey);

  const currentBlockRef = { blockKey: entryBlockKey };
  const controlFlowLowerer = createProofMirControlFlowLowerer({
    expression: expressionLowerer,
    statement: statementLowerer,
    terminal: terminalLowerer,
    currentBlockRef,
    continuationBlockRef: { blockKey: continuationBlockKey },
  });

  let currentBlockKey = entryBlockKey;

  for (const statement of parsed.preamble) {
    const lowered = dispatchStatementForIfTest({
      context,
      statement,
      blockKey: currentBlockKey,
      expressionLowerer,
      statementLowerer,
      terminalLowerer,
      controlFlowLowerer,
      idAllocator,
      scalarLocals: bindings.locals,
      continuationBlockKey,
    });
    if (lowered.kind === "error") {
      return { kind: "error", diagnostics: lowered.diagnostics };
    }
    currentBlockKey = lowered.value.blockKey;
  }

  const loweredIf = dispatchStatementForIfTest({
    context,
    statement: parsed.ifStatement,
    blockKey: currentBlockKey,
    expressionLowerer,
    statementLowerer,
    terminalLowerer,
    controlFlowLowerer,
    idAllocator,
    scalarLocals: bindings.locals,
    continuationBlockKey,
  });
  if (loweredIf.kind === "error") {
    return { kind: "error", diagnostics: loweredIf.diagnostics };
  }
  currentBlockKey = loweredIf.value.blockKey;
  const ifResult = loweredIf.value.ifResult;

  for (const statement of parsed.postamble) {
    const lowered = dispatchStatementForIfTest({
      context,
      statement,
      blockKey: currentBlockKey,
      expressionLowerer,
      statementLowerer,
      terminalLowerer,
      controlFlowLowerer,
      idAllocator,
      scalarLocals: bindings.locals,
      continuationBlockKey,
    });
    if (lowered.kind === "error") {
      return { kind: "error", diagnostics: lowered.diagnostics };
    }
    currentBlockKey = lowered.value.blockKey;
  }

  return buildIfLoweringTestSuccess({
    context,
    continuationBlockKey,
    ifResult,
  });
}

function runControlFlowLoweringSourceTest(
  input: LowerProofMirIfStatementForTestInput,
): IfLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:if-test");
  const bindings = collectIfLowererBindings(functionInstanceId, input.scalarLocals);
  const parsed = parseIfLowererSource({
    functionInstanceId,
    bindings,
    source: input.source,
  });
  const body: MonoBlock = {
    statements: [...parsed.preamble, parsed.ifStatement, ...parsed.postamble],
    sourceOrigin: "source:function:body",
  };

  const contextResult = buildIfLoweringTestContext({
    functionInstanceId,
    locals: bindings.locals,
    body,
  });
  if (contextResult.kind === "error") {
    return { kind: "error", diagnostics: contextResult.diagnostics };
  }

  const { context, entryBlockKey, expressionLowerer, statementLowerer, terminalLowerer } =
    contextResult.value;
  const currentBlockRef = { blockKey: entryBlockKey };
  const continuationBlockRef: { blockKey?: ProofMirCanonicalKey } = {};
  const controlFlowLowerer = createProofMirControlFlowLowerer({
    expression: expressionLowerer,
    statement: statementLowerer,
    terminal: terminalLowerer,
    currentBlockRef,
    continuationBlockRef,
  });

  let currentBlockKey = entryBlockKey;

  for (const statement of parsed.preamble) {
    const lowered = statementLowerer.lowerStatement({
      context,
      statement,
      blockKey: currentBlockKey,
    });
    if (lowered.kind === "error") {
      return { kind: "error", diagnostics: lowered.diagnostics };
    }
  }

  const loweredIf = controlFlowLowerer.lowerControlFlowStatement({
    context,
    statement: parsed.ifStatement,
    blockKey: currentBlockKey,
  });
  if (loweredIf.kind === "error") {
    return { kind: "error", diagnostics: loweredIf.diagnostics };
  }
  currentBlockKey = currentBlockRef.blockKey ?? currentBlockKey;

  for (const statement of parsed.postamble) {
    if (statement.kind.kind === "return") {
      const lowered = terminalLowerer.lowerReturn({
        context,
        expression: statement.kind.expression,
        blockKey: currentBlockKey,
        terminal: false,
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

  return buildIfLoweringTestSuccess({
    context,
    continuationBlockKey: continuationBlockRef.blockKey ?? currentBlockKey,
  });
}

export function lowerProofMirIfStatementForTest(
  input: LowerProofMirIfStatementForTestInput,
): IfLoweringTestResult {
  return runIfLoweringSourceTest(input);
}

export function lowerProofMirControlFlowForTest(
  input: LowerProofMirIfStatementForTestInput,
): IfLoweringTestResult {
  return runControlFlowLoweringSourceTest(input);
}
