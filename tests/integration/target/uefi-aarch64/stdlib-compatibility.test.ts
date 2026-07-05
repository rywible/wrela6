import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  compileUefiAArch64Image,
  compilerPackageInput,
  defaultUefiAArch64SourceRoots,
  packageInputFromFixtureProject,
} from "../../../../src/target/uefi-aarch64";
import { documentedStdlibModules } from "../../../../scripts/verify-stdlib";
import {
  nodeFixtureProjectFilesystem,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";
import { uefiAArch64PackagePipelineDependenciesForOptimizedFixture } from "../../../support/target/uefi-aarch64/package-pipeline-fixtures";

describe("stdlib compatibility contract", () => {
  test("compatibility document names every supported public module", async () => {
    const document = await readFile("docs/stdlib/compatibility.md", "utf8");
    const documentedModules = documentedStdlibModules();

    expect(documentedModules.length).toBeGreaterThan(0);

    for (const moduleName of documentedModules) {
      expect(document).toContain(`\`${moduleName}\``);
      expect(await readFile(stdlibPathForModule(moduleName), "utf8")).not.toHaveLength(0);
    }
  });

  test("current core Option and Result tagged-union surface compiles", () => {
    const packageInput = compilerPackageInput({
      packageKey: "stdlib-compatibility-core",
      entryModuleName: "image",
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
        ...defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" }),
      ],
      sourceFiles: [
        {
          sourceKey: "src/image.wr",
          moduleName: "image",
          text: [
            "use Bits from wrela_std.core.bits",
            "use Option from wrela_std.core.option",
            "use Result from wrela_std.core.result",
            "use Unit from wrela_std.core.unit",
            "use Validation from wrela_std.core.validation",
            "use UefiStatus from wrela_std.target.uefi.status",
            "",
            "class StdlibCoreProbe:",
            "    bits: Bits[u64]",
            "    maybe_status: Option[UefiStatus]",
            "    result_status: Result[UefiStatus, UefiStatus]",
            "    validation_status: Validation[UefiStatus, UefiStatus, UefiStatus]",
            "",
            "uefi image StdlibCompatibilityCore:",
            "    fn boot() -> Unit:",
            "        let maybe_status: Option[UefiStatus] = Option.some(value=UefiStatus.success)",
            "        let no_status: Option[UefiStatus] = Option.none",
            "        let ok_status: Result[UefiStatus, UefiStatus] = Result.ok(value=UefiStatus.success)",
            "        let err_status: Result[UefiStatus, UefiStatus] = Result.err(error=UefiStatus.device_error)",
            "        match ok_status:",
            "            case ok(value):",
            "                value",
            "            case err(error):",
            "                error",
            "        UefiStatus.success",
          ].join("\n"),
        },
      ],
    });

    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;
    expect(compilePackage(packageInput.value).kind).toBe("ok");
  });

  test("current UEFI helper modules compile through toolchain stdlib", () => {
    const packageInput = packageInputFromFixtureProject("tests/fixtures/uefi-aarch64/smoke-basic", {
      entryModuleName: "image",
      sourceRoots: defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" }),
      filesystem: nodeFixtureProjectFilesystem,
    });

    expect(packageInput.kind).toBe("ok");
    if (packageInput.kind !== "ok") return;
    expect(packageInput.value.sourceFiles.map((source) => source.moduleName)).toEqual(
      expect.arrayContaining(["wrela_std.target.uefi.console", "wrela_std.target.uefi.status"]),
    );
    expect(compilePackage(packageInput.value).kind).toBe("ok");
  });
});

function stdlibPathForModule(moduleName: string): string {
  return `stdlib/${moduleName.replace(/^wrela_std\./, "wrela-std.").replace(/\./g, "/")}.wr`;
}

function compilePackage(
  packageInput: Parameters<typeof compileUefiAArch64Image>[0]["packageInput"],
) {
  return compileUefiAArch64Image({
    packageInput,
    target: uefiTargetSurfaceFixture(),
    smoke: { kind: "disabled" },
    packagePipelineDependencies: uefiAArch64PackagePipelineDependenciesForOptimizedFixture(),
  });
}
