import { optIrConstructionIdAllocator, optIrCfgEdgeTable, type OptIrEdge } from "../cfg";
import { optIrConstantPool, type OptIrConstantPool } from "../constants";
import {
  optIrCallId,
  optIrConstantId,
  optIrOperationId,
  optIrProgramId,
  optIrRegionId,
  type OptIrOriginId,
  type OptIrValueId,
} from "../ids";
import { optIrFunctionTable, optIrProgram, optIrRegionTable, optIrConstantTable } from "../program";
import type { OptIrBlock } from "../cfg";
import type { OptIrFunction, OptIrProgram } from "../program";
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
import type { OptIrOrigin } from "../provenance";
import type { MonoCheckedType, MonoFunctionSignature, MonoLiteralValue } from "../../mono/mono-hir";
import type { MonoInstanceId } from "../../mono/ids";
import type { TargetId } from "../../semantic/ids";
import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import { checkedTypeFingerprint } from "../../semantic/surface/type-model";
import type { HirOriginId } from "../../hir/ids";
import type { ProofMirOriginId, ProofMirValueId } from "../../proof-mir/ids";
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
import {
  optIrBlockArgumentBuilder,
  type OptIrProofOnlyValueMarker,
} from "./block-argument-builder";
import { optIrProvenanceBuilder } from "./provenance-builder";
import {
  optIrBooleanBinaryOperation,
  optIrBooleanNotOperation,
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrIntegerUnaryOperation,
  optIrMemoryLoadOperation,
  optIrPlatformCallOperation,
  optIrProofErasedMarkerOperation,
  optIrRuntimeCallOperation,
  optIrSourceCallOperation,
  type OptIrBooleanBinaryOperator,
  type OptIrIntegerBinaryOperator,
  type OptIrIntegerCompareOperator,
  type OptIrOperation,
} from "../operations";

export type OptIrSkeletonLoweringResult =
  | {
      readonly kind: "ok";
      readonly program: OptIrProgram;
      readonly origins: ReadonlyMap<OptIrOriginId, OptIrOrigin>;
      readonly operations: readonly OptIrOperation[];
      readonly valueIdsByKey: ReadonlyMap<string, OptIrValueId>;
      readonly executableValueIds: readonly OptIrValueId[];
      readonly proofOnlyValueIds: readonly OptIrValueId[];
      readonly valuesMarkedForErasure: readonly OptIrProofOnlyValueMarker[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly string[] };

export interface OptIrSkeletonForTestInput {
  readonly targetId: TargetId;
  readonly functions: readonly OptIrSkeletonFunctionForTest[];
}

export interface OptIrSkeletonOriginForTest {
  readonly source?: OptIrOrigin["source"];
  readonly hir?: { readonly originId?: HirOriginId };
  readonly proofMirOriginId?: ProofMirOriginId;
}

export interface OptIrSkeletonFunctionForTest {
  readonly functionInstanceId: MonoInstanceId;
  readonly signature: MonoFunctionSignature;
  readonly entryBlockKey?: string;
  readonly origin: OptIrSkeletonOriginForTest;
  readonly blocks: readonly OptIrSkeletonBlockForTest[];
}

export interface OptIrSkeletonBlockForTest {
  readonly blockKey: string;
  readonly origin: OptIrSkeletonOriginForTest;
  readonly merge?: "loopHeader" | "join";
  readonly parameters: readonly OptIrSkeletonParameterForTest[];
  readonly edges: readonly OptIrSkeletonEdgeForTest[];
  readonly terminator?: OptIrSkeletonTerminatorForTest;
}

export type OptIrSkeletonTerminatorForTest =
  | {
      readonly kind: "jump";
      readonly edgeKey: string;
      readonly origin: OptIrSkeletonOriginForTest;
    }
  | {
      readonly kind: "branch";
      readonly conditionValueKey: string;
      readonly trueEdgeKey: string;
      readonly falseEdgeKey: string;
      readonly origin: OptIrSkeletonOriginForTest;
    }
  | {
      readonly kind: "switch";
      readonly scrutineeValueKey: string;
      readonly cases: readonly OptIrSkeletonSwitchCaseForTest[];
      readonly defaultEdgeKey: string;
      readonly origin: OptIrSkeletonOriginForTest;
    }
  | {
      readonly kind: "return";
      readonly valueKeys: readonly string[];
      readonly origin: OptIrSkeletonOriginForTest;
    }
  | {
      readonly kind: "unreachable";
      readonly origin: OptIrSkeletonOriginForTest;
    };

export interface OptIrSkeletonSwitchCaseForTest {
  readonly label: string;
  readonly edgeKey: string;
}

export interface OptIrSkeletonParameterForTest {
  readonly valueKey: string;
  readonly type: OptIrType;
  readonly role: "entry" | "branchArgument" | "loopCarried" | "exception" | "phi";
  readonly runtime: boolean;
  readonly proofOnlyReason?: string;
  readonly origin: OptIrSkeletonOriginForTest;
}

export interface OptIrSkeletonEdgeForTest {
  readonly edgeKey: string;
  readonly toBlockKey?: string;
  readonly kind: OptIrEdge["kind"];
  readonly argumentValueKeys: readonly string[];
  readonly origin: OptIrSkeletonOriginForTest;
}

export function lowerCheckedMirProgram(input: {
  readonly checkedMir: CheckedMirProgram;
  readonly targetId: TargetId;
}): OptIrSkeletonLoweringResult {
  const diagnostics: string[] = [];
  const functions = deterministicFunctions(input.checkedMir);
  const result = lowerProofMirFunctions({
    targetId: input.targetId,
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
  readonly diagnostics: string[];
  nextOperationId: number;
  nextConstantId: number;
}

function lowerProofMirFunctions(input: {
  readonly targetId: TargetId;
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
      regions: optIrRegionTable([]),
      constants: optIrConstantTable(context.constantPool.constants()),
      callGraph: { calls: [] },
      provenance: { originIds: originEntries.map((origin) => origin.originId) },
    }),
    origins: new Map(originEntries.map((origin) => [origin.originId, origin])),
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
      const layoutKey = validatedBufferFieldLayoutKey(read.layoutField);
      const result = optIrMemoryLoadOperation({
        operationId: nextStatementOperationId(context),
        resultId: proofMirValueIdFor(function_, read.result, context),
        region: optIrRegionId(0),
        byteOffset: 0n,
        byteWidth: byteWidthForType(proofMirValueType(function_, read.result)),
        alignment: 1,
        valueType: proofMirValueType(function_, read.result),
        endian: "native",
        volatility: "nonVolatile",
        layoutPath: layoutKey,
        boundsAuthority: { kind: "layoutFact", layoutKey },
        originId,
      });
      if (result.kind === "error") {
        context.diagnostics.push(`statement:${String(statement.statementId)}:invalid-buffer-read`);
        return [];
      }
      return [result.operation];
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

function proofMirScopedValueKey(functionInstanceId: MonoInstanceId, valueId: ProofMirValueId) {
  return scopedValueKey(functionInstanceId, String(valueId));
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

function validatedBufferFieldLayoutKey(input: {
  readonly instanceId: MonoInstanceId;
  readonly fieldId: unknown;
}): LayoutFactKey {
  return `layout:validated-buffer:${String(input.instanceId)}:${String(input.fieldId)}` as LayoutFactKey;
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

function compareOperations(left: OptIrOperation, right: OptIrOperation): number {
  return left.operationId - right.operationId;
}

export function lowerCheckedMirSkeletonForTest(
  input: OptIrSkeletonForTestInput,
): OptIrSkeletonLoweringResult {
  const diagnostics = validateSkeleton(input);
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }

  const allocator = optIrConstructionIdAllocator<string, string>({
    functionsInTraversalOrder: input.functions.map((function_) => function_.functionInstanceId),
    blocksInTraversalOrder: new Map(
      input.functions.map((function_) => [
        function_.functionInstanceId,
        function_.blocks.map((block) => block.blockKey),
      ]),
    ),
    edgesInTraversalOrder: new Map(
      input.functions.map((function_) => [
        function_.functionInstanceId,
        function_.blocks.flatMap((block) => block.edges.map((edge) => edge.edgeKey)),
      ]),
    ),
  });

  const provenance = optIrProvenanceBuilder();
  const blockArguments = optIrBlockArgumentBuilder();
  const loweredFunctions: OptIrFunction[] = [];

  for (const function_ of input.functions) {
    const blocks = lowerBlocks(function_, allocator, provenance, blockArguments);
    const edges = lowerEdges(function_, allocator, provenance, blockArguments);
    const blockIdByKey = blockIdsByKey(function_, allocator);
    const entryBlock =
      function_.entryBlockKey === undefined
        ? blocks[0]
        : blocks.find((block) => block.blockId === blockIdByKey.get(function_.entryBlockKey ?? ""));
    if (entryBlock === undefined) {
      return {
        kind: "error",
        diagnostics: [`function:${String(function_.functionInstanceId)}:missing-block`],
      };
    }
    loweredFunctions.push({
      functionId: allocator.functionIdFor(function_.functionInstanceId),
      monoInstanceId: function_.functionInstanceId,
      signature: function_.signature,
      blocks,
      edges: optIrCfgEdgeTable(edges),
      entryBlock: entryBlock.blockId,
      originId: provenance.originFor({
        functionInstanceId: function_.functionInstanceId,
        checkedMirNodeKey: `function:${String(function_.functionInstanceId)}`,
        source: function_.origin.source,
        hirOriginId: function_.origin.hir?.originId,
        proofMirOriginId: function_.origin.proofMirOriginId,
      }),
    });
  }

  const originEntries = provenance.entries();
  return {
    kind: "ok",
    program: optIrProgram({
      programId: optIrProgramId(0),
      targetId: input.targetId,
      functions: optIrFunctionTable(loweredFunctions),
      regions: optIrRegionTable([]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: originEntries.map((origin) => origin.originId) },
    }),
    origins: new Map(originEntries.map((origin) => [origin.originId, origin])),
    operations: [],
    valueIdsByKey: new Map(blockArguments.valueEntries()),
    executableValueIds: blockArguments.executableValueIds(),
    proofOnlyValueIds: blockArguments.proofOnlyValueIds(),
    valuesMarkedForErasure: blockArguments.valuesMarkedForErasure(),
  };
}

function lowerBlocks(
  function_: OptIrSkeletonFunctionForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
  provenance: ReturnType<typeof optIrProvenanceBuilder>,
  blockArguments: ReturnType<typeof optIrBlockArgumentBuilder>,
): readonly OptIrBlock[] {
  return function_.blocks.map((block) => ({
    blockId: allocator.blockIdFor(function_.functionInstanceId, block.blockKey),
    parameters: block.parameters.map((parameter) =>
      blockArguments.parameterFor({
        valueKey: scopedValueKey(function_.functionInstanceId, parameter.valueKey),
        type: parameter.type,
        incomingRole: parameter.role,
        runtime: parameter.runtime,
        proofOnlyReason: parameter.proofOnlyReason,
        originId: provenance.originFor({
          functionInstanceId: function_.functionInstanceId,
          checkedMirNodeKey: `parameter:${block.blockKey}:${parameter.valueKey}`,
          source: parameter.origin.source,
          hirOriginId: parameter.origin.hir?.originId,
          proofMirOriginId: parameter.origin.proofMirOriginId,
        }),
      }),
    ),
    operations: [],
    ...(block.terminator === undefined
      ? {}
      : { terminator: lowerTerminator(function_, block, allocator, provenance, blockArguments) }),
    originId: provenance.originFor({
      functionInstanceId: function_.functionInstanceId,
      checkedMirNodeKey: `block:${block.blockKey}`,
      source: block.origin.source,
      hirOriginId: block.origin.hir?.originId,
      proofMirOriginId: block.origin.proofMirOriginId,
    }),
  }));
}

function lowerTerminator(
  function_: OptIrSkeletonFunctionForTest,
  block: OptIrSkeletonBlockForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
  provenance: ReturnType<typeof optIrProvenanceBuilder>,
  blockArguments: ReturnType<typeof optIrBlockArgumentBuilder>,
): OptIrTerminator {
  const terminator = block.terminator;
  if (terminator === undefined) {
    throw new RangeError(`No OptIR skeleton terminator for block ${block.blockKey}.`);
  }
  const originId = provenance.originFor({
    functionInstanceId: function_.functionInstanceId,
    checkedMirNodeKey: `terminator:${block.blockKey}`,
    source: terminator.origin.source,
    hirOriginId: terminator.origin.hir?.originId,
    proofMirOriginId: terminator.origin.proofMirOriginId,
  });
  const operationId = terminatorOperationId(function_, block, allocator);
  switch (terminator.kind) {
    case "jump":
      return {
        kind: "jump",
        operationId,
        edge: allocator.edgeIdFor(function_.functionInstanceId, terminator.edgeKey),
        originId,
      };
    case "branch":
      return {
        kind: "branch",
        operationId,
        condition: requireValueId(
          blockArguments,
          scopedValueKey(function_.functionInstanceId, terminator.conditionValueKey),
        ),
        trueEdge: allocator.edgeIdFor(function_.functionInstanceId, terminator.trueEdgeKey),
        falseEdge: allocator.edgeIdFor(function_.functionInstanceId, terminator.falseEdgeKey),
        originId,
      };
    case "switch":
      return {
        kind: "switch",
        operationId,
        scrutinee: requireValueId(
          blockArguments,
          scopedValueKey(function_.functionInstanceId, terminator.scrutineeValueKey),
        ),
        cases: Object.freeze(
          terminator.cases.map((switchCase) =>
            Object.freeze({
              label: switchCase.label,
              edge: allocator.edgeIdFor(function_.functionInstanceId, switchCase.edgeKey),
            }),
          ),
        ),
        defaultEdge: allocator.edgeIdFor(function_.functionInstanceId, terminator.defaultEdgeKey),
        originId,
      };
    case "return":
      return {
        kind: "return",
        operationId,
        values: Object.freeze(
          terminator.valueKeys.map((valueKey) =>
            requireValueId(blockArguments, scopedValueKey(function_.functionInstanceId, valueKey)),
          ),
        ),
        originId,
      };
    case "unreachable":
      return { kind: "unreachable", operationId, originId };
  }
}

function terminatorOperationId(
  function_: OptIrSkeletonFunctionForTest,
  block: OptIrSkeletonBlockForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
) {
  const blockId = allocator.blockIdFor(function_.functionInstanceId, block.blockKey);
  return optIrOperationId(1_000_000_000 + Number(blockId));
}

function blockIdsByKey(
  function_: OptIrSkeletonFunctionForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
): ReadonlyMap<string, OptIrBlock["blockId"]> {
  return new Map(
    function_.blocks.map((block) => [
      block.blockKey,
      allocator.blockIdFor(function_.functionInstanceId, block.blockKey),
    ]),
  );
}

function lowerEdges(
  function_: OptIrSkeletonFunctionForTest,
  allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>,
  provenance: ReturnType<typeof optIrProvenanceBuilder>,
  blockArguments: ReturnType<typeof optIrBlockArgumentBuilder>,
): readonly OptIrEdge[] {
  return function_.blocks.flatMap((block) =>
    block.edges.map((edge, ordinal) => ({
      edgeId: allocator.edgeIdFor(function_.functionInstanceId, edge.edgeKey),
      from: allocator.blockIdFor(function_.functionInstanceId, block.blockKey),
      ...(edge.toBlockKey === undefined
        ? {}
        : { toBlock: allocator.blockIdFor(function_.functionInstanceId, edge.toBlockKey) }),
      ordinal,
      kind: edge.kind,
      arguments: edge.argumentValueKeys.map((valueKey) =>
        requireValueId(blockArguments, scopedValueKey(function_.functionInstanceId, valueKey)),
      ),
      originId: provenance.originFor({
        functionInstanceId: function_.functionInstanceId,
        checkedMirNodeKey: `edge:${edge.edgeKey}`,
        source: edge.origin.source,
        hirOriginId: edge.origin.hir?.originId,
        proofMirOriginId: edge.origin.proofMirOriginId,
      }),
    })),
  );
}

function requireValueId(
  blockArguments: ReturnType<typeof optIrBlockArgumentBuilder>,
  valueKey: string,
): OptIrValueId {
  const valueId = blockArguments.valueIdFor(valueKey);
  if (valueId === undefined) {
    throw new RangeError(`No OptIR value allocated for edge argument ${valueKey}.`);
  }
  return valueId;
}

function validateSkeleton(input: OptIrSkeletonForTestInput): string[] {
  const diagnostics: string[] = [];

  for (const function_ of input.functions) {
    if (function_.blocks.length === 0) {
      diagnostics.push(`function:${String(function_.functionInstanceId)}:missing-block`);
      continue;
    }

    const blocksByKey = new Map(function_.blocks.map((block) => [block.blockKey, block]));
    const edgeKeys = new Set(
      function_.blocks.flatMap((block) => block.edges.map((edge) => edge.edgeKey)),
    );
    const parametersByKey = new Map(
      function_.blocks.flatMap((block) =>
        block.parameters.map((parameter) => [parameter.valueKey, parameter] as const),
      ),
    );
    for (const block of function_.blocks) {
      for (const edge of block.edges) {
        for (const argumentKey of edge.argumentValueKeys) {
          const parameter = parametersByKey.get(argumentKey);
          if (parameter === undefined) {
            diagnostics.push(`edge:${edge.edgeKey}:unknown-argument:${argumentKey}`);
            continue;
          }
          if (!parameter.runtime) {
            diagnostics.push(`edge:${edge.edgeKey}:proof-only-argument:${argumentKey}`);
          }
        }
        if (edge.toBlockKey === undefined) {
          continue;
        }
        const successor = blocksByKey.get(edge.toBlockKey);
        if (successor === undefined) {
          diagnostics.push(`edge:${edge.edgeKey}:unknown-successor:${edge.toBlockKey}`);
          continue;
        }
        if (edge.argumentValueKeys.length !== successor.parameters.length) {
          diagnostics.push(
            `edge:${edge.edgeKey}:argument-count:${edge.argumentValueKeys.length}:parameter-count:${successor.parameters.length}`,
          );
        }
      }
      validateSkeletonTerminator(block, edgeKeys, parametersByKey, diagnostics);
    }
  }

  return diagnostics;
}

function validateSkeletonTerminator(
  block: OptIrSkeletonBlockForTest,
  edgeKeys: ReadonlySet<string>,
  parametersByKey: ReadonlyMap<string, OptIrSkeletonParameterForTest>,
  diagnostics: string[],
): void {
  const terminator = block.terminator;
  if (terminator === undefined) {
    return;
  }
  for (const edgeKey of terminatorEdgeKeys(terminator)) {
    if (!edgeKeys.has(edgeKey)) {
      diagnostics.push(`terminator:${block.blockKey}:unknown-edge:${edgeKey}`);
    }
  }
  for (const valueKey of terminatorValueKeys(terminator)) {
    const parameter = parametersByKey.get(valueKey);
    if (parameter === undefined) {
      diagnostics.push(`terminator:${block.blockKey}:unknown-value:${valueKey}`);
      continue;
    }
    if (!parameter.runtime) {
      diagnostics.push(`terminator:${block.blockKey}:proof-only-value:${valueKey}`);
    }
  }
}

function terminatorEdgeKeys(terminator: OptIrSkeletonTerminatorForTest): readonly string[] {
  switch (terminator.kind) {
    case "jump":
      return [terminator.edgeKey];
    case "branch":
      return [terminator.trueEdgeKey, terminator.falseEdgeKey];
    case "switch":
      return [
        ...terminator.cases.map((switchCase) => switchCase.edgeKey),
        terminator.defaultEdgeKey,
      ];
    case "return":
    case "unreachable":
      return [];
  }
}

function terminatorValueKeys(terminator: OptIrSkeletonTerminatorForTest): readonly string[] {
  switch (terminator.kind) {
    case "branch":
      return [terminator.conditionValueKey];
    case "switch":
      return [terminator.scrutineeValueKey];
    case "return":
      return terminator.valueKeys;
    case "jump":
    case "unreachable":
      return [];
  }
}

function scopedValueKey(functionInstanceId: MonoInstanceId, valueKey: string): string {
  return `${String(functionInstanceId)}/${valueKey}`;
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

function compareStableKeys(left: string | number, right: string | number): number {
  return String(left).localeCompare(String(right), "en", { numeric: true });
}

function optIrZeroSizedFallbackType(): OptIrType {
  return optIrZeroSizedType("proof-mir-parameter");
}
