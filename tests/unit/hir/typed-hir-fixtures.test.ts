import { expect, test } from "bun:test";
import { lowerTypedHirForTest, typedHirSummary } from "../../support/hir/typed-hir-fixtures";
import {
  bufferTakeSurface,
  certifiedPlatformBindingFake,
  localFake,
  parameterPlace,
  streamTakeSurface,
  successfulCallFake,
  targetWithCertifiedExit,
  targetWithRejectedRawEnsuredFact,
  validationContractForBuffer,
} from "../../support/hir/typed-hir-fakes";
import {
  coreTypeId,
  functionId,
  parameterId,
  platformPrimitiveId,
  typeId,
} from "../../../src/semantic/ids";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";

test("lowerTypedHirForTest runs the real parser semantic and HIR pipeline", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      "fn process(packet: u8) -> bool:\n    if packet > 0:\n        return true\n    return false\n",
    ],
  ]);

  expect(result.program.functions.entries()).toHaveLength(1);
  expect(typedHirSummary(result)).toContain("functions");
});

test("HIR fakes expose named proof-surface helpers", () => {
  expect(targetWithCertifiedExit().platformPrimitives.entries()[0]?.primitiveId).toBe(
    platformPrimitiveId("exit"),
  );
  expect(targetWithRejectedRawEnsuredFact().platformPrimitives.entries()).toHaveLength(1);
  expect(streamTakeSurface(functionId(1)).kind).toBe("stream");
  expect(bufferTakeSurface(typeId(1)).kind).toBe("buffer");
  expect(validationContractForBuffer(typeId(2)).validatedBufferTypeId).toBe(typeId(2));
  expect(certifiedPlatformBindingFake({ primitiveName: "exit" }).primitiveId).toBe(
    platformPrimitiveId("exit"),
  );
  expect(successfulCallFake({ calleeFunctionId: functionId(2) }).calleeFunctionId).toBe(
    functionId(2),
  );
  expect(parameterPlace(parameterId(0)).root).toEqual({
    kind: "parameter",
    parameterId: parameterId(0),
  });
  expect(localFake({ name: "value", type: coreCheckedType(coreTypeId("u32")) }).name).toBe("value");
});

test("typed HIR records source types, fields, and ordered type parameters", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      `
class Box[T]:
    value: T

fn id[U](value: U) -> U:
    return value
`,
    ],
  ]);

  const typeRecord = result.program.types.entries()[0]!;
  const fieldRecord = result.program.fields.entries()[0]!;
  const functionRecord = result.program.functions
    .entries()
    .find((entry) => entry.declaredTypeParameters.length === 1)!;

  expect(typeRecord.sourceKind).toBe("class");
  expect(typeRecord.declaredTypeParameters.map((parameter) => parameter.index)).toEqual([0]);
  expect(typeRecord.fieldIds).toEqual([fieldRecord.fieldId]);
  expect(fieldRecord.ownerTypeId).toBe(typeRecord.typeId);
  expect(functionRecord.declaredTypeParameters.map((parameter) => parameter.index)).toEqual([0]);
});

test("typed HIR source type kinds do not become error for fieldless proof-relevant types", () => {
  const result = lowerTypedHirForTest([["main.wr", "interface Capability:\n"]]);

  const typeKind = result.program.monoClosure.sourceTypeKinds.entries()[0];

  expect(typeKind?.kind).toEqual({ kind: "concrete", value: "Copy" });
});

test("typed HIR non-enum type records contain empty enumCases", () => {
  const result = lowerTypedHirForTest([
    [
      "main.wr",
      `
class Box[T]:
    value: T
`,
    ],
  ]);

  for (const typeRecord of result.program.types.entries()) {
    expect(typeRecord.enumCases).toEqual([]);
  }
});

test("typed HIR enum type records contain cases sorted by source ordinal", () => {
  const result = lowerTypedHirForTest([
    ["main.wr", "enum PacketKind:\n    Arp\n    Ipv4\n    Ipv6\n"],
  ]);
  const enumRecord = result.program.types.entries().find((record) => record.sourceKind === "enum");

  expect(enumRecord?.enumCases.map((caseRecord) => caseRecord.name)).toEqual([
    "Arp",
    "Ipv4",
    "Ipv6",
  ]);
  expect(enumRecord?.enumCases.map((caseRecord) => caseRecord.ordinal)).toEqual([0, 1, 2]);
  expect(
    enumRecord?.enumCases.every((caseRecord) => caseRecord.enumTypeId === enumRecord?.typeId),
  ).toBe(true);
});
