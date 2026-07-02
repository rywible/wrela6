import {
  materializeAArch64OptIrOperation,
  type AArch64OperationMaterializationResult,
} from "../../../../src/target/aarch64/lower/operation-materialization";
import type { OperationOf } from "../../../../src/target/aarch64/lower/operation-materialization-helpers";
import type { UefiAArch64StaticChar16StringPointer } from "../../../../src/target/uefi-aarch64/firmware-strings";
import type { UefiAArch64FirmwareTableSurface } from "../../../../src/target/uefi-aarch64/firmware-tables";
import type { UefiAArch64PlatformPrimitiveLowering } from "../../../../src/target/uefi-aarch64/platform-catalog";
import { uefiAArch64FirmwarePlatformCallContext } from "../../../../src/target/uefi-aarch64/firmware-lowering";

export function materializeUefiAArch64FirmwarePlatformCallForTest(input: {
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly platformLowerings: readonly UefiAArch64PlatformPrimitiveLowering[];
  readonly operation: OperationOf<"platformCall">;
  readonly staticChar16Pointers?: ReadonlyMap<string, UefiAArch64StaticChar16StringPointer>;
}):
  | {
      readonly kind: "ok";
      readonly value: AArch64OperationMaterializationResult & { readonly kind: "ok" };
    }
  | { readonly kind: "error"; readonly stableDetail: string } {
  const platformKey =
    input.operation.target.kind === "platform" ? input.operation.target.platformKey : "";
  const firmwareCalls = uefiAArch64FirmwarePlatformCallContext({
    firmwareTables: input.firmwareTables,
    platformLowerings: input.platformLowerings,
  });
  if (firmwareCalls.loweringFor(platformKey) === undefined) {
    return {
      kind: "error",
      stableDetail: `uefi-platform-lowering:missing:${platformKey}`,
    };
  }
  const result = materializeAArch64OptIrOperation({
    operation: input.operation,
    valueRegisters: new Map(),
    context: {
      firmware: {
        platformCalls: firmwareCalls,
        staticChar16Pointers: input.staticChar16Pointers,
        contextRegisters: new Map(),
      },
    },
  });
  if (result.kind === "error") {
    return result;
  }
  return { kind: "ok", value: result };
}
