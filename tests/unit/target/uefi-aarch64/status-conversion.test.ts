import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64StatusPolicy,
  efiErrorStatus,
  fingerprintUefiAArch64StatusPolicy,
  validateUefiAArch64StatusPolicy,
} from "../../../../src/target/uefi-aarch64";
import { stableHash, stableJson } from "../../../../src/shared/stable-json";
import { mapUefiAArch64EntryResultToStatus } from "../../../support/target/uefi-aarch64/fake-status-conversion";
import { UEFI_STATUS_GOLDEN } from "../../../support/target/uefi-aarch64/status-golden-fixtures";

describe("UEFI AArch64 status conversion", () => {
  test("freezes v1 EFI_STATUS constants against independent golden data", () => {
    const policy = canonicalUefiAArch64StatusPolicy();

    expect(Object.isFrozen(policy)).toBe(true);
    expect(policy.success).toBe(UEFI_STATUS_GOLDEN.success);
    expect(policy.loadError).toBe(UEFI_STATUS_GOLDEN.loadError);
    expect(policy.invalidParameter).toBe(UEFI_STATUS_GOLDEN.invalidParameter);
    expect(policy.unsupported).toBe(UEFI_STATUS_GOLDEN.unsupported);
    expect(policy.badBufferSize).toBe(UEFI_STATUS_GOLDEN.badBufferSize);
    expect(policy.bufferTooSmall).toBe(UEFI_STATUS_GOLDEN.bufferTooSmall);
    expect(policy.deviceError).toBe(UEFI_STATUS_GOLDEN.deviceError);
    expect(policy.notFound).toBe(UEFI_STATUS_GOLDEN.notFound);
    expect(policy.aborted).toBe(UEFI_STATUS_GOLDEN.aborted);
    expect(policy.securityViolation).toBe(UEFI_STATUS_GOLDEN.securityViolation);
    expect(policy.panicStatus).toBe("aborted");
  });

  test("derives error statuses through EFIERR semantics", () => {
    expect(efiErrorStatus(1n)).toBe(UEFI_STATUS_GOLDEN.loadError);
    expect(efiErrorStatus(0x1an)).toBe(UEFI_STATUS_GOLDEN.securityViolation);
  });

  test("rejects invalid EFIERR inputs", () => {
    expect(() => efiErrorStatus(0n)).toThrow(RangeError);
    expect(() => efiErrorStatus(-1n)).toThrow(RangeError);
    expect(() => efiErrorStatus(1n << 63n)).toThrow(RangeError);
  });

  test("maps source entry result shapes to firmware status", () => {
    const policy = canonicalUefiAArch64StatusPolicy();

    expect(mapUefiAArch64EntryResultToStatus({ kind: "success" }, policy)).toBe(policy.success);
    expect(mapUefiAArch64EntryResultToStatus({ kind: "panic" }, policy)).toBe(policy.aborted);
    expect(mapUefiAArch64EntryResultToStatus({ kind: "entry-context-invalid" }, policy)).toBe(
      policy.invalidParameter,
    );
    expect(
      mapUefiAArch64EntryResultToStatus(
        { kind: "target-error", errorKind: "securityViolation" },
        policy,
      ),
    ).toBe(policy.securityViolation);
  });

  test("maps every target-certified source error kind through a closed table", () => {
    const policy = canonicalUefiAArch64StatusPolicy();
    const cases = [
      ["loadError", policy.loadError],
      ["invalidParameter", policy.invalidParameter],
      ["unsupported", policy.unsupported],
      ["badBufferSize", policy.badBufferSize],
      ["bufferTooSmall", policy.bufferTooSmall],
      ["deviceError", policy.deviceError],
      ["notFound", policy.notFound],
      ["aborted", policy.aborted],
      ["securityViolation", policy.securityViolation],
    ] as const;

    for (const [errorKind, status] of cases) {
      expect(mapUefiAArch64EntryResultToStatus({ kind: "target-error", errorKind }, policy)).toBe(
        status,
      );
    }
  });

  test("validates status policies with deterministic diagnostics", () => {
    const valid = validateUefiAArch64StatusPolicy(canonicalUefiAArch64StatusPolicy());
    expect(valid.kind).toBe("ok");

    const malformed = validateUefiAArch64StatusPolicy(
      canonicalUefiAArch64StatusPolicy({ invalidParameter: 2n }),
    );

    expect(malformed.kind).toBe("error");
    if (malformed.kind === "error") {
      expect(malformed.diagnostics).toEqual([
        {
          code: "UEFI_AARCH64_STATUS_CONVERSION_FAILED",
          ownerKey: "uefi-aarch64.status-conversion",
          stableDetail: "invalidParameter must equal EFIERR(2)",
        },
      ]);
      expect(malformed.verification.runs).toEqual([
        {
          verifierKey: "uefi-aarch64.status-conversion",
          runKey: "status-policy",
          status: "failed",
          stableDetail: "invalidParameter must equal EFIERR(2)",
        },
      ]);
    }
  });

  test("fingerprints status policies with stable JSON hashing", () => {
    const policy = canonicalUefiAArch64StatusPolicy();

    expect(fingerprintUefiAArch64StatusPolicy(policy)).toBe(stableHash(stableJson(policy)));
  });
});
