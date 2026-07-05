import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import {
  compareScorecardBaselines,
  scorecardComparisonStatus,
  type ScorecardCase,
} from "../../scripts/cost-scorecard";
import {
  fixtureSpecForFullImageCase,
  fullImageValidationCaseKey,
  fullImageValidationV1Cases,
} from "../../src/validation/full-image";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly scripts: Record<string, string>;
  readonly bin?: Record<string, string>;
  readonly exports?: Record<string, unknown>;
  readonly module?: string;
  readonly publishConfig?: Record<string, string>;
  readonly types?: string;
  readonly files?: readonly string[];
};

type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

function reachablePackageScripts(entrypoint: string): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending = [entrypoint];
  while (pending.length > 0) {
    const scriptName = pending.pop();
    if (scriptName === undefined || visited.has(scriptName)) continue;
    visited.add(scriptName);
    const script = packageJson.scripts[scriptName] ?? "";
    for (const match of script.matchAll(/\bbun run ([\w:-]+)/gu)) {
      const dependency = match[1];
      if (dependency !== undefined && dependency in packageJson.scripts) pending.push(dependency);
    }
  }
  return visited;
}

function runCommand(command: readonly string[], cwd = process.cwd()): CommandResult {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, PATH: `${Bun.env.HOME}/.bun/bin:${Bun.env.PATH ?? ""}` },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
}

function expectCommandSuccess(command: readonly string[], cwd = process.cwd()): CommandResult {
  const result = runCommand(command, cwd);
  expect(
    result.exitCode,
    `${command.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  ).toBe(0);
  return result;
}

function ensureBuiltPackageEntries(): void {
  expectCommandSuccess(["bun", "run", "build"]);
}

function packageTarballPath(directory: string): string {
  const tarballs = readdirSync(directory)
    .filter((entry) => entry.endsWith(".tgz"))
    .map((entry) => join(directory, entry));
  expect(tarballs).toHaveLength(1);
  return tarballs[0] ?? "";
}

function expectCliPassed(stdout: string): void {
  const result = JSON.parse(stdout) as { readonly status?: string };
  expect(result.status).toBe("passed");
}

function markdownHeadingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/gu, "-");
}

function markdownAnchors(content: string): ReadonlySet<string> {
  const anchors = new Set<string>();
  for (const match of content.matchAll(/^#{1,6}\s+(.+)$/gmu)) {
    const heading = match[1];
    if (heading !== undefined) anchors.add(markdownHeadingAnchor(heading));
  }
  return anchors;
}

function markdownLinks(content: string): readonly string[] {
  return [...content.matchAll(/\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)]
    .map((match) => match[1])
    .filter((link): link is string => link !== undefined);
}

describe("release surface", () => {
  test("exposes build, CLI, QEMU, Lean, and release verification scripts", () => {
    expect(packageJson.scripts.build).toBe(
      "tsc -p tsconfig.build.json && bun scripts/fix-dist-esm-imports.ts",
    );
    expect(packageJson.scripts["verify:qemu"]).toBe("bun run scripts/verify-qemu.ts");
    expect(packageJson.scripts["verify:lean"]).toBe("bun run scripts/verify-lean.ts");
    expect(packageJson.scripts["verify:release"]).toBe("bun run scripts/verify-release.ts");
    expect(packageJson.scripts["verify:scorecard"]).toBe(
      "bun run scripts/cost-scorecard.ts --check",
    );
    expect(packageJson.scripts["verify:scorecard"]).not.toBe(
      packageJson.scripts["verify:full-image"],
    );
    expect(packageJson.scripts["verify:extended"]).toContain(
      "bun run verify:qemu -- --allow-missing-qemu",
    );
    expect(packageJson.scripts["verify:extended"]).toContain(
      "bun run verify:lean -- --allow-missing-lean",
    );
  });

  test("release verification requires Lean without environment opt-in", () => {
    const verifyReleaseSource = readFileSync("scripts/verify-release.ts", "utf8");

    expect(verifyReleaseSource).toContain(
      '{ name: "lean", command: ["bun", "run", "verify:lean"], strictRequired: true }',
    );
    expect(verifyReleaseSource).not.toContain("WRELA_RELEASE_REQUIRE_LEAN");
    expect(verifyReleaseSource).not.toContain("--allow-missing-lean");
  });

  test("W4-11b scorecard gate is owned by the required local verification chain", () => {
    expect(packageJson.scripts["verify:scorecard"]).toBe(
      "bun run scripts/cost-scorecard.ts --check",
    );
    expect(reachablePackageScripts("agent:check")).toContain("verify:extended");
    expect(reachablePackageScripts("agent:check")).toContain("verify:scorecard");
  });

  test("declares the production package entry points", () => {
    expect(packageJson.name).toBe("wrela");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.publishConfig?.access).toBe("public");
    expect(packageJson.bin).toEqual({ wrela: "dist/cli/main.js" });
    expect(packageJson.module).toBe("dist/index.js");
    expect(packageJson.types).toBe("dist/index.d.ts");
    expect(packageJson.files).toContain("dist");
    expect(packageJson.files).toContain("stdlib");
    expect(packageJson.exports).toMatchObject({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./cli": { types: "./dist/cli/main.d.ts", import: "./dist/cli/main.js" },
    });
  });

  test("built package entries are Node ESM importable and expose an executable bin", () => {
    ensureBuiltPackageEntries();
    expect(existsSync("dist/index.js")).toBe(true);
    expect(existsSync("dist/cli/main.js")).toBe(true);
    expect(statSync("dist/cli/main.js").mode & 0o111).not.toBe(0);
    const publicApi = Bun.spawnSync({
      cmd: ["node", "-e", "import('./dist/index.js')"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const cliApi = Bun.spawnSync({
      cmd: ["node", "-e", "import('./dist/cli/main.js')"],
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(publicApi.exitCode, publicApi.stderr.toString()).toBe(0);
    expect(cliApi.exitCode, cliApi.stderr.toString()).toBe(0);
  }, 20_000);

  test("packed package can be installed and invoked through bun x wrela build", () => {
    ensureBuiltPackageEntries();
    const root = mkdtempSync(join(tmpdir(), "wrela-release-package-"));
    try {
      expectCommandSuccess(["bun", "pm", "pack", "--destination", root, "--quiet"]);
      const tarballPath = packageTarballPath(root);
      const consumerDirectory = join(root, "consumer");
      const projectDirectory = join(root, "demo");
      mkdirSync(consumerDirectory);
      writeFileSync(
        join(consumerDirectory, "package.json"),
        JSON.stringify({
          type: "module",
          dependencies: { wrela: `file:${tarballPath}` },
        }),
        "utf8",
      );

      expectCommandSuccess(["bun", "install"], consumerDirectory);
      expectCliPassed(
        expectCommandSuccess(
          [
            "bun",
            "x",
            "--no-install",
            "wrela",
            "init",
            "--target",
            "uefi-aarch64",
            projectDirectory,
            "--json",
          ],
          consumerDirectory,
        ).stdout,
      );
      expectCliPassed(
        expectCommandSuccess(
          [
            "bun",
            "x",
            "--no-install",
            "wrela",
            "build",
            projectDirectory,
            "--emit",
            "tokens",
            "--json",
          ],
          consumerDirectory,
        ).stdout,
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }, 60_000);

  test("documents executable release commands and proof-domain coverage", () => {
    expect(readFileSync("RELEASING.md", "utf8")).toMatch(
      /\|\s*QEMU boot smoke\s*\|\s*`bun run verify:qemu`\s*\|/u,
    );
    const coverage = readFileSync("proof-model/COVERAGE.md", "utf8");
    const domains = readdirSync("src/proof-check/domains")
      .filter((file) => file.endsWith(".ts"))
      .map((file) => `src/proof-check/domains/${file}`)
      .sort();
    for (const domain of domains) {
      expect(coverage).toContain(domain);
    }
    expect(existsSync("tsconfig.build.json")).toBe(true);
  });

  test("W6-06b proof divergence recipes exist with stable local links", () => {
    const recipePath = "docs/language/proof-divergence-recipes.md";
    expect(existsSync(recipePath)).toBe(true);

    const content = readFileSync(recipePath, "utf8");
    const anchors = markdownAnchors(content);
    for (const anchor of [
      "hoist-the-fact",
      "consume-before-the-merge",
      "split-the-join",
      "duplicate-the-tail",
    ]) {
      expect(anchors.has(anchor), `missing required anchor #${anchor}`).toBe(true);
    }

    for (const link of markdownLinks(content)) {
      const [path = "", anchor = ""] = link.split("#", 2);
      const targetPath =
        path.length === 0 ? recipePath : normalize(join(dirname(recipePath), path));
      expect(existsSync(targetPath), `missing markdown link target ${link}`).toBe(true);

      if (anchor.length === 0) continue;
      const linkedContent = targetPath === recipePath ? content : readFileSync(targetPath, "utf8");
      expect(
        markdownAnchors(linkedContent).has(anchor),
        `missing markdown link anchor ${link}`,
      ).toBe(true);
    }
  });

  test("W4-11 scorecard baselines exist for every full-image validation case", () => {
    for (const caseKey of fullImageValidationV1Cases()) {
      const spec = fixtureSpecForFullImageCase(caseKey);
      const stableCaseKey = fullImageValidationCaseKey(caseKey);
      const baselinePath = `${spec.fixtureProjectPath}/scorecard-baseline.json`;
      expect(existsSync(baselinePath), stableCaseKey).toBe(true);
      if (!existsSync(baselinePath)) continue;
      const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
        readonly schema?: string;
        readonly schemaVersion?: number;
        readonly caseKey?: string;
        readonly metrics?: Record<string, number>;
      };
      expect(baseline.schema).toBe("wrela.cost-scorecard-baseline");
      expect(baseline.schemaVersion).toBe(1);
      expect(baseline.caseKey).toBe(stableCaseKey);
      expect(Object.keys(baseline.metrics ?? {}).sort()).toEqual([
        "executableTextBytes",
        "finalImageBytes",
        "objectSectionBytes",
        "optIrOperationsPost",
        "optIrOperationsPre",
        "staticCycleEstimate",
        "staticInstructionEstimate",
      ]);
    }
  });

  test("W4-11 scorecard baseline comparison reports deterministic regression details", () => {
    const scorecardCase: ScorecardCase = {
      caseKey: "smoke-console/toolchain-stdlib",
      baselinePath:
        "tests/fixtures/full-image-validation/smoke-console/toolchain-stdlib/scorecard-baseline.json",
      metrics: {
        optIrOperationsPre: 1,
        optIrOperationsPost: 1,
        objectSectionBytes: 1,
        executableTextBytes: 1,
        finalImageBytes: 10_000_000,
        staticInstructionEstimate: 1,
        staticCycleEstimate: 1,
      },
    };

    expect(compareScorecardBaselines([scorecardCase]).regressions).toContainEqual({
      caseKey: "smoke-console/toolchain-stdlib",
      metric: "finalImageBytes",
      baseline: expect.any(Number),
      actual: 10_000_000,
      allowed: expect.any(Number),
    });
  });

  test("W4-11 scorecard status fails when baseline diagnostics are present", () => {
    const missingBaselinePath = "tests/fixtures/full-image-validation/missing/scorecard.json";
    const scorecardCase: ScorecardCase = {
      caseKey: "missing-scorecard-baseline",
      baselinePath: missingBaselinePath,
      metrics: {
        optIrOperationsPre: 1,
        optIrOperationsPost: 1,
        objectSectionBytes: 1,
        executableTextBytes: 1,
        finalImageBytes: 1,
        staticInstructionEstimate: 1,
        staticCycleEstimate: 1,
      },
    };

    const comparison = compareScorecardBaselines([scorecardCase]);

    expect(comparison.regressions).toEqual([]);
    expect(comparison.diagnostics).toEqual([
      `scorecard:baseline-missing:missing-scorecard-baseline:${missingBaselinePath}`,
    ]);
    expect(scorecardComparisonStatus(comparison)).toBe("failed");
  });
});
