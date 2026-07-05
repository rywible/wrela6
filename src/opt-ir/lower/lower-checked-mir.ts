import {
  optIrConstructionIdAllocator,
  optIrCfgEdgeTable,
  type OptIrBlock,
  type OptIrEdge,
} from "../cfg";
import { optIrConstantPool, type OptIrConstantPool } from "../constants";
import {
  optIrCallId,
  optIrConstantId,
  optIrFactId,
  optIrProgramId,
  type OptIrFactId,
  type OptIrOperationId,
  type OptIrOriginId,
  type OptIrValueId,
} from "../ids";
import {
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  optIrConstantTable,
  type OptIrFunction,
} from "../program";
import type { OptIrTerminator } from "../terminators";
import { optIrUnitType, type OptIrType } from "../types";
import type { OptIrRegion } from "../regions";
import type { OptIrTargetSurface } from "../target-surface";
import type { LayoutFactProgram } from "../../layout/layout-program";
import type { MonoCheckedType } from "../../mono/mono-hir";
import type { OptIrFactRecord } from "../facts/fact-index";
import type { ProofMirStatementId, ProofMirValueId } from "../../proof-mir/ids";
import type { CheckedMirProgram } from "../../proof-check/model/checked-mir";
import type {
  ProofMirBlock,
  ProofMirCall,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirStatement,
} from "../../proof-mir/model/graph";
import { optIrBlockArgumentBuilder } from "./block-argument-builder";
import { optIrProvenanceBuilder } from "./provenance-builder";
import {
  optIrBooleanBinaryOperation,
  optIrBooleanNotOperation,
  optIrAggregateExtractOperation,
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrIntegerUnaryOperation,
  optIrIntrinsicCallOperation,
  optIrPlatformCallOperation,
  optIrProofErasedMarkerOperation,
  optIrRuntimeCallOperation,
  optIrSourceCallOperation,
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
import { lowerProofMirConstructObjectStatement } from "./proof-mir-construct-lowering";
import {
  booleanBinaryOperator,
  byteWidthForType,
  deterministicFunctions,
  entrySignatureParametersForBlock,
  integerBinaryOperator,
  integerCompareInputs,
  integerUnaryOperator,
  literalIntegerValue,
  nextStatementOperationId,
  operandValueIds,
  optIrTypeFromMono,
  parameterRuntime,
  predeclareProofMirValues,
  proofMirTerminatorOperationId,
  proofMirValueIdFor,
  proofMirValueErasureReason,
  proofMirValueIsRuntime,
  proofMirValueType,
  receiverArgumentIds,
  requireMappedProofMirEdgeKind,
  returnOperandValueIds,
  sortedProofMirBlocks,
  sortedProofMirEdges,
  statementOriginId,
} from "./proof-mir-lowering-helpers";
import type { OptIrSkeletonLoweringResult } from "./lowering-types";
import {
  aliasProofMirValue,
  basePlaceValueAliasesForBlock,
  bindPlaceValueAlias,
  clonePlaceValueAliases,
  projectionFieldPath,
  proofMirPlaceRootAliasKey,
  propagatedPlaceValueAliasesByBlock,
  rootValueAliasForPlace,
  valueAliasForTakeOperand,
  type ProofMirPlaceValueAliases,
} from "./proof-mir-place-aliases";
import { attemptStartInBlock, runtimeValueForAttemptOperand } from "./proof-mir-attempt-operands";
import { lowerProofMirSwitchTerminator } from "./proof-mir-switch-lowering";
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
  readonly target: OptIrTargetSurface;
  readonly validatedBufferFacts: readonly OptIrValidatedBufferFactForLowering[];
  readonly nextGeneratedFactId: OptIrFactId;
}): OptIrSkeletonLoweringResult {
  const diagnostics: string[] = [];
  const functions = deterministicFunctions(input.checkedMir);
  const result = lowerProofMirFunctions({
    target: input.target,
    checkedMirLayout: input.checkedMir.mir.layout,
    validatedBufferFacts: input.validatedBufferFacts,
    nextGeneratedFactId: input.nextGeneratedFactId,
    functions,
    diagnostics,
  });
  if (result.kind === "error") {
    return { kind: "error", diagnostics: result.diagnostics };
  }
  return result;
}

export interface ProofMirLoweringContext {
  readonly allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>;
  readonly provenance: ReturnType<typeof optIrProvenanceBuilder>;
  readonly values: ReturnType<typeof optIrBlockArgumentBuilder>;
  readonly constantPool: OptIrConstantPool;
  readonly operations: OptIrOperation[];
  readonly regions: OptIrRegion[];
  readonly regionsByKey: Map<string, OptIrRegion>;
  readonly validatedSourceValueByPacketRoot: Map<string, OptIrValueId>;
  readonly generatedFacts: OptIrFactRecord[];
  readonly target: OptIrTargetSurface;
  readonly targetEndian: "little" | "big";
  readonly checkedMirLayout: LayoutFactProgram;
  readonly validatedBufferFacts: readonly OptIrValidatedBufferFactForLowering[];
  readonly validatedBufferAuthorityIndex: ReadonlyMap<string, OptIrValidatedBufferFactForLowering>;
  readonly diagnostics: string[];
  nextOperationId: number;
  nextConstantId: number;
  nextGeneratedFactNumber: number;
}

function lowerProofMirFunctions(input: {
  readonly target: OptIrTargetSurface;
  readonly checkedMirLayout: LayoutFactProgram;
  readonly validatedBufferFacts: readonly OptIrValidatedBufferFactForLowering[];
  readonly nextGeneratedFactId: OptIrFactId;
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
    validatedSourceValueByPacketRoot: new Map(),
    generatedFacts: [],
    target: input.target,
    targetEndian: input.target.dataModel.endian,
    checkedMirLayout: input.checkedMirLayout,
    validatedBufferFacts: input.validatedBufferFacts,
    validatedBufferAuthorityIndex: validatedBufferFactIndexForLowering(input.validatedBufferFacts),
    diagnostics: input.diagnostics,
    nextOperationId: 1,
    nextConstantId: 0,
    nextGeneratedFactNumber: Number(input.nextGeneratedFactId),
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
      targetId: input.target.targetId,
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
    generatedFacts: Object.freeze([...context.generatedFacts]),
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
  const propagatedAliases = propagatedPlaceValueAliasesByBlock(function_, context);
  seedValidatedSourceValueAliases(function_, context, propagatedAliases);
  const blocks = sortedProofMirBlocks(function_).map((block) =>
    lowerProofMirBlock(function_, block, context, propagatedAliases.get(String(block.blockId))),
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

function seedValidatedSourceValueAliases(
  function_: ProofMirFunction,
  context: ProofMirLoweringContext,
  propagatedAliases: ReadonlyMap<string, ProofMirPlaceValueAliases>,
): void {
  for (const block of sortedProofMirBlocks(function_)) {
    const aliases = clonePlaceValueAliases(
      propagatedAliases.get(String(block.blockId)) ??
        basePlaceValueAliasesForBlock(function_, block, context),
    );
    for (const statement of block.statements) {
      switch (statement.kind.kind) {
        case "call": {
          const result = statement.kind.call.result;
          if (result?.kind === "valueAndPlace") {
            bindPlaceValueAlias({
              function_,
              aliases,
              placeId: result.place,
              valueId: proofMirValueIdFor(function_, result.value, context),
            });
          }
          break;
        }
        case "store":
          bindPlaceValueAlias({
            function_,
            aliases,
            placeId: statement.kind.place,
            valueId: proofMirValueIdFor(function_, statement.kind.value, context),
          });
          break;
        case "validate":
          recordValidatedSourceValueAlias({
            function_,
            context,
            aliases,
            validation: statement.kind.validation,
          });
          break;
      }
    }
  }
}

function recordValidatedSourceValueAlias(input: {
  readonly function_: ProofMirFunction;
  readonly context: ProofMirLoweringContext;
  readonly aliases: ProofMirPlaceValueAliases;
  readonly validation: Extract<
    ProofMirStatement["kind"],
    { readonly kind: "validate" }
  >["validation"];
}): void {
  const packetPlace = input.function_.places.get(input.validation.okPacketPlace);
  const sourcePlace = input.function_.places.get(input.validation.sourcePlace);
  if (packetPlace === undefined || sourcePlace === undefined) {
    return;
  }
  const exactSource = input.aliases.exactPlaceValues.get(String(sourcePlace.placeId));
  const sourceValueId =
    exactSource ??
    rootValueAliasForPlace({
      function_: input.function_,
      place: sourcePlace,
      context: input.context,
      aliases: input.aliases,
    });
  if (sourceValueId === undefined) {
    return;
  }
  input.context.validatedSourceValueByPacketRoot.set(
    proofMirPlaceRootAliasKey(packetPlace.root),
    sourceValueId,
  );
}

function lowerProofMirBlock(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringContext,
  entryAliases: ProofMirPlaceValueAliases | undefined,
): OptIrBlock {
  const entryParameterLoadStatementIds = new Set<ProofMirStatementId>();
  const incomingEdgeArgumentValues = incomingEdgeArgumentValuesForBlock(function_, block);
  const parameters = [
    ...entrySignatureParametersForBlock(function_, block, context),
    ...block.parameters.map((parameter) =>
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
    ),
    ...incomingEdgeArgumentValues.map((valueId) =>
      context.values.parameterFor({
        valueKey: proofMirScopedValueKey(function_.functionInstanceId, valueId),
        type: proofMirValueTypeForLowering(function_, valueId, context),
        incomingRole: "branchArgument",
        runtime: proofMirValueIsRuntime(function_.values.get(valueId)),
        proofOnlyReason: proofMirValueErasureReason(function_.values.get(valueId)),
        originId: context.provenance.originFor({
          functionInstanceId: function_.functionInstanceId,
          checkedMirNodeKey: `incoming-edge-argument:${String(block.blockId)}:${String(valueId)}`,
          proofMirOriginId: function_.values.get(valueId)?.origin ?? block.origin,
        }),
      }),
    ),
  ];
  const placeAliases = clonePlaceValueAliases(
    entryAliases ?? basePlaceValueAliasesForBlock(function_, block, context),
  );
  const operationIds = block.statements.flatMap((statement) =>
    lowerProofMirStatement(
      function_,
      statement,
      context,
      entryParameterLoadStatementIds,
      placeAliases,
    ).map((operation) => {
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
    ...(edge.toBlockId === undefined || edge.kind === "returnExit" || edge.kind === "panicExit"
      ? {}
      : {
          toBlock: context.allocator.blockIdFor(
            function_.functionInstanceId,
            String(edge.toBlockId),
          ),
        }),
    ordinal,
    kind: requireMappedProofMirEdgeKind(edge.kind),
    arguments: lowerProofMirEdgeArguments(function_, edge, context),
    originId: context.provenance.originFor({
      functionInstanceId: function_.functionInstanceId,
      checkedMirNodeKey: `edge:${String(edge.edgeId)}`,
      proofMirOriginId: edge.origin,
    }),
  };
}

function lowerProofMirEdgeArguments(
  function_: ProofMirFunction,
  edge: ProofMirControlEdge,
  context: ProofMirLoweringContext,
): readonly OptIrValueId[] {
  const arguments_ = edge.arguments.map((valueId) =>
    proofMirValueIdFor(function_, valueId, context),
  );
  return arguments_;
}

function incomingEdgeArgumentValuesForBlock(
  function_: ProofMirFunction,
  block: ProofMirBlock,
): readonly ProofMirValueId[] {
  const valueIds: ProofMirValueId[] = [];
  const seen = new Set<string>();
  for (const edge of sortedProofMirEdges(function_)) {
    if (
      edge.toBlockId !== block.blockId ||
      (edge.kind !== "validationOk" &&
        edge.kind !== "validationErr" &&
        edge.kind !== "attemptSuccess" &&
        edge.kind !== "attemptError")
    ) {
      continue;
    }
    for (const valueId of edge.arguments) {
      const key = String(valueId);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      valueIds.push(valueId);
    }
  }
  return Object.freeze(
    valueIds.sort((left, right) => compareStableKeys(String(left), String(right))),
  );
}

function optIrTypeFromMonoForTarget(
  type: MonoCheckedType,
  context: ProofMirLoweringContext,
): OptIrType {
  return context.target.sourceTypeAbi?.lowerType(type) ?? optIrTypeFromMono(type);
}

function proofMirValueTypeForLowering(
  function_: ProofMirFunction,
  valueId: ProofMirValueId,
  context: ProofMirLoweringContext,
): OptIrType {
  const value = function_.values.get(valueId);
  return value === undefined
    ? proofMirValueType(function_, valueId)
    : optIrTypeFromMonoForTarget(value.type, context);
}

function lowerProofMirLoad(
  function_: ProofMirFunction,
  statement: ProofMirStatement,
  load: Extract<ProofMirStatement["kind"], { readonly kind: "load" }>,
  context: ProofMirLoweringContext,
  aliases: ProofMirPlaceValueAliases,
  originId: OptIrOriginId,
): readonly OptIrOperation[] {
  const place = function_.places.get(load.place);
  if (place === undefined || function_.values.get(load.result) === undefined) {
    context.diagnostics.push(
      `statement:${String(statement.statementId)}:unsupported-load:missing-place`,
    );
    return [];
  }

  const exactAlias = aliases.exactPlaceValues.get(String(place.placeId));
  if (place.projection.length === 0 && exactAlias !== undefined) {
    aliasProofMirValue({
      function_,
      result: load.result,
      targetValueId: exactAlias,
      context,
    });
    return [];
  }

  const rootAlias = rootValueAliasForPlace({ function_, place, context, aliases });
  if (place.projection.length === 0 && rootAlias !== undefined) {
    aliasProofMirValue({
      function_,
      result: load.result,
      targetValueId: rootAlias,
      context,
    });
    return [];
  }

  if (place.projection.length > 0 && rootAlias !== undefined) {
    return [
      optIrAggregateExtractOperation({
        operationId: nextStatementOperationId(context),
        aggregate: rootAlias,
        fieldPath: projectionFieldPath(place),
        resultId: proofMirValueIdFor(function_, load.result, context),
        resultType: proofMirValueTypeForLowering(function_, load.result, context),
        originId,
      }),
    ];
  }

  context.diagnostics.push(`statement:${String(statement.statementId)}:unsupported-kind:load`);
  return [];
}

function lowerProofMirStatement(
  function_: ProofMirFunction,
  statement: ProofMirStatement,
  context: ProofMirLoweringContext,
  entryParameterLoadStatementIds: ReadonlySet<ProofMirStatementId>,
  placeAliases: ProofMirPlaceValueAliases,
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
            type: proofMirValueTypeForLowering(function_, statement.kind.value, context),
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
          resultType: proofMirValueTypeForLowering(function_, statement.kind.result, context),
          originId,
        }),
      ];
    }
    case "binary": {
      const left = proofMirValueIdFor(function_, statement.kind.left, context);
      const right = proofMirValueIdFor(function_, statement.kind.right, context);
      const resultId = proofMirValueIdFor(function_, statement.kind.result, context);
      const resultType = proofMirValueTypeForLowering(function_, statement.kind.result, context);
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
    case "constructObject":
      return lowerProofMirConstructObjectStatement({
        function_,
        construct: statement.kind,
        context,
        originId,
        valueTypeForLowering: (valueId) =>
          proofMirValueTypeForLowering(function_, valueId, context),
      });
    case "call": {
      const operation = lowerProofMirCall(function_, statement.kind.call, context, originId);
      const result = statement.kind.call.result;
      if (result?.kind === "valueAndPlace") {
        bindPlaceValueAlias({
          function_,
          aliases: placeAliases,
          placeId: result.place,
          valueId: proofMirValueIdFor(function_, result.value, context),
        });
      }
      return [operation];
    }
    case "readValidatedBufferField": {
      const read = statement.kind.read;
      const layoutKey = validatedBufferLayoutKey(read.layoutField);
      const packetPlace =
        read.packetPlace === undefined ? undefined : function_.places.get(read.packetPlace);
      const lowered = lowerValidatedBufferFieldRead({
        function_,
        read,
        layoutKey,
        sourceBaseValueId:
          packetPlace === undefined
            ? undefined
            : context.validatedSourceValueByPacketRoot.get(
                proofMirPlaceRootAliasKey(packetPlace.root),
              ),
        valueType: proofMirValueTypeForLowering(function_, read.result, context),
        byteWidth: byteWidthForType(proofMirValueTypeForLowering(function_, read.result, context)),
        targetEndian: context.targetEndian,
        layout: context.checkedMirLayout,
        resultId: proofMirValueIdFor(function_, read.result, context),
        operationId: nextStatementOperationId(context),
        originId,
        authorityIndex: context.validatedBufferAuthorityIndex,
        regions: context.regions,
        regionsByKey: context.regionsByKey,
        generatedFacts: {
          nextFactId: () => optIrFactId(context.nextGeneratedFactNumber++),
          push: (record) => context.generatedFacts.push(record),
        },
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
    case "take": {
      if (statement.kind.take.sessionMember?.placeId !== undefined) {
        const valueAlias = valueAliasForTakeOperand({
          function_,
          operand: statement.kind.take.operand,
          context,
          aliases: placeAliases,
        });
        if (valueAlias !== undefined) {
          bindPlaceValueAlias({
            function_,
            aliases: placeAliases,
            placeId: statement.kind.take.sessionMember.placeId,
            valueId: valueAlias,
          });
        }
      }
      return [
        optIrProofErasedMarkerOperation({
          operationId: nextStatementOperationId(context),
          erasedProof: statement.kind.kind,
          originId,
        }),
      ];
    }
    case "load":
      if (entryParameterLoadStatementIds.has(statement.statementId)) {
        return [];
      }
      return lowerProofMirLoad(
        function_,
        statement,
        statement.kind,
        context,
        placeAliases,
        originId,
      );
    case "store": {
      bindPlaceValueAlias({
        function_,
        aliases: placeAliases,
        placeId: statement.kind.place,
        valueId: proofMirValueIdFor(function_, statement.kind.value, context),
      });
      return [
        optIrProofErasedMarkerOperation({
          operationId: nextStatementOperationId(context),
          erasedProof: statement.kind.kind,
          originId,
        }),
      ];
    }
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
      ? [proofMirValueTypeForLowering(function_, call.result.value, context)]
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
    case "compilerIntrinsic":
      return optIrIntrinsicCallOperation({
        ...common,
        target: {
          kind: "intrinsic",
          intrinsicKey: call.target.intrinsicKey,
          literalValue: call.target.literalValue,
          sourceValueKey: call.target.sourceValueKey,
        },
      });
    case "certifiedPlatform":
      return optIrPlatformCallOperation({
        ...common,
        target: { kind: "platform", platformKey: String(call.target.primitiveId) },
      });
  }
}

function lowerProofMirMatchAttemptTerminator(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringContext,
  originId: OptIrOriginId,
  operationId: OptIrOperationId,
): OptIrTerminator {
  const terminator = block.terminator;
  if (terminator.kind.kind !== "matchAttempt") {
    return { kind: "unreachable", operationId, originId };
  }
  const attempt = attemptStartInBlock(block, terminator.kind.match.attemptId);
  const statusValue =
    attempt === undefined ? undefined : runtimeValueForAttemptOperand(function_, attempt);
  if (attempt === undefined || statusValue === undefined) {
    context.diagnostics.push(
      `terminator:${String(terminator.terminatorId)}:unsupported-attempt:missing-runtime-status`,
    );
    return { kind: "unreachable", operationId, originId };
  }
  const statusType = proofMirValueTypeForLowering(function_, statusValue, context);
  if (statusType.kind !== "integer" && statusType.kind !== "boolean") {
    context.diagnostics.push(
      `terminator:${String(terminator.terminatorId)}:unsupported-attempt:runtime-status-type:${statusType.kind}`,
    );
    return { kind: "unreachable", operationId, originId };
  }

  return {
    kind: "switch",
    operationId,
    scrutinee: proofMirValueIdFor(function_, statusValue, context),
    cases: Object.freeze([
      Object.freeze({
        label: "0",
        edge: context.allocator.edgeIdFor(
          function_.functionInstanceId,
          String(terminator.kind.match.successTarget.edgeId),
        ),
      }),
    ]),
    defaultEdge: context.allocator.edgeIdFor(
      function_.functionInstanceId,
      String(terminator.kind.match.errorTarget.edgeId),
    ),
    originId,
  };
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
      return lowerProofMirSwitchTerminator({
        function_: function_,
        switchKind: terminator.kind,
        context,
        operationId,
        originId,
      });
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
      return {
        kind: "jump",
        operationId,
        edge: context.allocator.edgeIdFor(
          function_.functionInstanceId,
          String(terminator.kind.match.okTarget.edgeId),
        ),
        originId,
      };
    case "matchAttempt":
      return lowerProofMirMatchAttemptTerminator(function_, block, context, originId, operationId);
    case "yield":
      context.diagnostics.push(
        `terminator:${String(terminator.terminatorId)}:unsupported-kind:${terminator.kind.kind}`,
      );
      return { kind: "unreachable", operationId, originId };
  }
}
