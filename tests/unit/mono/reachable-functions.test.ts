import { expect, test } from "bun:test";
import { hirExpressionId, hirOriginId, type HirExpressionId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type { MonoExpression, MonoFunctionInstance } from "../../../src/mono/mono-hir";
import {
  callOriginForReachableFunction,
  monoStringSourceOriginAsHirOriginId,
} from "../../../src/mono/reachable-functions";
import { functionId, itemId } from "../../../src/semantic/ids";

const FUNCTION_INSTANCE_ID = monoInstanceId("fn:main");
const CALL_EXPRESSION_ID = instantiatedHirId(FUNCTION_INSTANCE_ID, hirExpressionId(7));

const CALLEE_EXPRESSION_ID = instantiatedHirId(FUNCTION_INSTANCE_ID, hirExpressionId(8));

function literalExpression(sourceOrigin: string): MonoExpression {
  return {
    expressionId: CALLEE_EXPRESSION_ID,
    kind: { kind: "literal", literal: { kind: "integer", text: "0", value: 0n } },
    type: { kind: "core", coreTypeId: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin,
  };
}

function minimalCaller(input: {
  readonly hirSourceOrigin?: ReturnType<typeof hirOriginId>;
  readonly expressionSourceOrigin?: string;
}): MonoFunctionInstance {
  const expression: MonoExpression = {
    expressionId: CALL_EXPRESSION_ID,
    kind: {
      kind: "call",
      call: {
        callee: literalExpression("source:callee"),
        ownerTypeArguments: [],
        ownerTypeArgumentSource: "none",
        arguments: [],
        typeArguments: [],
      },
    },
    type: { kind: "core", coreTypeId: "Never" } as never,
    resourceKind: "Never",
    sourceOrigin: input.expressionSourceOrigin ?? "7",
  };
  return {
    instanceId: FUNCTION_INSTANCE_ID,
    sourceFunctionId: functionId(1),
    sourceItemId: itemId(1),
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: {
      functionId: functionId(1),
      itemId: itemId(1),
      parameters: [],
      returnType: { kind: "core", coreTypeId: "Never" } as never,
      returnKind: "Never",
      modifiers: {
        isPlatform: false,
        isTerminal: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      sourceSpan: { start: 0, end: 0, length: 0 },
    },
    bodyStatus: "sourceBody",
    locals: { entries: () => [], get: () => undefined } as never,
    bodyIndex: {
      statements: { entries: () => [], get: () => undefined },
      expressions: {
        entries: () => [expression],
        get: (expressionId: HirExpressionId) =>
          String(expressionId) === String(CALL_EXPRESSION_ID) ? expression : undefined,
      },
    } as never,
    declaredRequirements: [],
    sourceOrigin: "source:function",
    hirSourceOrigin: input.hirSourceOrigin ?? hirOriginId(3),
  };
}

test("monoStringSourceOriginAsHirOriginId rejects non-numeric display origins", () => {
  expect(monoStringSourceOriginAsHirOriginId("source:function")).toBeUndefined();
  expect(monoStringSourceOriginAsHirOriginId("7")).toEqual(hirOriginId(7));
});

test("callOriginForReachableFunction prefers numeric expression origins", () => {
  const resolution = callOriginForReachableFunction({
    caller: minimalCaller({ expressionSourceOrigin: "11" }),
    callExpressionId: CALL_EXPRESSION_ID,
  });
  expect(resolution).toEqual({ kind: "resolved", origin: hirOriginId(11) });
});

test("callOriginForReachableFunction falls back to caller hirSourceOrigin", () => {
  const resolution = callOriginForReachableFunction({
    caller: minimalCaller({ expressionSourceOrigin: "source:function" }),
    callExpressionId: CALL_EXPRESSION_ID,
  });
  expect(resolution).toEqual({ kind: "resolved", origin: hirOriginId(3) });
});

test("callOriginForReachableFunction reports unresolved when caller hirSourceOrigin is missing", () => {
  const caller = minimalCaller({
    expressionSourceOrigin: "source:function",
    hirSourceOrigin: undefined as never,
  });
  delete (caller as { hirSourceOrigin?: ReturnType<typeof hirOriginId> }).hirSourceOrigin;
  const resolution = callOriginForReachableFunction({
    caller,
    callExpressionId: CALL_EXPRESSION_ID,
  });
  expect(resolution.kind).toBe("unresolved");
});
