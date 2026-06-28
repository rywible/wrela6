import { describe, expect, test } from "bun:test";
import {
  PROOF_CHECK_DIAGNOSTIC_CODES,
  proofCheckDiagnostic,
  proofCheckDiagnosticCode,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
  type ProofCheckDiagnosticCode,
  type ProofCounterexamplePath,
} from "../../../src/proof-check/diagnostics";
import {
  checkedSummaryInstantiationCertificateId,
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofCheckPathCertificateId,
  proofCheckTransitionId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import { monoInstanceId } from "../../../src/mono/ids";

function makeDiagnostic(input: {
  readonly code: ProofCheckDiagnosticCode;
  readonly message: string;
  readonly messageTemplateId?: string;
  readonly messageArguments?: readonly { readonly kind: "text"; readonly value: string }[];
  readonly sourceOrigin?: string;
  readonly functionInstanceId?: ReturnType<typeof monoInstanceId>;
  readonly pathFrameKey?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly counterexample?: ProofCounterexamplePath;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: input.code,
    messageTemplateId: input.messageTemplateId ?? "test.template",
    messageArguments: input.messageArguments ?? [{ kind: "text", value: "detail" }],
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
    ...(input.functionInstanceId !== undefined
      ? { functionInstanceId: input.functionInstanceId }
      : {}),
    ...(input.pathFrameKey !== undefined ? { pathFrameKey: input.pathFrameKey } : {}),
    ...(input.counterexample !== undefined ? { counterexample: input.counterexample } : {}),
  });
}

const unsatisfiedRequirementCode = proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT");

describe("proof-check branded IDs", () => {
  test("dense ID helpers accept non-negative integers", () => {
    expect(proofCheckTransitionId(0)).toBe(proofCheckTransitionId(0));
    expect(proofCheckCoreCertificateId(3)).toBe(proofCheckCoreCertificateId(3));
    expect(proofCheckPacketFactId(5)).toBe(proofCheckPacketFactId(5));
    expect(proofCheckPathCertificateId(7)).toBe(proofCheckPathCertificateId(7));
    expect(proofSemanticsCertificateId(11)).toBe(proofSemanticsCertificateId(11));
    expect(checkedSummaryInstantiationCertificateId(13)).toBe(
      checkedSummaryInstantiationCertificateId(13),
    );
  });

  test("dense ID helpers reject invalid values", () => {
    expect(() => proofCheckTransitionId(-1)).toThrow("ProofCheckTransitionId");
    expect(() => proofCheckCoreCertificateId(1.5)).toThrow("ProofCheckCoreCertificateId");
  });
});

describe("Proof-check diagnostic codes", () => {
  test("every registered code constructs via proofCheckDiagnosticCode", () => {
    for (const code of PROOF_CHECK_DIAGNOSTIC_CODES) {
      expect(proofCheckDiagnosticCode(code) as string).toBe(code);
    }
  });

  test("proofCheckDiagnosticCode rejects unknown codes", () => {
    expect(() => proofCheckDiagnosticCode("PROOF_CHECK_NOT_A_REAL_CODE")).toThrow(
      "Unknown proof-check diagnostic code",
    );
  });

  test("unknown proof-check diagnostic codes are rejected", () => {
    expect(() =>
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_NOT_A_REAL_CODE",
        messageTemplateId: "test.template",
        messageArguments: [{ kind: "text", value: "bad" }],
        message: "bad",
        ownerKey: "program",
        rootCauseKey: "test",
        stableDetail: "bad",
      }),
    ).toThrow("Unknown proof-check diagnostic code");
  });
});

describe("sortProofCheckDiagnostics", () => {
  test("proof-check diagnostics sort by stable identity, not rendered message", () => {
    const diagnostics = [
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
        messageTemplateId: "requirement.missing",
        messageArguments: [{ kind: "text", value: "second" }],
        message: "different rendered text",
        ownerKey: "owner:b",
        rootCauseKey: "missing:fact",
        stableDetail: "fact:b",
      }),
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
        messageTemplateId: "requirement.missing",
        messageArguments: [{ kind: "text", value: "first" }],
        message: "rendered text",
        ownerKey: "owner:a",
        rootCauseKey: "missing:fact",
        stableDetail: "fact:a",
      }),
    ];

    expect(sortProofCheckDiagnostics(diagnostics).map((diagnostic) => diagnostic.ownerKey)).toEqual(
      ["owner:a", "owner:b"],
    );
  });

  test("sorts by source origin before function instance", () => {
    const laterOrigin = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      sourceOrigin: "main.wr:2:1",
      functionInstanceId: monoInstanceId("function:a"),
      ownerKey: "function:a",
      rootCauseKey: "body",
      stableDetail: "a",
    });
    const earlierOrigin = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      sourceOrigin: "main.wr:1:1",
      functionInstanceId: monoInstanceId("function:b"),
      ownerKey: "function:b",
      rootCauseKey: "body",
      stableDetail: "b",
    });

    const sorted = sortProofCheckDiagnostics([laterOrigin, earlierOrigin]);
    expect(sorted.map((diagnostic) => diagnostic.order.sourceOrigin)).toEqual([
      "main.wr:1:1",
      "main.wr:2:1",
    ]);
  });

  test("sorts by function instance before path frame", () => {
    const laterFunction = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      functionInstanceId: monoInstanceId("function:z"),
      pathFrameKey: "frame:0",
      ownerKey: "function:z",
      rootCauseKey: "body",
      stableDetail: "a",
    });
    const earlierFunction = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      functionInstanceId: monoInstanceId("function:a"),
      pathFrameKey: "frame:9",
      ownerKey: "function:a",
      rootCauseKey: "body",
      stableDetail: "b",
    });

    const sorted = sortProofCheckDiagnostics([laterFunction, earlierFunction]);
    expect(sorted.map((diagnostic) => diagnostic.order.functionInstanceId)).toEqual([
      "function:a",
      "function:z",
    ]);
  });

  test("sorts by path frame before code", () => {
    const laterFrame = makeDiagnostic({
      code: proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
      message: "m",
      pathFrameKey: "frame:9",
      ownerKey: "function:main",
      rootCauseKey: "move",
      stableDetail: "a",
    });
    const earlierFrame = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      pathFrameKey: "frame:1",
      ownerKey: "function:main",
      rootCauseKey: "requirement",
      stableDetail: "b",
    });

    const sorted = sortProofCheckDiagnostics([laterFrame, earlierFrame]);
    expect(sorted.map((diagnostic) => diagnostic.order.pathFrameKey)).toEqual([
      "frame:1",
      "frame:9",
    ]);
  });

  test("sorts by code before owner key", () => {
    const laterCode = makeDiagnostic({
      code: proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_CONSUME"),
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "consume",
      stableDetail: "a",
    });
    const earlierCode = makeDiagnostic({
      code: proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "move",
      stableDetail: "b",
    });

    const sorted = sortProofCheckDiagnostics([laterCode, earlierCode]);
    expect(sorted.map((diagnostic) => diagnostic.code)).toEqual([
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_CONSUME"),
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
    ]);
  });

  test("sorts by owner key before root cause", () => {
    const laterOwner = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      ownerKey: "function:z",
      rootCauseKey: "body",
      stableDetail: "a",
    });
    const earlierOwner = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      ownerKey: "function:a",
      rootCauseKey: "body",
      stableDetail: "b",
    });

    const sorted = sortProofCheckDiagnostics([laterOwner, earlierOwner]);
    expect(sorted.map((diagnostic) => diagnostic.order.ownerKey)).toEqual([
      "function:a",
      "function:z",
    ]);
  });

  test("sorts by root cause before stable detail", () => {
    const laterCause = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "z-cause",
      stableDetail: "a",
    });
    const earlierCause = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "a-cause",
      stableDetail: "b",
    });

    const sorted = sortProofCheckDiagnostics([laterCause, earlierCause]);
    expect(sorted.map((diagnostic) => diagnostic.order.rootCauseKey)).toEqual([
      "a-cause",
      "z-cause",
    ]);
  });

  test("falls back to stable detail when earlier keys agree", () => {
    const laterDetail = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "body",
      stableDetail: "z",
    });
    const earlierDetail = makeDiagnostic({
      code: unsatisfiedRequirementCode,
      message: "m",
      ownerKey: "function:main",
      rootCauseKey: "body",
      stableDetail: "a",
    });

    const sorted = sortProofCheckDiagnostics([laterDetail, earlierDetail]);
    expect(sorted.map((diagnostic) => diagnostic.order.stableDetail)).toEqual(["a", "z"]);
  });
});

describe("counterexample shell types", () => {
  test("diagnostics accept counterexample paths with state snapshots", () => {
    const emptySnapshot = {
      stateKey: "state:before",
      livePlaces: [],
      movedOrConsumedPlaces: [],
      loans: [],
      obligations: [],
      sessions: [],
      validations: [],
      attempts: [],
      facts: [],
      privateStateGenerations: [],
      capabilities: [],
    };
    const counterexample: ProofCounterexamplePath = {
      pathKey: "path:main:1",
      frames: [
        {
          pathFrameKey: "frame:0",
          functionInstanceId: "function:main",
          blockKey: "block:entry",
          programPointKey: "statement:1",
          originKey: "main.wr:10:5",
          beforeState: emptySnapshot,
          afterState: { ...emptySnapshot, stateKey: "state:after" },
          failedComponentKeys: ["fact:missing"],
        },
      ],
    };

    const diagnostic = proofCheckDiagnostic({
      severity: "error",
      code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
      messageTemplateId: "requirement.missing",
      messageArguments: [{ kind: "text", value: "detail" }],
      message: "missing requirement",
      ownerKey: "function:main",
      rootCauseKey: "missing:fact",
      stableDetail: "fact:missing",
      counterexample,
    });

    expect(diagnostic.counterexample).toEqual(counterexample);
  });
});
