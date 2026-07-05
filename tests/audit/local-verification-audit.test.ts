import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../../package.json";

const packageScripts: Record<string, string> = packageJson.scripts;

function reachablePackageScripts(entrypoint: string): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending = [entrypoint];
  while (pending.length > 0) {
    const scriptName = pending.pop();
    if (scriptName === undefined || visited.has(scriptName)) continue;
    visited.add(scriptName);
    const script = packageScripts[scriptName] ?? "";
    for (const match of script.matchAll(/\bbun run ([\w:-]+)/gu)) {
      const dependency = match[1];
      if (dependency !== undefined && dependency in packageScripts) pending.push(dependency);
    }
  }
  return visited;
}

describe("local verification audit", () => {
  test("Task W0-01a exposes the full-image verification script", () => {
    expect(packageJson.scripts["verify:full-image"]).toBe(
      "bun run scripts/validate-full-image.ts --json",
    );
  });

  test("Task W0-01b keeps agent check as the complete fast local gate", () => {
    const verifyExtended = packageJson.scripts["verify:extended"];
    expect(verifyExtended).toContain("bun run typecheck");
    expect(verifyExtended).toContain("bun run build");
    expect(verifyExtended).toContain("bun run format:check");
    expect(verifyExtended).toContain("bun run lint");
    expect(verifyExtended).toContain("bun run policy:check");
    expect(verifyExtended).toContain("bun test");
    expect(verifyExtended).toContain("bun run verify:scorecard");
    expect(verifyExtended).toContain("bun run verify:qemu -- --allow-missing-qemu");
    expect(verifyExtended).toContain("bun run verify:lean -- --allow-missing-lean");
    expect(packageJson.scripts["agent:check"]).toContain("bun run verify:full-image");
    expect(packageJson.scripts["agent:check"]).toContain("bun run verify:extended");
    expect(reachablePackageScripts("agent:check")).toContain("verify:full-image");
    expect(reachablePackageScripts("agent:check")).toContain("verify:scorecard");
  });

  test("local verification stays out of GitHub workflow configuration", () => {
    expect(existsSync(join(import.meta.dir, "../../.github/workflows"))).toBe(false);
  });
});
