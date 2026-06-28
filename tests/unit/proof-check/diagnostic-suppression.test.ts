import { describe, expect, test } from "bun:test";
import {
  proofCheckDiagnostic,
  proofCheckDiagnosticCode,
  type ProofCheckDiagnostic,
} from "../../../src/proof-check/diagnostics";
import {
  applyProofCheckDiagnosticSuppression,
  proofCheckDiagnosticSuppressionHooks,
} from "../../../src/proof-check/kernel/diagnostic-suppression";
import type { ProofCheckSuppressionCandidate } from "../../../src/proof-check/kernel/graph-worklist";

function proofCheckDiagnosticForTest(
  code: string,
  input?: {
    readonly rootCauseKey?: string;
  },
): ProofCheckDiagnostic {
  const validatedCode = proofCheckDiagnosticCode(code);
  return proofCheckDiagnostic({
    severity: "error",
    code,
    messageTemplateId: "test.template",
    messageArguments: [{ kind: "text", value: validatedCode }],
    message: validatedCode,
    ownerKey: "test:owner",
    rootCauseKey: input?.rootCauseKey ?? "test:root-cause",
    stableDetail: validatedCode,
  });
}

describe("applyProofCheckDiagnosticSuppression", () => {
  test("failed join suppresses successor cascade by root cause key", () => {
    const diagnostics = applyProofCheckDiagnosticSuppression({
      diagnostics: [
        proofCheckDiagnosticForTest("PROOF_CHECK_DIVERGENT_JOIN", {
          rootCauseKey: "join:block:merge",
        }),
        proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT", {
          rootCauseKey: "transition:block:after-merge",
        }),
      ],
      suppressionCandidates: [
        {
          rootCauseKey: "join:block:merge",
          suppressedRootCauseKey: "transition:block:after-merge",
        },
      ],
    });

    expect(diagnostics.publicDiagnostics.map((diagnostic) => diagnostic.rootCauseKey)).toEqual([
      "join:block:merge",
    ]);
    expect(diagnostics.suppressionRecords).toEqual([
      {
        suppressedRootCauseKey: "transition:block:after-merge",
        suppressingRootCauseKey: "join:block:merge",
      },
    ]);
  });

  test("keeps independent caller requirements when no suppression candidate links them", () => {
    const diagnostics = applyProofCheckDiagnosticSuppression({
      diagnostics: [
        proofCheckDiagnosticForTest("PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH", {
          rootCauseKey: "summary:callee:1",
        }),
        proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT", {
          rootCauseKey: "requirement:caller:local",
        }),
      ],
      suppressionCandidates: [
        {
          rootCauseKey: "summary:callee:1",
          suppressedRootCauseKey: "summary-import:call-site:2",
        },
      ],
    });

    expect(diagnostics.publicDiagnostics.map((diagnostic) => diagnostic.rootCauseKey)).toEqual([
      "summary:callee:1",
      "requirement:caller:local",
    ]);
  });

  test("does not suppress root-cause diagnostics", () => {
    const diagnostics = applyProofCheckDiagnosticSuppression({
      diagnostics: [
        proofCheckDiagnosticForTest("PROOF_CHECK_INPUT_CONTRACT_INVALID", {
          rootCauseKey: "proof-check:runtime-catalog",
        }),
      ],
      suppressionCandidates: [
        {
          rootCauseKey: "proof-check:runtime-catalog",
          suppressedRootCauseKey: "proof-check:runtime-catalog",
        },
      ],
    });

    expect(diagnostics.publicDiagnostics).toHaveLength(1);
    expect(diagnostics.suppressionRecords).toEqual([]);
  });

  test("applies deterministic ordering to public diagnostics", () => {
    const diagnostics = applyProofCheckDiagnosticSuppression({
      diagnostics: [
        proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT", {
          rootCauseKey: "z-root",
        }),
        proofCheckDiagnosticForTest("PROOF_CHECK_UNTRUSTED_FACT", {
          rootCauseKey: "a-root",
        }),
      ],
      suppressionCandidates: [],
    });

    expect(diagnostics.publicDiagnostics.map((diagnostic) => diagnostic.rootCauseKey)).toEqual([
      "z-root",
      "a-root",
    ]);
  });
});

describe("proofCheckDiagnosticSuppressionHooks", () => {
  test("filterPublicDiagnostics delegates to applyProofCheckDiagnosticSuppression", () => {
    const hooks = proofCheckDiagnosticSuppressionHooks();
    const candidates: ProofCheckSuppressionCandidate[] = [
      {
        rootCauseKey: "join:block:merge",
        suppressedRootCauseKey: "transition:block:after-merge",
      },
    ];
    const diagnostics = [
      proofCheckDiagnosticForTest("PROOF_CHECK_DIVERGENT_JOIN", {
        rootCauseKey: "join:block:merge",
      }),
      proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT", {
        rootCauseKey: "transition:block:after-merge",
      }),
    ];

    const filtered = hooks.filterPublicDiagnostics?.({
      diagnostics,
      suppressionCandidates: candidates,
    });

    expect(filtered?.map((diagnostic) => diagnostic.rootCauseKey)).toEqual(["join:block:merge"]);
  });
});
