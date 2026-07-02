import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkPolicyTextForTest } from "../../scripts/check-policy";

const PURE_UEFI_TARGET_FILES = [
  "diagnostics.ts",
  "result.ts",
  "artifact.ts",
  "target-driver-surface.ts",
  "target-surfaces.ts",
  "status-conversion.ts",
  "firmware-abi.ts",
  "firmware-tables.ts",
  "platform-catalog.ts",
  "runtime-catalog.ts",
  "entry-contract.ts",
  "entry-thunk.ts",
  "watchdog-policy.ts",
  "firmware-strings.ts",
  "static-char16-objects.ts",
  "exit-boot-services.ts",
  "firmware-lowering.ts",
  "runtime-helper-instructions.ts",
  "runtime-helper-objects.ts",
  "qemu-smoke.ts",
  "package-input.ts",
  "package-pipeline.ts",
  "binary-spine.ts",
  "compile-uefi-aarch64-image.ts",
] as const;

const FORBIDDEN_HOST_IMPORT =
  /from\s+["'](?:bun|node:fs|node:path|node:os|node:process|node:child_process|fs|path|os|process|child_process)/;
const UEFI_TARGET_IMPORT_PATTERN =
  /(?:from\s+["'][^"']*(?:target\/uefi-aarch64|\.\.\/uefi-aarch64)(?:\/[^"']*)?["']|import\s+["'][^"']*(?:target\/uefi-aarch64|\.\.\/uefi-aarch64)(?:\/[^"']*)?["'])/;

describe("UEFI AArch64 target-driver audit", () => {
  test("pure target-driver files do not import host APIs", () => {
    for (const fileName of PURE_UEFI_TARGET_FILES) {
      const text = readFileSync(join("src/target/uefi-aarch64", fileName), "utf8");
      expect(text).not.toMatch(FORBIDDEN_HOST_IMPORT);
      expect(text).not.toMatch(/\bBun\./);
      expect(text).not.toMatch(/\bprocess\./);
    }
  });

  test("policy checker rejects pure target-driver host imports", () => {
    const violations = checkPolicyTextForTest({
      filePath: "src/target/uefi-aarch64/package-input.ts",
      sourceText: 'import { readFileSync } from "node:fs";',
    });

    expect(violations.map((violation) => violation.message)).toContain(
      "Pure UEFI AArch64 target-driver modules must not import filesystem, process, OS, subprocess, Bun, or host runtime modules.",
    );
  });

  test("QEMU smoke host adapter and scripts are the host-effect boundary", () => {
    expect(
      checkPolicyTextForTest({
        filePath: "src/target/uefi-aarch64/qemu-smoke.ts",
        sourceText: 'import { spawn } from "node:child_process";',
      }),
    ).toHaveLength(1);
    expect(
      checkPolicyTextForTest({
        filePath: "src/target/uefi-aarch64/qemu-smoke-host.ts",
        sourceText: 'import { spawn } from "node:child_process";',
      }),
    ).toEqual([]);
    expect(
      checkPolicyTextForTest({
        filePath: "scripts/smoke-uefi-aarch64.ts",
        sourceText: 'import { readFileSync } from "node:fs";',
      }),
    ).toEqual([]);
  });

  test("earlier compiler phases do not import the UEFI target driver", () => {
    const forbiddenRoots = [
      "src/frontend",
      "src/semantic",
      "src/hir",
      "src/mono",
      "src/layout",
      "src/proof-mir",
      "src/proof-check",
      "src/opt-ir",
      "src/linker",
      "src/pe-coff",
      "src/target/aarch64",
    ];

    for (const root of forbiddenRoots) {
      const matches = filesUnder(root)
        .map((filePath) => [filePath, readFileSync(filePath, "utf8")] as const)
        .filter(([, text]) => UEFI_TARGET_IMPORT_PATTERN.test(text));
      expect(matches).toEqual([]);
    }
  });

  test("policy checker rejects lower-layer imports of the target driver", () => {
    const violations = checkPolicyTextForTest({
      filePath: "src/target/aarch64/bad.ts",
      sourceText: 'import { compileUefiAArch64Image } from "../uefi-aarch64";',
    });

    expect(violations.map((violation) => violation.message)).toContain(
      "Earlier compiler phases and lower target layers must not import the UEFI AArch64 target driver.",
    );
  });

  test("UEFI golden fixtures do not import production target data", () => {
    for (const filePath of [
      "tests/support/target/uefi-aarch64/status-golden-fixtures.ts",
      "tests/support/target/uefi-aarch64/firmware-table-golden-fixtures.ts",
    ]) {
      const text = readFileSync(filePath, "utf8");
      expect(text).not.toMatch(/src\/target\/uefi-aarch64|from\s+["'][^"']*uefi-aarch64/);
    }
  });

  test("linker source does not contain target-driver entry thunk materialization", () => {
    for (const filePath of filesUnder("src/linker")) {
      const text = readFileSync(filePath, "utf8");
      expect(text).not.toContain("__wrela_uefi_entry_initialize_context");
      expect(text).not.toContain("__wrela_uefi_status_from_boot_result");
      expect(text).not.toContain("createUefiAArch64EntryThunkObjectFactory");
    }
  });

  test("public API exposes compile and pure target helpers", async () => {
    const wrela = await import("../../src");

    expect(typeof wrela.compileUefiAArch64Image).toBe("function");
    expect(typeof wrela.target.uefiAarch64.compileUefiAArch64Image).toBe("function");
    expect(typeof wrela.target.uefiAarch64.productionUefiAArch64ResolvedTargetSurfaces).toBe(
      "function",
    );
    expect("evaluateUefiAArch64ExitBootServicesTrace" in wrela).toBe(false);
    expect("evaluateUefiAArch64EntryContextInitialization" in wrela.target.uefiAarch64).toBe(false);
    expect("materializeUefiAArch64FirmwarePlatformCall" in wrela.target.uefiAarch64).toBe(false);
  });

  test("review regressions stay out of the UEFI AArch64 driver", () => {
    const packagePipeline = readFileSync("src/target/uefi-aarch64/package-pipeline.ts", "utf8");
    expect(packagePipeline).not.toContain("[key: string]: unknown");
    expect(packagePipeline).not.toContain("artifact?: unknown");
    expect(packagePipeline).not.toContain('stages.passed("hir")');

    const compileDriver = readFileSync(
      "src/target/uefi-aarch64/compile-uefi-aarch64-image.ts",
      "utf8",
    );
    expect(compileDriver).not.toContain("parseStageTrail");
    expect(compileDriver).not.toContain('.split(",")');

    const binarySpine = readFileSync("src/target/uefi-aarch64/binary-spine.ts", "utf8");
    expect(binarySpine).not.toContain("pdataBytes: Object.freeze([0, 0, 0, 0])");
    expect(binarySpine).not.toContain("xdataBytes: Object.freeze([0, 0, 0, 0])");
    expect(binarySpine).not.toContain("stageTrail(");

    const entryObjects = readFileSync("src/linker/aarch64/aarch64-entry-objects.ts", "utf8");
    expect(entryObjects).not.toContain("readonly relocation?:");
    expect(entryObjects).not.toContain("entryFactoryRelocations");

    const firmwareAbi = readFileSync("src/target/uefi-aarch64/firmware-abi.ts", "utf8");
    expect(firmwareAbi).not.toContain("aarch64-target:abi:");
    expect(firmwareAbi).not.toContain("backend-register-model:");

    const callMaterializer = readFileSync(
      "src/target/aarch64/lower/operation-materializer-calls.ts",
      "utf8",
    );
    expect(callMaterializer).not.toContain("private readonly firmwareContextRegisters");
    expect(callMaterializer).not.toContain("?? this.firmwareContextRegisters");
    expect(callMaterializer.match(/call-result-lowering-unsupported/g) ?? []).toHaveLength(2);

    const targetIndex = readFileSync("src/target/uefi-aarch64/index.ts", "utf8");
    expect(targetIndex).not.toMatch(/^export \* from/m);

    const rootIndex = readFileSync("src/index.ts", "utf8");
    expect(rootIndex).not.toContain('export * from "./target/uefi-aarch64"');

    const statusStdlib = readFileSync("stdlib/wrela-std/target/uefi/status.wr", "utf8");
    expect(statusStdlib).toContain("bad_buffer_size");
    expect(statusStdlib).toContain("not_found");
  });
});

function filesUnder(path: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) {
      files.push(...filesUnder(child));
    } else if (entry.endsWith(".ts")) {
      files.push(child);
    }
  }
  return Object.freeze(files.sort());
}
