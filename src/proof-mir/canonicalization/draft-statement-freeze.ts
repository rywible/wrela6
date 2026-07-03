import type {
  DraftProofMirAttemptStart,
  DraftProofMirGraphStatementSnapshot,
  DraftProofMirLayoutTermBinding,
  DraftProofMirObligationReference,
  DraftProofMirSessionMemberReference,
  DraftProofMirStatementKind,
  DraftProofMirTakeStart,
  DraftProofMirValidatedBufferRead,
  DraftProofMirValidationStart,
} from "../draft/draft-statement";
import {
  type ProofMirFactId,
  type ProofMirLayoutTermBindingId,
  type ProofMirLayoutTermId,
  type ProofMirOriginId,
  type ProofMirPlaceId,
  type ProofMirScopeId,
  type ProofMirStatementId,
  type ProofMirValueId,
} from "../ids";
import type {
  ProofMirAttemptStart,
  ProofMirCall,
  ProofMirLayoutTermBinding,
  ProofMirLoanReference,
  ProofMirObligationReference,
  ProofMirPrivateStateTransitionReference,
  ProofMirSessionMemberReference,
  ProofMirStatement,
  ProofMirStatementKind,
  ProofMirTakeStart,
  ProofMirValidatedBufferRead,
  ProofMirValidationStart,
} from "../model/graph";
import type { ProofMirAttemptAlternative, ProofMirAttemptOperand } from "../model/operands";
import type {
  ProofMirCallArgument,
  ProofMirConsumedOperand,
  ProofMirObservedOperand,
} from "../model/operands";
import type { MonoInstanceId } from "../../mono/ids";
import type { DraftProofMirLoanRecord } from "../domains/effects-resources";
import type { DraftProofMirCallRecord } from "../draft/draft-program";
import {
  freezeDraftCallArgument,
  freezeDraftCallOperand,
  freezeDraftCallReceiver,
} from "./call-operand-freeze";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import type { ProofMirCanonicalKeyLookup } from "./id-assignment";
import { freezeDraftLayoutTermReference } from "../draft/draft-layout-term-reference";
import type { FreezeGraphSnapshotLookups } from "./graph-snapshot-freeze";

export interface DraftProofMirCallFreezePayload {
  readonly callKey: ProofMirCanonicalKey;
  readonly call: ProofMirCall;
}

export interface FreezeDraftStatementLookups extends FreezeGraphSnapshotLookups {
  readonly statementLookup: ProofMirCanonicalKeyLookup<ProofMirStatementId>;
  readonly callByKey: ReadonlyMap<string, DraftProofMirCallFreezePayload>;
  readonly loanRecordByKey: ReadonlyMap<string, DraftProofMirLoanRecord>;
  readonly layoutTermBindingLookup: ProofMirCanonicalKeyLookup<ProofMirLayoutTermBindingId>;
  readonly layoutTermLookup: ProofMirCanonicalKeyLookup<ProofMirLayoutTermId>;
}

function resolveValueId(
  lookups: FreezeDraftStatementLookups,
  key: ProofMirCanonicalKey,
): ProofMirValueId | undefined {
  return lookups.valueLookup.resolve(key);
}

function resolvePlaceId(
  lookups: FreezeDraftStatementLookups,
  key: ProofMirCanonicalKey,
): ProofMirPlaceId | undefined {
  return lookups.placeLookup.resolve(key);
}

function resolveOriginId(
  lookups: FreezeDraftStatementLookups,
  key: ProofMirCanonicalKey,
): ProofMirOriginId | undefined {
  return lookups.resolveOrigin(key);
}

function resolveScopeId(
  lookups: FreezeDraftStatementLookups,
  key: ProofMirCanonicalKey,
): ProofMirScopeId | undefined {
  return lookups.scopeLookup.resolve(key);
}

function freezeDraftObligationReference(
  lookups: FreezeDraftStatementLookups,
  obligation: DraftProofMirObligationReference,
): ProofMirObligationReference | undefined {
  const origin = resolveOriginId(lookups, obligation.originKey);
  if (origin === undefined) {
    return undefined;
  }
  return {
    obligationId: obligation.obligationId,
    origin,
  };
}

function freezeDraftSessionMemberReference(
  lookups: FreezeDraftStatementLookups,
  member: DraftProofMirSessionMemberReference,
): ProofMirSessionMemberReference | undefined {
  const origin = resolveOriginId(lookups, member.originKey);
  if (origin === undefined) {
    return undefined;
  }
  const placeId =
    member.placeKey === undefined ? undefined : resolvePlaceId(lookups, member.placeKey);
  return {
    sessionId: member.sessionId,
    brandId: member.brandId,
    ...(member.obligationId === undefined ? {} : { obligationId: member.obligationId }),
    ...(placeId === undefined ? {} : { placeId }),
    origin,
  };
}

function freezeDraftValidationStart(
  lookups: FreezeDraftStatementLookups,
  validation: DraftProofMirValidationStart,
): ProofMirValidationStart | undefined {
  const origin = resolveOriginId(lookups, validation.originKey);
  const sourcePlace = resolvePlaceId(lookups, validation.sourcePlaceKey);
  const pendingResultPlace = resolvePlaceId(lookups, validation.pendingResultPlaceKey);
  const okPacketPlace = resolvePlaceId(lookups, validation.okPacketPlaceKey);
  if (
    origin === undefined ||
    sourcePlace === undefined ||
    pendingResultPlace === undefined ||
    okPacketPlace === undefined
  ) {
    return undefined;
  }
  return {
    validationId: validation.validationId,
    sourcePlace,
    pendingResultPlace,
    okPacketPlace,
    ...(validation.okPayloadPlaceKey === undefined
      ? {}
      : { okPayloadPlace: resolvePlaceId(lookups, validation.okPayloadPlaceKey) }),
    ...(validation.errPayloadPlaceKey === undefined
      ? {}
      : { errPayloadPlace: resolvePlaceId(lookups, validation.errPayloadPlaceKey) }),
    okPayloadType: validation.okPayloadType,
    errPayloadType: validation.errPayloadType,
    validatedBufferInstanceId: validation.validatedBufferInstanceId,
    layout: validation.layout,
    origin,
  };
}

function freezeDraftAttemptOperand(
  lookups: FreezeDraftStatementLookups,
  operand: DraftProofMirAttemptStart["fallible"],
  origin: ProofMirOriginId,
  attemptId: DraftProofMirAttemptStart["attemptId"],
): ProofMirAttemptOperand | undefined {
  const place = resolvePlaceId(lookups, operand.placeKey);
  if (place === undefined) {
    return undefined;
  }
  return {
    expressionId: attemptId as never,
    result: { kind: "place", place },
    origin,
  };
}

function freezeDraftAttemptAlternative(
  lookups: FreezeDraftStatementLookups,
  alternative: NonNullable<DraftProofMirAttemptStart["alternative"]>,
  origin: ProofMirOriginId,
  attemptId: DraftProofMirAttemptStart["attemptId"],
): ProofMirAttemptAlternative | undefined {
  const place = resolvePlaceId(lookups, alternative.placeKey);
  if (place === undefined) {
    return undefined;
  }
  return {
    expressionId: attemptId as never,
    result: { kind: "place", place },
    origin,
  };
}

function freezeDraftAttemptStart(
  lookups: FreezeDraftStatementLookups,
  attempt: DraftProofMirAttemptStart,
): ProofMirAttemptStart | undefined {
  const origin = resolveOriginId(lookups, attempt.originKey);
  if (origin === undefined) {
    return undefined;
  }
  const fallible = freezeDraftAttemptOperand(lookups, attempt.fallible, origin, attempt.attemptId);
  const pendingResultPlace = resolvePlaceId(lookups, attempt.pendingResultPlaceKey);
  if (fallible === undefined || pendingResultPlace === undefined) {
    return undefined;
  }
  const inputPlaces: ProofMirPlaceId[] = [];
  for (const placeKey of attempt.inputPlaceKeys) {
    const placeId = resolvePlaceId(lookups, placeKey);
    if (placeId === undefined) {
      return undefined;
    }
    inputPlaces.push(placeId);
  }
  const alternative =
    attempt.alternative === undefined
      ? undefined
      : freezeDraftAttemptAlternative(lookups, attempt.alternative, origin, attempt.attemptId);
  if (attempt.alternative !== undefined && alternative === undefined) {
    return undefined;
  }
  return {
    attemptId: attempt.attemptId,
    fallible,
    ...(alternative === undefined ? {} : { alternative }),
    pendingResultPlace,
    inputPlaces,
    origin,
  };
}

function freezeDraftTakeOperand(
  lookups: FreezeDraftStatementLookups,
  operand: DraftProofMirTakeStart["operand"],
): ProofMirObservedOperand | ProofMirConsumedOperand | undefined {
  const place = resolvePlaceId(lookups, operand.placeKey);
  if (place === undefined) {
    return undefined;
  }
  if (operand.kind === "consume") {
    return { kind: "place", place };
  }
  return { kind: "place", place };
}

function freezeDraftTakeStart(
  lookups: FreezeDraftStatementLookups,
  take: DraftProofMirTakeStart,
): ProofMirTakeStart | undefined {
  const origin = resolveOriginId(lookups, take.originKey);
  const operand = freezeDraftTakeOperand(lookups, take.operand);
  const obligation = freezeDraftObligationReference(lookups, take.obligation);
  if (origin === undefined || operand === undefined || obligation === undefined) {
    return undefined;
  }
  const sessionMember =
    take.sessionMember === undefined
      ? undefined
      : freezeDraftSessionMemberReference(lookups, take.sessionMember);
  if (take.sessionMember !== undefined && sessionMember === undefined) {
    return undefined;
  }
  return {
    operand,
    obligation,
    ...(sessionMember === undefined ? {} : { sessionMember }),
    ...(take.aliasMonoLocalId === undefined ? {} : { aliasMonoLocalId: take.aliasMonoLocalId }),
    origin,
  };
}

function freezeDraftValidatedBufferRead(
  lookups: FreezeDraftStatementLookups,
  read: DraftProofMirValidatedBufferRead,
): ProofMirValidatedBufferRead | undefined {
  const origin = resolveOriginId(lookups, read.originKey);
  const sourcePlace = resolvePlaceId(lookups, read.sourcePlaceKey);
  const result = resolveValueId(lookups, read.resultKey);
  if (origin === undefined || sourcePlace === undefined || result === undefined) {
    return undefined;
  }
  const termBindings: ProofMirLayoutTermBindingId[] = [];
  for (const bindingKey of read.termBindingKeys) {
    const bindingId = lookups.layoutTermBindingLookup.resolve(bindingKey);
    if (bindingId === undefined) {
      return undefined;
    }
    termBindings.push(bindingId);
  }
  const readRequires: ProofMirFactId[] = [];
  for (const factKey of read.readRequiresFactKeys) {
    const factId = lookups.factLookup.resolve(factKey);
    if (factId === undefined) {
      return undefined;
    }
    readRequires.push(factId);
  }
  const offsetTerm = freezeDraftLayoutTermReference(read.offsetTerm, lookups.layoutTermLookup);
  const endTerm = freezeDraftLayoutTermReference(read.endTerm, lookups.layoutTermLookup);
  if (offsetTerm === undefined || endTerm === undefined) {
    return undefined;
  }
  return {
    sourcePlace,
    ...(read.packetPlaceKey === undefined
      ? {}
      : { packetPlace: resolvePlaceId(lookups, read.packetPlaceKey) }),
    validatedBufferInstanceId: read.validatedBufferInstanceId,
    fieldId: read.fieldId,
    layoutField: read.layoutField,
    offsetTerm,
    endTerm,
    termBindings,
    readRequires,
    result,
    origin,
  };
}

function freezeDraftLayoutTermBinding(
  lookups: FreezeDraftStatementLookups,
  binding: DraftProofMirLayoutTermBinding,
): ProofMirLayoutTermBinding | undefined {
  const origin = resolveOriginId(lookups, binding.originKey);
  const value = resolveValueId(lookups, binding.valueKey);
  if (origin === undefined || value === undefined) {
    return undefined;
  }
  const bindingId = lookups.layoutTermBindingLookup.resolve(binding.key);
  if (bindingId === undefined) {
    return undefined;
  }
  const term = freezeDraftLayoutTermReference(binding.term, lookups.layoutTermLookup);
  if (term === undefined) {
    return undefined;
  }
  return {
    bindingId,
    term,
    value,
    ...(binding.sourcePlaceKey === undefined
      ? {}
      : { sourcePlace: resolvePlaceId(lookups, binding.sourcePlaceKey) }),
    origin,
  };
}

function freezeDraftLoanReference(
  lookups: FreezeDraftStatementLookups,
  input: {
    readonly loanKey: ProofMirCanonicalKey;
    readonly placeKey: ProofMirCanonicalKey;
    readonly mode: "shared" | "exclusive";
    readonly scopeKey: ProofMirCanonicalKey;
    readonly startOriginKey: ProofMirCanonicalKey;
    readonly endOriginKey?: ProofMirCanonicalKey;
  },
): ProofMirLoanReference | undefined {
  const loanId = lookups.loanLookup.resolve(input.loanKey);
  const placeId = resolvePlaceId(lookups, input.placeKey);
  const scopeId = resolveScopeId(lookups, input.scopeKey);
  const startOrigin = resolveOriginId(lookups, input.startOriginKey);
  const endOrigin =
    input.endOriginKey === undefined ? undefined : resolveOriginId(lookups, input.endOriginKey);
  if (
    loanId === undefined ||
    placeId === undefined ||
    scopeId === undefined ||
    startOrigin === undefined
  ) {
    return undefined;
  }
  return {
    loanId,
    mode: input.mode,
    placeId,
    scopeId,
    startOrigin,
    ...(endOrigin === undefined ? {} : { endOrigin }),
  };
}

function freezeDraftReleasedLoanReference(
  lookups: FreezeDraftStatementLookups,
  input: {
    readonly loanKey: ProofMirCanonicalKey;
    readonly endOriginKey?: ProofMirCanonicalKey;
  },
): ProofMirLoanReference | undefined {
  const loanRecord = lookups.loanRecordByKey.get(String(input.loanKey));
  if (loanRecord === undefined) {
    return undefined;
  }
  const endOriginKey = input.endOriginKey ?? loanRecord.endOriginKey;
  return freezeDraftLoanReference(lookups, {
    loanKey: input.loanKey,
    placeKey: loanRecord.placeKey,
    mode: loanRecord.mode,
    scopeKey: loanRecord.scopeKey,
    startOriginKey: loanRecord.startOriginKey,
    ...(endOriginKey === undefined ? {} : { endOriginKey }),
  });
}

export function freezeDraftStatementKind(
  lookups: FreezeDraftStatementLookups,
  kind: DraftProofMirStatementKind,
): ProofMirStatementKind | undefined {
  switch (kind.kind) {
    case "load": {
      const place = resolvePlaceId(lookups, kind.placeKey);
      const result = resolveValueId(lookups, kind.resultKey);
      if (place === undefined || result === undefined) {
        return undefined;
      }
      return { kind: "load", place, result };
    }
    case "store": {
      const place = resolvePlaceId(lookups, kind.placeKey);
      const value = resolveValueId(lookups, kind.valueKey);
      if (place === undefined || value === undefined) {
        return undefined;
      }
      return { kind: "store", place, value };
    }
    case "movePlace": {
      const place = resolvePlaceId(lookups, kind.placeKey);
      if (place === undefined) {
        return undefined;
      }
      return {
        kind: "movePlace",
        place,
        ...(kind.resultKey === undefined
          ? {}
          : { result: resolveValueId(lookups, kind.resultKey) }),
      };
    }
    case "consumePlace": {
      const place = resolvePlaceId(lookups, kind.placeKey);
      if (place === undefined) {
        return undefined;
      }
      return { kind: "consumePlace", place, reason: kind.reason };
    }
    case "borrowPlace": {
      const loan = freezeDraftLoanReference(lookups, kind);
      const place = resolvePlaceId(lookups, kind.placeKey);
      if (loan === undefined || place === undefined) {
        return undefined;
      }
      return { kind: "borrowPlace", place, loan };
    }
    case "releaseLoan": {
      const loan = freezeDraftReleasedLoanReference(lookups, {
        loanKey: kind.loanKey,
        endOriginKey: kind.endOriginKey,
      });
      if (loan === undefined) {
        return undefined;
      }
      return { kind: "releaseLoan", loan };
    }
    case "literal": {
      const value = resolveValueId(lookups, kind.valueKey);
      if (value === undefined) {
        return undefined;
      }
      return { kind: "literal", value, literal: kind.literal };
    }
    case "unary": {
      const operand = resolveValueId(lookups, kind.operandKey);
      const result = resolveValueId(lookups, kind.resultKey);
      if (operand === undefined || result === undefined) {
        return undefined;
      }
      return { kind: "unary", operator: kind.operator, operand, result };
    }
    case "binary": {
      const left = resolveValueId(lookups, kind.leftKey);
      const right = resolveValueId(lookups, kind.rightKey);
      const result = resolveValueId(lookups, kind.resultKey);
      if (left === undefined || right === undefined || result === undefined) {
        return undefined;
      }
      return { kind: "binary", operator: kind.operator, left, right, result };
    }
    case "comparison": {
      const left = resolveValueId(lookups, kind.leftKey);
      const right = resolveValueId(lookups, kind.rightKey);
      const result = resolveValueId(lookups, kind.resultKey);
      if (left === undefined || right === undefined || result === undefined) {
        return undefined;
      }
      return { kind: "comparison", operator: kind.operator, left, right, result };
    }
    case "constructObject": {
      const result = resolveValueId(lookups, kind.resultKey);
      if (result === undefined) {
        return undefined;
      }
      const fields = [];
      for (const field of kind.fields) {
        const value = resolveValueId(lookups, field.valueKey);
        const origin = resolveOriginId(lookups, field.originKey);
        if (value === undefined || origin === undefined) {
          return undefined;
        }
        fields.push({
          ...(field.fieldId === undefined ? {} : { fieldId: field.fieldId }),
          name: field.name,
          value,
          origin,
        });
      }
      return { kind: "constructObject", result, fields };
    }
    case "call": {
      const payload = lookups.callByKey.get(String(kind.callKey));
      if (payload === undefined) {
        return undefined;
      }
      return { kind: "call", call: payload.call };
    }
    case "validate": {
      const validation = freezeDraftValidationStart(lookups, kind.validation);
      if (validation === undefined) {
        return undefined;
      }
      return { kind: "validate", validation };
    }
    case "attempt": {
      const attempt = freezeDraftAttemptStart(lookups, kind.attempt);
      if (attempt === undefined) {
        return undefined;
      }
      return { kind: "attempt", attempt };
    }
    case "take": {
      const take = freezeDraftTakeStart(lookups, kind.take);
      if (take === undefined) {
        return undefined;
      }
      return { kind: "take", take };
    }
    case "openSessionMember": {
      const member = freezeDraftSessionMemberReference(lookups, kind.member);
      if (member === undefined) {
        return undefined;
      }
      return { kind: "openSessionMember", member };
    }
    case "closeSessionMember": {
      const member = freezeDraftSessionMemberReference(lookups, kind.member);
      if (member === undefined) {
        return undefined;
      }
      return { kind: "closeSessionMember", member };
    }
    case "openObligation": {
      const obligation = freezeDraftObligationReference(lookups, kind.obligation);
      if (obligation === undefined) {
        return undefined;
      }
      return { kind: "openObligation", obligation };
    }
    case "dischargeObligation": {
      const obligation = freezeDraftObligationReference(lookups, kind.obligation);
      if (obligation === undefined) {
        return undefined;
      }
      const evidence =
        kind.evidenceFactKey === undefined
          ? undefined
          : lookups.factLookup.resolve(kind.evidenceFactKey);
      return {
        kind: "dischargeObligation",
        obligation,
        ...(evidence === undefined ? {} : { evidence }),
      };
    }
    case "advancePrivateState": {
      const origin = resolveOriginId(lookups, kind.originKey);
      if (origin === undefined) {
        return undefined;
      }
      const transition: ProofMirPrivateStateTransitionReference = {
        transitionId: kind.transitionId,
        origin,
      };
      return { kind: "advancePrivateState", transition };
    }
    case "bindLayoutTerm": {
      const binding = freezeDraftLayoutTermBinding(lookups, kind.binding);
      if (binding === undefined) {
        return undefined;
      }
      return { kind: "bindLayoutTerm", binding };
    }
    case "recordFactEvidence": {
      const fact = lookups.factLookup.resolve(kind.factKey);
      if (fact === undefined) {
        return undefined;
      }
      return { kind: "recordFactEvidence", factId: fact };
    }
    case "requireFact": {
      const fact = lookups.factLookup.resolve(kind.factKey);
      if (fact === undefined) {
        return undefined;
      }
      return { kind: "requireFact", factId: fact };
    }
    case "readValidatedBufferField": {
      const read = freezeDraftValidatedBufferRead(lookups, kind.read);
      if (read === undefined) {
        return undefined;
      }
      return { kind: "readValidatedBufferField", read };
    }
    case "extension":
      return { kind: "extension", extension: kind.extension };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function buildCallByKeyLookup(input: {
  readonly callRecords: readonly DraftProofMirCallRecord[];
  readonly resolveOrigin: (key: ProofMirCanonicalKey) => ProofMirOriginId | undefined;
  readonly lookups: FreezeDraftStatementLookups;
  readonly diagnostics: ProofMirDiagnostic[];
  readonly functionInstanceId: MonoInstanceId;
  readonly ownerKey: string;
}): Map<string, DraftProofMirCallFreezePayload> {
  const callByKey = new Map<string, DraftProofMirCallFreezePayload>();
  for (const record of input.callRecords) {
    const origin = input.resolveOrigin(record.originKey);
    if (origin === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
          message: "Proof MIR freeze could not resolve a draft call origin.",
          functionInstanceId: input.functionInstanceId,
          ownerKey: input.ownerKey,
          rootCauseKey: "call-origin",
          stableDetail: String(record.key),
        }),
      );
      continue;
    }
    const receiver =
      record.receiver === undefined
        ? undefined
        : freezeDraftCallReceiver(input.lookups, record.receiver);
    if (record.receiver !== undefined && receiver === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_CALL_OPERAND",
          message: "Proof MIR freeze could not resolve a draft call receiver operand.",
          functionInstanceId: input.functionInstanceId,
          ownerKey: input.ownerKey,
          rootCauseKey: "call-receiver",
          stableDetail: String(record.key),
        }),
      );
      continue;
    }
    const frozenArguments: ProofMirCallArgument[] = [];
    let argumentsFailed = false;
    for (const argument of record.arguments) {
      const frozenArgument = freezeDraftCallArgument(input.lookups, argument);
      if (frozenArgument === undefined) {
        argumentsFailed = true;
        break;
      }
      frozenArguments.push(frozenArgument);
    }
    if (argumentsFailed) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_CALL_OPERAND",
          message: "Proof MIR freeze could not resolve a draft call argument operand.",
          functionInstanceId: input.functionInstanceId,
          ownerKey: input.ownerKey,
          rootCauseKey: "call-argument",
          stableDetail: String(record.key),
        }),
      );
      continue;
    }
    const result =
      record.result === undefined
        ? undefined
        : freezeDraftCallOperand(input.lookups, record.result);
    if (record.result !== undefined && result === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_CALL_OPERAND",
          message: "Proof MIR freeze could not resolve a draft call result operand.",
          functionInstanceId: input.functionInstanceId,
          ownerKey: input.ownerKey,
          rootCauseKey: "call-result",
          stableDetail: String(record.key),
        }),
      );
      continue;
    }
    callByKey.set(String(record.key), {
      callKey: record.key,
      call: {
        callId: record.callId,
        target: record.target,
        ...(receiver === undefined ? {} : { receiver }),
        arguments: frozenArguments,
        requirements: record.requirements,
        ...(result === undefined ? {} : { result }),
        origin,
      },
    });
  }
  return callByKey;
}

export function freezeDraftGraphStatement(
  lookups: FreezeDraftStatementLookups,
  snapshot: DraftProofMirGraphStatementSnapshot,
): ProofMirStatement | undefined {
  const statementId = lookups.statementLookup.resolve(snapshot.statementKey);
  const origin = resolveOriginId(lookups, snapshot.originKey);
  const frozenKind = freezeDraftStatementKind(lookups, snapshot.kind);
  if (statementId === undefined || origin === undefined || frozenKind === undefined) {
    return undefined;
  }
  return {
    statementId,
    kind: frozenKind,
    origin,
  };
}
