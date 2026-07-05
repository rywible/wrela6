import type {
  ProofMirFactId,
  ProofMirLayoutTermBindingId,
  ProofMirPlaceId,
  ProofMirValueId,
} from "../ids";
import type { ProofMirLayoutTermReference, ProofMirStatement } from "../model/graph";
import type { ProofMirOperand } from "../model/operands";
import type {
  ProofMirLoanReference,
  ProofMirObligationReference,
  ProofMirSessionMemberReference,
} from "../model/effects";

export interface ProofMirStatementReferences {
  readonly reads: readonly ProofMirValueId[];
  readonly writes: readonly ProofMirValueId[];
  readonly facts: readonly ProofMirFactId[];
  readonly loans: readonly ProofMirLoanReference[];
  readonly sessions: readonly ProofMirSessionMemberReference[];
  readonly layoutTerms: readonly ProofMirLayoutTermReference[];
  readonly places: readonly ProofMirPlaceId[];
  readonly layoutTermBindings: readonly ProofMirLayoutTermBindingId[];
}

export function collectStatementReferences(
  statement: ProofMirStatement,
): ProofMirStatementReferences {
  const reads: ProofMirValueId[] = [];
  const writes: ProofMirValueId[] = [];
  const facts: ProofMirFactId[] = [];
  const loans: ProofMirLoanReference[] = [];
  const sessions: ProofMirSessionMemberReference[] = [];
  const layoutTerms: ProofMirLayoutTermReference[] = [];
  const places: ProofMirPlaceId[] = [];
  const layoutTermBindings: ProofMirLayoutTermBindingId[] = [];

  switch (statement.kind.kind) {
    case "load":
      places.push(statement.kind.place);
      writes.push(statement.kind.result);
      break;
    case "store":
      places.push(statement.kind.place);
      reads.push(statement.kind.value);
      break;
    case "movePlace":
      places.push(statement.kind.place);
      if (statement.kind.result !== undefined) writes.push(statement.kind.result);
      break;
    case "consumePlace":
      places.push(statement.kind.place);
      break;
    case "borrowPlace":
      places.push(statement.kind.place, statement.kind.loan.placeId);
      loans.push(statement.kind.loan);
      break;
    case "releaseLoan":
      places.push(statement.kind.loan.placeId);
      loans.push(statement.kind.loan);
      break;
    case "literal":
      writes.push(statement.kind.value);
      break;
    case "unary":
      reads.push(statement.kind.operand);
      writes.push(statement.kind.result);
      break;
    case "binary":
    case "comparison":
      reads.push(statement.kind.left, statement.kind.right);
      writes.push(statement.kind.result);
      break;
    case "constructObject":
      writes.push(statement.kind.result);
      for (const field of statement.kind.fields) reads.push(field.value);
      break;
    case "call":
      collectOperand(statement.kind.call.receiver?.operand, reads, places);
      for (const argument of statement.kind.call.arguments) {
        collectOperand(argument.operand, reads, places);
      }
      if (statement.kind.call.result !== undefined) {
        collectProducedOperand(statement.kind.call.result, writes, places);
      }
      break;
    case "validate":
      places.push(
        statement.kind.validation.sourcePlace,
        statement.kind.validation.pendingResultPlace,
        statement.kind.validation.okPacketPlace,
      );
      if (statement.kind.validation.okPayloadPlace !== undefined) {
        places.push(statement.kind.validation.okPayloadPlace);
      }
      if (statement.kind.validation.errPayloadPlace !== undefined) {
        places.push(statement.kind.validation.errPayloadPlace);
      }
      break;
    case "attempt":
      if (statement.kind.attempt.fallible.result !== undefined) {
        collectProducedOperand(statement.kind.attempt.fallible.result, writes, places);
      }
      if (statement.kind.attempt.alternative !== undefined) {
        if (statement.kind.attempt.alternative.result !== undefined) {
          collectProducedOperand(statement.kind.attempt.alternative.result, writes, places);
        }
      }
      places.push(statement.kind.attempt.pendingResultPlace, ...statement.kind.attempt.inputPlaces);
      break;
    case "take":
      collectOperand(statement.kind.take.operand, reads, places);
      collectObligation(statement.kind.take.obligation, facts);
      if (statement.kind.take.sessionMember !== undefined) {
        sessions.push(statement.kind.take.sessionMember);
        collectSessionPlaces(statement.kind.take.sessionMember, places);
      }
      break;
    case "openSessionMember":
    case "closeSessionMember":
      sessions.push(statement.kind.member);
      collectSessionPlaces(statement.kind.member, places);
      break;
    case "openObligation":
      collectObligation(statement.kind.obligation, facts);
      break;
    case "dischargeObligation":
      collectObligation(statement.kind.obligation, facts);
      if (statement.kind.evidence !== undefined) facts.push(statement.kind.evidence);
      break;
    case "advancePrivateState":
      break;
    case "bindLayoutTerm":
      layoutTerms.push(statement.kind.binding.term);
      reads.push(statement.kind.binding.value);
      if (statement.kind.binding.sourcePlace !== undefined) {
        places.push(statement.kind.binding.sourcePlace);
      }
      break;
    case "recordFactEvidence":
    case "requireFact":
      facts.push(statement.kind.factId);
      break;
    case "readValidatedBufferField":
      places.push(statement.kind.read.sourcePlace);
      if (statement.kind.read.packetPlace !== undefined)
        places.push(statement.kind.read.packetPlace);
      layoutTerms.push(statement.kind.read.offsetTerm, statement.kind.read.endTerm);
      layoutTermBindings.push(...statement.kind.read.termBindings);
      facts.push(...statement.kind.read.readRequires);
      writes.push(statement.kind.read.result);
      break;
    case "extension":
      collectExtension(statement.kind.extension, reads, places, facts, sessions);
      break;
    default: {
      const unreachable: never = statement.kind;
      return unreachable;
    }
  }

  return Object.freeze({
    reads,
    writes,
    facts,
    loans,
    sessions,
    layoutTerms,
    places,
    layoutTermBindings,
  });
}

function collectOperand(
  operand: ProofMirOperand | undefined,
  reads: ProofMirValueId[],
  places: ProofMirPlaceId[],
): void {
  if (operand === undefined) return;
  switch (operand.kind) {
    case "value":
      reads.push(operand.value);
      break;
    case "valueAndPlace":
      reads.push(operand.value);
      places.push(operand.place);
      break;
    case "place":
      places.push(operand.place);
      break;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function collectProducedOperand(
  operand: NonNullable<
    Extract<ProofMirStatement["kind"], { readonly kind: "call" }>["call"]["result"]
  >,
  writes: ProofMirValueId[],
  places: ProofMirPlaceId[],
): void {
  switch (operand.kind) {
    case "value":
      writes.push(operand.value);
      break;
    case "valueAndPlace":
      writes.push(operand.value);
      places.push(operand.place);
      break;
    case "place":
      places.push(operand.place);
      break;
    default: {
      const unreachable: never = operand;
      return unreachable;
    }
  }
}

function collectObligation(
  _obligation: ProofMirObligationReference,
  _facts: ProofMirFactId[],
): void {}

function collectSessionPlaces(
  member: ProofMirSessionMemberReference,
  places: ProofMirPlaceId[],
): void {
  if (member.placeId !== undefined) places.push(member.placeId);
}

function collectExtension(
  extension: Extract<ProofMirStatement["kind"], { readonly kind: "extension" }>["extension"],
  reads: ProofMirValueId[],
  places: ProofMirPlaceId[],
  facts: ProofMirFactId[],
  sessions: ProofMirSessionMemberReference[],
): void {
  switch (extension.kind) {
    case "concurrency":
      switch (extension.operation.kind) {
        case "pinCore":
          places.push(
            extension.operation.sourcePlace,
            extension.operation.workerPlace,
            extension.operation.targetCorePlace,
          );
          collectObligation(extension.operation.transferObligation, facts);
          break;
        case "spawnWorker":
          if (extension.operation.producedSession !== undefined) {
            sessions.push(extension.operation.producedSession);
            collectSessionPlaces(extension.operation.producedSession, places);
          }
          break;
        case "moveRingEnqueue":
          places.push(extension.operation.ringPlace, extension.operation.valuePlace);
          break;
        case "moveRingDequeue":
          places.push(extension.operation.ringPlace, extension.operation.resultPlace);
          break;
        case "transferOwnership":
          places.push(extension.operation.fromPlace, extension.operation.toPlace);
          break;
        default: {
          const unreachable: never = extension.operation;
          return unreachable;
        }
      }
      break;
  }
  void reads;
}
