import { optIrConstructionIdAllocator, optIrCfgEdgeTable, type OptIrEdge } from "../cfg";
import { optIrConstantPool, type OptIrConstantPool } from "../constants";
import {
  optIrCallId,
  optIrConstantId,
  optIrOperationId,
  optIrProgramId,
  type OptIrOriginId,
  type OptIrValueId,
} from "../ids";
import { optIrFunctionTable, optIrProgram, optIrRegionTable, optIrConstantTable } from "../program";
import type { OptIrBlock } from "../cfg";
import type { OptIrFunction } from "../program";
import type { OptIrTerminator } from "../terminators";
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
import type { OptIrRegion } from "../regions";
import type { MonoCheckedType, MonoLiteralValue } from "../../mono/mono-hir";
import type { TargetId } from "../../semantic/ids";
import { checkedTypeFingerprint } from "../../semantic/surface/type-model";
import type { ProofMirValueId } from "../../proof-mir/ids";
import type { CheckedMirProgram } from "../../proof-check/model/checked-mir";
import type {
  ProofMirBlock,
  ProofMirBlockParameter,
  ProofMirCall,
  ProofMirComparisonOperator,
  ProofMirControlEdge,
  ProofMirBinaryOperator,
  ProofMirFunction,
  ProofMirReturnOperand,
  ProofMirStatement,
  ProofMirUnaryOperator,
  ProofMirValue,
} from "../../proof-mir/model/graph";
import type { ProofMirCallArgument, ProofMirCallReceiver } from "../../proof-mir/model/operands";
import { optIrBlockArgumentBuilder } from "./block-argument-builder";
import { optIrProvenanceBuilder } from "./provenance-builder";
import {
  optIrBooleanBinaryOperation,
  optIrBooleanNotOperation,
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrIntegerUnaryOperation,
  optIrPlatformCallOperation,
  optIrProofErasedMarkerOperation,
  optIrRuntimeCallOperation,
  optIrSourceCallOperation,
  type OptIrBooleanBinaryOperator,
  type OptIrIntegerBinaryOperator,
  type OptIrIntegerCompareOperator,
  type OptIrOperation,
} from "../operations";
import {
  compareRegions,
  type OptIrValidatedBufferFactForLowering,
  validatedBufferFactIndexForLowering,
  validatedBufferLayoutKey,
  lowerValidatedBufferFieldRead,
} from "./validated-buffer-lowering";
import {
  compareOperations,
  compareStableKeys,
  proofMirScopedValueKey,
} from "./proof-mir-lowering-support";
import type { OptIrSkeletonLoweringResult } from "./lowering-types";

export type { OptIrSkeletonLoweringResult } from "./lowering-types";
export type { OptIrValidatedBufferFactForLowering };
export {
  lowerCheckedMirSkeletonForTest,
  type OptIrSkeletonBlockForTest,
  type OptIrSkeletonEdgeForTest,
  type OptIrSkeletonForTestInput,
  type OptIrSkeletonFunctionForTest,
  type OptIrSkeletonOriginForTest,
  type OptIrSkeletonParameterForTest,
  type OptIrSkeletonSwitchCaseForTest,
  type OptIrSkeletonTerminatorForTest,
} from "./skeleton-lowering";

export function lowerCheckedMirProgram(input: {
  readonly checkedMir: CheckedMirProgram;
  readonly targetId: TargetId;
  readonly targetEndian: "little" | "big";
  readonly validatedBufferFacts: readonly OptIrValidatedBufferFactForLowering[];
}): OptIrSkeletonLoweringResult {
  const diagnostics: string[] = [];
  const functions = deterministicFunctions(input.checkedMir);
  const result = lowerProofMirFunctions({
    targetId: input.targetId,
    targetEndian: input.targetEndian,
    validatedBufferFacts: input.validatedBufferFacts,
    functions,
    diagnostics,
  });
  if (result.kind === "error") {
    return { kind: "error", diagnostics: result.diagnostics };
  }
  return result;
}

interface ProofMirLoweringContext {
  readonly allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>;
  readonly provenance: ReturnType<typeof optIrProvenanceBuilder>;
  readonly values: ReturnType<typeof optIrBlockArgumentBuilder>;
  readonly constantPool: OptIrConstantPool;
  readonly operations: OptIrOperation[];
  readonly regions: OptIrRegion[];
  readonly regionsByKey: Map<string, OptIrRegion>;
  readonly targetEndian: "little" | "big";
  readonly validatedBufferFacts: readonly OptIrValidatedBufferFactForLowering[];
  readonly validatedBufferAuthorityIndex: ReadonlyMap<string, OptIrValidatedBufferFactForLowering>;
  readonly diagnostics: string[];
  nextOperationId: number;
  nextConstantId: number;
}

function lowerProofMirFunctions(input: {
  readonly targetId: TargetId;
  readonly targetEndian: "little" | "big";
  readonly validatedBufferFacts: readonly OptIrValidatedBufferFactForLowering[];
  readonly functions: readonly ProofMirFunction[];
  readonly diagnostics: string[];
}): OptIrSkeletonLoweringResult {
  const allocator = optIrConstructionIdAllocator<string, string>({
    functionsInTraversalOrder: input.functions.map((function_) => function_.functionInstanceId),
    blocksInTraversalOrder: new Map(
      input.functions.map((function_) => [
        function_.functionInstanceId,
        sortedProofMirBlocks(function_).map((block) => String(block.blockId)),
      ]),
    ),
    edgesInTraversalOrder: new Map(
      input.functions.map((function_) => [
        function_.functionInstanceId,
        sortedProofMirEdges(function_).map((edge) => String(edge.edgeId)),
      ]),
    ),
  });
  const context: ProofMirLoweringContext = {
    allocator,
    provenance: optIrProvenanceBuilder(),
    values: optIrBlockArgumentBuilder(),
    constantPool: optIrConstantPool(),
    operations: [],
    regions: [],
    regionsByKey: new Map(),
    targetEndian: input.targetEndian,
    validatedBufferFacts: input.validatedBufferFacts,
    validatedBufferAuthorityIndex: validatedBufferFactIndexForLowering(input.validatedBufferFacts),
    diagnostics: input.diagnostics,
    nextOperationId: 1,
    nextConstantId: 0,
  };

  for (const function_ of input.functions) {
    predeclareProofMirValues(function_, context);
    if (!function_.blocks.has(function_.entryBlockId)) {
      context.diagnostics.push(`function:${String(function_.functionInstanceId)}:missing-block`);
    }
  }

  if (context.diagnostics.length > 0) {
    return { kind: "error", diagnostics: context.diagnostics.slice().sort() };
  }

  const loweredFunctions = input.functions.map((function_) =>
    lowerProofMirFunction(function_, context),
  );

  if (context.diagnostics.length > 0) {
    return { kind: "error", diagnostics: context.diagnostics.slice().sort() };
  }

  const originEntries = context.provenance.entries();
  return {
    kind: "ok",
    program: optIrProgram({
      programId: optIrProgramId(0),
      targetId: input.targetId,
      functions: optIrFunctionTable(loweredFunctions),
      regions: optIrRegionTable(
        context.regions.map((region) => ({
          regionId: region.regionId,
          originId: region.origin.originId,
        })),
      ),
      constants: optIrConstantTable(context.constantPool.constants()),
      callGraph: { calls: [] },
      provenance: { originIds: originEntries.map((origin) => origin.originId) },
    }),
    origins: new Map(originEntries.map((origin) => [origin.originId, origin])),
    regions: Object.freeze([...context.regions].sort(compareRegions)),
    operations: Object.freeze([...context.operations].sort(compareOperations)),
    valueIdsByKey: new Map(context.values.valueEntries()),
    executableValueIds: context.values.executableValueIds(),
    proofOnlyValueIds: context.values.proofOnlyValueIds(),
    valuesMarkedForErasure: context.values.valuesMarkedForErasure(),
  };
}

function lowerProofMirFunction(
  function_: ProofMirFunction,
  context: ProofMirLoweringContext,
): OptIrFunction {
  const blocks = sortedProofMirBlocks(function_).map((block) =>
    lowerProofMirBlock(function_, block, context),
  );
  const edges = sortedProofMirEdges(function_).map((edge, ordinal) =>
    lowerProofMirEdge(function_, edge, ordinal, context),
  );
  const entryBlock = context.allocator.blockIdFor(
    function_.functionInstanceId,
    String(function_.entryBlockId),
  );
  return {
    functionId: context.allocator.functionIdFor(function_.functionInstanceId),
    monoInstanceId: function_.functionInstanceId,
    signature: function_.signature,
    blocks,
    edges: optIrCfgEdgeTable(edges),
    entryBlock,
    originId: context.provenance.originFor({
      functionInstanceId: function_.functionInstanceId,
      checkedMirNodeKey: `function:${String(function_.functionInstanceId)}`,
      proofMirOriginId: function_.origin,
    }),
  };
}

function lowerProofMirBlock(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringContext,
): OptIrBlock {
  const parameters = block.parameters.map((parameter) =>
    context.values.parameterFor({
      valueKey: proofMirScopedValueKey(function_.functionInstanceId, parameter.valueId),
      type: optIrTypeFromMono(parameter.type),
      incomingRole:
        String(block.blockId) === String(function_.entryBlockId) ? "entry" : "branchArgument",
      runtime: parameterRuntime(parameter),
      proofOnlyReason:
        parameter.parameterKind.kind === "proofFact" ? "proof-fact-parameter" : undefined,
      originId: context.provenance.originFor({
        functionInstanceId: function_.functionInstanceId,
        checkedMirNodeKey: `parameter:${String(block.blockId)}:${String(parameter.valueId)}`,
        proofMirOriginId: parameter.origin,
      }),
    }),
  );
  const operationIds = block.statements.flatMap((statement) =>
    lowerProofMirStatement(function_, statement, context).map((operation) => {
      context.operations.push(operation);
      return operation.operationId;
    }),
  );

  return {
    blockId: context.allocator.blockIdFor(function_.functionInstanceId, String(block.blockId)),
    parameters,
    operations: Object.freeze(operationIds),
    terminator: lowerProofMirTerminator(function_, block, context),
    originId: context.provenance.originFor({
      functionInstanceId: function_.functionInstanceId,
      checkedMirNodeKey: `block:${String(block.blockId)}`,
      proofMirOriginId: block.origin,
    }),
  };
}

function lowerProofMirEdge(
  function_: ProofMirFunction,
  edge: ProofMirControlEdge,
  ordinal: number,
  context: ProofMirLoweringContext,
): OptIrEdge {
  return {
    edgeId: context.allocator.edgeIdFor(function_.functionInstanceId, String(edge.edgeId)),
    from: context.allocator.blockIdFor(function_.functionInstanceId, String(edge.fromBlockId)),
    ...(edge.toBlockId === undefined
      ? {}
      : {
          toBlock: context.allocator.blockIdFor(
            function_.functionInstanceId,
            String(edge.toBlockId),
          ),
        }),
    ordinal,
    kind: requireMappedProofMirEdgeKind(edge.kind),
    arguments: edge.arguments.map((valueId) => proofMirValueIdFor(function_, valueId, context)),
    originId: context.provenance.originFor({
      functionInstanceId: function_.functionInstanceId,
      checkedMirNodeKey: `edge:${String(edge.edgeId)}`,
      proofMirOriginId: edge.origin,
    }),
  };
}

function lowerProofMirStatement(
  function_: ProofMirFunction,
  statement: ProofMirStatement,
  context: ProofMirLoweringContext,
): readonly OptIrOperation[] {
  const originId = statementOriginId(function_, statement, context);
  switch (statement.kind.kind) {
    case "literal":
      if (statement.kind.literal.kind === "string") {
        context.diagnostics.push(
          `statement:${String(statement.statementId)}:unsupported-literal:string`,
        );
        return [];
      }
      return [
        optIrConstantOperation({
          operationId: nextStatementOperationId(context),
          resultId: proofMirValueIdFor(function_, statement.kind.value, context),
          constant: context.constantPool.internInteger({
            constantId: optIrConstantId(context.nextConstantId++),
            type: proofMirValueType(function_, statement.kind.value),
            normalizedValue: literalIntegerValue(statement.kind.literal),
          }),
          originId,
        }),
      ];
    case "unary": {
      const operationId = nextStatementOperationId(context);
      const resultId = proofMirValueIdFor(function_, statement.kind.result, context);
      const operand = proofMirValueIdFor(function_, statement.kind.operand, context);
      if (statement.kind.operator === "logicalNot") {
        return [optIrBooleanNotOperation({ operationId, resultId, operand, originId })];
      }
      return [
        optIrIntegerUnaryOperation({
          operationId,
          resultId,
          operand,
          operator: integerUnaryOperator(statement.kind.operator),
          resultType: proofMirValueType(function_, statement.kind.result),
          originId,
        }),
      ];
    }
    case "binary": {
      const left = proofMirValueIdFor(function_, statement.kind.left, context);
      const right = proofMirValueIdFor(function_, statement.kind.right, context);
      const resultId = proofMirValueIdFor(function_, statement.kind.result, context);
      const resultType = proofMirValueType(function_, statement.kind.result);
      const booleanOperator = booleanBinaryOperator(statement.kind.operator, resultType);
      if (booleanOperator !== undefined) {
        return [
          optIrBooleanBinaryOperation({
            operationId: nextStatementOperationId(context),
            resultId,
            left,
            right,
            operator: booleanOperator,
            originId,
          }),
        ];
      }
      const operator = integerBinaryOperator(statement.kind.operator, resultType);
      if (operator === undefined) {
        context.diagnostics.push(
          `statement:${String(statement.statementId)}:unsupported-binary:${statement.kind.operator}`,
        );
        return [];
      }
      return [
        optIrIntegerBinaryOperation({
          operationId: nextStatementOperationId(context),
          resultId,
          left,
          right,
          operator,
          resultType,
          originId,
        }),
      ];
    }
    case "comparison": {
      const comparison = integerCompareInputs(function_, statement.kind, context);
      return [
        optIrIntegerCompareOperation({
          operationId: nextStatementOperationId(context),
          resultId: proofMirValueIdFor(function_, statement.kind.result, context),
          left: comparison.left,
          right: comparison.right,
          operator: comparison.operator,
          originId,
        }),
      ];
    }
    case "call":
      return [lowerProofMirCall(function_, statement.kind.call, context, originId)];
    case "readValidatedBufferField": {
      const read = statement.kind.read;
      const layoutKey = validatedBufferLayoutKey(read.layoutField);
      const lowered = lowerValidatedBufferFieldRead({
        function_,
        read,
        layoutKey,
        valueType: proofMirValueType(function_, read.result),
        byteWidth: byteWidthForType(proofMirValueType(function_, read.result)),
        targetEndian: context.targetEndian,
        resultId: proofMirValueIdFor(function_, read.result, context),
        operationId: nextStatementOperationId(context),
        originId,
        authorityIndex: context.validatedBufferAuthorityIndex,
        regions: context.regions,
        regionsByKey: context.regionsByKey,
        provenance: context.provenance,
      });
      if (lowered.kind === "error") {
        context.diagnostics.push(
          lowered.code === "missing-authority"
            ? `statement:${String(statement.statementId)}:missing-validated-buffer-authority:${String(layoutKey)}`
            : `statement:${String(statement.statementId)}:invalid-buffer-read`,
        );
        return [];
      }
      return [lowered.operation];
    }
    case "recordFactEvidence":
    case "requireFact":
    case "bindLayoutTerm":
    case "consumePlace":
    case "borrowPlace":
    case "releaseLoan":
    case "validate":
    case "attempt":
    case "take":
    case "openSessionMember":
    case "closeSessionMember":
    case "openObligation":
    case "dischargeObligation":
    case "advancePrivateState":
      return [
        optIrProofErasedMarkerOperation({
          operationId: nextStatementOperationId(context),
          erasedProof: statement.kind.kind,
          originId,
        }),
      ];
    case "load":
    case "store":
    case "movePlace":
    case "extension":
      context.diagnostics.push(
        `statement:${String(statement.statementId)}:unsupported-kind:${statement.kind.kind}`,
      );
      return [];
  }
}

function lowerProofMirCall(
  function_: ProofMirFunction,
  call: ProofMirCall,
  context: ProofMirLoweringContext,
  originId: OptIrOriginId,
): OptIrOperation {
  const argumentIds = [
    ...receiverArgumentIds(function_, call.receiver, context),
    ...call.arguments.flatMap((argument) => operandValueIds(function_, argument, context)),
  ];
  const resultValueIds =
    call.result === undefined ? [] : operandValueIds(function_, call.result, context);
  const resultTypes =
    call.result?.kind === "value" || call.result?.kind === "valueAndPlace"
      ? [proofMirValueType(function_, call.result.value)]
      : resultValueIds.map(() => optIrUnitType());
  const common = {
    operationId: nextStatementOperationId(context),
    callId: optIrCallId(Number(call.callId)),
    argumentIds,
    resultIds: resultValueIds,
    resultTypes,
    originId,
  };
  switch (call.target.kind) {
    case "sourceFunction":
      return optIrSourceCallOperation({
        ...common,
        target: { kind: "source", functionInstanceId: call.target.functionInstanceId },
      });
    case "compilerRuntime":
      return optIrRuntimeCallOperation({
        ...common,
        target: { kind: "runtime", runtimeKey: String(call.target.runtimeId) },
      });
    case "certifiedPlatform":
      return optIrPlatformCallOperation({
        ...common,
        target: { kind: "platform", platformKey: String(call.target.primitiveId) },
      });
  }
}

function lowerProofMirTerminator(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringContext,
): OptIrTerminator {
  const terminator = block.terminator;
  const originId = context.provenance.originFor({
    functionInstanceId: function_.functionInstanceId,
    checkedMirNodeKey: `terminator:${String(block.blockId)}`,
    proofMirOriginId: terminator.origin,
  });
  const operationId = proofMirTerminatorOperationId(function_, block, context);
  switch (terminator.kind.kind) {
    case "goto":
      return {
        kind: "jump",
        operationId,
        edge: context.allocator.edgeIdFor(
          function_.functionInstanceId,
          String(terminator.kind.target.edgeId),
        ),
        originId,
      };
    case "branch":
      return {
        kind: "branch",
        operationId,
        condition: proofMirValueIdFor(function_, terminator.kind.condition, context),
        trueEdge: context.allocator.edgeIdFor(
          function_.functionInstanceId,
          String(terminator.kind.whenTrue.edgeId),
        ),
        falseEdge: context.allocator.edgeIdFor(
          function_.functionInstanceId,
          String(terminator.kind.whenFalse.edgeId),
        ),
        originId,
      };
    case "switch":
      if (terminator.kind.fallback === undefined) {
        context.diagnostics.push(
          `terminator:${String(terminator.terminatorId)}:unsupported-switch`,
        );
        return { kind: "unreachable", operationId, originId };
      }
      return {
        kind: "switch",
        operationId,
        scrutinee: proofMirValueIdFor(function_, terminator.kind.scrutinee, context),
        cases: Object.freeze(
          terminator.kind.cases.map((switchCase) =>
            Object.freeze({
              label: switchCase.label,
              edge: context.allocator.edgeIdFor(
                function_.functionInstanceId,
                String(switchCase.target.edgeId),
              ),
            }),
          ),
        ),
        defaultEdge: context.allocator.edgeIdFor(
          function_.functionInstanceId,
          String(terminator.kind.fallback.edgeId),
        ),
        originId,
      };
    case "return":
      return {
        kind: "return",
        operationId,
        values: Object.freeze(returnOperandValueIds(function_, terminator.kind.value, context)),
        originId,
      };
    case "panic":
    case "unreachable":
      return { kind: "unreachable", operationId, originId };
    case "matchValidation":
    case "matchAttempt":
    case "yield":
      context.diagnostics.push(
        `terminator:${String(terminator.terminatorId)}:unsupported-kind:${terminator.kind.kind}`,
      );
      return { kind: "unreachable", operationId, originId };
  }
}

function predeclareProofMirValues(
  function_: ProofMirFunction,
  context: ProofMirLoweringContext,
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

function sortedProofMirBlocks(function_: ProofMirFunction): readonly ProofMirBlock[] {
  return function_.blocks
    .entries()
    .slice()
    .sort((left, right) => compareStableKeys(left.blockId, right.blockId));
}

function sortedProofMirEdges(function_: ProofMirFunction): readonly ProofMirControlEdge[] {
  return function_.edges
    .entries()
    .slice()
    .sort((left, right) => {
      const from = compareStableKeys(left.fromBlockId, right.fromBlockId);
      return from === 0 ? compareStableKeys(left.edgeId, right.edgeId) : from;
    });
}

function statementOriginId(
  function_: ProofMirFunction,
  statement: ProofMirStatement,
  context: ProofMirLoweringContext,
): OptIrOriginId {
  return context.provenance.originFor({
    functionInstanceId: function_.functionInstanceId,
    checkedMirNodeKey: `statement:${String(statement.statementId)}`,
    proofMirOriginId: statement.origin,
  });
}

function proofMirTerminatorOperationId(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringContext,
) {
  const blockId = context.allocator.blockIdFor(function_.functionInstanceId, String(block.blockId));
  return optIrOperationId(1_000_000_000 + Number(blockId));
}

function nextStatementOperationId(context: ProofMirLoweringContext) {
  const operationId = optIrOperationId(context.nextOperationId);
  context.nextOperationId += 1;
  return operationId;
}

function proofMirValueIdFor(
  function_: ProofMirFunction,
  valueId: ProofMirValueId,
  context: ProofMirLoweringContext,
): OptIrValueId {
  return context.values.declareValue({
    valueKey: proofMirScopedValueKey(function_.functionInstanceId, valueId),
    runtime: proofMirValueIsRuntime(function_.values.get(valueId)),
    proofOnlyReason: proofMirValueErasureReason(function_.values.get(valueId)),
  });
}

function proofMirValueType(function_: ProofMirFunction, valueId: ProofMirValueId): OptIrType {
  const value = function_.values.get(valueId);
  return value === undefined ? optIrZeroSizedFallbackType() : optIrTypeFromMono(value.type);
}

function proofMirValueIsRuntime(value: ProofMirValue | undefined): boolean {
  return value === undefined || value.representation.kind === "runtime";
}

function proofMirValueErasureReason(value: ProofMirValue | undefined): string | undefined {
  if (value === undefined || value.representation.kind === "runtime") {
    return undefined;
  }
  if (value.representation.kind === "proofOnly") {
    return value.representation.reason;
  }
  return value.representation.kind;
}

function parameterRuntime(parameter: ProofMirBlockParameter): boolean {
  return parameter.parameterKind.kind !== "proofFact";
}

function literalIntegerValue(
  literal: Exclude<MonoLiteralValue, { readonly kind: "string" }>,
): bigint {
  switch (literal.kind) {
    case "integer":
      return literal.value ?? BigInt(literal.text);
    case "bool":
      return literal.value ? 1n : 0n;
  }
}

function integerUnaryOperator(operator: ProofMirUnaryOperator) {
  switch (operator) {
    case "numericNegate":
      return "negate" as const;
    case "bitwiseNot":
      return "bitwiseNot" as const;
    case "logicalNot":
      return "negate" as const;
  }
}

function integerBinaryOperator(
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

function booleanBinaryOperator(
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

function integerCompareInputs(
  function_: ProofMirFunction,
  input: {
    readonly operator: ProofMirComparisonOperator;
    readonly left: ProofMirValueId;
    readonly right: ProofMirValueId;
  },
  context: ProofMirLoweringContext,
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

function receiverArgumentIds(
  function_: ProofMirFunction,
  receiver: ProofMirCallReceiver | undefined,
  context: ProofMirLoweringContext,
): readonly OptIrValueId[] {
  return receiver === undefined ? [] : operandValueIds(function_, receiver.operand, context);
}

function operandValueIds(
  function_: ProofMirFunction,
  operand: ProofMirCallArgument | NonNullable<ProofMirCall["result"]>,
  context: ProofMirLoweringContext,
): readonly OptIrValueId[];
function operandValueIds(
  function_: ProofMirFunction,
  operand: ProofMirCallArgument["operand"] | NonNullable<ProofMirCall["result"]>,
  context: ProofMirLoweringContext,
): readonly OptIrValueId[];
function operandValueIds(
  function_: ProofMirFunction,
  operand:
    | ProofMirCallArgument
    | ProofMirCallArgument["operand"]
    | NonNullable<ProofMirCall["result"]>,
  context: ProofMirLoweringContext,
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

function returnOperandValueIds(
  function_: ProofMirFunction,
  value: ProofMirReturnOperand | undefined,
  context: ProofMirLoweringContext,
): readonly OptIrValueId[] {
  return value === undefined ? [] : operandValueIds(function_, value.operand, context);
}

function byteWidthForType(type: OptIrType): number {
  if (type.kind === "integer") {
    return Math.max(1, Math.ceil(type.width / 8));
  }
  if (type.kind === "boolean") {
    return 1;
  }
  return 1;
}

function optIrTypeFromMono(type: MonoCheckedType): OptIrType {
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

function isSignedIntegerType(type: OptIrType): type is OptIrIntegerType {
  return type.kind === "integer" && type.signedness === "signed";
}

function optIrZeroSizedFallbackType(): OptIrType {
  return optIrZeroSizedType("proof-mir-parameter");
}

function deterministicFunctions(checkedMir: CheckedMirProgram): readonly ProofMirFunction[] {
  const checkedFunctionIds = new Set([...checkedMir.checkedFunctions.keys()].map(String));
  return checkedMir.mir.functions
    .entries()
    .filter((function_) => checkedFunctionIds.has(String(function_.functionInstanceId)))
    .sort((left, right) =>
      String(left.functionInstanceId).localeCompare(String(right.functionInstanceId)),
    );
}

function mapProofMirEdgeKind(kind: ProofMirControlEdge["kind"]): OptIrEdge["kind"] {
  return kind;
}

function requireMappedProofMirEdgeKind(kind: ProofMirControlEdge["kind"]): OptIrEdge["kind"] {
  return mapProofMirEdgeKind(kind);
}
