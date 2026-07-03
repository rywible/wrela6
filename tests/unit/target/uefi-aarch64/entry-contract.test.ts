import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  aarch64UefiImageProfileFromEntryProfile,
  canonicalUefiAArch64EntryProfile,
  canonicalUefiAArch64StatusPolicy,
  fingerprintUefiAArch64EntryProfile,
  validateUefiAArch64BootFunctionContract,
  validateUefiAArch64EntryProfile,
} from "../../../../src/target/uefi-aarch64";
import { stableHash, stableJson } from "../../../../src/shared/stable-json";
import { evaluateUefiAArch64EntryContextValidation } from "../../../support/target/uefi-aarch64/fake-entry-context-validation";

describe("UEFI AArch64 source boot function contract", () => {
  test("pins the v1 entry profile", () => {
    expect(canonicalUefiAArch64EntryProfile()).toEqual({
      peEntryLinkageName: "__wrela_uefi_entry",
      imageEntryShimSymbol: "wrela.image.entry_shim",
      bootFunctionSymbol: "wrela.image.boot",
      imageHandleSourceKey: "uefi.imageHandle",
      systemTableSourceKey: "uefi.systemTable",
      entryCallConvention: "uefi-aapcs64",
      bootCallConvention: "wrela-source",
      statusResultRegister: "x0",
      thunkStrategy: "framed-call",
    });
  });

  test("rejects raw firmware parameters in the source boot function", () => {
    const result = validateUefiAArch64BootFunctionContract({
      sourceVisibleParameters: [
        { name: "imageHandle", typeKey: "EFI_HANDLE" },
        { name: "systemTable", typeKey: "EFI_SYSTEM_TABLE*" },
      ],
      resultShape: { kind: "unit-success" },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry-contract:raw-firmware-parameter:imageHandle:EFI_HANDLE",
      "entry-contract:raw-firmware-parameter:systemTable:EFI_SYSTEM_TABLE*",
      "entry-contract:unsupported-source-visible-parameters",
    ]);
    expect(result.diagnostics.every((diagnostic) => diagnostic.ownerKey === "entry-contract")).toBe(
      true,
    );
  });

  test("rejects arbitrary source-visible parameters", () => {
    const result = validateUefiAArch64BootFunctionContract({
      sourceVisibleParameters: [{ name: "argc", typeKey: "i32" }],
      resultShape: { kind: "unit-success" },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "entry-contract:unsupported-source-visible-parameters",
    );
  });

  test("accepts the canonical source-visible UefiFirmware capability parameter", () => {
    const result = validateUefiAArch64BootFunctionContract({
      sourceVisibleParameters: [
        { name: "firmware", typeKey: "wrela_std.target.uefi.UefiFirmware" },
      ],
      resultShape: {
        kind: "target-certified-result",
        errorTypeKey: "wrela_std.target.uefi.BootError",
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sourceVisibleParameters).toEqual([
      { name: "firmware", typeKey: "wrela_std.target.uefi.UefiFirmware" },
    ]);
  });

  test("accepts lowered source-type fingerprints for the firmware capability parameter", () => {
    const result = validateUefiAArch64BootFunctionContract({
      sourceVisibleParameters: [{ name: "firmware", typeKey: "source:30:8" }],
      resultShape: { kind: "target-certified-result", errorTypeKey: "uefi.Status" },
    });

    expect(result.kind).toBe("ok");
  });

  test("accepts only the v1 source boot result shapes", () => {
    const acceptedShapes = [
      { kind: "unit-success" },
      { kind: "target-certified-result", errorTypeKey: "uefi.Status" },
      { kind: "never" },
      { kind: "panic" },
    ] as const;

    for (const resultShape of acceptedShapes) {
      const result = validateUefiAArch64BootFunctionContract({
        sourceVisibleParameters: [],
        resultShape,
      });
      expect(result.kind).toBe("ok");
    }

    const rejected = validateUefiAArch64BootFunctionContract({
      sourceVisibleParameters: [],
      resultShape: { kind: "efi-status" },
    });

    expect(rejected.kind).toBe("error");
    expect(rejected.diagnostics[0]?.stableDetail).toBe(
      "entry-contract:unsupported-result-shape:efi-status",
    );
  });

  test("validates profile symbol shape and uniqueness with deterministic diagnostics", () => {
    const result = validateUefiAArch64EntryProfile(
      canonicalUefiAArch64EntryProfile({
        imageEntryShimSymbol: "wrela.image.boot",
        bootFunctionSymbol: "wrela.image.boot",
        peEntryLinkageName: "not ascii",
      } as unknown as Partial<ReturnType<typeof canonicalUefiAArch64EntryProfile>>),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "entry-contract:duplicate-symbol:bootFunctionSymbol:imageEntryShimSymbol:wrela.image.boot",
      "entry-contract:invalid-ascii-symbol:peEntryLinkageName:not ascii",
    ]);
  });

  test("adapts the entry profile to the lower AArch64 UEFI image shape", () => {
    expect(aarch64UefiImageProfileFromEntryProfile(canonicalUefiAArch64EntryProfile())).toEqual({
      entryShimSymbol: "wrela.image.entry_shim",
      bootFunctionSymbol: "wrela.image.boot",
      imageHandleLocation: { kind: "intReg", index: 0 },
      systemTableLocation: { kind: "intReg", index: 1 },
      firmwareTableKeys: ["uefi.boot-services", "uefi.system-table"],
    });
  });

  test("maps missing system table context to EFI_INVALID_PARAMETER before source boot code", () => {
    const policy = canonicalUefiAArch64StatusPolicy();

    expect(evaluateUefiAArch64EntryContextValidation({ systemTable: 0x1000n, policy })).toEqual({
      kind: "ok",
    });
    expect(evaluateUefiAArch64EntryContextValidation({ systemTable: null, policy })).toEqual({
      kind: "return-status",
      status: policy.invalidParameter,
    });
  });

  test("fingerprints entry profiles with stable JSON hashing", () => {
    const profile = canonicalUefiAArch64EntryProfile();

    expect(fingerprintUefiAArch64EntryProfile(profile)).toBe(stableHash(stableJson(profile)));
  });

  test("keeps lower AArch64 code independent from the target driver", () => {
    const importingFiles = sourceFilesUnder("src/target/aarch64").filter((file) =>
      readFileSync(file, "utf8").includes("target/uefi-aarch64"),
    );

    expect(importingFiles).toEqual([]);
  });
});

function sourceFilesUnder(root: string): readonly string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        visit(path);
      } else if (path.endsWith(".ts")) {
        files.push(path);
      }
    }
  };
  visit(root);
  return files.sort();
}
