import { describe, expect, test } from "bun:test";
import packageJson from "../../../../package.json";
import {
  fixtureSpecsForFullImageV1Cases,
  packageInputForFullImageFixture,
} from "../../../../src/validation/full-image/fixture-catalog";
import { productionPackagePipelineDependencies } from "../../../../src/target/uefi-aarch64";
import { nodeFixtureProjectFilesystem } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("full image validation fixture matrix", () => {
  test("Task 26 package script points at the full image validation CLI", () => {
    expect(packageJson.scripts["validate:full-image"]).toBe(
      "bun run scripts/validate-full-image.ts",
    );
  });

  test("Task 26 CLI reports invalid case selection as deterministic JSON", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        "scripts/validate-full-image.ts",
        "--case",
        "unknown/direct-platform",
        "--json",
      ],
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toBe("");
    expect(JSON.parse(result.stdout.toString())).toEqual({
      schema: "wrela.full-image-validation.cli",
      schemaVersion: 1,
      status: "failed",
      diagnostics: [
        {
          code: "invalid-case",
          stableDetail: "cli:invalid-case:unknown/direct-platform",
        },
      ],
    });
  });

  test("Task 26 CLI accepts canonical matrix-only case selectors", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        "scripts/validate-full-image.ts",
        "--case",
        "stdlib-bits/toolchain-stdlib",
        "--json",
      ],
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    const report = JSON.parse(result.stdout.toString()) as {
      readonly status: string;
      readonly cases: readonly { readonly caseKey: string }[];
    };
    expect(report.status).toBe("passed");
    expect(report.cases.map((caseReport) => caseReport.caseKey)).toEqual([
      "stdlib-bits/toolchain-stdlib",
    ]);
  });

  test("Task 26 CLI wires QEMU host effects when QEMU smoke is requested", () => {
    const result = Bun.spawnSync({
      cmd: [
        "bun",
        "run",
        "scripts/validate-full-image.ts",
        "--case",
        "smoke-console/direct-platform",
        "--qemu",
        "--qemu-allow-skip",
        "--json",
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        WRELA_QEMU_AARCH64: "/definitely/missing/qemu-system-aarch64",
        WRELA_QEMU_AARCH64_EFI_CODE: "/tmp/AAVMF_CODE.fd",
        WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    const report = JSON.parse(result.stdout.toString()) as {
      readonly status: string;
      readonly cases: readonly { readonly smoke?: { readonly stableDetail: string } }[];
    };
    expect(report.status).toBe("passed");
    expect(report.cases[0]?.smoke?.stableDetail).toBe("qemu-smoke:missing-tools");
  });

  test("Task 5 fixtures parse with production module graph dependencies and untrusted roots", () => {
    const task5Cases = fixtureSpecsForFullImageV1Cases().filter(
      (spec) =>
        spec.scenario === "smoke-console" ||
        spec.scenario === "status-error" ||
        spec.scenario === "watchdog-or-boot-policy",
    );

    expect(task5Cases.map((spec) => `${spec.scenario}/${spec.stdlibMode}`)).toEqual([
      "smoke-console/toolchain-stdlib",
      "smoke-console/ejected-stdlib",
      "smoke-console/direct-platform",
      "status-error/toolchain-stdlib",
      "watchdog-or-boot-policy/toolchain-stdlib",
    ]);

    for (const spec of task5Cases) {
      const input = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);

      expect(input.kind).toBe("ok");
      if (input.kind !== "ok") continue;

      expect(input.value.sourceRoots.every((sourceRoot) => !sourceRoot.trustedForAuthority)).toBe(
        true,
      );

      const parsed = productionPackagePipelineDependencies().parseModuleGraph({
        packageInput: input.value,
      });

      expect(parsed.kind).toBe("ok");
    }
  });
});
