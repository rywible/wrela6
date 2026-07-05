import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  statusFromExitCodeAndOutput,
  summarizeReleaseSteps,
} from "../../../scripts/verify-release";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  readonly scripts: Record<string, string>;
};

describe("release validation scripts", () => {
  test("verify:reproducible and verify:stdlib are real script entrypoints", () => {
    expect(packageJson.scripts["verify:reproducible"]).toBe(
      "bun run scripts/verify-reproducible.ts",
    );
    expect(packageJson.scripts["verify:stdlib"]).toBe("bun run scripts/verify-stdlib.ts");
    expect(packageJson.scripts["verify:reproducible"]).not.toBe(
      packageJson.scripts["verify:full-image"],
    );
    expect(packageJson.scripts["verify:stdlib"]).not.toBe(packageJson.scripts["verify:full-image"]);
  });

  test("verify:reproducible writes a manifest and compares two build passes", () => {
    const source = readFileSync("scripts/verify-reproducible.ts", "utf8");

    expect(source).toContain("dist/release/reproducibility-manifest.json");
    expect(source).toContain('runReproducibilityBuildPass("first"');
    expect(source).toContain('runReproducibilityBuildPass("second"');
    expect(source).toContain("compareReproducibleBuildPasses(firstBuild, secondBuild)");
    expect(source).toContain("writeFileSync(manifestPath, manifest");
  });

  test("verify:stdlib compiles documented stdlib module cases directly", () => {
    const source = readFileSync("scripts/verify-stdlib.ts", "utf8");

    expect(source).toContain("compileUefiAArch64ImageWithTrace");
    expect(source).toContain("documentedStdlibModules");
    expect(source).toContain("stdlibVerificationCases");
    expect(source).not.toContain("verify:full-image");
    expect(source).not.toContain("validate-full-image");
  });

  test("strict release summary fails any skipped required phase", () => {
    const summary = summarizeReleaseSteps([
      { name: "qemu", status: "skipped", exitCode: 0 },
      { name: "lean", status: "passed", exitCode: 0 },
      { name: "validation", status: "passed", exitCode: 0 },
    ]);

    expect(summary.status).toBe("failed");
    expect(summary.counts).toEqual({ passed: 2, failed: 0, skipped: 1 });
    expect(summary.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "release:strict-skip:qemu",
    );
  });

  test("strict release classifier does not treat echoed allow-missing flags as skips", () => {
    const output = new TextEncoder().encode(
      "$ bun run verify:qemu -- --allow-missing-qemu\nall local checks passed",
    );

    expect(statusFromExitCodeAndOutput(0, output, new Uint8Array())).toBe("passed");
  });

  test("strict release classifier ignores incidental skipped prose", () => {
    const output = new TextEncoder().encode(
      "documentation says skipped checks are forbidden in strict release mode\n",
    );

    expect(statusFromExitCodeAndOutput(0, output, new Uint8Array())).toBe("passed");
  });

  test("strict release classifier recognizes explicit skip stable details", () => {
    const qemuOutput = new TextEncoder().encode("qemu-smoke:missing-tools\n");
    const leanOutput = new TextEncoder().encode("lean:missing-command:lake\n");
    const phaseOutput = new TextEncoder().encode("qemu-fake:skipped\n");

    expect(statusFromExitCodeAndOutput(0, qemuOutput, new Uint8Array())).toBe("skipped");
    expect(statusFromExitCodeAndOutput(0, leanOutput, new Uint8Array())).toBe("skipped");
    expect(statusFromExitCodeAndOutput(0, phaseOutput, new Uint8Array())).toBe("skipped");
  });
});
