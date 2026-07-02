import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64FirmwareAbiSurface,
  fingerprintUefiAArch64FirmwareAbi,
  validateUefiAArch64FirmwareAbiSurface,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI AArch64 firmware ABI", () => {
  test("pins UEFI handoff locations without owning a register catalog", () => {
    const surface = canonicalUefiAArch64FirmwareAbiSurface({
      backendAbiSurfaceFingerprint: "backend-abi:test",
      physicalRegisterModelFingerprint: "physical-registers:test",
    });

    expect(surface.imageHandleLocation).toEqual({ kind: "intReg", index: 0 });
    expect(surface.systemTableLocation).toEqual({ kind: "intReg", index: 1 });
    expect(surface.returnStatusLocation).toEqual({ kind: "intReg", index: 0 });
    expect(surface.pointerWidthBits).toBe(64);
    expect(surface.statusWidthBits).toBe(64);
    expect(surface.stackAlignmentBytes).toBe(16);
    expect(surface.redZone).toBe(false);
    expect("callerSavedRegisters" in surface).toBe(false);
    expect("calleeSavedRegisters" in surface).toBe(false);
  });

  test("rejects ABI records with missing backend fingerprints", () => {
    const result = validateUefiAArch64FirmwareAbiSurface(
      canonicalUefiAArch64FirmwareAbiSurface({
        backendAbiSurfaceFingerprint: "",
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "firmware-abi:missing-backend-abi-fingerprint",
    );
  });

  test("fingerprint changes when authenticated backend identities change", () => {
    const baseline = canonicalUefiAArch64FirmwareAbiSurface({
      backendAbiSurfaceFingerprint: "backend-abi:baseline",
      physicalRegisterModelFingerprint: "physical-registers:baseline",
    });
    const changedBackend = canonicalUefiAArch64FirmwareAbiSurface({
      backendAbiSurfaceFingerprint: "backend-abi:changed",
      physicalRegisterModelFingerprint: "physical-registers:baseline",
    });
    const changedRegisters = canonicalUefiAArch64FirmwareAbiSurface({
      backendAbiSurfaceFingerprint: "backend-abi:baseline",
      physicalRegisterModelFingerprint: "physical-registers:changed",
    });

    expect(fingerprintUefiAArch64FirmwareAbi(baseline)).not.toBe(
      fingerprintUefiAArch64FirmwareAbi(changedBackend),
    );
    expect(fingerprintUefiAArch64FirmwareAbi(baseline)).not.toBe(
      fingerprintUefiAArch64FirmwareAbi(changedRegisters),
    );
  });
});
