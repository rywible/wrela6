import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  fixtureSpecForFullImageCase,
  fullImageValidationCaseKey,
  fullImageValidationV1Cases,
  packageInputForFullImageFixture,
  type FullImageValidationCaseKey,
} from "../src/validation/full-image";
import { compileUefiAArch64ImageWithTrace } from "../src/target/uefi-aarch64";
import type { FixtureProjectFilesystem } from "../src/target/uefi-aarch64";

export interface ScorecardMetrics {
  readonly optIrOperationsPre: number;
  readonly optIrOperationsPost: number;
  readonly objectSectionBytes: number;
  readonly executableTextBytes: number;
  readonly finalImageBytes: number;
  readonly staticInstructionEstimate: number;
  readonly staticCycleEstimate: number;
}

export interface ScorecardCase {
  readonly caseKey: string;
  readonly baselinePath: string;
  readonly metrics: ScorecardMetrics;
}

export interface ScorecardRegression {
  readonly caseKey: string;
  readonly metric: keyof ScorecardMetrics;
  readonly baseline: number;
  readonly actual: number;
  readonly allowed: number;
}

const SCORECARD_SCHEMA = "wrela.cost-scorecard-baseline";
const SCORECARD_SCHEMA_VERSION = 1;
const REGRESSION_THRESHOLD = 0.05;

const nodeFixtureProjectFilesystem: FixtureProjectFilesystem = Object.freeze({
  readDirectory: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  readTextFile: (path: string) => readFileSync(path, "utf8"),
  realPath: (path: string) => realpathSync(path),
});

if (import.meta.main) {
  const result = await runScorecardCli(Bun.argv.slice(2));
  process.exit(result);
}

export async function runScorecardCli(args: readonly string[]): Promise<number> {
  const updateBaselines = args.includes("--update-baselines");
  const check = args.includes("--check");
  const json = args.includes("--json");
  const unknown = args.find((arg) => !["--check", "--json", "--update-baselines"].includes(arg));
  if (unknown !== undefined || (!check && !updateBaselines)) {
    writeCliFailure(json, [
      unknown === undefined
        ? "scorecard:missing-mode:--check-or--update-baselines"
        : `scorecard:unknown-argument:${unknown}`,
    ]);
    return 2;
  }

  const cases = await compileScorecardCases(fullImageValidationV1Cases());
  if (updateBaselines) {
    for (const scorecardCase of cases) {
      writeScorecardBaseline(scorecardCase);
    }
  }

  const comparison = compareScorecardBaselines(cases);
  if (json) {
    console.log(
      JSON.stringify(
        {
          schema: "wrela.cost-scorecard",
          schemaVersion: 1,
          status: scorecardComparisonStatus(comparison),
          cases,
          regressions: comparison.regressions,
          diagnostics: comparison.diagnostics,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatScorecardReport(cases, comparison));
  }

  return comparison.regressions.length === 0 && comparison.diagnostics.length === 0 ? 0 : 1;
}

export function scorecardComparisonStatus(comparison: {
  readonly regressions: readonly ScorecardRegression[];
  readonly diagnostics: readonly string[];
}): "passed" | "failed" {
  return comparison.regressions.length === 0 && comparison.diagnostics.length === 0
    ? "passed"
    : "failed";
}

export async function compileScorecardCases(
  caseKeys: readonly FullImageValidationCaseKey[],
): Promise<readonly ScorecardCase[]> {
  const cases: ScorecardCase[] = [];
  for (const caseKey of caseKeys) {
    cases.push(await compileScorecardCase(caseKey));
  }
  return Object.freeze(cases);
}

export function compareScorecardBaselines(cases: readonly ScorecardCase[]): {
  readonly regressions: readonly ScorecardRegression[];
  readonly diagnostics: readonly string[];
} {
  const regressions: ScorecardRegression[] = [];
  const diagnostics: string[] = [];

  for (const scorecardCase of cases) {
    const baseline = readScorecardBaseline(scorecardCase);
    if (baseline.kind === "error") {
      diagnostics.push(baseline.stableDetail);
      continue;
    }
    for (const metric of scorecardMetricKeys()) {
      const baselineValue = baseline.metrics[metric];
      const actual = scorecardCase.metrics[metric];
      const allowed = Math.floor(baselineValue * (1 + REGRESSION_THRESHOLD));
      if (actual > allowed) {
        regressions.push(
          Object.freeze({
            caseKey: scorecardCase.caseKey,
            metric,
            baseline: baselineValue,
            actual,
            allowed,
          }),
        );
      }
    }
  }

  return Object.freeze({
    regressions: Object.freeze(regressions),
    diagnostics: Object.freeze(diagnostics.sort()),
  });
}

function compileScorecardCase(caseKey: FullImageValidationCaseKey): ScorecardCase {
  const spec = fixtureSpecForFullImageCase(caseKey);
  const packageInput = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);
  const stableCaseKey = fullImageValidationCaseKey(caseKey);
  if (packageInput.kind === "error") {
    throw new Error(`scorecard:package-input-failed:${stableCaseKey}`);
  }

  const result = compileUefiAArch64ImageWithTrace({
    packageInput: packageInput.value,
    artifactName: spec.artifactName,
    smoke: { kind: "disabled" },
  });
  if (result.kind === "error") {
    throw new Error(`scorecard:compile-failed:${stableCaseKey}`);
  }

  return Object.freeze({
    caseKey: stableCaseKey,
    baselinePath: scorecardBaselinePath(caseKey),
    metrics: metricsFromTrace(result),
  });
}

function metricsFromTrace(
  result: Extract<ReturnType<typeof compileUefiAArch64ImageWithTrace>, { kind: "ok" }>,
): ScorecardMetrics {
  const optIrOperationsPre = result.trace.packagePipeline.optIr.unoptimizedOperations.length;
  const optIrOperationsPost = result.trace.packagePipeline.optIr.operations.length;
  const objectSectionBytes = result.trace.binarySpine.backendObjects.reduce(
    (total, module) =>
      total +
      module.objectModule.sections.reduce(
        (moduleTotal, section) => moduleTotal + section.bytes.length,
        0,
      ),
    0,
  );
  const executableTextBytes =
    result.trace.binarySpine.linkedLayout.sections.find((section) => section.stableKey === ".text")
      ?.bytes.length ?? 0;
  const finalImageBytes = result.artifact.peCoffArtifact.bytes.length;
  const staticInstructionEstimate = Math.floor(executableTextBytes / 4);
  const staticCycleEstimate =
    staticInstructionEstimate +
    result.trace.binarySpine.linkedLayout.appliedRelocations.length * 2 +
    result.trace.binarySpine.linkedLayout.sections.length;

  return Object.freeze({
    optIrOperationsPre,
    optIrOperationsPost,
    objectSectionBytes,
    executableTextBytes,
    finalImageBytes,
    staticInstructionEstimate,
    staticCycleEstimate,
  });
}

function readScorecardBaseline(
  scorecardCase: ScorecardCase,
):
  | { readonly kind: "ok"; readonly metrics: ScorecardMetrics }
  | { readonly kind: "error"; readonly stableDetail: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(scorecardCase.baselinePath, "utf8"));
  } catch {
    return {
      kind: "error",
      stableDetail: `scorecard:baseline-missing:${scorecardCase.caseKey}:${scorecardCase.baselinePath}`,
    };
  }
  if (!isScorecardBaseline(parsed, scorecardCase.caseKey)) {
    return {
      kind: "error",
      stableDetail: `scorecard:baseline-invalid:${scorecardCase.caseKey}:${scorecardCase.baselinePath}`,
    };
  }
  return { kind: "ok", metrics: parsed.metrics };
}

function writeScorecardBaseline(scorecardCase: ScorecardCase): void {
  mkdirSync(dirname(scorecardCase.baselinePath), { recursive: true });
  writeFileSync(
    scorecardCase.baselinePath,
    `${JSON.stringify(
      {
        schema: SCORECARD_SCHEMA,
        schemaVersion: SCORECARD_SCHEMA_VERSION,
        caseKey: scorecardCase.caseKey,
        metrics: scorecardCase.metrics,
      },
      null,
      2,
    )}\n`,
  );
}

function isScorecardBaseline(
  value: unknown,
  caseKey: string,
): value is {
  readonly schema: typeof SCORECARD_SCHEMA;
  readonly schemaVersion: typeof SCORECARD_SCHEMA_VERSION;
  readonly caseKey: string;
  readonly metrics: ScorecardMetrics;
} {
  if (typeof value !== "object" || value === null) return false;
  const record = value as {
    readonly schema?: unknown;
    readonly schemaVersion?: unknown;
    readonly caseKey?: unknown;
    readonly metrics?: unknown;
  };
  return (
    record.schema === SCORECARD_SCHEMA &&
    record.schemaVersion === SCORECARD_SCHEMA_VERSION &&
    record.caseKey === caseKey &&
    isScorecardMetrics(record.metrics)
  );
}

function isScorecardMetrics(value: unknown): value is ScorecardMetrics {
  if (typeof value !== "object" || value === null) return false;
  const metrics = value as Partial<Record<keyof ScorecardMetrics, unknown>>;
  return scorecardMetricKeys().every(
    (metric) =>
      typeof metrics[metric] === "number" &&
      Number.isInteger(metrics[metric]) &&
      metrics[metric] >= 0,
  );
}

function scorecardBaselinePath(caseKey: FullImageValidationCaseKey): string {
  return `tests/fixtures/full-image-validation/${caseKey.scenario}/${caseKey.stdlibMode}/scorecard-baseline.json`;
}

function scorecardMetricKeys(): readonly (keyof ScorecardMetrics)[] {
  return Object.freeze([
    "optIrOperationsPre",
    "optIrOperationsPost",
    "objectSectionBytes",
    "executableTextBytes",
    "finalImageBytes",
    "staticInstructionEstimate",
    "staticCycleEstimate",
  ]);
}

function formatScorecardReport(
  cases: readonly ScorecardCase[],
  comparison: ReturnType<typeof compareScorecardBaselines>,
): string {
  const lines = [
    `cost-scorecard ${scorecardComparisonStatus(comparison)}`,
    `cases ${cases.length}`,
  ];
  for (const scorecardCase of cases) {
    lines.push(
      `case ${scorecardCase.caseKey} finalImageBytes=${scorecardCase.metrics.finalImageBytes} optIrOperationsPost=${scorecardCase.metrics.optIrOperationsPost}`,
    );
  }
  for (const diagnostic of comparison.diagnostics) lines.push(`diagnostic ${diagnostic}`);
  for (const regression of comparison.regressions) {
    lines.push(
      `regression case=${regression.caseKey} metric=${regression.metric} baseline=${regression.baseline} actual=${regression.actual} allowed=${regression.allowed}`,
    );
  }
  return lines.join("\n");
}

function writeCliFailure(json: boolean, diagnostics: readonly string[]): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          schema: "wrela.cost-scorecard",
          schemaVersion: 1,
          status: "failed",
          diagnostics,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.error("cost-scorecard failed");
  for (const diagnostic of diagnostics) console.error(diagnostic);
}
