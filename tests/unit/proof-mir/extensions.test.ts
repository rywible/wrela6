import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { rejectUnsupportedProofMirExtensionConstruct } from "../../../src/proof-mir/extensions/extension-gates";
import { proofMirOriginForTest } from "../../support/proof-mir/proof-mir-fakes";

describe("rejectUnsupportedProofMirExtensionConstruct", () => {
  test("yield is rejected when coroutine semantics are not enabled", () => {
    const result = rejectUnsupportedProofMirExtensionConstruct({
      construct: "coroutineYield",
      targetFeatures: [],
      monoMetadataAvailable: false,
      origin: proofMirOriginForTest("yield"),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      return;
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
    ]);
  });

  test("stream for is rejected when stream loop semantics are not enabled", () => {
    const result = rejectUnsupportedProofMirExtensionConstruct({
      construct: "streamLoop",
      targetFeatures: [],
      monoMetadataAvailable: false,
      origin: proofMirOriginForTest("stream.for"),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      return;
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
    ]);
  });

  test("cross-core construct is rejected without mono concurrency metadata", () => {
    const result = rejectUnsupportedProofMirExtensionConstruct({
      construct: "crossCoreOwnership",
      targetFeatures: ["crossCoreOwnership"],
      monoMetadataAvailable: false,
      origin: proofMirOriginForTest("core.pin"),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      return;
    }
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      proofMirDiagnosticCode("PROOF_MIR_MISSING_CONCURRENCY_METADATA"),
    ]);
  });

  test("coroutine yield passes when coroutineYield feature is enabled", () => {
    const result = rejectUnsupportedProofMirExtensionConstruct({
      construct: "coroutineYield",
      targetFeatures: ["coroutineYield"],
      monoMetadataAvailable: false,
      origin: proofMirOriginForTest("yield"),
    });

    expect(result).toEqual({ kind: "ok" });
  });

  test("stream loop passes when streamLoop feature is enabled", () => {
    const result = rejectUnsupportedProofMirExtensionConstruct({
      construct: "streamLoop",
      targetFeatures: ["streamLoop"],
      monoMetadataAvailable: false,
      origin: proofMirOriginForTest("stream.for"),
    });

    expect(result).toEqual({ kind: "ok" });
  });

  test("cross-core construct passes when mono concurrency metadata is available", () => {
    const result = rejectUnsupportedProofMirExtensionConstruct({
      construct: "crossCoreOwnership",
      targetFeatures: [],
      monoMetadataAvailable: true,
      origin: proofMirOriginForTest("core.pin"),
    });

    expect(result).toEqual({ kind: "ok" });
  });
});
