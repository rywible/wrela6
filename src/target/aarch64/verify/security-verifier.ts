import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64SecurityVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "security",
  verify(context) {
    return verifyAArch64SecurityConstraints(context);
  },
};

export function verifyAArch64SecurityConstraints(context: AArch64MachineVerifierContext) {
  const diagnostics = [];
  for (const machineFunction of context.program.functions.entries()) {
    const secureRegisterPolicies = new Map(
      machineFunction.virtualRegisters
        .filter((register) =>
          register.securityLabels.some(
            (label) => label.kind === "noSpill" || label.kind === "wipeOnSpill",
          ),
        )
        .map((register) => [
          Number(register.vreg),
          register.securityLabels.some((label) => label.kind === "noSpill")
            ? "noSpill"
            : "wipeOnSpill",
        ]),
    );
    for (const frameObject of machineFunction.frameObjects) {
      if (frameObject.security.spillPolicy === "noSpill") {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_SECURITY_CONSTRAINT_INVALID",
            ownerKey: `frame:${frameObject.frameObjectId}`,
            rootCauseKey: "no-spill",
            stableDetail: "no-spill-value-materialized-in-frame",
          }),
        );
      }
      if (
        frameObject.security.spillPolicy === "wipeOnSpill" &&
        frameObject.security.zeroization?.required !== true
      ) {
        diagnostics.push(
          context.makeDiagnostic({
            code: "AARCH64_SECURITY_CONSTRAINT_INVALID",
            ownerKey: `frame:${frameObject.frameObjectId}`,
            rootCauseKey: "wipe-on-spill",
            stableDetail: "wipe-on-spill-zeroization-missing",
          }),
        );
      }
    }
    for (const block of machineFunction.blocks) {
      for (const instruction of [
        ...block.instructions,
        ...(block.terminator === undefined ? [] : [block.terminator]),
      ]) {
        if (
          instruction.security?.constantTime === true &&
          isDataDependentControlOpcode(String(instruction.opcode))
        ) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_SECURITY_CONSTRAINT_INVALID",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: "secret-dependent-control",
              stableDetail: secretDependentControlDetail(String(instruction.opcode)),
            }),
          );
        }
        for (const operand of instruction.operands) {
          if (operand.operand.kind !== "vreg") continue;
          const expectedPolicy = secureRegisterPolicies.get(Number(operand.operand.register.vreg));
          if (expectedPolicy === undefined) continue;
          if (instruction.security?.spillPolicy !== expectedPolicy) {
            diagnostics.push(
              context.makeDiagnostic({
                code: "AARCH64_SECURITY_CONSTRAINT_INVALID",
                ownerKey: `instruction:${instruction.instructionId}`,
                rootCauseKey: expectedPolicy,
                stableDetail: `security-policy-not-preserved:${expectedPolicy}:${Number(
                  operand.operand.register.vreg,
                )}`,
              }),
            );
          }
        }
        if (
          instruction.security?.zeroization?.required === true &&
          instruction.schedule.motion.kind !== "hardBoundary" &&
          instruction.schedule.motion.kind !== "pinned"
        ) {
          diagnostics.push(
            context.makeDiagnostic({
              code: "AARCH64_SECURITY_CONSTRAINT_INVALID",
              ownerKey: `instruction:${instruction.instructionId}`,
              rootCauseKey: "zeroization",
              stableDetail: "zeroization-motion-not-pinned",
            }),
          );
        }
      }
    }
  }
  return diagnostics;
}

function isDataDependentControlOpcode(opcode: string): boolean {
  return (
    opcode === "b-cond" ||
    opcode === "cbz" ||
    opcode === "cbnz" ||
    opcode === "tbz" ||
    opcode === "br"
  );
}

function secretDependentControlDetail(opcode: string): string {
  return opcode === "br"
    ? "secret-dependent-control:jump-table"
    : "secret-dependent-control:branch";
}
