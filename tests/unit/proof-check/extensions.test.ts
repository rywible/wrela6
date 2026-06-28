import { describe, expect, test } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkProofCheckExtensionTransfer,
  isProofCheckExtensionTransferCategory,
  PROOF_CHECK_EXTENSION_TRANSFER_CATEGORIES,
} from "../../../src/proof-check/domains/extensions";
import { proofSemanticsCompanionFake } from "../../support/proof-check/authority-fakes";
import { crossCoreOwnershipInputForTest } from "./cross-core-ownership.test";
import { extensionGateInputForTest } from "./extension-gates.test";
import { streamLoopInputForTest } from "./stream-loop.test";
import { yieldResumeInputForTest } from "./yield-resume.test";

describe("ProofCheckExtensionTransferCategory", () => {
  test("closed extension transfer categories are exactly the dispatch surface", () => {
    expect([...PROOF_CHECK_EXTENSION_TRANSFER_CATEGORIES].sort()).toEqual([
      "crossCoreOwnership",
      "extensionGate",
      "streamLoop",
      "yieldResume",
    ]);
  });

  test("isProofCheckExtensionTransferCategory rejects unknown categories", () => {
    expect(isProofCheckExtensionTransferCategory("extensionGate")).toBe(true);
    expect(isProofCheckExtensionTransferCategory("targetSpecific")).toBe(false);
  });
});

describe("checkProofCheckExtensionTransfer", () => {
  test("extension dispatcher delegates cross-core ownership by category", () => {
    const result = checkProofCheckExtensionTransfer({
      category: "crossCoreOwnership",
      input: crossCoreOwnershipInputForTest({
        companion: proofSemanticsCompanionFake({ providedJudgments: ["crossCoreOwnership"] }),
      }),
    });

    expect(result.delegatedTo).toBe("crossCoreOwnership");
  });

  test("unknown extension category rejects with PROOF_CHECK_UNSAFE_EXTENSION", () => {
    const result = checkProofCheckExtensionTransfer({
      category: "targetSpecific",
      input: {},
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.delegatedTo).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSAFE_EXTENSION"),
    );
    expect(result.diagnostics[0]?.ownerKey).toBe("extension:targetSpecific");
    expect(result.diagnostics[0]?.rootCauseKey).toBe("extension:targetSpecific");
  });

  test("extension dispatcher delegates extension gate by category", () => {
    const result = checkProofCheckExtensionTransfer({
      category: "extensionGate",
      input: extensionGateInputForTest(),
    });

    expect(result.delegatedTo).toBe("extensionGate");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patch.kind).toBe("extensionTransfer");
    expect(result.packetEntries).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  test("extension dispatcher delegates yield/resume by category", () => {
    const result = checkProofCheckExtensionTransfer({
      category: "yieldResume",
      input: yieldResumeInputForTest(),
    });

    expect(result.delegatedTo).toBe("yieldResume");
  });

  test("extension dispatcher delegates stream loop by category", () => {
    const result = checkProofCheckExtensionTransfer({
      category: "streamLoop",
      input: streamLoopInputForTest(),
    });

    expect(result.delegatedTo).toBe("streamLoop");
  });

  test("accepted cross-core transfer passes through delegated packet entries without adding extras", () => {
    const result = checkProofCheckExtensionTransfer({
      category: "crossCoreOwnership",
      input: crossCoreOwnershipInputForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.delegatedTo).toBe("crossCoreOwnership");
    expect(result.packetEntries.length).toBeGreaterThan(0);
    expect(result.diagnostics).toEqual([]);
    expect(result.patch.kind).toBe("crossCoreOwnership");
    expect(result.patch.entries.length).toBeGreaterThan(0);
  });

  test("delegated domain error diagnostics pass through with delegatedTo", () => {
    const result = checkProofCheckExtensionTransfer({
      category: "extensionGate",
      input: extensionGateInputForTest({
        enabledFeatureGates: [],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.delegatedTo).toBe("extensionGate");
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSAFE_EXTENSION"),
    );
  });
});
