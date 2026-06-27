import { describe, expect, test } from "bun:test";
import {
  PROOF_MIR_DIAGNOSTIC_CODES,
  proofMirDiagnostic,
  proofMirDiagnosticCode,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
  type ProofMirDiagnosticCode,
} from "../../../src/proof-mir/diagnostics";
import { monoInstanceId } from "../../../src/mono/ids";

function makeDiagnostic(input: {
  readonly code: ProofMirDiagnosticCode;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly functionInstanceId?: ReturnType<typeof monoInstanceId>;
  readonly nodeDetail?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
    ...(input.functionInstanceId !== undefined
      ? { functionInstanceId: input.functionInstanceId }
      : {}),
    ...(input.nodeDetail !== undefined ? { nodeDetail: input.nodeDetail } : {}),
  });
}

const missingBodyCode = proofMirDiagnosticCode("PROOF_MIR_MISSING_FUNCTION_BODY");

describe("Proof MIR diagnostic codes", () => {
  test("every registered code constructs via proofMirDiagnosticCode", () => {
    for (const code of PROOF_MIR_DIAGNOSTIC_CODES) {
      expect(proofMirDiagnosticCode(code) as string).toBe(code);
    }
  });

  test("proofMirDiagnosticCode rejects unknown codes", () => {
    expect(() => proofMirDiagnosticCode("PROOF_MIR_NOT_A_REAL_CODE")).toThrow(
      "Unknown Proof MIR diagnostic code",
    );
  });

  test("unknown Proof MIR diagnostic codes are rejected", () => {
    expect(() =>
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_NOT_A_REAL_CODE",
        message: "bad",
        ownerKey: "program",
        rootCauseKey: "test",
        stableDetail: "bad",
      }),
    ).toThrow("Unknown Proof MIR diagnostic code");
  });
});

describe("sortProofMirDiagnostics", () => {
  test("sorts by source origin before function instance", () => {
    const laterOrigin = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      sourceOrigin: "main.wr:2:1",
      functionInstanceId: monoInstanceId("function:a"),
      ownerKey: "function:a",
      rootCauseKey: "body",
      stableDetail: "a",
    });
    const earlierOrigin = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      sourceOrigin: "main.wr:1:1",
      functionInstanceId: monoInstanceId("function:b"),
      ownerKey: "function:b",
      rootCauseKey: "body",
      stableDetail: "b",
    });

    const sorted = sortProofMirDiagnostics([laterOrigin, earlierOrigin]);
    expect(sorted.map((diagnostic) => diagnostic.order.sourceOrigin)).toEqual([
      "main.wr:1:1",
      "main.wr:2:1",
    ]);
  });

  test("sorts by function instance before node detail", () => {
    const laterFunction = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      functionInstanceId: monoInstanceId("function:z"),
      nodeDetail: "statement:0",
      ownerKey: "function:z",
      rootCauseKey: "body",
      stableDetail: "a",
    });
    const earlierFunction = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      functionInstanceId: monoInstanceId("function:a"),
      nodeDetail: "statement:9",
      ownerKey: "function:a",
      rootCauseKey: "body",
      stableDetail: "b",
    });

    const sorted = sortProofMirDiagnostics([laterFunction, earlierFunction]);
    expect(sorted.map((diagnostic) => diagnostic.order.functionInstanceId)).toEqual([
      "function:a",
      "function:z",
    ]);
  });

  test("sorts by node detail before code", () => {
    const laterNode = makeDiagnostic({
      code: proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION"),
      message: "m",
      nodeDetail: "expression:9",
      ownerKey: "function:main",
      rootCauseKey: "expression",
      stableDetail: "a",
    });
    const earlierNode = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      nodeDetail: "expression:1",
      ownerKey: "function:main",
      rootCauseKey: "body",
      stableDetail: "b",
    });

    const sorted = sortProofMirDiagnostics([laterNode, earlierNode]);
    expect(sorted.map((diagnostic) => diagnostic.order.nodeDetail)).toEqual([
      "expression:1",
      "expression:9",
    ]);
  });

  test("sorts by code before owner key", () => {
    const laterCode = makeDiagnostic({
      code: proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_STATEMENT"),
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "statement",
      stableDetail: "a",
    });
    const earlierCode = makeDiagnostic({
      code: proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION"),
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "expression",
      stableDetail: "b",
    });

    const sorted = sortProofMirDiagnostics([laterCode, earlierCode]);
    expect(sorted.map((diagnostic) => diagnostic.code)).toEqual([
      proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION"),
      proofMirDiagnosticCode("PROOF_MIR_UNLOWERABLE_MONO_STATEMENT"),
    ]);
  });

  test("sorts by owner key before root cause", () => {
    const laterOwner = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      ownerKey: "function:z",
      rootCauseKey: "body",
      stableDetail: "a",
    });
    const earlierOwner = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      ownerKey: "function:a",
      rootCauseKey: "body",
      stableDetail: "b",
    });

    const sorted = sortProofMirDiagnostics([laterOwner, earlierOwner]);
    expect(sorted.map((diagnostic) => diagnostic.order.ownerKey)).toEqual([
      "function:a",
      "function:z",
    ]);
  });

  test("sorts by root cause before stable detail", () => {
    const laterCause = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "z-cause",
      stableDetail: "a",
    });
    const earlierCause = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "a-cause",
      stableDetail: "b",
    });

    const sorted = sortProofMirDiagnostics([laterCause, earlierCause]);
    expect(sorted.map((diagnostic) => diagnostic.order.rootCauseKey)).toEqual([
      "a-cause",
      "z-cause",
    ]);
  });

  test("falls back to stable detail when earlier keys agree", () => {
    const laterDetail = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "body",
      stableDetail: "z",
    });
    const earlierDetail = makeDiagnostic({
      code: missingBodyCode,
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "body",
      stableDetail: "a",
    });

    const sorted = sortProofMirDiagnostics([laterDetail, earlierDetail]);
    expect(sorted.map((diagnostic) => diagnostic.order.stableDetail)).toEqual(["a", "z"]);
  });
});
