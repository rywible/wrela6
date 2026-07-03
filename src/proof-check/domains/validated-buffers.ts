import { stableNumericSeed } from "../stable-numeric-seed";
import type {
  LayoutDerivedCaseFact,
  LayoutFactProgram,
  LayoutValidatedBufferDerivedFact,
} from "../../layout/layout-program";
import type { FieldId } from "../../semantic/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { proofCheckPacketFactId } from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";
import {
  checkedFactKindId,
  layoutFactKey,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import {
  proofMirOriginId,
  type ProofMirControlEdgeId,
  type ProofMirPlaceId,
} from "../../proof-mir/ids";
import { buildProofCheckFactEnvironment } from "./facts";
import type { ProofCheckFactEnvironment } from "../model/fact-environment";
import {
  proofCheckPlaceBinderKey,
  syntheticBinderId,
  type ProofCheckFactTerm,
  type ProofCheckLayoutFitsTerm,
  type ProofCheckOperandTerm,
  type ProofCheckPayloadEndTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import type { ProofCheckState } from "../kernel/state";
import {
  layoutEntailmentCertificatesForRequirements,
  proveLayoutEntailment,
  type LayoutEntailmentCertificate,
} from "./layout-entailment";

export interface ValidatedBufferReadRequirementInput {
  readonly source: ProofCheckPlaceBinder;
  readonly end: ProofCheckOperandTerm;
  readonly fieldId: FieldId;
  readonly isDynamicPayload: boolean;
  readonly requiresPacketSource?: boolean;
  readonly packet?: ProofCheckPlaceBinder;
  readonly readRequirements: readonly ProofCheckRequirementTerm[];
}

export interface DerivedFieldReadRequirementInput {
  readonly source: ProofCheckPlaceBinder;
  readonly packet?: ProofCheckPlaceBinder;
  readonly derivedFieldId: FieldId;
  readonly sourceFieldId: FieldId;
  readonly deriveEntry?: LayoutValidatedBufferDerivedFact;
  readonly sourceFieldReadCertificate?: LayoutEntailmentCertificate;
}

export type CheckValidatedBufferReadRequirementResult =
  | {
      readonly kind: "ok";
      readonly certificates: readonly LayoutEntailmentCertificate[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface CheckValidatedBufferReadRequirementInput {
  readonly state: ProofCheckState;
  readonly read: ValidatedBufferReadRequirementInput;
  readonly factTerms?: readonly ProofCheckFactTerm[];
  readonly layoutProgram?: LayoutFactProgram;
  readonly ownerKey?: string;
}

export interface CheckDerivedFieldReadRequirementInput {
  readonly state: ProofCheckState;
  readonly read: DerivedFieldReadRequirementInput;
  readonly factTerms?: readonly ProofCheckFactTerm[];
  readonly ownerKey?: string;
}

function defaultOwnerKey(ownerKey: string | undefined): string {
  return ownerKey ?? "proof-check:validated-buffer";
}

function syntheticSourceBinder(sourceName: string): ProofCheckPlaceBinder {
  return { kind: "synthetic", id: syntheticBinderId(sourceName) };
}

function syntheticEndOperand(endName: string): ProofCheckOperandTerm {
  return {
    kind: "value",
    value: { kind: "synthetic", id: syntheticBinderId(endName) },
  };
}

function layoutFitsTerm(sourceName: string, endName: string): ProofCheckLayoutFitsTerm {
  return {
    kind: "layoutFits",
    source: syntheticSourceBinder(sourceName),
    end: syntheticEndOperand(endName),
  };
}

function payloadEndTerm(sourceName: string, endName: string): ProofCheckPayloadEndTerm {
  return {
    kind: "payloadEnd",
    source: syntheticSourceBinder(sourceName),
    end: syntheticEndOperand(endName),
  };
}

function buildEnvironment(
  state: ProofCheckState,
  factTerms: readonly ProofCheckFactTerm[] | undefined,
  ownerKey: string,
): ProofCheckFactEnvironment {
  return buildProofCheckFactEnvironment({
    terms: factTerms ?? [],
    state,
    ownerKey,
  });
}

function hasActivePacketSource(
  state: ProofCheckState,
  packetKey: string,
  sourceKey: string,
): boolean {
  if (packetKey === sourceKey && state.layout.has(sourceKey)) {
    return true;
  }
  for (const packetSource of state.packetSources.values()) {
    if (packetSource.packetKey === packetKey && packetSource.sourceKey === sourceKey) {
      return true;
    }
  }
  return false;
}

function missingLayoutEntailmentDiagnostic(input: {
  readonly detail: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT",
    messageTemplateId: "proof-check.validated-buffer.missing-layout-entailment",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function deriveTableIsExhaustive(entry: LayoutValidatedBufferDerivedFact): boolean {
  return entry.cases.some((caseFact) => caseFact.condition.kind === "otherwise");
}

function deriveCasesAreDeterministic(entry: LayoutValidatedBufferDerivedFact): boolean {
  const conditionKeys = entry.cases
    .filter((caseFact) => caseFact.condition.kind === "equals")
    .map((caseFact) => deriveCaseConditionKey(caseFact));
  const uniqueKeys = new Set(conditionKeys);
  return uniqueKeys.size === conditionKeys.length;
}

function deriveCaseConditionKey(caseFact: LayoutDerivedCaseFact): string {
  if (caseFact.condition.kind === "otherwise") {
    return "otherwise";
  }
  return `equals:${caseFact.condition.value.kind}`;
}

function proveDynamicPayloadRequirements(
  environment: ProofCheckFactEnvironment,
  read: ValidatedBufferReadRequirementInput,
  ownerKey: string,
): CheckValidatedBufferReadRequirementResult {
  const certificates: LayoutEntailmentCertificate[] = [];
  const diagnostics: ProofCheckDiagnostic[] = [];

  const payloadEndFromRead = read.readRequirements.find(
    (requirement) => requirement.kind === "payloadEnd",
  );
  const layoutFitsFromRead = read.readRequirements.find(
    (requirement) => requirement.kind === "layoutFits",
  );

  const requirementsToProve: ProofCheckRequirementTerm[] = [];
  if (layoutFitsFromRead !== undefined) {
    requirementsToProve.push(layoutFitsFromRead);
  }
  if (payloadEndFromRead !== undefined) {
    requirementsToProve.push(payloadEndFromRead);
  }

  for (const requirement of requirementsToProve) {
    const result = proveLayoutEntailment(environment, requirement, { ownerKey });
    if (result.kind === "ok") {
      certificates.push(result.certificate);
      continue;
    }
    diagnostics.push(...result.diagnostics);
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortProofCheckDiagnostics(diagnostics) };
  }

  const hasPayloadEnd = certificates.some((certificate) =>
    certificate.normalizedTermKey.startsWith("payloadEnd:"),
  );
  const hasLayoutFits = certificates.some((certificate) =>
    certificate.normalizedTermKey.startsWith("layoutFits:"),
  );

  if (!hasPayloadEnd || !hasLayoutFits) {
    return {
      kind: "error",
      diagnostics: [
        missingLayoutEntailmentDiagnostic({
          detail: `missing-dynamic-payload-facts:payloadEnd=${String(hasPayloadEnd)}:layoutFits=${String(hasLayoutFits)}`,
          ownerKey,
          rootCauseKey: `payload-read:${String(read.fieldId)}`,
        }),
      ],
    };
  }

  return { kind: "ok", certificates };
}

export function checkValidatedBufferReadRequirement(
  input: CheckValidatedBufferReadRequirementInput,
): CheckValidatedBufferReadRequirementResult {
  const ownerKey = defaultOwnerKey(input.ownerKey);
  const environment = buildEnvironment(input.state, input.factTerms, ownerKey);
  const certificates: LayoutEntailmentCertificate[] = [];
  const diagnostics: ProofCheckDiagnostic[] = [];

  if (input.read.requiresPacketSource === true) {
    const packet = input.read.packet ?? input.read.source;
    const packetKey = proofCheckPlaceBinderKey(packet);
    const sourceKey = proofCheckPlaceBinderKey(input.read.source);
    if (!hasActivePacketSource(input.state, packetKey, sourceKey)) {
      diagnostics.push(
        missingLayoutEntailmentDiagnostic({
          detail: `missing-packet-source:${packetKey}->${sourceKey}`,
          ownerKey,
          rootCauseKey: `packet-source:${packetKey}`,
        }),
      );
    }
  }

  if (input.read.isDynamicPayload) {
    const dynamicResult = proveDynamicPayloadRequirements(environment, input.read, ownerKey);
    if (dynamicResult.kind === "error") {
      diagnostics.push(...dynamicResult.diagnostics);
    } else {
      certificates.push(...dynamicResult.certificates);
    }
  } else {
    const fixedRequirements = input.read.readRequirements.filter(
      (requirement) => requirement.kind !== "payloadEnd",
    );
    const fixedResult = layoutEntailmentCertificatesForRequirements(
      environment,
      fixedRequirements,
      { ownerKey },
    );
    if (fixedResult.kind === "missing") {
      diagnostics.push(...fixedResult.diagnostics);
    } else {
      certificates.push(...fixedResult.certificates);
    }
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortProofCheckDiagnostics(diagnostics) };
  }

  return { kind: "ok", certificates };
}

export function checkDerivedFieldReadRequirement(
  input: CheckDerivedFieldReadRequirementInput,
): CheckValidatedBufferReadRequirementResult {
  const ownerKey = defaultOwnerKey(input.ownerKey);
  const diagnostics: ProofCheckDiagnostic[] = [];

  if (input.read.deriveEntry === undefined) {
    diagnostics.push(
      missingLayoutEntailmentDiagnostic({
        detail: `missing-derive-table-entry:${String(input.read.derivedFieldId)}`,
        ownerKey,
        rootCauseKey: `derive:${String(input.read.derivedFieldId)}`,
      }),
    );
  } else {
    if (!deriveTableIsExhaustive(input.read.deriveEntry)) {
      diagnostics.push(
        missingLayoutEntailmentDiagnostic({
          detail: `non-exhaustive-derive-table:${String(input.read.derivedFieldId)}`,
          ownerKey,
          rootCauseKey: `derive:${String(input.read.derivedFieldId)}`,
        }),
      );
    }
    if (!deriveCasesAreDeterministic(input.read.deriveEntry)) {
      diagnostics.push(
        missingLayoutEntailmentDiagnostic({
          detail: `non-deterministic-derive-table:${String(input.read.derivedFieldId)}`,
          ownerKey,
          rootCauseKey: `derive:${String(input.read.derivedFieldId)}`,
        }),
      );
    }
  }

  if (input.read.sourceFieldReadCertificate === undefined) {
    diagnostics.push(
      missingLayoutEntailmentDiagnostic({
        detail: `missing-source-field-read-certificate:${String(input.read.sourceFieldId)}`,
        ownerKey,
        rootCauseKey: `source-field:${String(input.read.sourceFieldId)}`,
      }),
    );
  }

  if (input.read.packet !== undefined) {
    const packetKey = proofCheckPlaceBinderKey(input.read.packet);
    const sourceKey = proofCheckPlaceBinderKey(input.read.source);
    if (!hasActivePacketSource(input.state, packetKey, sourceKey)) {
      diagnostics.push(
        missingLayoutEntailmentDiagnostic({
          detail: `missing-packet-source:${packetKey}->${sourceKey}`,
          ownerKey,
          rootCauseKey: `packet-source:${packetKey}`,
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortProofCheckDiagnostics(diagnostics) };
  }

  const certificates: LayoutEntailmentCertificate[] = [];
  if (input.read.sourceFieldReadCertificate !== undefined) {
    certificates.push(input.read.sourceFieldReadCertificate);
  }

  return { kind: "ok", certificates };
}

export function layoutFitsFactForTest(
  sourceName: string,
  endName: string,
): ProofCheckLayoutFitsTerm {
  return layoutFitsTerm(sourceName, endName);
}

export function payloadEndFactForTest(
  sourceName: string,
  endName: string,
): ProofCheckPayloadEndTerm {
  return payloadEndTerm(sourceName, endName);
}

export function payloadReadForTest(input: {
  readonly source: string;
  readonly end: string;
  readonly fieldId?: FieldId;
}): ValidatedBufferReadRequirementInput {
  return {
    source: syntheticSourceBinder(input.source),
    end: syntheticEndOperand(input.end),
    fieldId: input.fieldId ?? (1 as FieldId),
    isDynamicPayload: true,
    readRequirements: [
      layoutFitsTerm(input.source, input.end),
      payloadEndTerm(input.source, input.end),
    ],
  };
}

export function fixedFieldReadForTest(input: {
  readonly source: string;
  readonly end: string;
  readonly fieldId?: FieldId;
}): ValidatedBufferReadRequirementInput {
  return {
    source: syntheticSourceBinder(input.source),
    end: syntheticEndOperand(input.end),
    fieldId: input.fieldId ?? (1 as FieldId),
    isDynamicPayload: false,
    readRequirements: [layoutFitsTerm(input.source, input.end)],
  };
}

export function sortedLayoutEntailmentCertificateKeys(
  certificates: readonly LayoutEntailmentCertificate[],
): readonly string[] {
  return [...certificates]
    .map((certificate) => certificate.normalizedTermKey)
    .sort(compareCodeUnitStrings);
}

function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
}

function originForValidatedBufferRead(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function coreCertificateForLayoutRead(
  certificate: LayoutEntailmentCertificate,
): ProofCheckCertificateId {
  return {
    kind: "core",
    id: certificate.certificate.certificateId,
  };
}

export function validatedBufferPacketEntriesForRead(input: {
  readonly certificates: readonly LayoutEntailmentCertificate[];
  readonly validatedBufferInstanceId: string;
  readonly placeId: ProofMirPlaceId;
  readonly edgeIds: readonly ProofMirControlEdgeId[];
  readonly operationOriginKey: string;
}): readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
  const layoutKey = String(input.validatedBufferInstanceId);
  const subjectKey = `validated-buffer:${layoutKey}:${String(input.placeId)}`;
  return input.certificates.map((certificate, index) => ({
    factId: proofCheckPacketFactId(
      stableNumericSeed(`validatedBuffer:${subjectKey}:${certificate.normalizedTermKey}:${index}`),
    ),
    kind: checkedFactKindId("validatedBuffer"),
    subject: { kind: "place", placeId: input.placeId },
    scope: defaultScope(),
    dependencies: [
      ...[...input.edgeIds]
        .sort((left, right) => compareCodeUnitStrings(String(left), String(right)))
        .map((edgeId) => ({ kind: "proofMirEdge" as const, edgeId })),
      { kind: "layoutFact", layoutKey: layoutFactKey(layoutKey) },
      {
        kind: "coreCertificate",
        certificateId: certificate.certificate.certificateId,
      },
    ],
    invalidatedBy: [{ kind: "abiRewrite", layoutKey: layoutFactKey(layoutKey) }],
    certificate: coreCertificateForLayoutRead(certificate),
    origin: originForValidatedBufferRead(input.operationOriginKey),
  }));
}
