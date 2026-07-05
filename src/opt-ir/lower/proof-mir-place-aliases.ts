import type { OptIrValueId } from "../ids";
import { optIrTypesEqual } from "../types";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirPlace,
  ProofMirStatement,
  ProofMirValue,
} from "../../proof-mir/model/graph";
import { checkedTypeFingerprint } from "../../semantic/surface/type-model";
import type { ProofMirLoweringContext } from "./lower-checked-mir";
import { compareStableKeys, proofMirScopedValueKey } from "./proof-mir-lowering-support";
import {
  functionSignatureParameterValueKey,
  optIrTypeFromMono,
  proofMirValueErasureReason,
  proofMirValueIdFor,
  proofMirValueIsRuntime,
  sortedProofMirBlocks,
  sortedProofMirEdges,
} from "./proof-mir-lowering-helpers";

export interface ProofMirPlaceValueAliases {
  readonly exactPlaceValues: Map<string, OptIrValueId>;
  readonly rootPlaceValues: Map<string, OptIrValueId>;
}

export function basePlaceValueAliasesForBlock(
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
    seedAttemptEdgePlaceAliases(function_, edge, context, aliases);
    seedSwitchCaseEdgePlaceAliases(function_, edge, context, aliases);
  }
  return aliases;
}

export function propagatedPlaceValueAliasesByBlock(
  function_: ProofMirFunction,
  context: ProofMirLoweringContext,
): ReadonlyMap<string, ProofMirPlaceValueAliases> {
  const blocks = sortedProofMirBlocks(function_);
  const aliasesByBlock = new Map<string, ProofMirPlaceValueAliases>(
    blocks.map((block) => [
      String(block.blockId),
      basePlaceValueAliasesForBlock(function_, block, context),
    ]),
  );
  const maxIterations = Math.max(1, blocks.length * (function_.edges.entries().length + 1) * 2);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    for (const block of blocks) {
      const blockAliases = aliasesByBlock.get(String(block.blockId)) ?? emptyPlaceValueAliases();
      const exitAliases = aliasesAfterBlockStatements(function_, block, blockAliases, context);
      for (const edgeId of block.terminator.outgoingEdges) {
        const edge = function_.edges.get(edgeId);
        if (edge === undefined || !edgeRetainsPlaceValueAliases(edge)) {
          continue;
        }
        const targetBlockId = edge.toBlockId;
        if (targetBlockId === undefined) {
          continue;
        }
        const targetKey = String(targetBlockId);
        const targetAliases = aliasesByBlock.get(targetKey);
        if (targetAliases === undefined) {
          continue;
        }
        changed = mergeCompatiblePlaceValueAliases(targetAliases, exitAliases) || changed;
      }
    }
    if (!changed) {
      return aliasesByBlock;
    }
  }

  context.diagnostics.push(
    `function:${String(function_.functionInstanceId)}:alias-propagation:not-converged`,
  );
  return aliasesByBlock;
}

export function clonePlaceValueAliases(
  aliases: ProofMirPlaceValueAliases,
): ProofMirPlaceValueAliases {
  return {
    exactPlaceValues: new Map(aliases.exactPlaceValues),
    rootPlaceValues: new Map(aliases.rootPlaceValues),
  };
}

export function bindPlaceValueAlias(input: {
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
    input.aliases.rootPlaceValues.set(proofMirPlaceRootAliasKey(place.root), input.valueId);
  }
}

export function rootValueAliasForPlace(input: {
  readonly function_: ProofMirFunction;
  readonly place: ProofMirPlace;
  readonly context: ProofMirLoweringContext;
  readonly aliases: ProofMirPlaceValueAliases;
}): OptIrValueId | undefined {
  const rootAlias = input.aliases.rootPlaceValues.get(proofMirPlaceRootAliasKey(input.place.root));
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

export function projectionFieldPath(place: ProofMirPlace): readonly string[] {
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

export function aliasProofMirValue(input: {
  readonly function_: ProofMirFunction;
  readonly result: Parameters<typeof proofMirScopedValueKey>[1];
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

export function valueAliasForTakeOperand(input: {
  readonly function_: ProofMirFunction;
  readonly operand: Extract<
    ProofMirStatement["kind"],
    { readonly kind: "take" }
  >["take"]["operand"];
  readonly context: ProofMirLoweringContext;
  readonly aliases: ProofMirPlaceValueAliases;
}): OptIrValueId | undefined {
  if (input.operand.kind === "value" || input.operand.kind === "valueAndPlace") {
    return proofMirValueIdFor(input.function_, input.operand.value, input.context);
  }
  const place = input.function_.places.get(input.operand.place);
  if (place === undefined) {
    return undefined;
  }
  return (
    input.aliases.exactPlaceValues.get(String(place.placeId)) ??
    rootValueAliasForPlace({
      function_: input.function_,
      place,
      context: input.context,
      aliases: input.aliases,
    })
  );
}

function emptyPlaceValueAliases(): ProofMirPlaceValueAliases {
  return {
    exactPlaceValues: new Map(),
    rootPlaceValues: new Map(),
  };
}

function aliasesAfterBlockStatements(
  function_: ProofMirFunction,
  block: ProofMirBlock,
  entryAliases: ProofMirPlaceValueAliases,
  context: ProofMirLoweringContext,
): ProofMirPlaceValueAliases {
  const aliases = clonePlaceValueAliases(entryAliases);
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
      case "take": {
        if (statement.kind.take.sessionMember?.placeId !== undefined) {
          const valueAlias = valueAliasForTakeOperand({
            function_,
            operand: statement.kind.take.operand,
            context,
            aliases,
          });
          if (valueAlias !== undefined) {
            bindPlaceValueAlias({
              function_,
              aliases,
              placeId: statement.kind.take.sessionMember.placeId,
              valueId: valueAlias,
            });
          }
        }
        break;
      }
      case "consumePlace":
        unbindPlaceValueAlias(function_, aliases, statement.kind.place);
        break;
    }
  }
  return aliases;
}

function edgeRetainsPlaceValueAliases(edge: ProofMirControlEdge): boolean {
  return edge.kind === "normal" && edge.arguments.length === 0 && edge.effects.length === 0;
}

function mergeCompatiblePlaceValueAliases(
  target: ProofMirPlaceValueAliases,
  source: ProofMirPlaceValueAliases,
): boolean {
  return (
    mergeCompatibleAliasMap(target.exactPlaceValues, source.exactPlaceValues) ||
    mergeCompatibleAliasMap(target.rootPlaceValues, source.rootPlaceValues)
  );
}

function mergeCompatibleAliasMap(
  target: Map<string, OptIrValueId>,
  source: Map<string, OptIrValueId>,
) {
  let changed = false;
  for (const [key, valueId] of source) {
    const existing = target.get(key);
    if (existing === undefined) {
      target.set(key, valueId);
      changed = true;
      continue;
    }
    if (existing !== valueId) {
      target.delete(key);
      changed = true;
    }
  }
  return changed;
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
  const signatureParameters = [
    ...(function_.signature.receiver === undefined ? [] : [function_.signature.receiver]),
    ...function_.signature.parameters,
  ];
  for (const parameter of signatureParameters) {
    const parameterValueKey = functionSignatureParameterValueKey(function_, parameter.parameterId);
    const parameterValueId =
      context.values.valueIdFor(parameterValueKey) ??
      context.values.declareValue({
        valueKey: parameterValueKey,
        runtime: true,
      });
    for (const place of function_.places.entries()) {
      if (
        (place.root.kind === "parameter" || place.root.kind === "receiver") &&
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
  seedIntroducedEdgePlaceAliases(function_, edge, context, aliases);
}

function seedAttemptEdgePlaceAliases(
  function_: ProofMirFunction,
  edge: ProofMirControlEdge,
  context: ProofMirLoweringContext,
  aliases: ProofMirPlaceValueAliases,
): void {
  if (edge.kind !== "attemptSuccess" && edge.kind !== "attemptError") {
    return;
  }
  seedIntroducedEdgePlaceAliases(function_, edge, context, aliases);
}

function seedSwitchCaseEdgePlaceAliases(
  function_: ProofMirFunction,
  edge: ProofMirControlEdge,
  context: ProofMirLoweringContext,
  aliases: ProofMirPlaceValueAliases,
): void {
  if (edge.kind !== "switchCase") {
    return;
  }
  const sourceBlock = function_.blocks.get(edge.fromBlockId);
  if (sourceBlock?.terminator.kind.kind !== "switch") {
    return;
  }
  const label = switchCaseLabelForEdge(sourceBlock, edge);
  if (label === undefined) {
    return;
  }
  const scrutinee = function_.values.get(sourceBlock.terminator.kind.scrutinee);
  if (scrutinee === undefined) {
    return;
  }
  const scrutineeValueId = proofMirValueIdFor(
    function_,
    sourceBlock.terminator.kind.scrutinee,
    context,
  );
  for (const placeId of introducedEdgePlaceIds(edge)) {
    const place = function_.places.get(placeId);
    if (place === undefined || place.projection.length > 0) {
      continue;
    }
    const payload = context.target.sourceTypeAbi?.lowerSwitchCasePayload?.({
      type: scrutinee.type,
      label,
      payloadType: place.type,
    });
    if (payload?.kind !== "scrutinee") {
      continue;
    }
    if (
      !optIrTypesEqual(
        lowerProofMirTypeForTarget(scrutinee.type, context),
        lowerProofMirTypeForTarget(place.type, context),
      )
    ) {
      continue;
    }
    bindPlaceValueAlias({ function_, aliases, placeId, valueId: scrutineeValueId });
  }
}

function seedIntroducedEdgePlaceAliases(
  function_: ProofMirFunction,
  edge: ProofMirControlEdge,
  context: ProofMirLoweringContext,
  aliases: ProofMirPlaceValueAliases,
): void {
  const usedArgumentIndexes = new Set<number>();
  const introducedPlaceIds = introducedEdgePlaceIds(edge);

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

function introducedEdgePlaceIds(edge: ProofMirControlEdge): readonly ProofMirPlace["placeId"][] {
  return edge.effects
    .filter(
      (effect): effect is Extract<typeof effect, { readonly kind: "introducePlace" }> =>
        effect.kind === "introducePlace",
    )
    .map((effect) => effect.placeId)
    .sort((left, right) => compareStableKeys(String(left), String(right)));
}

function switchCaseLabelForEdge(
  block: ProofMirBlock,
  edge: ProofMirControlEdge,
): string | undefined {
  if (block.terminator.kind.kind !== "switch") {
    return undefined;
  }
  return block.terminator.kind.cases.find((switchCase) => switchCase.target.edgeId === edge.edgeId)
    ?.label;
}

function lowerProofMirTypeForTarget(type: ProofMirValue["type"], context: ProofMirLoweringContext) {
  return context.target.sourceTypeAbi?.lowerType(type) ?? optIrTypeFromMono(type);
}

function unbindPlaceValueAlias(
  function_: ProofMirFunction,
  aliases: ProofMirPlaceValueAliases,
  placeId: ProofMirPlace["placeId"],
): void {
  const consumedPlace = function_.places.get(placeId);
  if (consumedPlace === undefined) {
    return;
  }
  for (const place of function_.places.entries()) {
    if (placeIsSameOrDescendant(consumedPlace, place)) {
      aliases.exactPlaceValues.delete(String(place.placeId));
    }
  }
  if (consumedPlace.projection.length === 0) {
    aliases.rootPlaceValues.delete(proofMirPlaceRootAliasKey(consumedPlace.root));
  }
}

function placeIsSameOrDescendant(parent: ProofMirPlace, candidate: ProofMirPlace): boolean {
  if (proofMirPlaceRootAliasKey(parent.root) !== proofMirPlaceRootAliasKey(candidate.root)) {
    return false;
  }
  if (parent.projection.length > candidate.projection.length) {
    return false;
  }
  return parent.projection.every(
    (projection, index) =>
      projectionFieldPath({ ...parent, projection: [projection] })[0] ===
      projectionFieldPath({ ...candidate, projection: [candidate.projection[index]!] })[0],
  );
}

export function proofMirPlaceRootAliasKey(root: ProofMirPlace["root"]): string {
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
      return `validationPayload:${String(root.validationId.instanceId)}:${String(
        root.validationId.hirId,
      )}`;
    case "blockParameter":
      return `blockParameter:${String(root.valueId)}`;
    case "runtimeTemporary":
      return `runtimeTemporary:${String(root.valueId)}`;
    case "error":
      return "error";
  }
}
