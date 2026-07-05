import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize, relative } from "node:path";
import {
  compilerPackageInput,
  defaultUefiAArch64SourceRoots,
  packageInputFromFixtureProject,
} from "../../../../src/target/uefi-aarch64";
import { uefiCompilePackageInputFixture } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI compiler package input", () => {
  test("sorts source roots and source files by stable keys", () => {
    const result = compilerPackageInput({
      packageKey: "smoke-basic",
      entryModuleName: "image",
      sourceRoots: [
        { kind: "project", rootKey: "project-z", rootPath: "src/z", trustedForAuthority: false },
        {
          kind: "toolchain",
          rootKey: "toolchain-a",
          rootPath: "stdlib/wrela-std",
          trustedForAuthority: false,
        },
      ],
      sourceFiles: [
        { sourceKey: "src/z.wr", moduleName: "z", text: "module z\n" },
        { sourceKey: "src/a.wr", moduleName: "a", text: "module a\n" },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sourceRoots.map((source) => source.rootKey)).toEqual([
      "project-z",
      "toolchain-a",
    ]);
    expect(result.value.sourceFiles.map((source) => source.sourceKey)).toEqual([
      "src/a.wr",
      "src/z.wr",
    ]);
  });

  test("normalizes enabled target features deterministically", () => {
    const result = compilerPackageInput({
      packageKey: "smoke-basic",
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      ],
      sourceFiles: [{ sourceKey: "src/image.wr", moduleName: "image", text: "module image\n" }],
      enabledTargetFeatures: ["zeta", "alpha", "zeta"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.enabledTargetFeatures).toEqual(["alpha", "zeta"]);
    expect(Object.isFrozen(result.value.enabledTargetFeatures)).toBe(true);
  });

  test("does not enable fixture-only target features by default", () => {
    const result = compilerPackageInput({
      packageKey: "smoke-basic",
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      ],
      sourceFiles: [{ sourceKey: "src/image.wr", moduleName: "image", text: "module image\n" }],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.enabledTargetFeatures).toEqual([]);
  });

  test("rejects duplicate source keys and duplicate module names deterministically", () => {
    const result = compilerPackageInput({
      packageKey: "smoke-basic",
      entryModuleName: "image",
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      ],
      sourceFiles: [
        { sourceKey: "src/b.wr", moduleName: "image", text: "module image\n" },
        { sourceKey: "src/a.wr", moduleName: "image", text: "module image\n" },
        { sourceKey: "src/a.wr", moduleName: "image_dup", text: "module image_dup\n" },
      ],
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "package-input:duplicate-module-name:image",
      "package-input:duplicate-source-key:src/a.wr",
    ]);
  });

  test("rejects API module names that cannot round-trip through module paths", () => {
    const result = compilerPackageInput({
      packageKey: "smoke-basic",
      entryModuleName: "../evil",
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      ],
      sourceFiles: [
        { sourceKey: "src/image.wr", moduleName: "image", text: "module image\n" },
        { sourceKey: "src/evil.wr", moduleName: "../evil", text: "module evil\n" },
      ],
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "package-input:invalid-entry-module-name:../evil",
      "package-input:invalid-source-module-name:../evil",
    ]);
  });

  test("adds toolchain stdlib as untrusted source by default", () => {
    expect(defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" })).toEqual([
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      {
        kind: "toolchain",
        rootKey: "toolchain-wrela-std",
        rootPath: "stdlib/wrela-std",
        trustedForAuthority: false,
      },
    ]);
  });

  test("supports project-ejected and no-stdlib source root modes", () => {
    expect(
      defaultUefiAArch64SourceRoots({
        projectSourceRoot: "src",
        stdlibMode: "project-ejected",
      }),
    ).toEqual([
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      {
        kind: "project",
        rootKey: "project-wrela-std",
        rootPath: "src/wrela-std",
        trustedForAuthority: false,
      },
    ]);

    expect(defaultUefiAArch64SourceRoots({ projectSourceRoot: "src", stdlibMode: "none" })).toEqual(
      [{ kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false }],
    );
  });

  test("reads wr files from explicit fixture source roots through injected filesystem edge", () => {
    const result = packageInputFromFixtureProject("/fixtures/smoke-basic", {
      entryModuleName: "image",
      sourceRoots: defaultUefiAArch64SourceRoots({
        projectSourceRoot: "src",
        stdlibMode: "project-ejected",
      }),
      filesystem: {
        readDirectory: (path) => {
          const entries = new Map<string, readonly string[]>([
            ["/fixtures/smoke-basic/src", ["image.wr", "notes.txt", "wrela-std"]],
            ["/fixtures/smoke-basic/src/wrela-std", ["core"]],
            ["/fixtures/smoke-basic/src/wrela-std/core", ["unit.wr"]],
          ]);
          return entries.get(path) ?? [];
        },
        isDirectory: (path) => path.endsWith("wrela-std") || path.endsWith("core"),
        readTextFile: (path) => {
          const files = new Map<string, string>([
            ["/fixtures/smoke-basic/src/image.wr", "module image\n"],
            ["/fixtures/smoke-basic/src/wrela-std/core/unit.wr", "module core.unit\n"],
          ]);
          const text = files.get(path);
          if (text === undefined) throw new Error(`Unexpected read: ${path}`);
          return text;
        },
        realPath: (path) => path,
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sourceFiles).toEqual([
      { sourceKey: "src/image.wr", moduleName: "image", text: "module image\n" },
      {
        sourceKey: "src/wrela-std/core/unit.wr",
        moduleName: "wrela_std.core.unit",
        text: "module core.unit\n",
      },
    ]);
  });

  test("skips lexical source-root escape entries from injected filesystem hosts", () => {
    const result = packageInputFromFixtureProject("/fixtures/smoke-basic", {
      sourceRoots: defaultUefiAArch64SourceRoots({
        projectSourceRoot: "src",
        stdlibMode: "none",
      }),
      filesystem: {
        readDirectory: (path) =>
          path === "/fixtures/smoke-basic/src" ? ["image.wr", "../escape.wr"] : [],
        isDirectory: () => false,
        readTextFile: (path) => {
          if (path !== "/fixtures/smoke-basic/src/image.wr") {
            throw new Error(`Unexpected read: ${path}`);
          }
          return "module image\n";
        },
        realPath: (path) => path,
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sourceFiles).toEqual([
      { sourceKey: "src/image.wr", moduleName: "image", text: "module image\n" },
    ]);
  });

  test("keeps realpath-aware package traversal inside each declared source root", () => {
    const workspace = mkdtempSync(join(tmpdir(), "wrela-package-input-"));
    try {
      const project = join(workspace, "project");
      const source = join(project, "src");
      const inside = join(source, "inside");
      const outside = join(workspace, "outside");
      const siblingPrefix = join(project, "src-evil");
      mkdirSync(inside, { recursive: true });
      mkdirSync(outside, { recursive: true });
      mkdirSync(siblingPrefix, { recursive: true });
      writeFileSync(join(source, "image.wr"), "module image\n");
      writeFileSync(join(inside, "local.wr"), "module inside.local\n");
      writeFileSync(join(outside, "leaked-file.wr"), "module leaked.file\n");
      mkdirSync(join(outside, "leaked-dir"));
      writeFileSync(join(outside, "leaked-dir", "secret.wr"), "module leaked.dir.secret\n");
      writeFileSync(join(siblingPrefix, "prefix-secret.wr"), "module leaked.prefix\n");
      symlinkSync(join(outside, "leaked-file.wr"), join(source, "file-link.wr"));
      symlinkSync(join(outside, "leaked-dir"), join(source, "dir-link"));
      symlinkSync(join(siblingPrefix, "prefix-secret.wr"), join(source, "prefix-link.wr"));
      symlinkSync(join(inside, "local.wr"), join(source, "inside-link.wr"));
      symlinkSync(source, join(source, "source-cycle"));

      const result = packageInputFromFixtureProject(project, {
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        filesystem: {
          readDirectory: (path) => readdirSync(path),
          isDirectory: (path) => statSync(path).isDirectory(),
          readTextFile: (path) => readFileSync(path, "utf8"),
          realPath: (path) => realpathSync(path),
        },
        paths: { join, normalize, relative },
      });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.value.sourceFiles.map((sourceFile) => sourceFile.sourceKey)).toEqual([
        "src/image.wr",
        "src/inside-link.wr",
        "src/inside/local.wr",
      ]);
      expect(result.value.sourceFiles.map((sourceFile) => sourceFile.text)).not.toContain(
        "module leaked.file\n",
      );
      expect(result.value.sourceFiles.map((sourceFile) => sourceFile.text)).not.toContain(
        "module leaked.dir.secret\n",
      );
      expect(result.value.sourceFiles.map((sourceFile) => sourceFile.text)).not.toContain(
        "module leaked.prefix\n",
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("passes enabled target features through fixture package input", () => {
    const result = packageInputFromFixtureProject("/fixtures/smoke-basic", {
      entryModuleName: "image",
      sourceRoots: defaultUefiAArch64SourceRoots({
        projectSourceRoot: "src",
        stdlibMode: "none",
      }),
      enabledTargetFeatures: ["full-image-validation-fixture"],
      filesystem: {
        readDirectory: (path) => (path === "/fixtures/smoke-basic/src" ? ["image.wr"] : []),
        isDirectory: () => false,
        readTextFile: (path) => {
          if (path !== "/fixtures/smoke-basic/src/image.wr") {
            throw new Error(`Unexpected read: ${path}`);
          }
          return "module image\n";
        },
        realPath: (path) => path,
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.enabledTargetFeatures).toEqual(["full-image-validation-fixture"]);
  });

  test("accepts frozen validation fixture packet bytes only with the validation feature", () => {
    const result = packageInputFromFixtureProject("/fixtures/packet-counter", {
      entryModuleName: "image",
      sourceRoots: defaultUefiAArch64SourceRoots({
        projectSourceRoot: "src",
        stdlibMode: "none",
      }),
      enabledTargetFeatures: ["full-image-validation-fixture"],
      validationFixturePacketSource: {
        primitiveId: "uefi.validation.fixturePacketSource",
        feature: "full-image-validation-fixture",
        stableKey: "packet-counter:test",
        bytes: [0x01, 0x02, 0x41, 0x42],
      },
      filesystem: {
        readDirectory: (path) => (path === "/fixtures/packet-counter/src" ? ["image.wr"] : []),
        isDirectory: () => false,
        readTextFile: (path) => {
          if (path !== "/fixtures/packet-counter/src/image.wr") {
            throw new Error(`Unexpected read: ${path}`);
          }
          return "module image\n";
        },
        realPath: (path) => path,
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.validationFixturePacketSource?.bytes).toEqual([0x01, 0x02, 0x41, 0x42]);
    expect(Object.isFrozen(result.value.validationFixturePacketSource)).toBe(true);
    expect(Object.isFrozen(result.value.validationFixturePacketSource?.bytes)).toBe(true);
  });

  test("rejects validation fixture packet bytes for packages without the validation feature", () => {
    const result = packageInputFromFixtureProject("/fixtures/packet-counter", {
      entryModuleName: "image",
      sourceRoots: defaultUefiAArch64SourceRoots({
        projectSourceRoot: "src",
        stdlibMode: "none",
      }),
      validationFixturePacketSource: {
        primitiveId: "uefi.validation.fixturePacketSource",
        feature: "full-image-validation-fixture",
        stableKey: "packet-counter:test",
        bytes: [0x01],
      },
      filesystem: {
        readDirectory: (path) => (path === "/fixtures/packet-counter/src" ? ["image.wr"] : []),
        isDirectory: () => false,
        readTextFile: () => "module image\n",
        realPath: (path) => path,
      },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "package-input:validation-fixture-packet-source:feature-disabled",
    );
  });

  test("package fixture preserves the existing target surface fixture export", () => {
    const result = uefiCompilePackageInputFixture("success");

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.entryModuleName).toBe("image");
  });
});
