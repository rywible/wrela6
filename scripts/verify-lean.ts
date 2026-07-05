const allowMissing = Bun.argv.slice(2).includes("--allow-missing-lean");

let probe: ReturnType<typeof Bun.spawnSync>;
try {
  probe = Bun.spawnSync(["lake", "--version"], {
    cwd: "proof-model",
    stdout: "pipe",
    stderr: "pipe",
  });
} catch {
  console.error("lean:missing-command:lake");
  process.exit(allowMissing ? 0 : 1);
}

if (probe.exitCode !== 0) {
  console.error("lean:missing-command:lake");
  process.exit(allowMissing ? 0 : 1);
}

const build = Bun.spawnSync(["lake", "build", "Wrela"], {
  cwd: "proof-model",
  stdout: "pipe",
  stderr: "pipe",
});

if (build.stdout.length > 0) process.stdout.write(build.stdout);
if (build.stderr.length > 0) process.stderr.write(build.stderr);
process.exit(build.exitCode);
