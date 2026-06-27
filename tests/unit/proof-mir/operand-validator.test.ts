import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { proofMirPlaceId, proofMirValueId } from "../../../src/proof-mir/ids";
import type { ProofMirConsumedOperand } from "../../../src/proof-mir/model/operands";
import { validateProofMirOperands } from "../../../src/proof-mir/validation/operand-validator";
import {
  proofMirProgramWithCallOperandForTest,
  proofMirValidatorFunctionFake,
  proofMirValidatorProgramFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("validateProofMirOperands", () => {
  test("validator rejects value-only consume operands", () => {
    const program = proofMirProgramWithCallOperandForTest({
      mode: "consume",
      operand: { kind: "value", value: proofMirValueId(0) },
    });

    const diagnostics = validateProofMirOperands(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_CALL_OPERAND"),
    );
  });

  test("accepts place-backed consume call arguments", () => {
    const program = proofMirProgramWithCallOperandForTest({
      mode: "consume",
      operand: { kind: "place", place: proofMirPlaceId(0) },
    });

    const diagnostics = validateProofMirOperands(program);

    expect(diagnostics).toEqual([]);
  });

  test("accepts value-and-place consume call arguments", () => {
    const program = proofMirProgramWithCallOperandForTest({
      mode: "consume",
      operand: {
        kind: "valueAndPlace",
        value: proofMirValueId(0),
        place: proofMirPlaceId(0),
      },
    });

    const diagnostics = validateProofMirOperands(program);

    expect(diagnostics).toEqual([]);
  });

  test("accepts value-only observe call arguments", () => {
    const program = proofMirProgramWithCallOperandForTest({
      mode: "observe",
      operand: { kind: "value", value: proofMirValueId(0) },
    });

    const diagnostics = validateProofMirOperands(program);

    expect(diagnostics).toEqual([]);
  });

  test("rejects value-only consume call receivers", () => {
    const program = proofMirProgramWithCallOperandForTest({
      mode: "consume",
      operand: { kind: "value", value: proofMirValueId(0) },
      receiver: true,
    });

    const diagnostics = validateProofMirOperands(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_CALL_OPERAND"),
    );
  });

  test("rejects return operands that consume value-only operands", () => {
    const origin = validatorOrigin("return-consume");
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        terminator: {
          terminatorId: 0 as never,
          kind: {
            kind: "return",
            value: {
              mode: "consume",
              operand: {
                kind: "value",
                value: proofMirValueId(0),
              } as unknown as ProofMirConsumedOperand,
            },
            edgeId: 1 as never,
            exit: 1 as never,
          },
          outgoingEdges: [1 as never],
          origin,
        },
      }),
    ]);

    const diagnostics = validateProofMirOperands(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_CALL_OPERAND"),
    );
  });
});
