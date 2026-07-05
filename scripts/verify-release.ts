type ReleaseStep = {
  readonly name: string;
  readonly command: readonly string[];
  readonly env?: Record<string, string>;
};

const steps: readonly ReleaseStep[] = Object.freeze([
  { name: "agent-check", command: ["bun", "run", "agent:check"] },
  { name: "qemu", command: ["bun", "run", "verify:qemu"] },
  { name: "lean", command: ["bun", "run", "verify:lean"] },
  { name: "scorecard", command: ["bun", "run", "verify:scorecard"] },
  { name: "reproducible", command: ["bun", "run", "verify:reproducible"] },
  { name: "cli-smoke", command: ["bun", "run", "verify:cli-smoke"] },
  { name: "stdlib-conformance", command: ["bun", "run", "verify:stdlib"] },
]);

for (const step of steps) {
  console.error(`release:${step.name}:start`);
  const result = Bun.spawnSync([...step.command], {
    stdout: "pipe",
    stderr: "pipe",
    env: step.env === undefined ? Bun.env : { ...Bun.env, ...step.env },
  });
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  if (result.exitCode !== 0) {
    console.error(`release:${step.name}:failed`);
    process.exit(result.exitCode);
  }
}

console.error("release:passed");
