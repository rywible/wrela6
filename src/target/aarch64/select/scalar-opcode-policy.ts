import type { OptIrIntegerBinaryOperator } from "../../../opt-ir/operations";
import type { OptIrType } from "../../../opt-ir/types";

export function opcodeForAArch64IntegerBinary(
  operator: OptIrIntegerBinaryOperator,
  resultType?: OptIrType,
): string {
  switch (operator) {
    case "add":
      return "add-shifted-register";
    case "subtract":
      return "sub-shifted-register";
    case "multiply":
      return "mul";
    case "unsignedDivide":
      return "udiv";
    case "signedDivide":
      return "sdiv";
    case "and":
      return "and-shifted-register";
    case "or":
      return "orr-shifted-register";
    case "xor":
      return "eor-shifted-register";
    case "shiftLeft":
      return "lsl";
    case "shiftRight":
      return resultType?.kind === "integer" && resultType.signedness === "signed" ? "asr" : "lsr";
  }
}
