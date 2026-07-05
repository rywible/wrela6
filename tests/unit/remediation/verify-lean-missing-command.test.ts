import { expect, test } from "bun:test";

test("verify-lean honors allow-missing when lake is absent", () => {
  const result = Bun.spawnSync(
    [process.execPath, "run", "scripts/verify-lean.ts", "--allow-missing-lean"],
    {
      cwd: process.cwd(),
      env: { ...process.env, PATH: "" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toContain("lean:missing-command:lake");
});
