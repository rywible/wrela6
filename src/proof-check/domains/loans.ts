import { stableNumericSeed } from "../stable-numeric-seed";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofMirOriginId } from "../../proof-mir/ids";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import {
  type CheckedLoanState,
  type ProofCheckState,
  type ProofCheckStructuredPlace,
} from "../kernel/state";
import { compareProofCheckPlaces, type ProofCheckPlaceRelation } from "./ownership";
import {
  proofMirPlaceIdForPlaceKey,
  type ProofCheckPlaceResolver,
} from "../kernel/registry/transition-helpers";

function structuredPlace(placeKey: string): ProofCheckStructuredPlace {
  return { placeKey };
}

export type ProofCheckLoanConflict =
  | { readonly kind: "samePlace"; readonly loanKey: string }
  | { readonly kind: "ancestor"; readonly loanKey: string }
  | { readonly kind: "descendant"; readonly loanKey: string };

export type ProofCheckLoanOperation =
  | { readonly kind: "observe" }
  | { readonly kind: "mutate" }
  | { readonly kind: "consume" }
  | { readonly kind: "open"; readonly mode: "shared" | "exclusive" };

export type ProofCheckLoanTransferResult =
  | {
      readonly kind: "ok";
      readonly patches: readonly ProofCheckStatePatchEntry[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface ProofCheckLoanPlaceInput {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface ProofCheckOpenLoanInput {
  readonly state: ProofCheckState;
  readonly loan: CheckedLoanState;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface ProofCheckCloseLoanInput {
  readonly state: ProofCheckState;
  readonly loanKey: string;
  readonly operationOriginKey: string;
}

export interface ProofCheckReturnWithLoansInput {
  readonly state: ProofCheckState;
  readonly operationOriginKey: string;
}

function loanConflictKind(
  relation: ProofCheckPlaceRelation,
): ProofCheckLoanConflict["kind"] | undefined {
  switch (relation.kind) {
    case "same":
      return "samePlace";
    case "ancestor":
      return "ancestor";
    case "descendant":
      return "descendant";
    case "disjointField":
    case "unrelatedRoot":
      return undefined;
    case "overlappingSibling":
      return "samePlace";
  }
}

function operationConflictsWithLoanMode(
  operation: ProofCheckLoanOperation,
  loanMode: "shared" | "exclusive",
): boolean {
  switch (operation.kind) {
    case "observe":
      return loanMode === "exclusive";
    case "mutate":
    case "consume":
      return true;
    case "open":
      if (operation.mode === "exclusive") {
        return true;
      }
      return loanMode === "exclusive";
  }
}

function placeRelationConflicts(
  operation: ProofCheckLoanOperation,
  relation: ProofCheckPlaceRelation,
  loanMode: "shared" | "exclusive",
): boolean {
  if (relation.kind === "disjointField" || relation.kind === "unrelatedRoot") {
    return false;
  }
  return operationConflictsWithLoanMode(operation, loanMode);
}

export function findLoanConflict(input: {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly operation: ProofCheckLoanOperation;
}): ProofCheckLoanConflict | undefined {
  const sortedLoans = [...input.state.loans.values()].sort((left, right) =>
    compareCodeUnitStrings(left.loanKey, right.loanKey),
  );

  for (const loan of sortedLoans) {
    const relation = compareProofCheckPlaces(input.place, structuredPlace(loan.placeKey));
    if (!placeRelationConflicts(input.operation, relation, loan.mode)) {
      continue;
    }
    const conflictKind = loanConflictKind(relation);
    if (conflictKind === undefined) {
      continue;
    }
    return { kind: conflictKind, loanKey: loan.loanKey };
  }

  return undefined;
}

function loanDisjointnessCertificate(subjectKey: string): ProofCheckCoreCertificate {
  return {
    certificateId: proofCheckCoreCertificateId(stableNumericSeed(`cert:${subjectKey}`)),
    rule: "loanDisjointness",
    subjectKey,
    dependencyKeys: [],
  };
}

function defaultCertificate(subjectKey: string): ProofCheckCertificateId {
  return {
    kind: "core",
    id: loanDisjointnessCertificate(subjectKey).certificateId,
  };
}

function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
}

function originForLoanFact(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function buildDisjointPacketEntries(input: {
  readonly place: ProofCheckStructuredPlace;
  readonly state: ProofCheckState;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
  const entries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];
  const sortedLoans = [...input.state.loans.values()].sort((left, right) =>
    compareCodeUnitStrings(left.loanKey, right.loanKey),
  );

  for (const loan of sortedLoans) {
    const loanPlace = structuredPlace(loan.placeKey);
    const relation = compareProofCheckPlaces(input.place, loanPlace);
    if (relation.kind !== "disjointField") {
      continue;
    }

    const subjectKey = `${input.place.placeKey}|${loan.placeKey}`;
    const leftPlaceId = proofMirPlaceIdForPlaceKey(input.place.placeKey, input.placeResolver);
    const rightPlaceId = proofMirPlaceIdForPlaceKey(loan.placeKey, input.placeResolver);
    const certificate = defaultCertificate(subjectKey);
    const origin = originForLoanFact(input.operationOriginKey);

    entries.push({
      factId: proofCheckPacketFactId(stableNumericSeed(`fieldDisjointness:${subjectKey}`)),
      kind: checkedFactKindId("fieldDisjointness"),
      subject: { kind: "place", placeId: leftPlaceId },
      scope: defaultScope(),
      dependencies: [
        { kind: "proofMirPlace", placeId: leftPlaceId },
        { kind: "proofMirPlace", placeId: rightPlaceId },
      ],
      invalidatedBy: [
        { kind: "loanConflict", placeId: leftPlaceId },
        { kind: "loanConflict", placeId: rightPlaceId },
      ],
      certificate,
      origin,
    });

    entries.push({
      factId: proofCheckPacketFactId(stableNumericSeed(`noalias:${subjectKey}`)),
      kind: checkedFactKindId("noalias"),
      subject: { kind: "place", placeId: leftPlaceId },
      scope: defaultScope(),
      dependencies: [
        { kind: "proofMirPlace", placeId: leftPlaceId },
        { kind: "proofMirPlace", placeId: rightPlaceId },
      ],
      invalidatedBy: [
        { kind: "loanConflict", placeId: leftPlaceId },
        { kind: "loanConflict", placeId: rightPlaceId },
      ],
      certificate,
      origin,
    });
  }

  return entries.sort((left, right) => {
    const kindCmp = compareCodeUnitStrings(left.kind, right.kind);
    if (kindCmp !== 0) {
      return kindCmp;
    }
    return compareCodeUnitStrings(String(left.factId), String(right.factId));
  });
}

function conflictingLoanDiagnostic(input: {
  readonly operation: ProofCheckLoanOperation["kind"] | "open";
  readonly operationOriginKey: string;
  readonly place: ProofCheckStructuredPlace;
  readonly conflict: ProofCheckLoanConflict;
  readonly conflictingLoan: CheckedLoanState;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_CONFLICTING_LOAN",
    messageTemplateId: "loan.conflicting",
    messageArguments: [
      { kind: "text", value: input.place.placeKey },
      { kind: "text", value: input.conflictingLoan.loanKey },
    ],
    message: `Conflicting loan while ${input.operation} ${input.place.placeKey} with ${input.conflictingLoan.loanKey}`,
    ownerKey: input.operationOriginKey,
    rootCauseKey: input.conflictingLoan.loanKey,
    stableDetail: `operation:${input.operation}:place:${input.place.placeKey}:conflict:${input.conflict.kind}:loan:${input.conflictingLoan.loanKey}`,
  });
}

function loanConflictError(input: {
  readonly operation: ProofCheckLoanOperation;
  readonly operationOriginKey: string;
  readonly place: ProofCheckStructuredPlace;
  readonly state: ProofCheckState;
}): ProofCheckLoanTransferResult {
  const conflict = findLoanConflict({
    state: input.state,
    place: input.place,
    operation: input.operation,
  });
  if (conflict === undefined) {
    return { kind: "ok", patches: [], packetEntries: [] };
  }
  const conflictingLoan = input.state.loans.get(conflict.loanKey);
  if (conflictingLoan === undefined) {
    return { kind: "ok", patches: [], packetEntries: [] };
  }
  return {
    kind: "error",
    diagnostics: [
      conflictingLoanDiagnostic({
        operation: input.operation.kind,
        operationOriginKey: input.operationOriginKey,
        place: input.place,
        conflict,
        conflictingLoan,
      }),
    ],
  };
}

function okLoanTransfer(input: {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly operationOriginKey: string;
  readonly patches?: readonly ProofCheckStatePatchEntry[];
  readonly placeResolver?: ProofCheckPlaceResolver;
}): ProofCheckLoanTransferResult {
  return {
    kind: "ok",
    patches: input.patches ?? [],
    packetEntries: buildDisjointPacketEntries({
      place: input.place,
      state: input.state,
      operationOriginKey: input.operationOriginKey,
      placeResolver: input.placeResolver,
    }),
  };
}

export function checkUseWithLoans(
  input: Omit<ProofCheckLoanPlaceInput, "operationOriginKey"> &
    Partial<Pick<ProofCheckLoanPlaceInput, "operationOriginKey">>,
): ProofCheckLoanTransferResult {
  const operationOriginKey = input.operationOriginKey ?? "operation:observe";
  const conflictResult = loanConflictError({
    state: input.state,
    place: input.place,
    operation: { kind: "observe" },
    operationOriginKey,
  });
  if (conflictResult.kind === "error") {
    return conflictResult;
  }
  return okLoanTransfer({
    state: input.state,
    place: input.place,
    operationOriginKey,
    placeResolver: input.placeResolver,
  });
}

export function checkMutateWithLoans(
  input: ProofCheckLoanPlaceInput,
): ProofCheckLoanTransferResult {
  const conflictResult = loanConflictError({
    state: input.state,
    place: input.place,
    operation: { kind: "mutate" },
    operationOriginKey: input.operationOriginKey,
  });
  if (conflictResult.kind === "error") {
    return conflictResult;
  }
  return okLoanTransfer({
    state: input.state,
    place: input.place,
    operationOriginKey: input.operationOriginKey,
    placeResolver: input.placeResolver,
  });
}

export function checkConsumeWithLoans(
  input: ProofCheckLoanPlaceInput,
): ProofCheckLoanTransferResult {
  const conflictResult = loanConflictError({
    state: input.state,
    place: input.place,
    operation: { kind: "consume" },
    operationOriginKey: input.operationOriginKey,
  });
  if (conflictResult.kind === "error") {
    return conflictResult;
  }
  return okLoanTransfer({
    state: input.state,
    place: input.place,
    operationOriginKey: input.operationOriginKey,
    placeResolver: input.placeResolver,
  });
}

export function openLoan(input: ProofCheckOpenLoanInput): ProofCheckLoanTransferResult {
  if (input.state.loans.has(input.loan.loanKey)) {
    return {
      kind: "error",
      diagnostics: [
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_CONFLICTING_LOAN",
          messageTemplateId: "loan.duplicate",
          messageArguments: [{ kind: "text", value: input.loan.loanKey }],
          message: `Loan ${input.loan.loanKey} is already active`,
          ownerKey: input.operationOriginKey,
          rootCauseKey: input.loan.loanKey,
          stableDetail: `operation:open:loan:${input.loan.loanKey}:duplicate`,
        }),
      ],
    };
  }

  const conflictResult = loanConflictError({
    state: input.state,
    place: structuredPlace(input.loan.placeKey),
    operation: { kind: "open", mode: input.loan.mode },
    operationOriginKey: input.operationOriginKey,
  });
  if (conflictResult.kind === "error") {
    return conflictResult;
  }

  return {
    kind: "ok",
    patches: [
      {
        kind: "loan",
        action: "open",
        loan: input.loan,
      },
    ],
    packetEntries: buildDisjointPacketEntries({
      place: structuredPlace(input.loan.placeKey),
      state: input.state,
      operationOriginKey: input.operationOriginKey,
      placeResolver: input.placeResolver,
    }),
  };
}

export function closeLoan(input: ProofCheckCloseLoanInput): ProofCheckLoanTransferResult {
  const loan = input.state.loans.get(input.loanKey);
  if (loan === undefined) {
    return {
      kind: "error",
      diagnostics: [
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_CONFLICTING_LOAN",
          messageTemplateId: "loan.missing",
          messageArguments: [{ kind: "text", value: input.loanKey }],
          message: `Cannot close missing loan ${input.loanKey}`,
          ownerKey: input.operationOriginKey,
          rootCauseKey: input.loanKey,
          stableDetail: `operation:close:loan:${input.loanKey}:missing`,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    patches: [
      {
        kind: "loan",
        action: "close",
        loan,
      },
    ],
    packetEntries: [],
  };
}

export function checkReturnWithLoans(
  input: ProofCheckReturnWithLoansInput,
): ProofCheckLoanTransferResult {
  const sortedLoans = [...input.state.loans.values()].sort((left, right) =>
    compareCodeUnitStrings(left.loanKey, right.loanKey),
  );
  if (sortedLoans.length === 0) {
    return { kind: "ok", patches: [], packetEntries: [] };
  }

  return {
    kind: "error",
    diagnostics: sortedLoans.map((loan) =>
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_LEAKED_LOAN",
        messageTemplateId: "loan.leaked",
        messageArguments: [{ kind: "text", value: loan.loanKey }],
        message: `Return with live loan ${loan.loanKey}`,
        ownerKey: input.operationOriginKey,
        rootCauseKey: loan.loanKey,
        stableDetail: `operation:return:loan:${loan.loanKey}`,
      }),
    ),
  };
}
