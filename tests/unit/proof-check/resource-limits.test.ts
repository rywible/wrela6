import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirBlockId, proofMirStatementId } from "../../../src/proof-mir/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  enforceProofCheckResourceLimits,
  proofCheckResourceLimitHooks,
  proofCheckResourceLimitsForTest,
} from "../../../src/proof-check/kernel/resource-limits";
import type { ProofCheckProgramPoint } from "../../../src/proof-check/kernel/transition-api";
import {
  activeFactForTest,
  exclusiveLoanForTest,
  obligationStateForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";

const defaultFunctionInstanceId = monoInstanceId("1");

export function proofCheckProgramPointForTest(blockKey: string): ProofCheckProgramPoint {
  const blockId = proofMirBlockId(Number(blockKey.split(":")[1] ?? "0"));
  return {
    kind: "statement",
    functionInstanceId: defaultFunctionInstanceId,
    blockId,
    statementId: proofMirStatementId(0),
  };
}

describe("proofCheckResourceLimitsForTest", () => {
  test("returns positive safe integers for every limit key", () => {
    const limits = proofCheckResourceLimitsForTest();
    expect(limits.maximumReachableFunctions).toBeGreaterThan(0);
    expect(limits.maximumBlocksPerFunction).toBeGreaterThan(0);
    expect(limits.maximumEdgesPerFunction).toBeGreaterThan(0);
    expect(limits.maximumAcceptedStateVariantsPerBlock).toBeGreaterThan(0);
    expect(limits.maximumActiveFactsPerState).toBeGreaterThan(0);
    expect(limits.maximumActiveLoansPerState).toBeGreaterThan(0);
    expect(limits.maximumOpenObligationsPerState).toBeGreaterThan(0);
    expect(limits.maximumOpenValidationsPerState).toBeGreaterThan(0);
    expect(limits.maximumOpenAttemptsPerState).toBeGreaterThan(0);
    expect(limits.maximumLiveCapabilitiesPerState).toBeGreaterThan(0);
    expect(limits.maximumCounterexampleFrames).toBeGreaterThan(0);
    expect(limits.maximumStagedPacketEntriesPerFunction).toBeGreaterThan(0);
  });
});

describe("enforceProofCheckResourceLimits", () => {
  test("state fact limit produces deterministic resource-limit diagnostic", () => {
    const result = enforceProofCheckResourceLimits({
      limits: { ...proofCheckResourceLimitsForTest(), maximumActiveFactsPerState: 1 },
      location: proofCheckProgramPointForTest("block:0"),
      state: proofCheckStateForTest({
        facts: [activeFactForTest("fact:a"), activeFactForTest("fact:b")],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RESOURCE_LIMIT_EXCEEDED"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("maximumActiveFactsPerState");
    expect(result.diagnostics[0]?.stableDetail).toContain("function:1");
    expect(result.diagnostics[0]?.stableDetail).toContain("block:0");
    expect(result.diagnostics[0]?.stableDetail).toContain("state:");
  });

  test("accepts state within active fact limit", () => {
    const result = enforceProofCheckResourceLimits({
      limits: { ...proofCheckResourceLimitsForTest(), maximumActiveFactsPerState: 2 },
      location: proofCheckProgramPointForTest("block:0"),
      state: proofCheckStateForTest({
        facts: [activeFactForTest("fact:a"), activeFactForTest("fact:b")],
      }),
    });

    expect(result.kind).toBe("ok");
  });

  test("loan limit produces resource-limit diagnostic with limit key", () => {
    const result = enforceProofCheckResourceLimits({
      limits: { ...proofCheckResourceLimitsForTest(), maximumActiveLoansPerState: 1 },
      location: proofCheckProgramPointForTest("block:0"),
      state: proofCheckStateForTest({
        loans: [exclusiveLoanForTest("place:a"), exclusiveLoanForTest("place:b")],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("maximumActiveLoansPerState");
  });

  test("obligation limit counts only open obligations", () => {
    const result = enforceProofCheckResourceLimits({
      limits: { ...proofCheckResourceLimitsForTest(), maximumOpenObligationsPerState: 1 },
      location: proofCheckProgramPointForTest("block:0"),
      state: proofCheckStateForTest({
        obligations: [
          obligationStateForTest("obligation:a"),
          { obligationKey: "obligation:b", status: "discharged" },
        ],
      }),
    });

    expect(result.kind).toBe("ok");
  });

  test("reachable function metric limit rejects deterministically", () => {
    const result = enforceProofCheckResourceLimits({
      limits: { ...proofCheckResourceLimitsForTest(), maximumReachableFunctions: 1 },
      location: proofCheckProgramPointForTest("block:0"),
      state: proofCheckStateForTest(),
      metrics: { reachableFunctionCount: 2 },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("maximumReachableFunctions");
  });

  test("accepted state variant metric limit includes block key", () => {
    const result = enforceProofCheckResourceLimits({
      limits: { ...proofCheckResourceLimitsForTest(), maximumAcceptedStateVariantsPerBlock: 1 },
      location: proofCheckProgramPointForTest("block:0"),
      state: proofCheckStateForTest(),
      metrics: { acceptedStateVariantCount: 2 },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("maximumAcceptedStateVariantsPerBlock");
    expect(result.diagnostics[0]?.stableDetail).toContain("block:0");
  });
});

describe("proofCheckResourceLimitHooks", () => {
  test("beforeRecordTransition rejects when state exceeds fact limit", () => {
    const hooks = proofCheckResourceLimitHooks({
      ...proofCheckResourceLimitsForTest(),
      maximumActiveFactsPerState: 1,
    });

    const result = hooks.beforeRecordTransition?.({
      functionInstanceId: defaultFunctionInstanceId,
      location: proofCheckProgramPointForTest("block:0"),
      state: proofCheckStateForTest({
        facts: [activeFactForTest("fact:a"), activeFactForTest("fact:b")],
      }),
    });

    expect(result?.kind).toBe("error");
    if (result?.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RESOURCE_LIMIT_EXCEEDED"),
    );
  });

  test("beforeAcceptState rejects when block exceeds accepted state variants", () => {
    const hooks = proofCheckResourceLimitHooks({
      ...proofCheckResourceLimitsForTest(),
      maximumAcceptedStateVariantsPerBlock: 1,
    });
    const blockId = proofMirBlockId(0);

    hooks.beforeAcceptState?.({
      functionInstanceId: defaultFunctionInstanceId,
      blockId,
      state: proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] }),
    });

    const result = hooks.beforeAcceptState?.({
      functionInstanceId: defaultFunctionInstanceId,
      blockId,
      state: proofCheckStateForTest({ facts: [activeFactForTest("fact:b")] }),
    });

    expect(result?.kind).toBe("error");
    if (result?.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("maximumAcceptedStateVariantsPerBlock");
  });
});
