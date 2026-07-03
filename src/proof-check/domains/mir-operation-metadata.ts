import type { LayoutValidatedBufferFieldFact } from "../../layout/layout-program";
import type { MonoInstanceId } from "../../mono/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import type { AttemptId, ValidationId } from "../../hir/ids";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import {
  proofMirOwnedPlaceId,
  type ProofMirBlockId,
  type ProofMirPlaceId,
  type ProofMirPrivateStateGenerationId,
} from "../../proof-mir/ids";
import type {
  ProofMirAttemptStart,
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirObligationReference,
  ProofMirSessionMemberReference,
  ProofMirStatement,
  ProofMirTakeStart,
  ProofMirValidatedBufferRead,
  ProofMirValidationStart,
} from "../../proof-mir/model/graph";
import type {
  ProofMirObservedOperand,
  ProofMirConsumedOperand,
} from "../../proof-mir/model/operands";
import type { ProofMirFact } from "../../proof-mir/model/facts";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type { ProofMirPrivateStateTransitionReference } from "../../proof-mir/model/effects";
import type { CheckedFactScope } from "../model/fact-packet";
import type {
  ProofCheckOperandTerm,
  ProofCheckPlaceBinder,
  ProofCheckRequirementTerm,
} from "../model/fact-language";
import type { ProofCheckStructuredPlace } from "../kernel/state";
import type { ProofCheckProgramPoint } from "../kernel/transition-api";
import type { AdvancePrivateStateInput } from "./private-state";
import type { TakeSessionTransferInput } from "./take-sessions";
import type { ValidatedBufferReadRequirementInput } from "./validated-buffers";
import { operandFromLayoutTermReference, placeBinderForMirOwnedPlace } from "./mir-place-bindings";
import { requirementTermFromProofMirFact } from "./mir-requirement-terms";

export function mirProofMetadataKey(id: MonoInstantiatedProofId<unknown>): string {
  return proofMetadataIdKey(id);
}

export function mirPlaceKey(placeId: ProofMirPlaceId): string {
  return `proofMirPlace:${String(placeId)}`;
}

export function mirPrivateGenerationKey(generationId: ProofMirPrivateStateGenerationId): string {
  return `privateGeneration:${String(generationId)}`;
}

export function structuredPlaceForMirPlace(placeId: ProofMirPlaceId): ProofCheckStructuredPlace {
  return { placeKey: mirPlaceKey(placeId) };
}

export function factScopeForProgramPoint(location: ProofCheckProgramPoint): CheckedFactScope {
  switch (location.kind) {
    case "functionEntry":
      return { kind: "function", functionInstanceId: location.functionInstanceId };
    case "statement":
      return {
        kind: "afterStatement",
        functionInstanceId: location.functionInstanceId,
        statementId: location.statementId,
      };
    case "edge":
      return {
        kind: "edge",
        functionInstanceId: location.functionInstanceId,
        edgeId: location.edgeId,
      };
    case "terminator":
    case "join":
    case "loopHeader":
      return {
        kind: "blockEntry",
        functionInstanceId: location.functionInstanceId,
        blockId: location.blockId,
      };
    case "call":
      return { kind: "function", functionInstanceId: location.functionInstanceId };
    case "exit":
      return { kind: "function", functionInstanceId: location.functionInstanceId };
    case "terminalClosure":
      return { kind: "wholeImage" };
    default: {
      const unreachable: never = location;
      return unreachable;
    }
  }
}

function placeIdFromTakeOperand(
  operand: ProofMirObservedOperand | ProofMirConsumedOperand,
): ProofMirPlaceId | undefined {
  switch (operand.kind) {
    case "place":
      return operand.place;
    case "valueAndPlace":
      return operand.place;
    case "value":
      return undefined;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function blockForId(
  functionGraph: ProofMirFunction,
  blockId: ProofMirBlockId,
): ProofMirBlock | undefined {
  return functionGraph.blocks.get(blockId);
}

function validationStartInBlock(
  block: ProofMirBlock,
  validationId: MonoInstantiatedProofId<ValidationId>,
): ProofMirValidationStart | undefined {
  for (const statement of block.statements) {
    if (statement.kind.kind !== "validate") {
      continue;
    }
    if (
      mirProofMetadataKey(statement.kind.validation.validationId) ===
      mirProofMetadataKey(validationId)
    ) {
      return statement.kind.validation;
    }
  }
  return undefined;
}

function attemptStartInBlock(
  block: ProofMirBlock,
  attemptId: MonoInstantiatedProofId<AttemptId>,
): ProofMirAttemptStart | undefined {
  for (const statement of block.statements) {
    if (statement.kind.kind !== "attempt") {
      continue;
    }
    if (mirProofMetadataKey(statement.kind.attempt.attemptId) === mirProofMetadataKey(attemptId)) {
      return statement.kind.attempt;
    }
  }
  return undefined;
}

export interface MirValidationOperationContext {
  readonly validationKey: string;
  readonly sourcePlaceKey: string;
  readonly packetPlaceKey: string;
  readonly pendingResultPlaceKey: string;
  readonly layoutKey: string;
  readonly payloadPlaceKey?: string;
  readonly errPayloadPlaceKey?: string;
}

export interface MirAttemptOperationContext {
  readonly attemptKey: string;
  readonly declaredInputs: readonly ProofCheckStructuredPlace[];
}

function validationContextFromStart(
  validation: ProofMirValidationStart,
): MirValidationOperationContext {
  return {
    validationKey: mirProofMetadataKey(validation.validationId),
    sourcePlaceKey: mirPlaceKey(validation.sourcePlace),
    packetPlaceKey: mirPlaceKey(validation.okPacketPlace),
    pendingResultPlaceKey: mirPlaceKey(validation.pendingResultPlace),
    layoutKey: String(validation.validatedBufferInstanceId),
    ...(validation.okPayloadPlace === undefined
      ? {}
      : { payloadPlaceKey: mirPlaceKey(validation.okPayloadPlace) }),
    ...(validation.errPayloadPlace === undefined
      ? {}
      : { errPayloadPlaceKey: mirPlaceKey(validation.errPayloadPlace) }),
  };
}

export function resolveValidationContextForBlock(input: {
  readonly functionGraph: ProofMirFunction;
  readonly blockId: ProofMirBlockId;
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
}): MirValidationOperationContext | undefined {
  const block = blockForId(input.functionGraph, input.blockId);
  if (block === undefined) {
    return undefined;
  }
  const validation = validationStartInBlock(block, input.validationId);
  if (validation === undefined) {
    return undefined;
  }
  return validationContextFromStart(validation);
}

export function resolveValidationContextForEdge(input: {
  readonly functionGraph: ProofMirFunction;
  readonly edge: ProofMirControlEdge;
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
}): MirValidationOperationContext | undefined {
  return resolveValidationContextForBlock({
    functionGraph: input.functionGraph,
    blockId: input.edge.fromBlockId,
    validationId: input.validationId,
  });
}

export function resolveAttemptContextForBlock(input: {
  readonly functionGraph: ProofMirFunction;
  readonly blockId: ProofMirBlockId;
  readonly attemptId: MonoInstantiatedProofId<AttemptId>;
}): MirAttemptOperationContext | undefined {
  const block = blockForId(input.functionGraph, input.blockId);
  if (block === undefined) {
    return undefined;
  }
  const attempt = attemptStartInBlock(block, input.attemptId);
  if (attempt === undefined) {
    return undefined;
  }
  return {
    attemptKey: mirProofMetadataKey(attempt.attemptId),
    declaredInputs: attempt.inputPlaces.map((place) => structuredPlaceForMirPlace(place)),
  };
}

export function resolveAttemptContextForEdge(input: {
  readonly functionGraph: ProofMirFunction;
  readonly edge: ProofMirControlEdge;
  readonly attemptId: MonoInstantiatedProofId<AttemptId>;
}): MirAttemptOperationContext | undefined {
  return resolveAttemptContextForBlock({
    functionGraph: input.functionGraph,
    blockId: input.edge.fromBlockId,
    attemptId: input.attemptId,
  });
}

function lookupMonoObligation(mir: ProofMirProgram, obligation: ProofMirObligationReference) {
  return mir.proofMetadata.obligations.get(obligation.obligationId);
}

function sessionKeyForMember(member: ProofMirSessionMemberReference): string {
  return mirProofMetadataKey(member.sessionId);
}

export function streamMemberForMirReference(member: ProofMirSessionMemberReference): {
  readonly memberKey: string;
  readonly sessionKey: string;
} {
  const sessionKey = sessionKeyForMember(member);
  const memberKey =
    member.obligationId !== undefined
      ? mirProofMetadataKey(member.obligationId)
      : member.placeId !== undefined
        ? mirPlaceKey(member.placeId)
        : mirProofMetadataKey(member.brandId);
  return { memberKey, sessionKey };
}

export function takeSessionTransferForTakeStatement(input: {
  readonly mir: ProofMirProgram;
  readonly take: ProofMirTakeStart;
}): Omit<TakeSessionTransferInput, "state" | "operationOriginKey"> | undefined {
  const obligation = lookupMonoObligation(input.mir, input.take.obligation);
  if (obligation === undefined) {
    return undefined;
  }
  const obligationKey = mirProofMetadataKey(input.take.obligation.obligationId);
  const operandPlaceId = placeIdFromTakeOperand(input.take.operand);
  const operandPlaceKey = operandPlaceId === undefined ? undefined : mirPlaceKey(operandPlaceId);

  switch (obligation.kind) {
    case "bufferDischarge": {
      if (operandPlaceKey === undefined) {
        return undefined;
      }
      return {
        operation: "takeBuffer",
        sessionKey: obligationKey,
        obligationKey,
        bufferPlaceKey: operandPlaceKey,
      };
    }
    case "streamClosure": {
      const sessionMember = input.take.sessionMember;
      if (sessionMember === undefined || operandPlaceKey === undefined) {
        return undefined;
      }
      return {
        operation: "takeStream",
        sessionKey: mirProofMetadataKey(sessionMember.sessionId),
        obligationKey,
        brandKey: mirProofMetadataKey(sessionMember.brandId),
        producerEdgePathKey: operandPlaceKey,
      };
    }
    case "validatedBufferClosure": {
      const sessionMember = input.take.sessionMember;
      if (sessionMember === undefined || operandPlaceKey === undefined) {
        return undefined;
      }
      return {
        operation: "takeValidated",
        sessionKey: mirProofMetadataKey(sessionMember.sessionId),
        obligationKey,
        brandKey: mirProofMetadataKey(sessionMember.brandId),
        validatedPlaceKey: operandPlaceKey,
      };
    }
    default:
      return undefined;
  }
}

export function advancePrivateStateInputFromMir(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly transition: ProofMirPrivateStateTransitionReference;
  readonly operationOriginKey: string;
  readonly programPointScope: CheckedFactScope;
}): Omit<AdvancePrivateStateInput, "state"> | undefined {
  const transitionKey = mirProofMetadataKey(input.transition.transitionId);
  let targetGeneration = undefined as
    | {
        readonly generationId: ProofMirPrivateStateGenerationId;
        readonly place: { readonly placeId: ProofMirPlaceId };
      }
    | undefined;

  for (const generation of input.mir.privateStateGenerations.entries()) {
    if (
      generation.producedBy !== undefined &&
      mirProofMetadataKey(generation.producedBy) === transitionKey
    ) {
      targetGeneration = generation;
      break;
    }
  }
  if (targetGeneration === undefined) {
    return undefined;
  }

  return {
    placeKey: mirPlaceKey(targetGeneration.place.placeId),
    nextGenerationKey: mirPrivateGenerationKey(targetGeneration.generationId),
    transitionKey,
    operationOriginKey: input.operationOriginKey,
    programPointScope: input.programPointScope,
  };
}

function layoutFieldForRead(
  mir: ProofMirProgram,
  read: ProofMirValidatedBufferRead,
): LayoutValidatedBufferFieldFact | undefined {
  const buffer = mir.layout.validatedBuffers.get(read.validatedBufferInstanceId);
  if (buffer === undefined) {
    return undefined;
  }
  return buffer.layoutFields.find((field) => field.fieldId === read.fieldId);
}

function factForMirFactId(
  mir: ProofMirProgram,
  factId: ProofMirFact["factId"],
): ProofMirFact | undefined {
  return mir.facts.get(factId);
}

function requirementTermsForReadFacts(input: {
  readonly mir: ProofMirProgram;
  readonly functionGraph: ProofMirFunction;
  readonly read: ProofMirValidatedBufferRead;
}): ProofCheckRequirementTerm[] {
  const requirements: ProofCheckRequirementTerm[] = [];
  for (const factId of input.read.readRequires) {
    const fact = factForMirFactId(input.mir, factId);
    if (fact === undefined) {
      continue;
    }
    const term = requirementTermFromProofMirFact({
      mir: input.mir,
      functionGraph: input.functionGraph,
      fact,
    });
    if (term === undefined) {
      continue;
    }
    requirements.push(term);
  }
  return requirements;
}

function placeBinderForMirPlace(input: {
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
  readonly placeId: ProofMirPlaceId;
}): ProofCheckPlaceBinder {
  return placeBinderForMirOwnedPlace(
    input.functionGraph,
    proofMirOwnedPlaceId(input.functionInstanceId, input.placeId),
  );
}

export function validatedBufferReadRequirementFromMir(input: {
  readonly mir: ProofMirProgram;
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
  readonly read: ProofMirValidatedBufferRead;
}): ValidatedBufferReadRequirementInput | undefined {
  const layoutField = layoutFieldForRead(input.mir, input.read);
  if (layoutField === undefined) {
    return undefined;
  }

  const source = placeBinderForMirPlace({
    functionGraph: input.functionGraph,
    functionInstanceId: input.functionInstanceId,
    placeId: input.read.sourcePlace,
  });
  const end: ProofCheckOperandTerm = operandFromLayoutTermReference(input.read.endTerm);
  const readRequirements = requirementTermsForReadFacts(input);

  return {
    source,
    end,
    fieldId: input.read.fieldId,
    isDynamicPayload: layoutField.readRequires.some(
      (requirement) => requirement.kind === "payloadEnd",
    ),
    ...(input.read.packetPlace === undefined
      ? {}
      : {
          requiresPacketSource: true as const,
          packet: placeBinderForMirPlace({
            functionGraph: input.functionGraph,
            functionInstanceId: input.functionInstanceId,
            placeId: input.read.packetPlace,
          }),
        }),
    readRequirements,
  };
}

export function findStatementInFunction(input: {
  readonly functionGraph: ProofMirFunction;
  readonly statementId: ProofMirStatement["statementId"];
}): ProofMirStatement | undefined {
  for (const block of input.functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      if (String(statement.statementId) === String(input.statementId)) {
        return statement;
      }
    }
  }
  return undefined;
}
