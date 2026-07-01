import { describe, expect, test } from "bun:test";
import { checkImportPolicyForTest } from "../../../../scripts/check-policy";

const AARCH64_TARGET_ALLOWED_IMPORTS = [
  "src/opt-ir/index.ts",
  "src/opt-ir/program.ts",
  "src/opt-ir/facts/fact-index.ts",
  "src/shared/deterministic-sort.ts",
  "src/target/aarch64/machine-ir/machine-program.ts",
] as const;

describe("aarch64 target import policy", () => {
  test("allows public OptIR, shared, and local AArch64 target imports", () => {
    for (const imported of AARCH64_TARGET_ALLOWED_IMPORTS) {
      expect(
        checkImportPolicyForTest({
          importer: "src/target/aarch64/lower/lower-program.ts",
          imported,
        }),
      ).toEqual([]);
    }
  });

  test("rejects host state and OptIR pass internals", () => {
    expect(
      checkImportPolicyForTest({
        importer: "src/target/aarch64/lower/lower-program.ts",
        imported: "node:fs",
      }),
    ).toEqual(["AARCH64_TARGET_HOST_STATE_IMPORT"]);

    expect(
      checkImportPolicyForTest({
        importer: "src/target/aarch64/select/local-selector.ts",
        imported: "../../opt-ir/passes/pipeline-state",
      }),
    ).toEqual(["AARCH64_TARGET_OPT_IR_PASS_INTERNAL_IMPORT"]);
  });

  test("rejects encoder linker object writer and register allocator internals", () => {
    expect(
      checkImportPolicyForTest({
        importer: "src/target/aarch64/lower/lower-program.ts",
        imported: "../../linker/pe-coff/writer",
      }),
    ).toEqual(["AARCH64_TARGET_ENCODER_LINKER_OBJECT_IMPORT"]);

    expect(
      checkImportPolicyForTest({
        importer: "src/target/aarch64/plan/pre-ra-scheduler.ts",
        imported: "../register-allocator/live-range-splitter",
      }),
    ).toEqual(["AARCH64_TARGET_REGISTER_ALLOCATOR_INTERNAL_IMPORT"]);

    expect(
      checkImportPolicyForTest({
        importer: "src/target/aarch64/plan/pre-ra-scheduler.ts",
        imported: "/Users/ryanwible/projects/wrela6/src/register-allocator/live-range-splitter",
      }),
    ).toEqual(["AARCH64_TARGET_REGISTER_ALLOCATOR_INTERNAL_IMPORT"]);

    expect(
      checkImportPolicyForTest({
        importer: "src/target/aarch64/select/local-selector.ts",
        imported: "src/opt-ir/passes/pipeline-state",
      }),
    ).toEqual(["AARCH64_TARGET_OPT_IR_PASS_INTERNAL_IMPORT"]);
  });

  test("ignores non-AArch64 importers", () => {
    expect(
      checkImportPolicyForTest({
        importer: "src/opt-ir/index.ts",
        imported: "node:fs",
      }),
    ).toEqual([]);
  });
});
