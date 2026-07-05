export type ReleasePhaseStatus = "passed" | "failed" | "skipped";

export type ReleaseStep = {
  readonly name: string;
  readonly command: readonly string[];
  readonly env?: Record<string, string>;
  readonly strictRequired?: boolean;
};

export type CompletedReleaseStep = {
  readonly name: string;
  readonly status: ReleasePhaseStatus;
  readonly exitCode: number;
};

export type ReleaseSummary = {
  readonly status: "passed" | "failed";
  readonly counts: Record<ReleasePhaseStatus, number>;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly stableDetail: string;
  }[];
};

const steps: readonly ReleaseStep[] = Object.freeze([
  { name: "agent-check", command: ["bun", "run", "agent:check"] },
  { name: "qemu", command: ["bun", "run", "verify:qemu"], strictRequired: true },
  { name: "lean", command: ["bun", "run", "verify:lean"], strictRequired: true },
  { name: "scorecard", command: ["bun", "run", "verify:scorecard"] },
  { name: "reproducible", command: ["bun", "run", "verify:reproducible"], strictRequired: true },
  { name: "cli-smoke", command: ["bun", "run", "verify:cli-smoke"] },
  { name: "stdlib-conformance", command: ["bun", "run", "verify:stdlib"], strictRequired: true },
]);

if (import.meta.main) {
  const completedSteps: CompletedReleaseStep[] = [];

  for (const step of steps) {
    console.error(`release:${step.name}:start`);
    const result = Bun.spawnSync([...step.command], {
      stdout: "pipe",
      stderr: "pipe",
      env: step.env === undefined ? Bun.env : { ...Bun.env, ...step.env },
    });
    if (result.stdout.length > 0) process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);

    const status = statusFromExitCodeAndOutput(result.exitCode, result.stdout, result.stderr);
    completedSteps.push({ name: step.name, status, exitCode: result.exitCode });
    if (status === "failed") console.error(`release:${step.name}:failed`);
    if (status === "skipped") console.error(`release:${step.name}:skipped`);
  }

  const summary = summarizeReleaseSteps(completedSteps);
  console.error(`release:${summary.status}`);
  process.exit(summary.status === "passed" ? 0 : 1);
}

export function summarizeReleaseSteps(
  completedSteps: readonly CompletedReleaseStep[],
): ReleaseSummary {
  const counts: Record<ReleasePhaseStatus, number> = { passed: 0, failed: 0, skipped: 0 };
  const diagnostics: ReleaseSummary["diagnostics"][number][] = [];

  for (const step of completedSteps) {
    counts[step.status] += 1;
    if (step.status === "failed") {
      diagnostics.push({
        code: "RELEASE_PHASE_FAILED",
        stableDetail: `release:phase-failed:${step.name}`,
      });
    }
    if (step.status === "skipped") {
      diagnostics.push({
        code: "RELEASE_PHASE_SKIPPED",
        stableDetail: `release:strict-skip:${step.name}`,
      });
    }
  }

  return Object.freeze({
    status: diagnostics.length === 0 ? "passed" : "failed",
    counts: Object.freeze(counts),
    diagnostics: Object.freeze(diagnostics),
  });
}

export function statusFromExitCodeAndOutput(
  exitCode: number,
  stdout: Uint8Array,
  stderr: Uint8Array,
): ReleasePhaseStatus {
  if (exitCode !== 0) return "failed";
  const output = `${new TextDecoder().decode(stdout)}\n${new TextDecoder().decode(stderr)}`;
  return outputHasSkippedPhaseMarker(output) ? "skipped" : "passed";
}

function outputHasSkippedPhaseMarker(output: string): boolean {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => line.length > 0 && isSkippedPhaseMarker(line));
}

function isSkippedPhaseMarker(line: string): boolean {
  return (
    /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)*:skipped(?::|$)/u.test(line) ||
    /^qemu-smoke:missing-(?:tools|env:[A-Z0-9_]+|config:[A-Za-z0-9]+)$/u.test(line) ||
    line === "lean:missing-command:lake"
  );
}
