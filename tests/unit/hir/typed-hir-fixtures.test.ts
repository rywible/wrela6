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
