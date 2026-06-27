import {
  hirExpressionId,
  hirLocalId,
  hirStatementId,
  resourcePlaceId,
} from "../../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../../src/mono/ids";
import type {
  MonoBlock,
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoForIteration,
  MonoForStatement,
  MonoLocal,
  MonoResourcePlace,
  MonoStatement,
  MonoStatementId,
} from "../../../../src/mono/mono-hir";
import { monoStatementIdFor } from "../../../../src/mono/function-instantiator-shell";

export function expressionIdFor(
  functionInstanceId: MonoInstanceId,
  ordinal: number,
): MonoExpressionId {
  return instantiatedHirId(functionInstanceId, hirExpressionId(ordinal));
}

export function scalarType(): MonoCheckedType {
  return { kind: "core", coreTypeId: "u8" } as MonoCheckedType;
}

interface IteratorLowererBindings {
  readonly locals: MonoLocal[];
  readonly localsByName: Map<string, MonoLocal>;
  readonly placeBackedLocalNames: ReadonlySet<string>;
}

export function collectIteratorLowererBindings(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly scalarLocalNames: readonly string[];
  readonly placeBackedLocalNames: readonly string[];
  readonly bindingName?: string;
}): IteratorLowererBindings {
  const locals: MonoLocal[] = [];
  const localsByName = new Map<string, MonoLocal>();
  const placeBackedLocalNames = new Set(input.placeBackedLocalNames);
  let nextLocalIndex = 1;
  const names = [
    ...input.scalarLocalNames,
    ...input.placeBackedLocalNames,
    ...(input.bindingName === undefined ? [] : [input.bindingName]),
  ];
  for (const name of names) {
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

export function statementIdFor(
  functionInstanceId: MonoInstanceId,
  ordinal: number,
): MonoStatementId {
  return monoStatementIdFor(functionInstanceId, hirStatementId(ordinal));
}

function monoLocalPlace(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly local: MonoLocal;
}): MonoResourcePlace {
  return {
    placeId: {
      owner: { kind: "function", instanceId: input.functionInstanceId },
      hirId: resourcePlaceId(Number(String(input.local.localId.hirId))),
      instanceId: input.functionInstanceId,
    },
    canonicalKey: `function:${String(input.functionInstanceId)}/local:${input.local.name}`,
    root: { kind: "local", localId: input.local.localId },
    projection: [],
    type: input.local.type,
    resourceKind: input.local.resourceKind,
    sourceOrigin: input.local.sourceOrigin,
    kind: "local",
    localId: input.local.localId,
  };
}

export function buildExpressionForIteratorLowererTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: IteratorLowererBindings;
  readonly expressionText: string;
  readonly expressionIds: { next(): MonoExpressionId };
}): MonoExpression {
  function expressionFromText(text: string, origin: string): MonoExpression {
    const trimmed = text.trim();
    const callMatch = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\(\)$/.exec(trimmed);
    if (callMatch !== null) {
      const receiverLocal = input.bindings.localsByName.get(callMatch[1]!);
      if (receiverLocal === undefined) {
        throw new RangeError(
          `Unknown receiver in iterator lowerer test expression: ${callMatch[1]}.`,
        );
      }
      const receiver: MonoExpression = {
        expressionId: input.expressionIds.next(),
        kind: {
          kind: "name",
          name: receiverLocal.name,
          localId: receiverLocal.localId,
        },
        type: receiverLocal.type,
        resourceKind: receiverLocal.resourceKind,
        sourceOrigin: origin,
        place: monoLocalPlace({
          functionInstanceId: input.functionInstanceId,
          local: receiverLocal,
        }),
      };
      const iterableFunctionInstanceId = monoInstanceId("fn:packet-bytes");
      return {
        expressionId: input.expressionIds.next(),
        kind: {
          kind: "call",
          call: {
            callee: {
              expressionId: input.expressionIds.next(),
              kind: { kind: "name", name: callMatch[2]! },
              type: scalarType(),
              resourceKind: "Copy",
              sourceOrigin: origin,
            },
            ownerTypeArguments: [],
            ownerTypeArgumentSource: "none",
            arguments: [],
            typeArguments: [],
            receiver,
            resolvedTarget: {
              kind: "sourceFunction",
              targetFunctionInstanceId: iterableFunctionInstanceId,
            },
            sourceOrigin: origin,
          },
        },
        type: scalarType(),
        resourceKind: "Affine",
        sourceOrigin: origin,
        place: {
          placeId: {
            owner: { kind: "function", instanceId: input.functionInstanceId },
            hirId: resourcePlaceId(9000 + Number(String(receiverLocal.localId.hirId))),
            instanceId: input.functionInstanceId,
          },
          canonicalKey: `function:${String(input.functionInstanceId)}/iterator:${callMatch[2]}`,
          root: { kind: "temporary", ordinal: 1 },
          projection: [],
          type: scalarType(),
          resourceKind: "Affine",
          sourceOrigin: origin,
          kind: "temporary",
        },
      };
    }
    const spacedNameMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (spacedNameMatch !== null) {
      return expressionFromText(spacedNameMatch[2]!, origin);
    }
    const binaryMatch = /^(.+?)\s*([+\-*/])\s*(.+)$/.exec(trimmed);
    if (binaryMatch !== null) {
      return {
        expressionId: input.expressionIds.next(),
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
    const local = input.bindings.localsByName.get(trimmed);
    if (local !== undefined) {
      return {
        expressionId: input.expressionIds.next(),
        kind: { kind: "name", name: local.name, localId: local.localId },
        type: local.type,
        resourceKind: local.resourceKind,
        sourceOrigin: origin,
        ...(input.bindings.placeBackedLocalNames.has(local.name)
          ? { place: monoLocalPlace({ functionInstanceId: input.functionInstanceId, local }) }
          : {}),
      };
    }
    throw new RangeError(`Unsupported iterator lowerer test expression: ${trimmed}.`);
  }
  return expressionFromText(input.expressionText, "source:expr:test");
}

export function parseIteratorLowererSource(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly bindings: IteratorLowererBindings;
  readonly source: readonly string[];
  readonly iteration: MonoForIteration;
}): {
  readonly forStatement: MonoForStatement;
  readonly monoStatement: MonoStatement;
  readonly postamble: readonly MonoStatement[];
} {
  let statementOrdinal = 1;
  let expressionOrdinal = 1;
  const expressionIds = {
    next(): MonoExpressionId {
      return expressionIdFor(input.functionInstanceId, expressionOrdinal++);
    },
  };

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
      const assignmentMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(trimmed);
      if (assignmentMatch !== null) {
        const local = input.bindings.localsByName.get(assignmentMatch[1]!);
        if (local === undefined) {
          throw new RangeError(
            `Unknown local in iterator lowerer test source: ${assignmentMatch[1]}.`,
          );
        }
        statements.push({
          statementId: statementIdFor(input.functionInstanceId, statementOrdinal++),
          kind: {
            kind: "assignment",
            statement: {
              target: buildExpressionForIteratorLowererTest({
                functionInstanceId: input.functionInstanceId,
                bindings: input.bindings,
                expressionText: assignmentMatch[1]!,
                expressionIds,
              }),
              value: buildExpressionForIteratorLowererTest({
                functionInstanceId: input.functionInstanceId,
                bindings: input.bindings,
                expressionText: assignmentMatch[2]!,
                expressionIds,
              }),
            },
          },
          sourceOrigin: `source:stmt:assign:${assignmentMatch[1]}`,
        });
        index += 1;
        continue;
      }
      if (/^continue\s*$/.test(trimmed)) {
        statements.push({
          statementId: statementIdFor(input.functionInstanceId, statementOrdinal++),
          kind: { kind: "continue" },
          sourceOrigin: "source:stmt:continue",
        });
        index += 1;
        continue;
      }
      const takeMatch = /^take\s+(.+)$/.exec(trimmed);
      if (takeMatch !== null) {
        statements.push({
          statementId: statementIdFor(input.functionInstanceId, statementOrdinal++),
          kind: {
            kind: "expression",
            expression: buildExpressionForIteratorLowererTest({
              functionInstanceId: input.functionInstanceId,
              bindings: input.bindings,
              expressionText: takeMatch[1]!,
              expressionIds,
            }),
          },
          sourceOrigin: "source:stmt:take",
        });
        index += 1;
        continue;
      }
      throw new RangeError(`Unsupported iterator lowerer test statement: ${trimmed}.`);
    }
    return {
      block: { statements, sourceOrigin: "source:block" },
      nextIndex: index,
    };
  }

  const forMatch = input.source.map((line) => line.trim()).find((line) => /^for\s+/.test(line));
  if (forMatch === undefined) {
    throw new RangeError("Iterator lowerer test source must include a for statement.");
  }
  const forLineMatch = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+):\s*$/.exec(forMatch);
  if (forLineMatch === null) {
    throw new RangeError(`Unsupported iterator lowerer test for statement: ${forMatch}.`);
  }
  const binding = input.bindings.localsByName.get(forLineMatch[1]!);
  if (binding === undefined) {
    throw new RangeError(
      `Unknown for binding in iterator lowerer test source: ${forLineMatch[1]}.`,
    );
  }
  const forLineIndex = input.source.findIndex((line) => line.trim() === forMatch);
  const bodyParsed = parseBlock(input.source, forLineIndex + 1);
  const forStatement: MonoForStatement = {
    binding,
    iterable: buildExpressionForIteratorLowererTest({
      functionInstanceId: input.functionInstanceId,
      bindings: input.bindings,
      expressionText: forLineMatch[2]!,
      expressionIds,
    }),
    iteration: input.iteration,
    body: bodyParsed.block,
  };
  const monoStatement: MonoStatement = {
    statementId: statementIdFor(input.functionInstanceId, statementOrdinal++),
    kind: { kind: "for", statement: forStatement },
    sourceOrigin: "source:stmt:for",
  };

  const postamble: MonoStatement[] = [];
  let index = bodyParsed.nextIndex;
  while (index < input.source.length) {
    const postLine = input.source[index]!.trim();
    const returnMatch = /^return\s+(.+)$/.exec(postLine);
    if (returnMatch !== null) {
      postamble.push({
        statementId: statementIdFor(input.functionInstanceId, statementOrdinal++),
        kind: {
          kind: "return",
          expression: buildExpressionForIteratorLowererTest({
            functionInstanceId: input.functionInstanceId,
            bindings: input.bindings,
            expressionText: returnMatch[1]!,
            expressionIds,
          }),
        },
        sourceOrigin: "source:stmt:return",
      });
      index += 1;
      continue;
    }
    throw new RangeError(`Unsupported iterator lowerer test postamble: ${postLine}.`);
  }

  return { forStatement, monoStatement, postamble };
}
