import { optIrConstructionIdAllocator, optIrCfgEdgeTable, type OptIrEdge } from "../cfg";
import { optIrConstantPool, type OptIrConstantPool } from "../constants";
import {
  optIrCallId,
  optIrConstantId,
  optIrFactId,
  optIrProgramId,
  type OptIrFactId,
  type OptIrOriginId,
  type OptIrValueId,
} from "../ids";
import { optIrFunctionTable, optIrProgram, optIrRegionTable, optIrConstantTable } from "../program";
import type { OptIrBlock } from "../cfg";
import type { OptIrFunction } from "../program";
import type { OptIrTerminator } from "../terminators";
import { optIrUnitType } from "../types";
import type { OptIrRegion } from "../regions";
import type { LayoutFactProgram } from "../../layout/layout-program";
import type { TargetId } from "../../semantic/ids";
import { checkedTypeFingerprint } from "../../semantic/surface/type-model";
import type { OptIrFactRecord } from "../facts/fact-index";
import type { ProofMirStatementId, ProofMirValueId } from "../../proof-mir/ids";
import type { CheckedMirProgram } from "../../proof-check/model/checked-mir";
import type {
  ProofMirBlock,
  ProofMirCall,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirPlace,
  ProofMirStatement,
} from "../../proof-mir/model/graph";
import { optIrBlockArgumentBuilder } from "./block-argument-builder";
import { optIrProvenanceBuilder } from "./provenance-builder";
import {
  optIrBooleanBinaryOperation,
  optIrBooleanNotOperation,
  optIrAggregateConstructOperation,
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
import {
  booleanBinaryOperator,
  byteWidthForType,
  deterministicFunctions,
  entrySignatureParametersForBlock,
  functionSignatureParameterValueKey,
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
  readonly nextGeneratedFactId: OptIrFactId;
}): OptIrSkeletonLoweringResult {
  const diagnostics: string[] = [];
  const functions = deterministicFunctions(input.checkedMir);
  const result = lowerProofMirFunctions({
    targetId: input.targetId,
    targetEndian: input.targetEndian,
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

interface ProofMirLoweringContext {
  readonly allocator: ReturnType<typeof optIrConstructionIdAllocator<string, string>>;
  readonly provenance: ReturnType<typeof optIrProvenanceBuilder>;
  readonly values: ReturnType<typeof optIrBlockArgumentBuilder>;
  readonly constantPool: OptIrConstantPool;
  readonly operations: OptIrOperation[];
  readonly regions: OptIrRegion[];
  readonly regionsByKey: Map<string, OptIrRegion>;
  readonly generatedFacts: OptIrFactRecord[];
  readonly targetEndian: "little" | "big";
  readonly checkedMirLayout: LayoutFactProgram;
  readonly validatedBufferFacts: readonly OptIrValidatedBufferFactForLowering[];
  readonly validatedBufferAuthorityIndex: ReadonlyMap<string, OptIrValidatedBufferFactForLowering>;
  readonly diagnostics: string[];
  nextOperationId: number;
  nextConstantId: number;
  nextGeneratedFactNumber: number;
}

interface ProofMirPlaceValueAliases {
  readonly exactPlaceValues: Map<string, OptIrValueId>;
  readonly rootPlaceValues: Map<string, OptIrValueId>;
}

function lowerProofMirFunctions(input: {
  readonly targetId: TargetId;
  readonly targetEndian: "little" | "big";
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
    generatedFacts: [],
    targetEndian: input.targetEndian,
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
  const entryParameterLoadStatementIds = new Set<ProofMirStatementId>();
  const validationEdgeArgumentValues = validationEdgeArgumentValuesForBlock(function_, block);
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
    ...validationEdgeArgumentValues.map((valueId) =>
      context.values.parameterFor({
        valueKey: proofMirScopedValueKey(function_.functionInstanceId, valueId),
        type: proofMirValueType(function_, valueId),
        incomingRole: "branchArgument",
        runtime: proofMirValueIsRuntime(function_.values.get(valueId)),
        proofOnlyReason: proofMirValueErasureReason(function_.values.get(valueId)),
        originId: context.provenance.originFor({
          functionInstanceId: function_.functionInstanceId,
          checkedMirNodeKey: `validation-edge-argument:${String(block.blockId)}:${String(valueId)}`,
          proofMirOriginId: function_.values.get(valueId)?.origin ?? block.origin,
        }),
      }),
    ),
  ];
  const placeAliases = initialPlaceValueAliasesForBlock(function_, block, context);
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

function validationEdgeArgumentValuesForBlock(
  function_: ProofMirFunction,
  block: ProofMirBlock,
): readonly ProofMirValueId[] {
  const valueIds: ProofMirValueId[] = [];
  const seen = new Set<string>();
  for (const edge of sortedProofMirEdges(function_)) {
    if (
      edge.toBlockId !== block.blockId ||
      (edge.kind !== "validationOk" && edge.kind !== "validationErr")
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

function emptyPlaceValueAliases(): ProofMirPlaceValueAliases {
  return {
    exactPlaceValues: new Map(),
    rootPlaceValues: new Map(),
  };
}

function initialPlaceValueAliasesForBlock(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringContext,
): ProofMirPlaceValueAliases {
  const aliases = emptyPlaceValueAliases();
  seedEntryParameterPlaceAliases(function_, block, context, aliases);
  for (const edge of sortedProofMirEdges(function_)) {
    if (edge.toBlockId !== block.blockId) {
      continue;
    }
    seedValidationEdgePlaceAliases(function_, edge, context, aliases);
  }
  return aliases;
}

function seedEntryParameterPlaceAliases(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  context: ProofMirLoweringContext,
  aliases: ProofMirPlaceValueAliases,
): void {
  if (block.blockId !== function_.entryBlockId) {
    return;
  }
  for (const parameter of function_.signature.parameters) {
    const parameterValueId = context.values.valueIdFor(
      functionSignatureParameterValueKey(function_, parameter.parameterId),
    );
    if (parameterValueId === undefined) {
      continue;
    }
    for (const place of function_.places.entries()) {
      if (
        place.root.kind === "parameter" &&
        place.root.parameterId === parameter.parameterId &&
        place.projection.length === 0
      ) {
        bindPlaceValueAlias({
          function_,
          aliases,
          placeId: place.placeId,
          valueId: parameterValueId,
        });
      }
    }
  }
}

function seedValidationEdgePlaceAliases(
  function_: ProofMirFunction,
  edge: ProofMirControlEdge,
  context: ProofMirLoweringContext,
  aliases: ProofMirPlaceValueAliases,
): void {
  if (edge.kind !== "validationOk" && edge.kind !== "validationErr") {
    return;
  }

  const usedArgumentIndexes = new Set<number>();
  const introducedPlaceIds = edge.effects
    .filter(
      (effect): effect is Extract<typeof effect, { readonly kind: "introducePlace" }> =>
        effect.kind === "introducePlace",
    )
    .map((effect) => effect.placeId)
    .sort((left, right) => compareStableKeys(String(left), String(right)));

  for (const placeId of introducedPlaceIds) {
    const place = function_.places.get(placeId);
    if (place === undefined || place.projection.length > 0) {
      continue;
    }
    const argumentIndex = edge.arguments.findIndex((valueId, index) => {
      if (usedArgumentIndexes.has(index)) {
        return false;
      }
      const value = function_.values.get(valueId);
      return (
        value !== undefined &&
        checkedTypeFingerprint(value.type) === checkedTypeFingerprint(place.type)
      );
    });
    if (argumentIndex < 0) {
      continue;
    }
    usedArgumentIndexes.add(argumentIndex);
    bindPlaceValueAlias({
      function_,
      aliases,
      placeId,
      valueId: proofMirValueIdFor(function_, edge.arguments[argumentIndex]!, context),
    });
  }
}

function bindPlaceValueAlias(input: {
  readonly function_: ProofMirFunction;
  readonly aliases: ProofMirPlaceValueAliases;
  readonly placeId: ProofMirPlace["placeId"];
  readonly valueId: OptIrValueId;
}): void {
  const place = input.function_.places.get(input.placeId);
  if (place === undefined) {
    return;
  }
  input.aliases.exactPlaceValues.set(String(place.placeId), input.valueId);
  if (place.projection.length === 0) {
    input.aliases.rootPlaceValues.set(placeRootAliasKey(place.root), input.valueId);
  }
}

function rootValueAliasForPlace(input: {
  readonly function_: ProofMirFunction;
  readonly place: ProofMirPlace;
  readonly context: ProofMirLoweringContext;
  readonly aliases: ProofMirPlaceValueAliases;
}): OptIrValueId | undefined {
  const rootAlias = input.aliases.rootPlaceValues.get(placeRootAliasKey(input.place.root));
  if (rootAlias !== undefined) {
    return rootAlias;
  }
  switch (input.place.root.kind) {
    case "blockParameter":
    case "runtimeTemporary":
      return proofMirValueIdFor(input.function_, input.place.root.valueId, input.context);
    default:
      return undefined;
  }
}

function placeRootAliasKey(root: ProofMirPlace["root"]): string {
  switch (root.kind) {
    case "receiver":
    case "parameter":
      return `${root.kind}:${String(root.parameterId)}`;
    case "local":
      return `local:${String(root.localId.instanceId)}:${String(root.localId.hirId)}`;
    case "temporary":
      return `temporary:${String(root.ordinal)}`;
    case "imageDevice":
      return `imageDevice:${String(root.imageId)}:${String(root.fieldId)}`;
    case "validationPayload":
      return `validationPayload:${String(root.validationId.instanceId)}:${String(root.validationId.hirId)}`;
    case "blockParameter":
      return `blockParameter:${String(root.valueId)}`;
    case "runtimeTemporary":
      return `runtimeTemporary:${String(root.valueId)}`;
    case "error":
      return "error";
  }
}

function projectionFieldPath(place: ProofMirPlace): readonly string[] {
  return place.projection.map((projection) => {
    switch (projection.kind) {
      case "field":
        return String(projection.fieldId);
      case "deref":
        return "deref";
      case "variant":
        return `variant:${projection.name}`;
      case "validatedPacketPayload":
        return `validatedPacketPayload:${String(projection.validationId.instanceId)}:${String(
          projection.validationId.hirId,
        )}`;
      case "imageDevice":
        return `imageDevice:${String(projection.fieldId)}`;
    }
  });
}

function aliasProofMirValue(input: {
  readonly function_: ProofMirFunction;
  readonly result: ProofMirValueId;
  readonly targetValueId: OptIrValueId;
  readonly context: ProofMirLoweringContext;
}): void {
  const value = input.function_.values.get(input.result);
  input.context.values.aliasValue({
    valueKey: proofMirScopedValueKey(input.function_.functionInstanceId, input.result),
    targetValueId: input.targetValueId,
    runtime: proofMirValueIsRuntime(value),
    proofOnlyReason: proofMirValueErasureReason(value),
  });
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
  if (place.projection.length > 0 && rootAlias !== undefined) {
    return [
      optIrAggregateExtractOperation({
        operationId: nextStatementOperationId(context),
        aggregate: rootAlias,
        fieldPath: projectionFieldPath(place),
        resultId: proofMirValueIdFor(function_, load.result, context),
        resultType: proofMirValueType(function_, load.result),
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
    case "constructObject":
      return [
        optIrAggregateConstructOperation({
          operationId: nextStatementOperationId(context),
          fieldIds: statement.kind.fields.map((field) =>
            proofMirValueIdFor(function_, field.value, context),
          ),
          resultId: proofMirValueIdFor(function_, statement.kind.result, context),
          resultType: proofMirValueType(function_, statement.kind.result),
          originId,
        }),
      ];
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
    case "compilerIntrinsic":
      return optIrIntrinsicCallOperation({
        ...common,
        target: {
          kind: "intrinsic",
          intrinsicKey: call.target.intrinsicKey,
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
    case "yield":
      context.diagnostics.push(
        `terminator:${String(terminator.terminatorId)}:unsupported-kind:${terminator.kind.kind}`,
      );
      return { kind: "unreachable", operationId, originId };
  }
}
