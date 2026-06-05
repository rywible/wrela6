import type { CheckedInterfaceConstraint } from "./generic-checker";
import type { CheckedType } from "./type-model";
import { SourceSpan } from "../../frontend";

export interface CheckInterfaceConstraintInput {
  readonly interfaceType: CheckedType;
  readonly arguments: readonly CheckedType[];
}

export interface CheckInterfaceConstraintResult {
  readonly constraint: CheckedInterfaceConstraint;
  readonly diagnostics: readonly any[];
}

export function checkInterfaceConstraint(
  input: CheckInterfaceConstraintInput,
): CheckInterfaceConstraintResult {
  return {
    constraint: {
      interfaceType: input.interfaceType,
      arguments: input.arguments,
      span: SourceSpan.from(0, 0),
    },
    diagnostics: [],
  };
}
