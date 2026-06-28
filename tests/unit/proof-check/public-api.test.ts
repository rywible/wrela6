import { describe, expect, test } from "bun:test";

import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofCheckPlatformContractCatalog,
  type ProofCheckPlatformContractCatalog,
} from "../../../src/proof-check/authority/platform-contracts";
import {
  proofCheckRuntimeCatalog,
  type ProofCheckRuntimeCatalog,
} from "../../../src/proof-check/authority/runtime-authority";
import {
  proofSemanticsCompanion,
  type ProofSemanticsCompanion,
} from "../../../src/proof-check/authority/semantics-companion";
import {
  proofCheckTypeFactCatalog,
  type ProofCheckTypeFactCatalog,
} from "../../../src/proof-check/authority/type-fact-authority";
import {
  checkProofAndResources,
  type CheckProofAndResourcesInput,
  type ProofCheckResourceLimits,
} from "../../../src/proof-check/proof-checker";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import { targetId } from "../../../src/semantic/ids";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-build-input";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";

function authorityCatalogFingerprintForPublicApiTest(
  authorityKind: ProofAuthorityFingerprint["authorityKind"],
): ProofAuthorityFingerprint {
  return {
    authorityKind,
    targetId: targetId("uefi-aarch64"),
    version: "public-api-v1",
    digestAlgorithm: "sha256",
    digestHex: "dd".repeat(32),
  };
}

function proofMirProgramForPublicApiTest(): ProofMirProgram {
  const result = buildProofMir(closedProofMirFixture());
  if (result.kind !== "ok") {
    throw new Error(
      `proofMirProgramForPublicApiTest failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.mir;
}

function layoutFactProgramForPublicApiTest(): LayoutFactProgram {
  return proofMirProgramForPublicApiTest().layout;
}

function proofCheckResourceLimitsForPublicApiTest(): ProofCheckResourceLimits {
  return {
    maximumReachableFunctions: 256,
    maximumBlocksPerFunction: 512,
    maximumEdgesPerFunction: 1024,
    maximumAcceptedStateVariantsPerBlock: 64,
    maximumActiveFactsPerState: 512,
    maximumActiveLoansPerState: 128,
    maximumOpenObligationsPerState: 128,
    maximumOpenValidationsPerState: 64,
    maximumOpenAttemptsPerState: 64,
    maximumLiveCapabilitiesPerState: 128,
    maximumCounterexampleFrames: 64,
    maximumStagedPacketEntriesPerFunction: 512,
  };
}

function proofCheckPlatformContractCatalogForPublicApiTest(): ProofCheckPlatformContractCatalog {
  const result = proofCheckPlatformContractCatalog({
    fingerprint: authorityCatalogFingerprintForPublicApiTest("platform"),
    entries: [],
  });
  if (result.kind !== "ok") {
    throw new Error(
      `proofCheckPlatformContractCatalogForPublicApiTest failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.catalog;
}

function proofCheckRuntimeCatalogForPublicApiTest(): ProofCheckRuntimeCatalog {
  const mir = proofMirProgramForPublicApiTest();
  const result = proofCheckRuntimeCatalog({
    fingerprint: authorityCatalogFingerprintForPublicApiTest("runtime"),
    targetId: mir.runtimeCatalog.targetId,
    features: [...mir.runtimeCatalog.features],
    entries: mir.runtimeCatalog.entries().map((operation) => ({
      authorityKey: `runtime:${operation.name}`,
      operation,
    })),
  });
  if (result.kind !== "ok") {
    throw new Error(
      `proofCheckRuntimeCatalogForPublicApiTest failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.catalog;
}

function proofCheckTypeFactCatalogForPublicApiTest(): ProofCheckTypeFactCatalog {
  const result = proofCheckTypeFactCatalog({
    fingerprint: authorityCatalogFingerprintForPublicApiTest("typeFacts"),
    entries: [],
  });
  if (result.kind !== "ok") {
    throw new Error(
      `proofCheckTypeFactCatalogForPublicApiTest failed: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  return result.catalog;
}

function proofSemanticsCompanionForPublicApiTest(): ProofSemanticsCompanion {
  return proofSemanticsCompanion({
    fingerprint: authorityCatalogFingerprintForPublicApiTest("semantics"),
    targetId: targetId("uefi-aarch64"),
    schemaVersion: "semantics-v1",
    providedJudgments: [],
    judge: () => undefined,
  });
}

function minimalCheckProofAndResourcesInputForTask4(): CheckProofAndResourcesInput {
  return {
    mir: proofMirProgramForPublicApiTest(),
    layout: layoutFactProgramForPublicApiTest(),
    limits: proofCheckResourceLimitsForPublicApiTest(),
    platformContracts: proofCheckPlatformContractCatalogForPublicApiTest(),
    runtimeCatalog: proofCheckRuntimeCatalogForPublicApiTest(),
    typeFacts: proofCheckTypeFactCatalogForPublicApiTest(),
    semantics: proofSemanticsCompanionForPublicApiTest(),
  };
}

describe("proof-check public API", () => {
  test("public proof-check facade accepts closed fixture input", () => {
    const result = checkProofAndResourcesForClosedFixture();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.checkedFunctions.size).toBeGreaterThan(0);
  });

  test("fail-closed facade never returns checked MIR on error", () => {
    const result = checkProofAndResources({
      ...minimalCheckProofAndResourcesInputForTask4(),
      limits: {
        ...proofCheckResourceLimitsForPublicApiTest(),
        maximumReachableFunctions: 0,
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect("checked" in result).toBe(false);
  });

  test("missing limits return input-contract diagnostics instead of throwing", () => {
    const result = checkProofAndResources({} as CheckProofAndResourcesInput);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "PROOF_CHECK_INPUT_CONTRACT_INVALID",
      ),
    ).toBe(true);
  });
});
