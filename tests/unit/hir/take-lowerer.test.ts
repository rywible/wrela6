import { expect, test } from "bun:test";
import { classifyTakeExpression } from "../../../src/hir/take-lowerer";
import {
  createHirUnitContext,
  createProgramHirUnitContext,
  lowerTypedHirForTest,
} from "../../support/hir/typed-hir-fixtures";
import {
  successfulCallFake,
  streamTakeSurface,
  bufferTakeSurface,
  parameterPlace,
} from "../../support/hir/typed-hir-fakes";
import {
  functionId,
  itemId,
  platformContractId,
  platformPrimitiveId,
  targetId,
  typeId,
} from "../../../src/semantic/ids";
import { hirExpressionId, hirOriginId, ownedBrandId } from "../../../src/hir/ids";
import { SourceSpan } from "../../../src/shared/source-span";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";

test("take-only stream call creates session metadata", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const result = classifyTakeExpression({
    expression: {
      kind: "call",
      call: successfulCallFake({ calleeFunctionId: functionId(1) }),
    } as any,
    context,
    takeSurfaces: [streamTakeSurface(functionId(1))],
  });

  expect(result.kind.kind).toBe("stream");
  expect(context.proofMetadata.sessions.entries()).toHaveLength(1);
});

test("take-only stream call without a function owner reports and creates no sentinel metadata", () => {
  const context = createProgramHirUnitContext("fn process():\n    return\n");
  const result = classifyTakeExpression({
    expression: {
      kind: "call",
      call: successfulCallFake({ calleeFunctionId: functionId(1) }),
      sourceOrigin: hirOriginId(0),
    } as any,
    context,
    takeSurfaces: [streamTakeSurface(functionId(1))],
  });

  expect(result.kind.kind).toBe("error");
  expect(context.diagnostics.entries().map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_MISSING_OWNER_FUNCTION",
  );
  expect(context.proofMetadata.sessions.entries()).toEqual([]);
  expect(context.proofMetadata.brands.entries()).toEqual([]);
  expect(context.proofMetadata.obligations.entries()).toEqual([]);
});

test("buffer take creates a buffer obligation", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const result = classifyTakeExpression({
    expression: {
      place: parameterPlace(0 as any),
      type: { kind: "source", itemId: 1 as any, typeId: typeId(1) },
    } as any,
    context,
    takeSurfaces: [bufferTakeSurface(typeId(1))],
  });

  expect(result.kind.kind).toBe("buffer");
  expect(context.proofMetadata.obligations.entries()).toHaveLength(1);
});

test("buffer take over non-place operand mints no proof metadata", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const result = classifyTakeExpression({
    expression: {
      expressionId: hirExpressionId(0),
      kind: { kind: "call", call: successfulCallFake({ calleeFunctionId: functionId(1) }) },
      type: { kind: "source", itemId: itemId(1), typeId: typeId(1) },
      resourceKind: concreteKind("Linear"),
      sourceOrigin: hirOriginId(0),
    },
    context,
    takeSurfaces: [bufferTakeSurface(typeId(1))],
  });

  expect(result.kind.kind).toBe("error");
  expect(context.proofMetadata.obligations.entries()).toEqual([]);
  expect(context.proofMetadata.sessions.entries()).toEqual([]);
  expect(context.proofMetadata.brands.entries()).toEqual([]);
});

test("validated-buffer take over non-place operand mints no proof metadata", () => {
  const context = createHirUnitContext("fn process():\n    return\n");
  const result = classifyTakeExpression({
    expression: {
      expressionId: hirExpressionId(0),
      kind: { kind: "call", call: successfulCallFake({ calleeFunctionId: functionId(1) }) },
      type: { kind: "source", itemId: itemId(2), typeId: typeId(2) },
      resourceKind: concreteKind("ValidatedBuffer"),
      sourceOrigin: hirOriginId(0),
    },
    context,
    takeSurfaces: [
      {
        kind: "validatedBuffer",
        validatedBufferTypeId: typeId(2),
        span: SourceSpan.from(0, 0),
      },
    ],
  });

  expect(result.kind.kind).toBe("error");
  expect(context.proofMetadata.obligations.entries()).toEqual([]);
  expect(context.proofMetadata.sessions.entries()).toEqual([]);
  expect(context.proofMetadata.brands.entries()).toEqual([]);
});

test("stream call without take-only surface emits HIR_TAKE_ONLY_CALL_REQUIRED", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "stream Counter:",
        "    field: u8",
        "fn produce() -> Counter",
        "fn caller() -> Never:",
        "    take produce() as item:",
        "        continue",
      ].join("\n"),
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_TAKE_ONLY_CALL_REQUIRED",
  );
  expect(result.program.proofMetadata.sessions.entries()).toEqual([]);
});

test("take brand canonical key uses statement ordinal after preallocated platform brands", () => {
  const context = createHirUnitContext(
    "fn process():\n    take produce() as item:\n        continue\n",
  );
  const owner = { kind: "function" as const, functionId: functionId(0) };
  context.proofMetadata.addBrand({
    brandId: ownedBrandId(owner, 0),
    canonicalKey: "platform:0:primitive:exit:contract:exit_contract:target:uefi-aarch64",
    origin: {
      kind: "platformToken",
      sourceFunctionId: functionId(0),
      primitiveId: platformPrimitiveId("exit"),
      contractId: platformContractId("exit_contract"),
      targetId: targetId("uefi-aarch64"),
    },
  });

  classifyTakeExpression({
    expression: {
      kind: "call",
      call: successfulCallFake({ calleeFunctionId: functionId(1) }),
      sourceOrigin: 0,
    } as any,
    context,
    takeSurfaces: [streamTakeSurface(functionId(1))],
  });

  expect(context.proofMetadata.brands.entries().map((brand) => brand.canonicalKey)).toContain(
    "function:0:take:0",
  );
});

test("validated-buffer take brand uses owner-local ordinal after unrelated brands", () => {
  const context = createHirUnitContext(
    "fn process(buffer: Packet):\n    take buffer as item:\n        continue\n",
  );
  context.proofMetadata.addBrand({
    brandId: ownedBrandId({ kind: "function", functionId: functionId(1) }, 0),
    canonicalKey: "platform:1:primitive:exit:contract:exit_contract:target:uefi-aarch64",
    origin: {
      kind: "platformToken",
      sourceFunctionId: functionId(1),
      primitiveId: platformPrimitiveId("exit"),
      contractId: platformContractId("exit_contract"),
      targetId: targetId("uefi-aarch64"),
    },
  });

  const result = classifyTakeExpression({
    expression: {
      place: parameterPlace(0 as any),
      type: { kind: "source", itemId: itemId(2), typeId: typeId(2) },
      sourceOrigin: 0,
    } as any,
    context,
    takeSurfaces: [
      {
        kind: "validatedBuffer",
        validatedBufferTypeId: typeId(2),
        span: SourceSpan.from(0, 0),
      },
    ],
  });

  expect(result.kind.kind).toBe("validatedBuffer");
  const takeBrand = context.proofMetadata.brands
    .entries()
    .find((brand) => brand.origin.kind === "functionTake");
  expect(takeBrand?.brandId).toEqual(
    ownedBrandId({ kind: "function", functionId: functionId(0) }, 0),
  );
  expect(takeBrand?.canonicalKey).toBe("function:0:take:0");
});

test("take over parametric resource kind emits HIR_PROOF_RELEVANT_KIND_NOT_CONCRETE", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      ["fn caller[T](value: T) -> Never:", "    take value as item:", "        continue"].join(
        "\n",
      ),
    ],
  ]);

  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toContain(
    "HIR_PROOF_RELEVANT_KIND_NOT_CONCRETE",
  );
});
