import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { nodeUefiAArch64QemuHostEffects } from "../src/target/uefi-aarch64/qemu-smoke-host";
import {
  qemuSmokeArtifactPathFromEnvironment,
  qemuSmokeConfigFromEnvironment,
  runUefiAArch64QemuSmokeImage,
} from "../src/target/uefi-aarch64";

const config = qemuSmokeConfigFromEnvironment(process.env);

if (config.kind === "skipped") {
  console.error(config.stableDetail);
  process.exit(1);
}

const artifactPath = qemuSmokeArtifactPathFromEnvironment(process.env);

if (artifactPath.kind === "skipped") {
  console.error(artifactPath.stableDetail);
  process.exit(1);
}

let artifactBytes: readonly number[];
try {
  artifactBytes = Object.freeze([...readFileSync(artifactPath.artifactPath)]);
} catch {
  console.error("qemu-smoke:artifact-read-failed");
  process.exit(1);
}

const smoke = await runUefiAArch64QemuSmokeImage({
  artifactName: basename(artifactPath.artifactPath),
  artifactBytes,
  request: {
    kind: "qemu",
    allowSkip: false,
    uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
    termination: "kill-after-marker",
    timeoutMs: 30000,
  },
  config: config.config,
  hostEffects: nodeUefiAArch64QemuHostEffects(),
});

console.log(smoke.stableDetail);
process.exit(smoke.status === "passed" ? 0 : 1);
