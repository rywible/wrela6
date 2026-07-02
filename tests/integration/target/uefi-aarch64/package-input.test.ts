import { describe, expect, test } from "bun:test";
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

  test("package fixture preserves the existing target surface fixture export", () => {
    const result = uefiCompilePackageInputFixture("success");

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.entryModuleName).toBe("image");
  });
});
