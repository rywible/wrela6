import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  UefiAArch64QemuHostEffects,
  UefiAArch64QemuRunnerOutput,
  UefiAArch64QemuSmokeCommandPlan,
} from "./qemu-smoke";

const QEMU_HARNESS_FORCE_KILL_GRACE_MS = 500;

export function nodeUefiAArch64QemuHostEffects(): UefiAArch64QemuHostEffects {
  return Object.freeze({
    createTempDirectory: async (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix)),
    writeFile: async (path: string, bytes: readonly number[]): Promise<void> => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Uint8Array.from(bytes));
    },
    copyFile,
    runProcess: runNodeQemuProcess,
    removeDirectory: async (path: string): Promise<void> => {
      await rm(path, { recursive: true, force: true });
    },
  });
}

async function runNodeQemuProcess(
  command: UefiAArch64QemuSmokeCommandPlan,
  timeoutMs: number,
): Promise<UefiAArch64QemuRunnerOutput> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let terminatedByHarness = false;
    let settled = false;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(command.executable, command.args, { stdio: ["ignore", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      requestHarnessTermination("timeout");
    }, timeoutMs);

    const settle = (exitCode?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimeout !== undefined) clearTimeout(forceKillTimeout);
      resolve(
        Object.freeze({
          stdout,
          stderr,
          exitCode,
          timedOut,
          cleanupFailed: false,
          missingTools: false,
          terminatedByHarness,
        }),
      );
    };

    const requestHarnessTermination = (reason: "marker" | "timeout") => {
      if (reason === "timeout") timedOut = true;
      if (!terminatedByHarness) {
        terminatedByHarness = true;
        child.kill("SIGTERM");
      }
      if (forceKillTimeout !== undefined) return;
      forceKillTimeout = setTimeout(() => {
        child.kill("SIGKILL");
        settle(undefined);
      }, QEMU_HARNESS_FORCE_KILL_GRACE_MS);
    };

    const observe = () => {
      if (command.termination === "wait-for-firmware-exit") return;
      if (
        command.expectedConsoleMarkers.length === 0 &&
        command.failureConsoleMarkers.length === 0
      ) {
        return;
      }
      const combinedOutput = `${stdout}\n${stderr}`;
      const allObserved = command.expectedConsoleMarkers.every((marker) =>
        combinedOutput.includes(marker),
      );
      const failureObserved = command.failureConsoleMarkers.some((marker) =>
        combinedOutput.includes(marker),
      );
      if ((!allObserved && !failureObserved) || terminatedByHarness) return;
      requestHarnessTermination("marker");
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      observe();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      observe();
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(
        Object.freeze({
          stdout,
          stderr,
          exitCode: undefined,
          timedOut: false,
          cleanupFailed: false,
          missingTools: true,
          terminatedByHarness: false,
        }),
      );
    });
    child.on("exit", (code) => settle(code ?? undefined));
  });
}
