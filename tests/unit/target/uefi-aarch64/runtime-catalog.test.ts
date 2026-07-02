import { describe, expect, test } from "bun:test";

import { normalizedProofMirRuntimeOperationContent } from "../../../../src/runtime/runtime-catalog";
import { proofMirRuntimeOperationId } from "../../../../src/runtime/runtime-catalog-types";
import {
  authenticateUefiAArch64RuntimeMaterializations,
  canonicalUefiAArch64RuntimeMaterializations,
  fingerprintUefiAArch64ProofMirRuntimeCatalog,
  fingerprintUefiAArch64RuntimeOperation,
} from "../../../../src/target/uefi-aarch64";
import {
  proofMirRuntimeCatalogWithUefiOperations,
  proofMirRuntimeOperationFake,
} from "../../../support/proof-mir/proof-mir-fakes";

describe("UEFI AArch64 runtime materialization", () => {
  test("authenticates v1 materializations against Proof MIR runtime catalog records", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations();
    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
      materializations: canonicalUefiAArch64RuntimeMaterializations(runtimeCatalog),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.value.map((record) => record.runtimeId)).toEqual([
      proofMirRuntimeOperationId(1000),
      proofMirRuntimeOperationId(1001),
      proofMirRuntimeOperationId(1002),
      proofMirRuntimeOperationId(1003),
      proofMirRuntimeOperationId(1004),
      proofMirRuntimeOperationId(1005),
      proofMirRuntimeOperationId(1006),
    ]);
    expect(result.value.map((record) => record.linkageName)).toEqual([
      "__wrela_uefi_status_from_boot_result",
      "__wrela_uefi_panic_to_status",
      "__wrela_uefi_entry_initialize_context",
      "__wrela_uefi_console_write_ascii_debug",
      "__wrela_uefi_string_utf16_static",
      "__wrela_runtime_validated_buffer_read_slow",
      "__wrela_uefi_exit_boot_services_with_fresh_map",
    ]);
    expect(result.value.map((record) => record.materialization)).toEqual([
      "backend-object",
      "inline-only",
      "backend-object",
      "source-runtime",
      "source-runtime",
      "source-runtime",
      "backend-object",
    ]);
  });

  test("rejects a materialization whose runtime operation is absent", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations({ operations: [] });
    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
      materializations: canonicalUefiAArch64RuntimeMaterializations(),
    });

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith("runtime-materialization:missing-runtime-operation:"),
      ),
    ).toBe(true);
  });

  test("rejects stale runtime operation fingerprints", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations();
    const [first, ...rest] = canonicalUefiAArch64RuntimeMaterializations(runtimeCatalog);
    if (first === undefined) throw new Error("expected canonical materialization");

    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
      materializations: [
        {
          ...first,
          runtimeOperationFingerprint: `${first.runtimeOperationFingerprint}:stale`,
        },
        ...rest,
      ],
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "runtime-materialization:stale-runtime-fingerprint:1000",
    );
  });

  test("rejects duplicate runtime IDs in materializations", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations();
    const [first] = canonicalUefiAArch64RuntimeMaterializations(runtimeCatalog);
    if (first === undefined) throw new Error("expected canonical materialization");

    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
      materializations: [first, first],
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "runtime-materialization:duplicate-runtime-id:1000",
    );
  });

  test("rejects missing canonical v1 runtime materializations", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations();
    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
      materializations: canonicalUefiAArch64RuntimeMaterializations(runtimeCatalog).filter(
        (materialization) => String(materialization.runtimeId) !== "1002",
      ),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "runtime-materialization:missing-required-runtime-id:1002",
    );
  });

  test("rejects canonical runtime materializations with the wrong emission mode", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations();
    const materializations = canonicalUefiAArch64RuntimeMaterializations(runtimeCatalog);
    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
      materializations: materializations.map((materialization) =>
        String(materialization.runtimeId) === "1000"
          ? { ...materialization, materialization: "inline-only" as const }
          : materialization,
      ),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "runtime-materialization:materialization-kind-mismatch:1000:expected:backend-object:actual:inline-only",
    );
  });

  test("rejects stale runtime catalog fingerprints", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations();
    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: "stale-runtime-catalog",
      materializations: canonicalUefiAArch64RuntimeMaterializations(runtimeCatalog),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "runtime-materialization:stale-runtime-catalog-fingerprint",
    );
  });

  test("fingerprints runtime operations from normalized Proof MIR runtime operation content", () => {
    const operation = proofMirRuntimeOperationFake({
      runtimeId: proofMirRuntimeOperationId(1000),
      name: "uefi.status.from-boot-result",
      loweringOwner: "uefiStatusConversion",
    });
    const sameContentDifferentId = { ...operation, runtimeId: proofMirRuntimeOperationId(2000) };

    expect(fingerprintUefiAArch64RuntimeOperation(operation)).toBe(
      fingerprintUefiAArch64RuntimeOperation(sameContentDifferentId),
    );
    expect(normalizedProofMirRuntimeOperationContent(operation)).not.toContain("runtimeId");
  });

  test("leaves coroutine and transfer helpers unavailable unless cataloged and materialized", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations({
      operations: [
        proofMirRuntimeOperationFake({
          runtimeId: proofMirRuntimeOperationId(2000),
          name: "runtime.coroutine.frame",
          loweringOwner: "coroutineFrame",
        }),
      ],
    });

    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: fingerprintUefiAArch64ProofMirRuntimeCatalog(runtimeCatalog),
      materializations: canonicalUefiAArch64RuntimeMaterializations(),
    });

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.every(
        (diagnostic) =>
          !diagnostic.stableDetail.includes("runtime.coroutine.frame") &&
          !diagnostic.stableDetail.includes("moveRingCoreTransfer"),
      ),
    ).toBe(true);
  });
});
