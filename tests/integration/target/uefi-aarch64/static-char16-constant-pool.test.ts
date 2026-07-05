import { describe, expect, test } from "bun:test";
import {
  authenticateUefiAArch64TargetDriverSurface,
  compileUefiAArch64ImageWithTrace,
  compilerPackageInput,
  runUefiAArch64PackagePipelineToOptIr,
  type UefiAArch64TargetDriverSurface,
} from "../../../../src/target/uefi-aarch64";
import { uefiTargetSurfaceFixture } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI static CHAR16 constant pool", () => {
  test("passes utf16_static through two source calls with one constant-address reference", () => {
    const packageInputResult = compilerPackageInput({
      packageKey: "static-char16-constant-pool",
      entryModuleName: "image",
      enabledTargetFeatures: ["full-image-validation"],
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      ],
      sourceFiles: [
        {
          sourceKey: "src/image.wr",
          moduleName: "image",
          text: [
            "use UefiStatus from wrela_abi.target.uefi.status",
            "platform fn output_string(message: Utf16Static) -> UefiStatus",
            "fn pass_one(message: Utf16Static) -> Utf16Static:",
            "    message",
            "fn pass_two(message: Utf16Static) -> Utf16Static:",
            "    pass_one(message)",
            "uefi image StaticChar16ConstantPool:",
            "    fn boot() -> UefiStatus:",
            '        output_string(pass_two(utf16_static("hello")))',
            "",
          ].join("\n"),
        },
        {
          sourceKey: "src/wrela_abi/target/uefi/status.wr",
          moduleName: "wrela_abi.target.uefi.status",
          text: canonicalUefiStatusSourceForTest(),
        },
      ],
    });
    expect(packageInputResult.kind).toBe("ok");
    if (packageInputResult.kind !== "ok") return;

    const result = runUefiAArch64PackagePipelineToOptIr({
      packageInput: packageInputResult.value,
      target: targetSurfaceWithUefiImageProfileForTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.optIr.unoptimizedOperations.some(isUtf16StaticIntrinsicOperation)).toBe(
      false,
    );
    expect(result.value.optIr.operations.some(isUtf16StaticIntrinsicOperation)).toBe(false);
    const constAddr = result.value.optIr.operations.find(
      (operation) => operation.kind === "constAddr",
    );
    expect(constAddr).toEqual(expect.objectContaining({ kind: "constAddr" }));
    const platformCall = result.value.optIr.operations.find(
      (operation) => operation.kind === "platformCall",
    );
    expect(platformCall).toEqual(
      expect.objectContaining({ kind: "platformCall", argumentIds: constAddr?.resultIds }),
    );
    expect(result.value.optIr.operations.some((operation) => operation.kind === "sourceCall")).toBe(
      false,
    );
    const char16Constants = result.value.optIr.program.constants
      .entries()
      .filter((constant) => constant.kind === "data" && constant.section === ".rodata");
    expect(char16Constants).toHaveLength(1);
    expect(char16Constants[0]).toEqual(
      expect.objectContaining({
        bytes: [104, 0, 101, 0, 108, 0, 108, 0, 111, 0, 0, 0],
        alignment: 2,
        section: ".rodata",
      }),
    );

    const compiled = compileUefiAArch64ImageWithTrace({ packageInput: packageInputResult.value });
    expect(compiled.kind).toBe("ok");
  });
});

function targetSurfaceWithUefiImageProfileForTest(): UefiAArch64TargetDriverSurface {
  const targetResult = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
  expect(targetResult.kind).toBe("ok");
  if (targetResult.kind !== "ok") throw new Error("expected authenticated UEFI target");
  return targetResult.value;
}

function isUtf16StaticIntrinsicOperation(operation: {
  readonly kind: string;
  readonly target?: { readonly kind?: string; readonly intrinsicKey?: string };
}): boolean {
  return (
    operation.kind === "intrinsicCall" &&
    operation.target?.kind === "intrinsic" &&
    operation.target.intrinsicKey === "uefi.utf16_static"
  );
}

function canonicalUefiStatusSourceForTest(): string {
  return [
    "enum UefiStatus:",
    "    success",
    "    load_error",
    "    invalid_parameter",
    "    unsupported",
    "    bad_buffer_size",
    "    buffer_too_small",
    "    device_error",
    "    not_found",
    "    aborted",
    "    security_violation",
  ].join("\n");
}
