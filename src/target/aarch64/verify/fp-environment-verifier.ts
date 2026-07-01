import type { AArch64MachineVerifierDescriptor } from "./verifier-suite";

const FP_RESOURCE_OPCODES = new Set(["fmadd", "fmla", "fcvt-fp16"]);

const REQUIRED_CONSTRAINTS = new Map<string, readonly string[]>([
  ["fmadd", ["fp-contraction-authorized"]],
  ["fmla", ["fp-contraction-authorized"]],
  ["fcvt-fp16", ["fp16-narrowing-authorized"]],
  ["sqrdmulh", ["numeric-error-bound-authorized", "rdm-authorized", "saturation-authorized"]],
  ["sqrdmlah", ["numeric-error-bound-authorized", "rdm-authorized", "saturation-authorized"]],
  ["sqadd-saturating", ["saturation-authorized"]],
  ["dotprod", ["dotprod-authorized"]],
]);

const EXPECTED_ISSUE_CLASS = new Map<string, "fp" | "vector">([
  ["fmadd", "fp"],
  ["fcvt-fp16", "fp"],
  ["fmla", "vector"],
  ["sqrdmulh", "vector"],
  ["sqrdmlah", "vector"],
  ["sqadd-saturating", "vector"],
  ["dotprod", "vector"],
]);

export const aarch64FpEnvironmentVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "fp-environment",
  verify(context) {
    const diagnostics = [];
    for (const machineFunction of context.program.functions.entries()) {
      for (const block of machineFunction.blocks) {
        for (const instruction of block.instructions) {
          const opcode = String(instruction.opcode);
          const expectedIssueClass = EXPECTED_ISSUE_CLASS.get(opcode);
          if (
            expectedIssueClass !== undefined &&
            instruction.schedule.issueClass !== expectedIssueClass
          ) {
            diagnostics.push(
              context.makeDiagnostic({
                code: "AARCH64_FP_ENVIRONMENT_INVALID",
                ownerKey: `instruction:${instruction.instructionId}`,
                rootCauseKey: "fp-issue-class",
                stableDetail: `fp-issue-class-mismatch:${opcode}:${expectedIssueClass}:${instruction.schedule.issueClass}`,
              }),
            );
          }
          for (const constraint of REQUIRED_CONSTRAINTS.get(opcode) ?? []) {
            if (instruction.schedule.errataConstraints.includes(constraint)) continue;
            diagnostics.push(
              context.makeDiagnostic({
                code: "AARCH64_FP_ENVIRONMENT_INVALID",
                ownerKey: `instruction:${instruction.instructionId}`,
                rootCauseKey: constraint,
                stableDetail: `fp-numeric-authority-missing:${opcode}:${constraint}`,
              }),
            );
          }
          if (FP_RESOURCE_OPCODES.has(opcode) && !hasFpResourceObligation(instruction)) {
            diagnostics.push(
              context.makeDiagnostic({
                code: "AARCH64_FP_ENVIRONMENT_INVALID",
                ownerKey: `instruction:${instruction.instructionId}`,
                rootCauseKey: "fpcr-fpsr",
                stableDetail: `fp-resource-obligation-missing:${opcode}`,
              }),
            );
          }
        }
      }
    }
    return diagnostics;
  },
};

function hasFpResourceObligation(instruction: {
  readonly operands: readonly {
    readonly role: string;
    readonly operand: { readonly kind: string; readonly resource?: { readonly kind: string } };
  }[];
}): boolean {
  const resources = new Set(
    instruction.operands
      .filter((operand) => operand.operand.kind === "resource")
      .map((operand) => `${operand.role}:${operand.operand.resource?.kind ?? ""}`),
  );
  return resources.has("implicitUse:FPCR") && resources.has("implicitDef:FPSR");
}
