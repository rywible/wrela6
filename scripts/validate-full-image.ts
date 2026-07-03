import { readdirSync, readFileSync, statSync } from "node:fs";
import {
  fixtureSpecForFullImageCase,
  fullImageValidationCaseKey,
  fullImageValidationV1Cases,
  runFullImageValidation,
  type FullImageValidationCaseKey,
  type FullImageValidationQemuSmokePolicy,
  type FullImageValidationReport,
  type FullImageValidationScenarioKey,
  type FullImageValidationStdlibMode,
} from "../src/validation/full-image";
import type { FullImageValidationQemuLaunchMode } from "../src/validation/full-image/runner";
import type { FixtureProjectFilesystem } from "../src/target/uefi-aarch64";
import { nodeUefiAArch64QemuHostEffects } from "../src/target/uefi-aarch64/qemu-smoke-host";

type CliResult =
  | {
      readonly kind: "run";
      readonly request: {
        readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
        readonly cases?: readonly FullImageValidationCaseKey[];
        readonly qemuSmoke: FullImageValidationQemuSmokePolicy;
        readonly qemuLaunchMode?: FullImageValidationQemuLaunchMode;
      };
      readonly json: boolean;
    }
  | {
      readonly kind: "error";
      readonly json: boolean;
      readonly code: string;
      readonly stableDetail: string;
    };

const SCENARIOS = new Set<FullImageValidationScenarioKey>([
  "smoke-console",
  "packet-counter",
  "status-error",
  "watchdog-or-boot-policy",
]);
const STDLIB_MODES = new Set<FullImageValidationStdlibMode>([
  "toolchain-stdlib",
  "ejected-stdlib",
  "direct-platform",
]);

const nodeFixtureProjectFilesystem: FixtureProjectFilesystem = Object.freeze({
  readDirectory: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  readTextFile: (path: string) => readFileSync(path, "utf8"),
});

const cli = parseCli(Bun.argv.slice(2));

if (cli.kind === "error") {
  writeCliError(cli);
  process.exit(2);
}

const report = await runFullImageValidation(cli.request, {
  filesystem: nodeFixtureProjectFilesystem,
  environment: process.env,
  ...(cli.request.qemuSmoke.kind === "disabled"
    ? {}
    : { qemuHostEffects: nodeUefiAArch64QemuHostEffects() }),
});

if (cli.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatHumanReport(report));
}

process.exit(report.status === "passed" ? 0 : 1);

function parseCli(args: readonly string[]): CliResult {
  let json = args.includes("--json");
  let selectedCase: FullImageValidationCaseKey | undefined;
  let qemu = false;
  let qemuAllowSkip = false;
  let qemuLaunchMode: FullImageValidationQemuLaunchMode | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--qemu") {
      qemu = true;
      continue;
    }
    if (arg === "--qemu-allow-skip") {
      qemuAllowSkip = true;
      continue;
    }
    if (arg === "--case") {
      const value = args[index + 1];
      if (value === undefined) {
        return cliError(json, "missing-case", "cli:missing-value:--case");
      }
      const parsedCase = parseCaseKey(value);
      if (parsedCase.kind === "error") return cliError(json, "invalid-case", parsedCase.detail);
      selectedCase = parsedCase.caseKey;
      index += 1;
      continue;
    }
    if (arg === "--qemu-launch-mode") {
      const value = args[index + 1];
      if (value === undefined) {
        return cliError(json, "missing-qemu-launch-mode", "cli:missing-value:--qemu-launch-mode");
      }
      if (value === "uefi-shell-startup") {
        qemuLaunchMode = "uefi-shell-startup";
      } else if (value === "default-boot-path") {
        qemuLaunchMode = "default-boot-path";
      } else {
        return cliError(json, "invalid-qemu-launch-mode", `cli:invalid-qemu-launch-mode:${value}`);
      }
      index += 1;
      continue;
    }
    return cliError(json, "unknown-argument", `cli:unknown-argument:${arg}`);
  }

  return {
    kind: "run",
    json,
    request: {
      targetKey: "wrela-uefi-aarch64-rpi5-v1",
      ...(selectedCase === undefined ? {} : { cases: Object.freeze([selectedCase]) }),
      qemuSmoke: qemu
        ? { kind: qemuAllowSkip ? "configured-only" : "required" }
        : { kind: "disabled" },
      ...(qemuLaunchMode === undefined ? {} : { qemuLaunchMode }),
    },
  };
}

function parseCaseKey(
  value: string,
):
  | { readonly kind: "ok"; readonly caseKey: FullImageValidationCaseKey }
  | { readonly kind: "error"; readonly detail: string } {
  const [scenario, stdlibMode, extra] = value.split("/");
  if (
    extra !== undefined ||
    !SCENARIOS.has(scenario as FullImageValidationScenarioKey) ||
    !STDLIB_MODES.has(stdlibMode as FullImageValidationStdlibMode)
  ) {
    return { kind: "error", detail: `cli:invalid-case:${value}` };
  }

  const caseKey = Object.freeze({
    scenario: scenario as FullImageValidationScenarioKey,
    stdlibMode: stdlibMode as FullImageValidationStdlibMode,
  });
  const allowed = new Set(fullImageValidationV1Cases().map(fullImageValidationCaseKey));
  if (!allowed.has(fullImageValidationCaseKey(caseKey))) {
    return { kind: "error", detail: `cli:invalid-case:${value}` };
  }
  return { kind: "ok", caseKey };
}

function cliError(json: boolean, code: string, stableDetail: string): CliResult {
  return { kind: "error", json, code, stableDetail };
}

function writeCliError(error: Extract<CliResult, { readonly kind: "error" }>): void {
  if (error.json) {
    console.log(
      JSON.stringify(
        {
          schema: "wrela.full-image-validation.cli",
          schemaVersion: 1,
          status: "failed",
          diagnostics: [{ code: error.code, stableDetail: error.stableDetail }],
        },
        null,
        2,
      ),
    );
    return;
  }
  console.error(`full-image-validation failed`);
  console.error(`${error.code} ${error.stableDetail}`);
}

function formatHumanReport(report: FullImageValidationReport): string {
  const lines = [
    `full-image-validation ${report.status}`,
    `target ${report.targetKey}`,
    `cases ${report.cases.length}`,
  ];

  for (const caseReport of report.cases) {
    const spec = fixtureSpecForFullImageCase(caseReport);
    lines.push(
      `case ${caseReport.caseKey} ${caseReport.compileStatus}`,
      `  fixture ${spec.fixtureProjectPath}`,
      `  artifact ${caseReport.artifactName ?? spec.artifactName}`,
    );

    for (const diagnostic of caseReport.diagnostics) {
      lines.push(`  diagnostic ${diagnostic.code} ${diagnostic.stableDetail}`);
    }
    for (const diagnostic of caseReport.compilerDiagnostics) {
      lines.push(`  compiler ${diagnostic.code} ${diagnostic.stableDetail}`);
    }
    for (const stageRun of caseReport.stageRuns.filter((run) => run.status === "failed")) {
      lines.push(
        `  stage ${stageRun.runKey} ${stageRun.status} ${stageRun.stableDetail ?? "no-detail"}`,
      );
    }
    for (const check of [...caseReport.binaryChecks, ...caseReport.referenceChecks].filter(
      (reportCheck) => reportCheck.status === "failed",
    )) {
      lines.push(`  check ${check.checkerKey} ${check.status} ${check.stableDetail}`);
    }
    for (const evidence of caseReport.equivalenceEvidence.filter(
      (entry) => entry.status === "failed",
    )) {
      lines.push(`  equivalence ${evidence.groupKey} failed ${evidence.stableDetail}`);
    }
    if (caseReport.smoke?.status === "failed") {
      lines.push(`  qemu-smoke failed ${caseReport.smoke.stableDetail}`);
    }
  }

  for (const diagnostic of report.diagnostics) {
    lines.push(`report-diagnostic ${diagnostic.ownerKey} ${diagnostic.stableDetail}`);
  }

  return lines.join("\n");
}
