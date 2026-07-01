import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";

export interface AArch64MachineCallSite {
  readonly callKey: string;
  readonly caller: string;
  readonly callee: string;
  readonly instructionId: number;
  readonly kind: "direct" | "indirect";
}

export function machineCallSiteForInstruction(
  functionKey: string,
  instruction: AArch64MachineInstruction,
): AArch64MachineCallSite | undefined {
  const opcode = String(instruction.opcode);
  const instructionId = Number(instruction.instructionId);
  if (opcode === "bl") {
    const symbolOperand = instruction.operands.find(
      (operand) => operand.role === "use" && operand.operand.kind === "symbol",
    );
    if (symbolOperand?.operand.kind !== "symbol") return undefined;
    const callee = String(symbolOperand.operand.symbol);
    return Object.freeze({
      callKey: `call:${functionKey}:${callee}:insn:${instructionId}`,
      caller: functionKey,
      callee,
      instructionId,
      kind: "direct",
    });
  }
  if (opcode === "blr") {
    const targetOperand = instruction.operands.find(
      (operand) => operand.role === "use" && operand.operand.kind === "vreg",
    );
    if (targetOperand?.operand.kind !== "vreg") return undefined;
    const callee = `indirect:${instructionId}`;
    return Object.freeze({
      callKey: `call:${functionKey}:${callee}:insn:${instructionId}`,
      caller: functionKey,
      callee,
      instructionId,
      kind: "indirect",
    });
  }
  return undefined;
}
