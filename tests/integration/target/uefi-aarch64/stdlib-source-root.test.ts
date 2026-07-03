import { describe, expect, test } from "bun:test";
import {
  compileUefiAArch64Image,
  defaultUefiAArch64SourceRoots,
  packageInputFromFixtureProject,
  productionPackagePipelineDependencies,
} from "../../../../src/target/uefi-aarch64";
import {
  nodeFixtureProjectFilesystem,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";
import { uefiAArch64PackagePipelineDependenciesForOptimizedFixture } from "../../../support/target/uefi-aarch64/package-pipeline-fixtures";

describe("UEFI stdlib source root", () => {
  test("loads smoke-basic with toolchain stdlib source root", () => {
    const result = packageInputFromFixtureProject("tests/fixtures/uefi-aarch64/smoke-basic", {
      entryModuleName: "image",
      sourceRoots: defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" }),
      filesystem: nodeFixtureProjectFilesystem,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sourceRoots).toContainEqual({
      kind: "toolchain",
      rootKey: "toolchain-wrela-std",
      rootPath: "stdlib/wrela-std",
      trustedForAuthority: false,
    });
    expect(result.value.sourceFiles.map((source) => source.sourceKey)).toContain(
      "stdlib/wrela-std/target/uefi/console.wr",
    );
    expect(result.value.sourceFiles.map((source) => source.moduleName)).toContain(
      "wrela_std.target.uefi.console",
    );
    expect(result.value.sourceFiles.map((source) => source.sourceKey)).toContain("src/image.wr");
    expectParsedImportResolves(result.value, "image", "wrela_std.target.uefi.console");
    expect(result.value.sourceRoots.every((root) => root.trustedForAuthority === false)).toBe(true);
    expect(compileFixturePackage(result.value).kind).toBe("ok");
  });

  test("loads ejected stdlib under src/wrela-std as untrusted project source", () => {
    const result = packageInputFromFixtureProject(
      "tests/fixtures/uefi-aarch64/smoke-ejected-stdlib",
      {
        entryModuleName: "image",
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "project-ejected",
        }),
        filesystem: nodeFixtureProjectFilesystem,
      },
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sourceRoots).toContainEqual({
      kind: "project",
      rootKey: "project-wrela-std",
      rootPath: "src/wrela-std",
      trustedForAuthority: false,
    });
    expect(result.value.sourceFiles.map((source) => source.sourceKey)).toContain(
      "src/wrela-std/target/uefi/console.wr",
    );
    expect(result.value.sourceFiles.map((source) => source.moduleName)).toContain(
      "wrela_std.target.uefi.console",
    );
    expectParsedImportResolves(result.value, "image", "wrela_std.target.uefi.console");
    expect(result.value.sourceRoots.every((root) => root.trustedForAuthority === false)).toBe(true);
    expect(compileFixturePackage(result.value).kind).toBe("ok");
  });

  test("loads direct project platform declarations without shipped stdlib", () => {
    const result = packageInputFromFixtureProject(
      "tests/fixtures/uefi-aarch64/smoke-direct-platform",
      {
        entryModuleName: "image",
        sourceRoots: defaultUefiAArch64SourceRoots({
          projectSourceRoot: "src",
          stdlibMode: "none",
        }),
        filesystem: nodeFixtureProjectFilesystem,
      },
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sourceRoots).toEqual([
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
    ]);
    expect(result.value.sourceFiles.map((source) => source.sourceKey)).toEqual([
      "src/image.wr",
      "src/wrela_abi/target/uefi/status.wr",
    ]);
    expect(result.value.sourceFiles.map((source) => source.moduleName)).toContain(
      "wrela_abi.target.uefi.status",
    );
    expect(result.value.sourceFiles[0]?.text).toContain("platform fn output_string");
    expectParsedImportResolves(result.value, "image", "wrela_abi.target.uefi.status");
    expect(compileFixturePackage(result.value).kind).toBe("ok");
  });
});

function compileFixturePackage(
  packageInput: Parameters<typeof compileUefiAArch64Image>[0]["packageInput"],
) {
  return compileUefiAArch64Image({
    packageInput,
    target: uefiTargetSurfaceFixture(),
    smoke: { kind: "disabled" },
    packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
  });
}

function expectParsedImportResolves(
  packageInput: Parameters<typeof compileFixturePackage>[0],
  importer: string,
  importedModule: string,
): void {
  const parsed = productionPackagePipelineDependencies().parseModuleGraph({ packageInput });

  expect(parsed.kind).toBe("ok");
  if (parsed.kind !== "ok") return;

  expect(parsed.value.parsedGraph).toBeDefined();
  if (parsed.value.parsedGraph === undefined) return;

  const modules = parsed.value.parsedGraph.modules;
  const importerModule = modules.find((module) => module.path.key === modulePathKey(importer));
  expect(importerModule?.imports.map((request) => request.moduleName)).toContain(importedModule);
  expect(modules.map((module) => module.path.key)).toContain(modulePathKey(importedModule));
}

function modulePathKey(moduleName: string): string {
  return `${moduleName.replace(/\./g, "/")}.wr`;
}
