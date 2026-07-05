import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tempDirectories: string[] = [];
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const emitStages = [
  { stage: "tokens", extension: "json", mediaType: "application/json" },
  { stage: "ast", extension: "json", mediaType: "application/json" },
  { stage: "hir", extension: "json", mediaType: "application/json" },
  { stage: "proof-mir", extension: "json", mediaType: "application/json" },
  { stage: "opt-ir", extension: "json", mediaType: "application/json" },
  { stage: "asm", extension: "txt", mediaType: "text/plain" },
  { stage: "object", extension: "json", mediaType: "application/json" },
  { stage: "image", extension: "efi", mediaType: "application/octet-stream" },
] as const;

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("wrela CLI", () => {
  test("init scaffolds a buildable project surface", async () => {
    const project = tempProject();
    const result = await runCli(["init", "--target", "uefi-aarch64", project]);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(project, "wrela.toml"), "utf8")).toContain(
      'key = "wrela-uefi-aarch64-rpi5-v1"',
    );
    expect(readFileSync(join(project, "src", "image.wr"), "utf8")).toContain("uefi image");
  });

  test("init refuses to overwrite an existing manifest", async () => {
    const project = tempProject();
    writeFileSync(join(project, "wrela.toml"), "sentinel manifest\n", "utf8");

    const result = await runCli(["init", "--target", "uefi-aarch64", project, "--json"]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.cli.result",
      status: "failed",
      diagnostics: [{ stableDetail: "cli:init:file-exists:wrela.toml" }],
    });
    expect(readFileSync(join(project, "wrela.toml"), "utf8")).toBe("sentinel manifest\n");
  });

  test("init refuses to overwrite an existing source image", async () => {
    const project = tempProject();
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "src", "image.wr"), "sentinel image\n", "utf8");

    const result = await runCli(["init", "--target", "uefi-aarch64", project, "--json"]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.cli.result",
      status: "failed",
      diagnostics: [{ stableDetail: "cli:init:file-exists:src/image.wr" }],
    });
    expect(readFileSync(join(project, "src", "image.wr"), "utf8")).toBe("sentinel image\n");
  });

  test("build --json writes an EFI artifact for a scaffolded project", async () => {
    const project = tempProject();
    expect((await runCli(["init", "--target", "uefi-aarch64", project])).exitCode).toBe(0);
    const outputPath = join(project, "image.efi");

    const result = await runCli(["build", project, "--out", outputPath, "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.cli.result",
      status: "passed",
      artifact: { path: outputPath },
    });
    expect(readFileSync(outputPath).length).toBeGreaterThan(0);
  });

  test("build compiles the docs happy-path program", async () => {
    const project = tempProject();
    const outputPath = join(project, "image.efi");
    writeFileSync(join(project, "wrela.toml"), manifest(), "utf8");
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "src", "image.wr"), fencedHappyProgram(), "utf8");

    const result = await runCli(["build", project, "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.cli.result",
      status: "passed",
      artifact: { path: outputPath, mediaType: "application/octet-stream" },
    });
    expect(readFileSync(outputPath).length).toBeGreaterThan(0);
  });

  test("build --emit writes every supported deterministic artifact shape", async () => {
    const project = tempProject();
    expect((await runCli(["init", "--target", "uefi-aarch64", project])).exitCode).toBe(0);

    for (const descriptor of emitStages) {
      const outputPath = join(project, `${descriptor.stage}.${descriptor.extension}`);
      const result = await runCli([
        "build",
        project,
        "--emit",
        descriptor.stage,
        "--out",
        outputPath,
        "--json",
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        schema: "wrela.cli.result",
        status: "passed",
        emit: descriptor.stage,
        artifact: { path: outputPath, mediaType: descriptor.mediaType },
      });
      expect(readFileSync(outputPath).length).toBeGreaterThan(0);
    }
  });

  test("build --emit opt-ir writes byte-identical artifacts across runs", async () => {
    const project = tempProject();
    expect((await runCli(["init", "--target", "uefi-aarch64", project])).exitCode).toBe(0);
    const firstPath = join(project, "opt-ir-first.json");
    const secondPath = join(project, "opt-ir-second.json");

    const first = await runCli(["build", project, "--emit", "opt-ir", "--out", firstPath]);
    const second = await runCli(["build", project, "--emit", "opt-ir", "--out", secondPath]);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(readFileSync(firstPath, "utf8")).toBe(readFileSync(secondPath, "utf8"));
    const emitted = JSON.parse(readFileSync(firstPath, "utf8")) as {
      readonly metadata: { readonly operationCount: number };
      readonly operations: readonly unknown[];
    };
    expect(emitted.metadata.operationCount).toBe(emitted.operations.length);
    expect(emitted.operations.length).toBeGreaterThan(0);
  });

  test("build --emit rejects unsupported emit names with usage exit code", async () => {
    const project = tempProject();
    expect((await runCli(["init", "--target", "uefi-aarch64", project])).exitCode).toBe(0);

    const result = await runCli(["build", project, "--emit", "banana", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.cli.result",
      status: "failed",
      diagnostics: [{ stableDetail: "cli:invalid-emit:banana" }],
    });
  });

  test("check --json reports diagnostics with exit code 1", async () => {
    const project = tempProject();
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "wrela.toml"), manifest(), "utf8");
    writeFileSync(join(project, "src", "image.wr"), "banana zebra unicorn\n", "utf8");

    const result = await runCli(["check", project, "--json"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.cli.result",
      status: "failed",
    });
  });

  test("check --json stops after proof-check", async () => {
    const project = tempProject();
    expect((await runCli(["init", "--target", "uefi-aarch64", project])).exitCode).toBe(0);

    const result = await runCli(["check", project, "--json"]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      readonly status: string;
      readonly stageRuns?: readonly { readonly runKey: string }[];
    };
    expect(parsed.status).toBe("passed");
    expect(parsed.stageRuns?.map((run) => run.runKey)).toEqual(["to-proof-check"]);
    expect(result.stdout).not.toContain("to-opt-ir");
  });

  test("check --json reports a stable diagnostic when the source root is missing", async () => {
    const project = tempProject();
    writeFileSync(join(project, "wrela.toml"), manifest(), "utf8");

    const result = await runCli(["check", project, "--json"]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.cli.result",
      status: "failed",
      diagnostics: [{ stableDetail: "cli:source-root:not-found:src" }],
    });
    expect(result.stdout).not.toContain(project);
    expect(result.stderr).toBe("");
  });

  test("validate --json runs the full-image validation command", async () => {
    const result = await runCli(["validate", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.full-image-validation",
      status: "passed",
    });
  }, 30000);

  test("run --qemu reports deterministic skip when QEMU is not configured", async () => {
    const project = tempProject();
    expect((await runCli(["init", "--target", "uefi-aarch64", project])).exitCode).toBe(0);

    const result = await runCli(["run", project, "--qemu", "--json"], {
      WRELA_QEMU_AARCH64: "",
      WRELA_QEMU_AARCH64_EFI_CODE: "",
      WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE: "",
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: "wrela.cli.result",
      status: "skipped",
      stableDetail: "qemu-smoke:missing-env:WRELA_QEMU_AARCH64",
    });
  });
});

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "wrela-cli-"));
  tempDirectories.push(directory);
  return directory;
}

function manifest(): string {
  return [
    "[package]",
    'name = "demo"',
    "",
    "[target]",
    'key = "wrela-uefi-aarch64-rpi5-v1"',
    "",
    "[stdlib]",
    'mode = "toolchain"',
    "",
  ].join("\n");
}

function fencedHappyProgram(): string {
  const fileContent = readFileSync(join(repoRoot, "docs/language/happy.md"), "utf8");
  const codeLines: string[] = [];
  let inFence = false;
  for (const line of fileContent.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) codeLines.push(line);
  }
  return `${codeLines.join("\n").trimEnd()}\n`;
}

async function runCli(args: readonly string[], env: Record<string, string | undefined> = {}) {
  const process = Bun.spawn(["bun", "src/cli/main.ts", ...args], {
    cwd: repoRoot,
    env: { ...Bun.env, ...env, PATH: `${Bun.env.HOME}/.bun/bin:${Bun.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}
