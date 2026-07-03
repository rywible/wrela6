import type { MonoCheckedType, MonoLiteralValue } from "../../mono/mono-hir";
import type { CheckedMirProgram } from "../../proof-check/model/checked-mir";
import type {
  ProofMirBinaryOperator,
  ProofMirBlock,
  ProofMirBlockParameter,
  ProofMirCall,
  ProofMirComparisonOperator,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirReturnOperand,
  ProofMirStatement,
  ProofMirUnaryOperator,
  ProofMirValue,
} from "../../proof-mir/model/graph";
import type { ProofMirCallArgument, ProofMirCallReceiver } from "../../proof-mir/model/operands";
import type { ProofMirValueId } from "../../proof-mir/ids";
import { checkedTypeFingerprint } from "../../semantic/surface/type-model";
import { optIrConstructionIdAllocator, type OptIrEdge } from "../cfg";
import { optIrOperationId, type OptIrOriginId, type OptIrValueId } from "../ids";
import {
  optIrBooleanType,
  optIrNeverType,
  optIrPointerType,
  optIrSignedIntegerType,
  optIrUnitType,
  optIrUnsignedIntegerType,
  optIrZeroSizedType,
  type OptIrIntegerType,
  type OptIrType,
} from "../types";
import { optIrBlockArgumentBuilder } from "./block-argument-builder";
import { proofMirScopedValueKey, compareStableKeys } from "./proof-mir-lowering-support";
import { optIrProvenanceBuilder } from "./provenance-builder";
import type {
  OptIrBooleanBinaryOperator,
  OptIrIntegerBinaryOperator,
  OptIrIntegerCompareOperator,
} from "../operations";

export interface ProofMirLoweringHelperContext {
  readonly allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>;
  readonly provenance: ReturnType<typeof optIrProvenanceBuilder>;
  readonly values: ReturnType<typeof optIrBlockArgumentBuilder>;
  nextOperationId: number;
}

export function predeclareProofMirValues(
  function_: ProofMirFunction,
  context: ProofMirLoweringHelperContext,
): void {
  for (const value of function_.values
    .entries()
    .slice()
    .sort((left, right) => compareStableKeys(left.valueId, right.valueId))) {
    context.values.declareValue({
      valueKey: proofMirScopedValueKey(function_.functionInstanceId, value.valueId),
      runtime: proofMirValueIsRuntime(value),
      proofOnlyReason:
        value.representation.kind === "proofOnly"
          ? value.representation.reason
          : value.representation.kind,
    });
  }
}

export function sortedProofMirBlocks(function_: ProofMirFunction): readonly ProofMirBlock[] {
  return function_.blocks
    .entries()
    .slice()
    .sort((left, right) => compareStableKeys(left.blockId, right.blockId));
}

export function sortedProofMirEdges(function_: ProofMirFunction): readonly ProofMirControlEdge[] {
  return function_.edges
    .entries()
    .slice()
    .sort((left, right) => {
      const from = compareStableKeys(left.fromBlockId, right.fromBlockId);
      return from === 0 ? compareStableKeys(left.edgeId, right.edgeId) : from;
    });
}

export function entrySignatureParametersForBlock(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringHelperContext,
) {
  if (block.blockId !== function_.entryBlockId) {
    return [];
  }
  return function_.signature.parameters.map((parameter) =>
    context.values.parameterFor({
      valueKey: functionSignatureParameterValueKey(function_, parameter.parameterId),
      type: optIrTypeFromMono(parameter.type),
      incomingRole: "entry",
      runtime: true,
      originId: context.provenance.originFor({
        functionInstanceId: function_.functionInstanceId,
        checkedMirNodeKey: `signature-parameter:${String(parameter.parameterId)}`,
        proofMirOriginId: function_.origin,
      }),
    }),
  );
}

export function functionSignatureParameterValueKey(
  function_: ProofMirFunction,
  parameterId: ProofMirFunction["signature"]["parameters"][number]["parameterId"],
): string {
  return `${String(function_.functionInstanceId)}/parameter:${String(parameterId)}`;
}

export function statementOriginId(
  function_: ProofMirFunction,
  statement: ProofMirStatement,
  context: ProofMirLoweringHelperContext,
): OptIrOriginId {
  return context.provenance.originFor({
    functionInstanceId: function_.functionInstanceId,
    checkedMirNodeKey: `statement:${String(statement.statementId)}`,
    proofMirOriginId: statement.origin,
  });
}

export function proofMirTerminatorOperationId(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringHelperContext,
) {
  const blockId = context.allocator.blockIdFor(function_.functionInstanceId, String(block.blockId));
  return optIrOperationId(1_000_000_000 + Number(blockId));
}

export function nextStatementOperationId(context: ProofMirLoweringHelperContext) {
  const operationId = optIrOperationId(context.nextOperationId);
  context.nextOperationId += 1;
  return operationId;
}

export function proofMirValueIdFor(
  function_: ProofMirFunction,
  valueId: ProofMirValueId,
  context: ProofMirLoweringHelperContext,
): OptIrValueId {
  return context.values.declareValue({
    valueKey: proofMirScopedValueKey(function_.functionInstanceId, valueId),
    runtime: proofMirValueIsRuntime(function_.values.get(valueId)),
    proofOnlyReason: proofMirValueErasureReason(function_.values.get(valueId)),
  });
}

export function proofMirValueType(
  function_: ProofMirFunction,
  valueId: ProofMirValueId,
): OptIrType {
  const value = function_.values.get(valueId);
  return value === undefined ? optIrZeroSizedFallbackType() : optIrTypeFromMono(value.type);
}

export function proofMirValueIsRuntime(value: ProofMirValue | undefined): boolean {
  return value === undefined || value.representation.kind === "runtime";
}

export function proofMirValueErasureReason(value: ProofMirValue | undefined): string | undefined {
  if (value === undefined || value.representation.kind === "runtime") {
    return undefined;
  }
  if (value.representation.kind === "proofOnly") {
    return value.representation.reason;
  }
  return value.representation.kind;
}

export function parameterRuntime(parameter: ProofMirBlockParameter): boolean {
  return parameter.parameterKind.kind !== "proofFact";
}

export function literalIntegerValue(
  literal: Exclude<MonoLiteralValue, { readonly kind: "string" }>,
): bigint {
  switch (literal.kind) {
    case "integer":
      return literal.value ?? BigInt(literal.text);
    case "bool":
      return literal.value ? 1n : 0n;
  }
}

export function integerUnaryOperator(operator: ProofMirUnaryOperator) {
  switch (operator) {
    case "numericNegate":
      return "negate" as const;
    case "bitwiseNot":
      return "bitwiseNot" as const;
    case "logicalNot":
      return "negate" as const;
  }
}

export function integerBinaryOperator(
  operator: ProofMirBinaryOperator,
  resultType: OptIrType,
): OptIrIntegerBinaryOperator | undefined {
  switch (operator) {
    case "add":
      return "add";
    case "subtract":
      return "subtract";
    case "multiply":
      return "multiply";
    case "divide":
      return isSignedIntegerType(resultType) ? "signedDivide" : "unsignedDivide";
    case "bitwiseAnd":
      return "and";
    case "bitwiseOr":
      return "or";
    case "bitwiseXor":
      return "xor";
    case "shiftLeft":
      return "shiftLeft";
    case "shiftRight":
      return "shiftRight";
    case "remainder":
      return undefined;
  }
}

export function booleanBinaryOperator(
  operator: ProofMirBinaryOperator,
  resultType: OptIrType,
): OptIrBooleanBinaryOperator | undefined {
  if (resultType.kind !== "boolean") {
    return undefined;
  }
  switch (operator) {
    case "bitwiseAnd":
      return "and";
    case "bitwiseOr":
      return "or";
    case "bitwiseXor":
      return "xor";
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
    case "remainder":
    case "shiftLeft":
    case "shiftRight":
      return undefined;
  }
}

export function integerCompareInputs(
  function_: ProofMirFunction,
  input: {
    readonly operator: ProofMirComparisonOperator;
    readonly left: ProofMirValueId;
    readonly right: ProofMirValueId;
  },
  context: ProofMirLoweringHelperContext,
): {
  readonly left: OptIrValueId;
  readonly right: OptIrValueId;
  readonly operator: OptIrIntegerCompareOperator;
} {
  const left = proofMirValueIdFor(function_, input.left, context);
  const right = proofMirValueIdFor(function_, input.right, context);
  const signed = isSignedIntegerType(proofMirValueType(function_, input.left));
  switch (input.operator) {
    case "eq":
      return { left, right, operator: "equal" };
    case "ne":
      return { left, right, operator: "notEqual" };
    case "lt":
      return { left, right, operator: signed ? "signedLessThan" : "unsignedLessThan" };
    case "le":
      return {
        left,
        right,
        operator: signed ? "signedLessThanOrEqual" : "unsignedLessThanOrEqual",
      };
    case "gt":
      return { left: right, right: left, operator: signed ? "signedLessThan" : "unsignedLessThan" };
    case "ge":
      return {
        left: right,
        right: left,
        operator: signed ? "signedLessThanOrEqual" : "unsignedLessThanOrEqual",
      };
  }
}

export function receiverArgumentIds(
  function_: ProofMirFunction,
  receiver: ProofMirCallReceiver | undefined,
  context: ProofMirLoweringHelperContext,
): readonly OptIrValueId[] {
  return receiver === undefined ? [] : operandValueIds(function_, receiver.operand, context);
}

export function operandValueIds(
  function_: ProofMirFunction,
  operand: ProofMirCallArgument | NonNullable<ProofMirCall["result"]>,
  context: ProofMirLoweringHelperContext,
): readonly OptIrValueId[];
export function operandValueIds(
  function_: ProofMirFunction,
  operand: ProofMirCallArgument["operand"] | NonNullable<ProofMirCall["result"]>,
  context: ProofMirLoweringHelperContext,
): readonly OptIrValueId[];
export function operandValueIds(
  function_: ProofMirFunction,
  operand:
    | ProofMirCallArgument
    | ProofMirCallArgument["operand"]
    | NonNullable<ProofMirCall["result"]>,
  context: ProofMirLoweringHelperContext,
): readonly OptIrValueId[] {
  const actualOperand = "operand" in operand ? operand.operand : operand;
  switch (actualOperand.kind) {
    case "value":
      return [proofMirValueIdFor(function_, actualOperand.value, context)];
    case "valueAndPlace":
      return [proofMirValueIdFor(function_, actualOperand.value, context)];
    case "place":
      return [];
  }
}

export function returnOperandValueIds(
  function_: ProofMirFunction,
  value: ProofMirReturnOperand | undefined,
  context: ProofMirLoweringHelperContext,
): readonly OptIrValueId[] {
  return value === undefined ? [] : operandValueIds(function_, value.operand, context);
}

export function byteWidthForType(type: OptIrType): number {
  if (type.kind === "integer") {
    return Math.max(1, Math.ceil(type.width / 8));
  }
  if (type.kind === "boolean") {
    return 1;
  }
  return 1;
}

export function optIrTypeFromMono(type: MonoCheckedType): OptIrType {
  if (type.kind === "core") {
    const coreTypeName = String(type.coreTypeId);
    switch (coreTypeName) {
      case "bool":
        return optIrBooleanType();
      case "i8":
        return optIrSignedIntegerType(8);
      case "i16":
        return optIrSignedIntegerType(16);
      case "i32":
        return optIrSignedIntegerType(32);
      case "i64":
        return optIrSignedIntegerType(64);
      case "u8":
        return optIrUnsignedIntegerType(8);
      case "u16":
        return optIrUnsignedIntegerType(16);
      case "u32":
        return optIrUnsignedIntegerType(32);
      case "u64":
        return optIrUnsignedIntegerType(64);
      case "usize":
        return optIrUnsignedIntegerType(64);
      case "Never":
        return optIrNeverType();
      case "void":
        return optIrUnitType();
    }
  }
  if (type.kind === "target" && String(type.targetTypeId) === "Ptr") {
    return optIrPointerType({ addressSpace: "target" });
  }
  return optIrZeroSizedType(checkedTypeFingerprint(type));
}

export function deterministicFunctions(checkedMir: CheckedMirProgram): readonly ProofMirFunction[] {
  const checkedFunctionIds = new Set([...checkedMir.checkedFunctions.keys()].map(String));
  return checkedMir.mir.functions
    .entries()
    .filter((function_) => checkedFunctionIds.has(String(function_.functionInstanceId)))
    .sort((left, right) =>
      String(left.functionInstanceId).localeCompare(String(right.functionInstanceId)),
    );
}

export function requireMappedProofMirEdgeKind(
  kind: ProofMirControlEdge["kind"],
): OptIrEdge["kind"] {
  return kind;
}

function isSignedIntegerType(type: OptIrType): type is OptIrIntegerType {
  return type.kind === "integer" && type.signedness === "signed";
}

function optIrZeroSizedFallbackType(): OptIrType {
  return optIrZeroSizedType("proof-mir-parameter");
}
