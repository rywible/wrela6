import { expect, test } from "bun:test";
import { coreTypeId, functionId, parameterId, typeId } from "../../../../src/semantic/ids";
import { SourceSpan } from "../../../../src/frontend";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import {
  CheckedAttemptContractSurfaceTableBuilder,
  CheckedValidationContractSurfaceTableBuilder,
  populateAttemptContractSurfaces,
  populateValidationContractSurfaces,
} from "../../../../src/semantic/surface/proof-contracts";
import type {
  AttemptContractPopulationContext,
  ValidationContractPopulationContext,
} from "../../../../src/semantic/surface/proof-contracts";

const span = SourceSpan.from(0, 6);
const attemptType = coreCheckedType(coreTypeId("Attempt"));
const okType = coreCheckedType(coreTypeId("bool"));
const errType = coreCheckedType(coreTypeId("u32"));

test("attempt contracts preserve declared inputs", () => {
  const builder = new CheckedAttemptContractSurfaceTableBuilder();
  builder.add({
    fallibleFunctionId: functionId(3),
    resultType: attemptType,
    okType,
    errType,
    inputs: [{ kind: "parameter", parameterId: parameterId(0) }],
    span,
  });

  expect(builder.build().get(functionId(3))[0]!.inputs).toEqual([
    { kind: "parameter", parameterId: parameterId(0) },
  ]);
});

test("attempt population rejects consume-mode-only inference", () => {
  const context: AttemptContractPopulationContext = {
    contracts: [
      {
        fallibleFunctionId: functionId(1),
        resultType: attemptType,
        okType,
        errType,
        inputs: [],
        span,
      },
    ],
  };
  const builder = new CheckedAttemptContractSurfaceTableBuilder();

  populateAttemptContractSurfaces(builder, context);

  expect(builder.build().entries()).toEqual([]);
});

test("validation contracts preserve explicit result ok err source and input positions", () => {
  const context: ValidationContractPopulationContext = {
    contracts: [
      {
        validatedBufferTypeId: typeId(2),
        resultType: attemptType,
        sourceType: coreCheckedType(coreTypeId("u8")),
        okPayloadType: okType,
        errPayloadType: errType,
        sourceParameterId: parameterId(4),
        span,
      },
    ],
  };
  const builder = new CheckedValidationContractSurfaceTableBuilder();

  populateValidationContractSurfaces(builder, context);

  expect(builder.build().entries()).toEqual(context.contracts);
});

test("ambiguous validation production emits no contracts", () => {
  const builder = new CheckedValidationContractSurfaceTableBuilder();

  populateValidationContractSurfaces(builder, {
    contracts: [
      {
        validatedBufferTypeId: typeId(2),
        resultType: attemptType,
        sourceType: coreCheckedType(coreTypeId("u8")),
        okPayloadType: okType,
        errPayloadType: errType,
        span,
      },
    ],
  });

  expect(builder.build().entries()).toEqual([]);
});
