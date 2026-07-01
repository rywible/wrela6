import type { AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64RegionVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "regions",
  verify(context) {
    return verifyAArch64Regions(context);
  },
};

export function verifyAArch64Regions(
  context: AArch64MachineVerifierContext,
): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const machineFunction of context.program.functions.entries()) {
    for (const block of machineFunction.blocks) {
      for (const instruction of block.instructions) {
        const ordering = instruction.memoryOrdering;
        if (
          ordering !== undefined &&
          ordering.regionMemoryType !== "normalCacheable" &&
          ordering.regionMemoryType !== "validatedPayload" &&
          (String(instruction.opcode) === "ldp-signed-offset" ||
            String(instruction.opcode) === "stp-signed-offset")
        ) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_REGION_CONTRACT_INVALID",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: ordering.regionMemoryType,
              stableDetail: "mmio-access-count-changed",
            }),
          );
        }
        if (
          ordering !== undefined &&
          (ordering.regionMemoryType === "deviceMmio" ||
            ordering.regionMemoryType === "firmwareTable") &&
          ordering.barrierDomain.domain === "nonShareable"
        ) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_REGION_CONTRACT_INVALID",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: ordering.regionMemoryType,
              stableDetail: `region-domain-invalid:${ordering.regionMemoryType}:nonShareable`,
            }),
          );
        }
        if (
          ordering !== undefined &&
          ordering.regionMemoryType === "normalCacheable" &&
          instruction.schedule.motion.kind === "pinned"
        ) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_REGION_CONTRACT_INVALID",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: ordering.regionMemoryType,
              stableDetail: "normal-memory-pinned-as-device",
            }),
          );
        }
      }
    }
  }
  return diagnostics;
}
