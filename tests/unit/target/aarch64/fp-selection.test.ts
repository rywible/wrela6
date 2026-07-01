import { describe, expect, test } from "bun:test";
import { fpNumericFactRecord } from "../../../../src/opt-ir/facts/fp-numeric-facts";
import { optIrFactSetFromRecords } from "../../../../src/opt-ir/facts/fact-index";
import { optIrFactId, optIrOperationId } from "../../../../src/opt-ir/ids";
import { createAArch64FactQuery } from "../../../../src/target/aarch64/facts/aarch64-fact-adapter";
import {
  DEFAULT_AARCH64_FP_ENVIRONMENT,
  selectAArch64DotProductNumeric,
  selectAArch64FactGatedNumericOpcode,
  selectAArch64FusedMultiplyAdd,
} from "../../../../src/target/aarch64/select/fp-selection";

describe("AArch64 FP and numeric selection", () => {
  test("fused multiply-add requires contraction, rounding, FP environment, and fp registers", () => {
    const operationId = optIrOperationId(12);
    const factAnswer = fpAnswer(
      fpNumericFactRecord({
        factId: optIrFactId(1),
        operationId,
        contraction: "allowed",
        rounding: "nearestTiesToEven",
        exceptionFlagsObservable: false,
      }),
      operationId,
    );

    expect(
      selectAArch64FusedMultiplyAdd({
        operationId,
        factAnswer,
        fpEnvironment: DEFAULT_AARCH64_FP_ENVIRONMENT,
        resultRegisterClass: "fpScalar",
        sourceRegisterClasses: ["fpScalar", "fpScalar", "fpScalar"],
        numericContract: { family: "multiplyAdd" },
      }),
    ).toMatchObject({
      kind: "ok",
      opcode: "fmadd",
      factsUsed: [1],
      errataConstraints: ["fp-contraction-authorized"],
    });
  });

  test("fused multiply-add rejects observable exception flags and non-FP registers", () => {
    const operationId = optIrOperationId(13);
    const factAnswer = fpAnswer(
      fpNumericFactRecord({
        factId: optIrFactId(2),
        operationId,
        contraction: "allowed",
        rounding: "nearestTiesToEven",
        exceptionFlagsObservable: false,
      }),
      operationId,
    );

    expect(
      selectAArch64FusedMultiplyAdd({
        operationId,
        factAnswer,
        fpEnvironment: { ...DEFAULT_AARCH64_FP_ENVIRONMENT, exceptionFlagsObservable: true },
        resultRegisterClass: "fpScalar",
        sourceRegisterClasses: ["fpScalar", "fpScalar", "fpScalar"],
      }),
    ).toMatchObject({ kind: "rejected", reason: "fp-exception-flags-observable" });
    expect(
      selectAArch64FusedMultiplyAdd({
        operationId,
        factAnswer,
        resultRegisterClass: "gpr64",
        sourceRegisterClasses: ["fpScalar", "fpScalar", "fpScalar"],
      }),
    ).toMatchObject({
      kind: "rejected",
      reason: "fp-numeric:register-class-mismatch:13:fmadd:0:expected:fpScalar:actual:gpr64",
    });
  });

  test("DotProd requires lane width, signedness, range, saturation, accumulation, and error facts", () => {
    const operationId = optIrOperationId(14);
    const incomplete = fpAnswer(
      fpNumericFactRecord({
        factId: optIrFactId(3),
        operationId,
        laneWidthBits: 8,
        signedness: "unsigned",
      }),
      operationId,
    );
    const complete = fpAnswer(
      fpNumericFactRecord({
        factId: optIrFactId(4),
        operationId,
        laneWidthBits: 8,
        signedness: "unsigned",
        accumulation: "widening",
        saturation: "none",
        errorBoundUlps: 0,
        numericRange: { min: 0, max: 255 },
      }),
      operationId,
    );

    expect(
      selectAArch64DotProductNumeric({
        operationId,
        factAnswers: [incomplete],
        laneWidthBits: 8,
        signedness: "unsigned",
      }),
    ).toMatchObject({ kind: "rejected", reason: "dotprod:numeric-facts-missing:14:8:unsigned" });
    expect(
      selectAArch64DotProductNumeric({
        operationId,
        factAnswers: [incomplete, complete],
        laneWidthBits: 8,
        signedness: "unsigned",
      }),
    ).toMatchObject({
      kind: "ok",
      opcode: "dotprod",
      factsUsed: [4],
      errataConstraints: ["dotprod-authorized"],
    });
  });

  test("FP16, RDM, and saturation forms reject missing numeric payloads", () => {
    const operationId = optIrOperationId(15);
    const sparse = fpAnswer(
      fpNumericFactRecord({ factId: optIrFactId(5), operationId, precision: "fp16" }),
      operationId,
    );
    const rdm = fpAnswer(
      fpNumericFactRecord({
        factId: optIrFactId(6),
        operationId,
        laneWidthBits: 16,
        signedness: "signed",
        saturation: "signed",
        errorBoundUlps: 0,
        numericRange: { min: -32768, max: 32767 },
      }),
      operationId,
    );

    expect(
      selectAArch64FactGatedNumericOpcode({
        operationId,
        opcode: "fcvt-fp16",
        factAnswer: sparse,
      }),
    ).toMatchObject({ kind: "rejected", reason: "fcvt-fp16:numeric-fact-missing:rounding" });
    expect(
      selectAArch64FactGatedNumericOpcode({
        operationId,
        opcode: "sqrdmulh",
        factAnswer: rdm,
      }),
    ).toMatchObject({
      kind: "ok",
      opcode: "sqrdmulh",
      errataConstraints: [
        "rdm-authorized",
        "saturation-authorized",
        "numeric-error-bound-authorized",
      ],
    });
  });
});

function fpAnswer(
  record: ReturnType<typeof fpNumericFactRecord>,
  operationId: ReturnType<typeof optIrOperationId>,
) {
  return createAArch64FactQuery(optIrFactSetFromRecords([record])).fpContractionForOperation(
    operationId,
  );
}
