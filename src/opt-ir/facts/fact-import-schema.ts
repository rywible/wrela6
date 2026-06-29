import type {
  CheckedFactDependency,
  CheckedFactKindId,
  CheckedFactPacket,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedPacketFactKind,
  LayoutFactKey,
} from "../../proof-check/model/fact-packet";
import { isKnownCheckedPacketFactKind } from "../../proof-check/model/fact-packet";
import type { CheckedOptIrHandoff } from "../../proof-check/model/opt-ir-handoff";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  ProofMirCallId,
  ProofMirControlEdgeId,
  ProofMirFactId,
  ProofMirOriginId,
  ProofMirPlaceId,
  ProofMirPrivateStateGenerationId,
  ProofMirValueId,
} from "../../proof-mir/ids";
import { factEntryReferencesLayout, layoutDependencyMissing } from "../layout-authority-policy";
import type { ProofAuthorityFingerprint } from "../../shared/proof-authority-types";

export type OptIrFactImportTypedAnswer =
  | "owns"
  | "mustNotAlias"
  | "fieldsDisjoint"
  | "erasureOf"
  | "provesInBounds"
  | "provesImpossible"
  | "privateStateGeneration"
  | "callEffects"
  | "volatilityOf"
  | "capabilityFlow"
  | "terminalBehavior"
  | "layoutOf"
  | "endianOfLayoutAccess"
  | "abiShape"
  | "provenanceContributor";

export type OptIrFactImportDiagnosticCode =
  | "OPT_IR_FACT_IMPORT_UNKNOWN_KIND"
  | "OPT_IR_FACT_IMPORT_WRONG_SUBJECT"
  | "OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY"
  | "OPT_IR_FACT_IMPORT_CERTIFICATE_MISMATCH"
  | "OPT_IR_FACT_IMPORT_STALE_SCOPE"
  | "OPT_IR_FACT_IMPORT_MISSING_PATH_DEPENDENCY"
  | "OPT_IR_FACT_IMPORT_MISSING_PROOF_MIR_NODE"
  | "OPT_IR_FACT_IMPORT_LAYOUT_MISMATCH";

export interface OptIrFactImportDiagnostic {
  readonly code: OptIrFactImportDiagnosticCode;
  readonly message: string;
  readonly stableDetail: string;
}

export interface CheckedFactImportSchema {
  readonly kind: CheckedPacketFactKind;
  readonly subjectKinds: readonly CheckedFactSubject["kind"][];
  readonly requiredDependencies: readonly CheckedFactDependency["kind"][];
  readonly certificateRule: "core" | "semantics";
  readonly typedAnswers: readonly OptIrFactImportTypedAnswer[];
}

export interface CheckedFactImportProofMirLookups {
  readonly places?: readonly ProofMirPlaceId[];
  readonly values?: readonly ProofMirValueId[];
  readonly edges?: readonly ProofMirControlEdgeId[];
  readonly callSubjects?: readonly {
    readonly functionInstanceId: MonoInstanceId;
    readonly callId: ProofMirCallId;
  }[];
  readonly facts?: readonly ProofMirFactId[];
  readonly origins?: readonly ProofMirOriginId[];
  readonly privateGenerations?: readonly ProofMirPrivateStateGenerationId[];
}

export interface CheckedFactImportLayoutFacts {
  readonly keys: readonly (LayoutFactKey | string)[];
  readonly fingerprint: ProofAuthorityFingerprint;
}

export interface CheckedFactImportValidationInput {
  readonly entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;
  readonly handoff: CheckedOptIrHandoff;
  readonly packet: CheckedFactPacket;
  readonly proofMirLookups: CheckedFactImportProofMirLookups;
  readonly layoutFacts: CheckedFactImportLayoutFacts;
}

export type CheckedFactImportValidationResult =
  | { readonly kind: "ok"; readonly typedAnswers: readonly OptIrFactImportTypedAnswer[] }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrFactImportDiagnostic[] };

const SCHEMAS = {
  ownership: {
    kind: "ownership",
    subjectKinds: ["place", "value"],
    requiredDependencies: ["proofMirPlace", "proofMirValue", "coreCertificate"],
    certificateRule: "core",
    typedAnswers: ["owns"],
  },
  noalias: {
    kind: "noalias",
    subjectKinds: ["place", "value", "edge"],
    requiredDependencies: ["proofMirPlace", "proofMirValue", "proofMirEdge", "coreCertificate"],
    certificateRule: "core",
    typedAnswers: ["mustNotAlias"],
  },
  fieldDisjointness: {
    kind: "fieldDisjointness",
    subjectKinds: ["place"],
    requiredDependencies: ["layoutFact", "proofMirPlace"],
    certificateRule: "core",
    typedAnswers: ["fieldsDisjoint"],
  },
  erasure: {
    kind: "erasure",
    subjectKinds: ["place", "value"],
    requiredDependencies: ["coreCertificate"],
    certificateRule: "core",
    typedAnswers: ["erasureOf"],
  },
  validatedBuffer: {
    kind: "validatedBuffer",
    subjectKinds: ["place", "value", "edge", "packetSource"],
    requiredDependencies: ["proofMirEdge", "layoutFact", "coreCertificate"],
    certificateRule: "core",
    typedAnswers: ["provesInBounds", "provesImpossible"],
  },
  packetSource: {
    kind: "packetSource",
    subjectKinds: ["packetSource"],
    requiredDependencies: ["proofMirPlace", "packetSource", "coreCertificate"],
    certificateRule: "core",
    typedAnswers: ["provesInBounds"],
  },
  privateState: {
    kind: "privateState",
    subjectKinds: ["privateState"],
    requiredDependencies: ["privateGeneration", "coreCertificate"],
    certificateRule: "core",
    typedAnswers: ["privateStateGeneration"],
  },
  platformEffect: {
    kind: "platformEffect",
    subjectKinds: ["call", "authority"],
    requiredDependencies: ["authorityEntry", "coreCertificate"],
    certificateRule: "core",
    typedAnswers: ["callEffects", "volatilityOf"],
  },
  capabilityFlow: {
    kind: "capabilityFlow",
    subjectKinds: ["call", "place", "authority"],
    requiredDependencies: ["authorityEntry", "proofMirCall"],
    certificateRule: "core",
    typedAnswers: ["capabilityFlow"],
  },
  terminalClosure: {
    kind: "terminalClosure",
    subjectKinds: ["terminal"],
    requiredDependencies: ["semanticsCertificate"],
    certificateRule: "semantics",
    typedAnswers: ["terminalBehavior", "provesImpossible"],
  },
  exitClosure: {
    kind: "exitClosure",
    subjectKinds: ["function", "block", "edge"],
    requiredDependencies: ["coreCertificate", "proofMirEdge"],
    certificateRule: "core",
    typedAnswers: ["terminalBehavior", "provesImpossible"],
  },
  layoutAbi: {
    kind: "layoutAbi",
    subjectKinds: ["layout"],
    requiredDependencies: ["layoutFact"],
    certificateRule: "core",
    typedAnswers: ["layoutOf", "endianOfLayoutAccess", "abiShape"],
  },
  origin: {
    kind: "origin",
    subjectKinds: ["mirOrigin"],
    requiredDependencies: ["proofMirFact"],
    certificateRule: "core",
    typedAnswers: ["provenanceContributor"],
  },
} as const satisfies Record<CheckedPacketFactKind, CheckedFactImportSchema>;

export function checkedFactImportSchemaForKind(kind: CheckedFactKindId): CheckedFactImportSchema {
  const factKind = String(kind);
  if (!isKnownCheckedPacketFactKind(factKind)) {
    throw new RangeError(`Unknown checked fact import schema kind: ${factKind}.`);
  }
  return SCHEMAS[factKind];
}

export function validateCheckedFactImportSchema(
  input: CheckedFactImportValidationInput,
): CheckedFactImportValidationResult {
  const factKind = String(input.entry.kind);
  if (!isKnownCheckedPacketFactKind(factKind)) {
    return error([
      diagnostic(
        "OPT_IR_FACT_IMPORT_UNKNOWN_KIND",
        "Checked fact import kind is not registered.",
        factKind,
      ),
    ]);
  }

  const schema = SCHEMAS[factKind];
  const diagnostics: OptIrFactImportDiagnostic[] = [];

  if (!(schema.subjectKinds as readonly string[]).includes(input.entry.subject.kind)) {
    diagnostics.push(
      diagnostic(
        "OPT_IR_FACT_IMPORT_WRONG_SUBJECT",
        "Checked fact subject does not match the import schema.",
        `${factKind}:${input.entry.subject.kind}`,
      ),
    );
  }

  for (const dependencyKind of schema.requiredDependencies) {
    if (!input.entry.dependencies.some((dependency) => dependency.kind === dependencyKind)) {
      diagnostics.push(
        diagnostic(
          "OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY",
          "Checked fact import is missing a required dependency.",
          `${factKind}:${dependencyKind}`,
        ),
      );
    }
  }

  const scope = input.entry.scope;
  if (scope.kind === "path") {
    const hasPathCertificate = input.handoff.pathCertificates.some(
      (certificate) => certificate.certificateId === scope.certificateId,
    );
    if (!hasPathCertificate) {
      diagnostics.push(
        diagnostic(
          "OPT_IR_FACT_IMPORT_STALE_SCOPE",
          "Checked fact import references a path certificate outside the handoff.",
          `${factKind}:${String(scope.certificateId)}`,
        ),
      );
    }
    if (!input.entry.dependencies.some((dependency) => dependency.kind === "proofMirEdge")) {
      diagnostics.push(
        diagnostic(
          "OPT_IR_FACT_IMPORT_MISSING_PATH_DEPENDENCY",
          "Path-scoped checked fact import requires a Proof MIR edge dependency.",
          `${factKind}:${String(scope.certificateId)}`,
        ),
      );
    }
  }

  if (input.entry.certificate.kind !== schema.certificateRule) {
    diagnostics.push(
      diagnostic(
        "OPT_IR_FACT_IMPORT_CERTIFICATE_MISMATCH",
        "Checked fact certificate kind does not match the import schema.",
        `${factKind}:${input.entry.certificate.kind}`,
      ),
    );
  }

  diagnostics.push(...validateDependencyReferences(input));
  diagnostics.push(...validateSubjectEvidenceDependencies(input));
  diagnostics.push(...validateSubjectReferences(input));
  diagnostics.push(...validateLayoutReferences(input));
  diagnostics.push(...validateLayoutFingerprint(input));
  diagnostics.push(...validateAuthorityReferences(input));

  return diagnostics.length === 0
    ? { kind: "ok", typedAnswers: schema.typedAnswers }
    : error(diagnostics);
}

function validateDependencyReferences(
  input: CheckedFactImportValidationInput,
): readonly OptIrFactImportDiagnostic[] {
  const diagnostics: OptIrFactImportDiagnostic[] = [];
  for (const dependency of input.entry.dependencies) {
    if (!dependencyExists(input, dependency)) {
      diagnostics.push(
        diagnostic(
          dependency.kind === "layoutFact"
            ? "OPT_IR_FACT_IMPORT_LAYOUT_MISMATCH"
            : "OPT_IR_FACT_IMPORT_MISSING_PROOF_MIR_NODE",
          "Checked fact import dependency does not resolve in its authenticated lookup table.",
          `${String(input.entry.kind)}:${dependency.kind}`,
        ),
      );
    }
  }
  return diagnostics;
}

function validateSubjectEvidenceDependencies(
  input: CheckedFactImportValidationInput,
): readonly OptIrFactImportDiagnostic[] {
  if (String(input.entry.kind) !== "erasure") {
    return [];
  }

  const subject = input.entry.subject;
  if (
    subject.kind === "place" &&
    !input.entry.dependencies.some(
      (dependency) => dependency.kind === "proofMirPlace" && dependency.placeId === subject.placeId,
    )
  ) {
    return [missingSubjectEvidenceDependency(input, "proofMirPlace")];
  }

  if (
    subject.kind === "value" &&
    !input.entry.dependencies.some(
      (dependency) => dependency.kind === "proofMirValue" && dependency.valueId === subject.valueId,
    )
  ) {
    return [missingSubjectEvidenceDependency(input, "proofMirValue")];
  }

  return [];
}

function validateSubjectReferences(
  input: CheckedFactImportValidationInput,
): readonly OptIrFactImportDiagnostic[] {
  const subject = input.entry.subject;
  switch (subject.kind) {
    case "place":
      return hasValue(input.proofMirLookups.places, subject.placeId)
        ? []
        : [missingProofMirSubject(input, "place")];
    case "value":
      return hasValue(input.proofMirLookups.values, subject.valueId)
        ? []
        : [missingProofMirSubject(input, "value")];
    case "edge":
      return hasValue(input.proofMirLookups.edges, subject.edgeId)
        ? []
        : [missingProofMirSubject(input, "edge")];
    case "call":
      return hasCallSubject(input.proofMirLookups, subject)
        ? []
        : [missingProofMirSubject(input, "call")];
    case "mirOrigin":
      return hasValue(input.proofMirLookups.origins, subject.proofMirOriginId)
        ? []
        : [missingProofMirSubject(input, "mirOrigin")];
    case "privateState":
      return hasValue(input.proofMirLookups.privateGenerations, subject.generation)
        ? []
        : [missingProofMirSubject(input, "privateState")];
    case "packetSource": {
      const hasPacket = hasValue(input.proofMirLookups.places, subject.packet);
      const hasSource = hasValue(input.proofMirLookups.places, subject.source);
      return hasPacket && hasSource ? [] : [missingProofMirSubject(input, "packetSource")];
    }
    case "layout":
      return hasValue(input.layoutFacts.keys, subject.layoutKey)
        ? []
        : [
            diagnostic(
              "OPT_IR_FACT_IMPORT_LAYOUT_MISMATCH",
              "Checked fact import layout subject does not resolve in authenticated layout facts.",
              `${String(input.entry.kind)}:${String(subject.layoutKey)}`,
            ),
          ];
    case "authority":
      return authorityAllowed(input, subject.fingerprint)
        ? []
        : [
            diagnostic(
              "OPT_IR_FACT_IMPORT_CERTIFICATE_MISMATCH",
              "Checked fact import authority fingerprint is not in the handoff attestation.",
              `${String(input.entry.kind)}:${subject.fingerprint.digestHex}`,
            ),
          ];
    case "function":
      return input.handoff.packetValidation.acceptedFunctionInstanceIds.includes(
        subject.functionInstanceId,
      )
        ? []
        : [missingProofMirSubject(input, "function")];
    case "block":
    case "terminal":
      return [];
  }
}

function validateLayoutFingerprint(
  input: CheckedFactImportValidationInput,
): readonly OptIrFactImportDiagnostic[] {
  if (
    !factEntryReferencesLayout(input.entry) ||
    authorityAllowed(input, input.layoutFacts.fingerprint)
  ) {
    return [];
  }
  return [
    diagnostic(
      "OPT_IR_FACT_IMPORT_LAYOUT_MISMATCH",
      "Checked fact import layout fingerprint is not in the handoff attestation.",
      `${String(input.entry.kind)}:${input.layoutFacts.fingerprint.digestHex}`,
    ),
  ];
}

function validateLayoutReferences(
  input: CheckedFactImportValidationInput,
): readonly OptIrFactImportDiagnostic[] {
  const authenticatedKeys = new Set(input.layoutFacts.keys.map(String));
  const missing = input.entry.dependencies.find((dependency) =>
    layoutDependencyMissing(dependency, authenticatedKeys),
  );
  if (missing === undefined) {
    return [];
  }
  return [
    diagnostic(
      "OPT_IR_FACT_IMPORT_LAYOUT_MISMATCH",
      "Checked fact import layout dependency does not match authenticated layout facts.",
      String(input.entry.kind),
    ),
  ];
}

function validateAuthorityReferences(
  input: CheckedFactImportValidationInput,
): readonly OptIrFactImportDiagnostic[] {
  const mismatched = input.entry.dependencies.find(
    (
      dependency,
    ): dependency is Extract<CheckedFactDependency, { readonly kind: "authorityEntry" }> =>
      dependency.kind === "authorityEntry" && !authorityAllowed(input, dependency.fingerprint),
  );
  if (mismatched === undefined) {
    return [];
  }
  return [
    diagnostic(
      "OPT_IR_FACT_IMPORT_CERTIFICATE_MISMATCH",
      "Checked fact import authority dependency is not in the handoff attestation.",
      `${String(input.entry.kind)}:${mismatched.fingerprint.digestHex}`,
    ),
  ];
}

function dependencyExists(
  input: CheckedFactImportValidationInput,
  dependency: CheckedFactDependency,
): boolean {
  switch (dependency.kind) {
    case "proofMirFact":
      return hasValue(input.proofMirLookups.facts, dependency.factId);
    case "proofMirPlace":
      return hasValue(input.proofMirLookups.places, dependency.placeId);
    case "proofMirValue":
      return hasValue(input.proofMirLookups.values, dependency.valueId);
    case "proofMirEdge":
      return hasValue(input.proofMirLookups.edges, dependency.edgeId);
    case "proofMirCall":
      return hasCallSubjectByCallId(input.proofMirLookups, dependency.callId);
    case "layoutFact":
      return hasValue(input.layoutFacts.keys, dependency.layoutKey);
    case "authorityEntry":
      return authorityAllowed(input, dependency.fingerprint);
    case "packetSource":
      return (
        hasValue(input.proofMirLookups.places, dependency.packet) &&
        hasValue(input.proofMirLookups.places, dependency.source)
      );
    case "privateGeneration":
      return hasValue(input.proofMirLookups.privateGenerations, dependency.generation);
    case "coreCertificate":
      return input.handoff.certificates.some(
        (certificate) =>
          !("kind" in certificate) && certificate.certificateId === dependency.certificateId,
      );
    case "semanticsCertificate":
      return input.handoff.packetValidation.terminalGraphCertificateId === dependency.certificateId;
    case "summaryInstantiation":
      return input.handoff.certificates.some(
        (certificate) =>
          "kind" in certificate &&
          certificate.kind === "summaryInstantiation" &&
          certificate.certificateId === dependency.certificateId,
      );
  }
}

function authorityAllowed(
  input: CheckedFactImportValidationInput,
  fingerprint: ProofAuthorityFingerprint,
): boolean {
  return input.handoff.packetValidation.authorityFingerprints.some(
    (candidate) =>
      candidate.authorityKind === fingerprint.authorityKind &&
      candidate.targetId === fingerprint.targetId &&
      candidate.version === fingerprint.version &&
      candidate.digestAlgorithm === fingerprint.digestAlgorithm &&
      candidate.digestHex === fingerprint.digestHex,
  );
}

function hasCallSubjectByCallId(
  lookups: CheckedFactImportProofMirLookups,
  callId: ProofMirCallId,
): boolean {
  return (lookups.callSubjects ?? []).some((call) => call.callId === callId);
}

function hasCallSubject(
  lookups: CheckedFactImportProofMirLookups,
  subject: Extract<CheckedFactSubject, { readonly kind: "call" }>,
): boolean {
  return (lookups.callSubjects ?? []).some(
    (call) =>
      call.callId === subject.callId && call.functionInstanceId === subject.functionInstanceId,
  );
}

function hasValue<Value>(values: readonly Value[] | undefined, value: Value): boolean {
  return values?.some((candidate) => candidate === value) ?? false;
}

function missingProofMirSubject(
  input: CheckedFactImportValidationInput,
  subjectKind: CheckedFactSubject["kind"],
): OptIrFactImportDiagnostic {
  return diagnostic(
    "OPT_IR_FACT_IMPORT_MISSING_PROOF_MIR_NODE",
    "Checked fact import subject does not resolve in Proof MIR.",
    `${String(input.entry.kind)}:${subjectKind}`,
  );
}

function missingSubjectEvidenceDependency(
  input: CheckedFactImportValidationInput,
  dependencyKind: CheckedFactDependency["kind"],
): OptIrFactImportDiagnostic {
  return diagnostic(
    "OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY",
    "Checked fact import subject is missing its required Proof MIR evidence dependency.",
    `${String(input.entry.kind)}:${dependencyKind}`,
  );
}

function diagnostic(
  code: OptIrFactImportDiagnosticCode,
  message: string,
  stableDetail: string,
): OptIrFactImportDiagnostic {
  return { code, message, stableDetail };
}

function error(
  diagnostics: readonly OptIrFactImportDiagnostic[],
): CheckedFactImportValidationResult {
  return {
    kind: "error",
    diagnostics: [...diagnostics].sort((left, right) =>
      `${left.code}:${left.stableDetail}`.localeCompare(`${right.code}:${right.stableDetail}`),
    ),
  };
}
