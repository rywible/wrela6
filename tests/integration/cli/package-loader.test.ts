import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWrelaPackage } from "../../../src/cli/package-loader";

describe("CLI package loader", () => {
  test("keeps package source loading inside the real source root", () => {
    const workspace = mkdtempSync(join(tmpdir(), "wrela-package-loader-"));
    try {
      const project = join(workspace, "project");
      const outside = join(workspace, "outside");
      mkdirSync(join(project, "src"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(project, "wrela.toml"), manifestText(), "utf8");
      writeFileSync(join(project, "src", "image.wr"), "module image\n", "utf8");
      writeFileSync(join(outside, "secret.wr"), "module secret\n", "utf8");
      symlinkSync(join(outside, "secret.wr"), join(project, "src", "secret-link.wr"));

      const result = loadWrelaPackage({ directory: project, stdlibMode: "none" });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.value.packageInput.sourceFiles).toEqual([
        { sourceKey: "src/image.wr", moduleName: "image", text: "module image\n" },
      ]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("returns a deterministic package-input filesystem error for broken symlinks", () => {
    const project = mkdtempSync(join(tmpdir(), "wrela-package-loader-"));
    try {
      mkdirSync(join(project, "src"));
      writeFileSync(join(project, "wrela.toml"), manifestText(), "utf8");
      writeFileSync(join(project, "src", "image.wr"), "module image\n", "utf8");
      symlinkSync(join(project, "missing"), join(project, "src", "missing-link.wr"));

      const result = loadWrelaPackage({ directory: project, stdlibMode: "none" });

      expect(result).toEqual({
        kind: "error",
        stableDetail: "cli:package-input:filesystem-error",
      });
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

function manifestText(): string {
  return [
    "[package]",
    'name = "symlink-loader-test"',
    "",
    "[target]",
    'key = "wrela-uefi-aarch64-rpi5-v1"',
    "",
    "[stdlib]",
    'mode = "direct-platform"',
    "",
  ].join("\n");
}
