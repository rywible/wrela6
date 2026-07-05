import { qemuSmokeConfigFromEnvironment } from "../src/target/uefi-aarch64";

const allowMissing = Bun.argv.slice(2).includes("--allow-missing-qemu");
const config = qemuSmokeConfigFromEnvironment(process.env);

if (config.kind === "skipped") {
  console.error(config.stableDetail);
  process.exit(allowMissing ? 0 : 1);
}

const validation = Bun.spawnSync([
  "bun",
  "run",
  "scripts/validate-full-image.ts",
  "--json",
  "--qemu",
  "--qemu-launch-mode",
  "uefi-shell-startup",
]);

if (validation.stdout.length > 0) process.stdout.write(validation.stdout);
if (validation.stderr.length > 0) process.stderr.write(validation.stderr);
process.exit(validation.exitCode);
