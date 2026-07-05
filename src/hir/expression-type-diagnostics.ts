import { SyntaxKind } from "../frontend/syntax/syntax-kind";
import { coreTypeId } from "../semantic/ids";
import {
  checkedTypeFingerprint,
  checkedTypesEqual,
  type CheckedType,
} from "../semantic/surface/type-model";
import type { HirOriginId } from "./ids";
import { hirDiagnostic, type HirLoweringContext } from "./lowering-context";

export function reportTypeMismatch(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly expectedType: CheckedType | undefined;
  readonly actualType: CheckedType;
}): void {
  if (input.expectedType === undefined) return;
  if (input.actualType.kind === "error") return;
  if (checkedTypesEqual(input.expectedType, input.actualType)) return;
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_EXPRESSION_TYPE_MISMATCH",
      message: "Expression type does not match expected type.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: "expression-type",
    }),
  );
}

export function isIntegerCheckedType(type: CheckedType | undefined): boolean {
  if (type?.kind !== "core") return false;
  return (
    type.coreTypeId === coreTypeId("u8") ||
    type.coreTypeId === coreTypeId("u16") ||
    type.coreTypeId === coreTypeId("u32") ||
    type.coreTypeId === coreTypeId("u64") ||
    type.coreTypeId === coreTypeId("usize")
  );
}

export function maximumIntegerValue(type: CheckedType): bigint | undefined {
  if (type.kind !== "core") return undefined;
  if (type.coreTypeId === coreTypeId("u8")) return 255n;
  if (type.coreTypeId === coreTypeId("u16")) return 65_535n;
  if (type.coreTypeId === coreTypeId("u32")) return 4_294_967_295n;
  if (type.coreTypeId === coreTypeId("u64") || type.coreTypeId === coreTypeId("usize")) {
    return 18_446_744_073_709_551_615n;
  }
  return undefined;
}

export function reportIntegerLiteralOutOfRange(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly valueText: string;
  readonly type: CheckedType;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_INTEGER_LITERAL_OUT_OF_RANGE",
      message: "Integer literal is outside the expected type range.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: `${input.valueText}:${checkedTypeFingerprint(input.type)}`,
    }),
  );
}

export function reportBinaryOperandTypeMismatch(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly operator: string;
  readonly leftType: CheckedType;
  readonly rightType: CheckedType;
}): void {
  if (input.leftType.kind === "error" || input.rightType.kind === "error") return;
  if (checkedTypesEqual(input.leftType, input.rightType)) return;
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_BINARY_OPERAND_TYPE_MISMATCH",
      message: "Binary expression operands must have matching types.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: `${input.operator}:${checkedTypeFingerprint(input.leftType)}:${checkedTypeFingerprint(input.rightType)}`,
    }),
  );
}

export function isArithmeticOperator(kind: SyntaxKind | undefined): boolean {
  return (
    kind === SyntaxKind.PlusToken ||
    kind === SyntaxKind.MinusToken ||
    kind === SyntaxKind.StarToken ||
    kind === SyntaxKind.SlashToken ||
    kind === SyntaxKind.PercentToken
  );
}

export function isBitwiseOperator(kind: SyntaxKind | undefined): boolean {
  return (
    kind === SyntaxKind.AmpersandToken ||
    kind === SyntaxKind.PipeToken ||
    kind === SyntaxKind.CaretToken ||
    kind === SyntaxKind.LeftShiftToken ||
    kind === SyntaxKind.RightShiftToken
  );
}

export function isLogicalOperator(kind: SyntaxKind | undefined): boolean {
  return kind === SyntaxKind.AndKeyword || kind === SyntaxKind.OrKeyword;
}

export function reportArithmeticRequiresInteger(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly stableDetail: string;
  readonly message?: string;
}): void {
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_ARITHMETIC_REQUIRES_INTEGER",
      message: input.message ?? "Arithmetic operands must be integers.",
      originId: input.sourceOrigin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${input.sourceOrigin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

export function reportArithmeticOperandDiagnostics(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly operator: string;
  readonly leftType: CheckedType;
  readonly rightType: CheckedType;
}): void {
  if (input.leftType.kind !== "error" && !isIntegerCheckedType(input.leftType)) {
    reportArithmeticRequiresInteger({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      stableDetail: `${input.operator}:left:${checkedTypeFingerprint(input.leftType)}`,
    });
  }
  if (input.rightType.kind !== "error" && !isIntegerCheckedType(input.rightType)) {
    reportArithmeticRequiresInteger({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      stableDetail: `${input.operator}:right:${checkedTypeFingerprint(input.rightType)}`,
    });
  }
}

export function reportBitwiseOperandDiagnostics(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly operator: string;
  readonly leftType: CheckedType;
  readonly rightType: CheckedType;
}): void {
  if (input.leftType.kind !== "error" && !isIntegerCheckedType(input.leftType)) {
    reportArithmeticRequiresInteger({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      stableDetail: `${input.operator}:left:${checkedTypeFingerprint(input.leftType)}`,
      message: "Bitwise operands must be unsigned integers.",
    });
  }
  if (input.rightType.kind !== "error" && !isIntegerCheckedType(input.rightType)) {
    reportArithmeticRequiresInteger({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      stableDetail: `${input.operator}:right:${checkedTypeFingerprint(input.rightType)}`,
      message: "Bitwise operands must be unsigned integers.",
    });
  }
}

export function reportLogicalOperandDiagnostics(input: {
  readonly context: HirLoweringContext;
  readonly sourceOrigin: HirOriginId;
  readonly operator: string;
  readonly leftType: CheckedType;
  readonly rightType: CheckedType;
}): void {
  const boolType: CheckedType = { kind: "core", coreTypeId: coreTypeId("bool") };
  if (input.leftType.kind !== "error" && !checkedTypesEqual(input.leftType, boolType)) {
    reportTypeMismatch({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      expectedType: boolType,
      actualType: input.leftType,
    });
  }
  if (input.rightType.kind !== "error" && !checkedTypesEqual(input.rightType, boolType)) {
    reportTypeMismatch({
      context: input.context,
      sourceOrigin: input.sourceOrigin,
      expectedType: boolType,
      actualType: input.rightType,
    });
  }
}

export function unaryNegationStableDetail(type: CheckedType): string {
  return `negate:${checkedTypeFingerprint(type)}`;
}
