import type {
  CheckedFactInvalidation,
  CheckedFactPacket,
  CheckedFactPacketEntry,
  CheckedFactSubject,
  CheckedFactKindId,
} from "../proof-check/model/fact-packet";
import { checkedOptIrHandoffFingerprint } from "../proof-check/model/opt-ir-handoff";
import type {
  CheckedOptIrHandoff,
  CheckedPacketValidationAttestation,
} from "../proof-check/model/opt-ir-handoff";
import type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";
import type { InternalConstructOptIrInput } from "./internal-construction-api";
import {
  layoutDependencyKeys,
  optIrLayoutAuthorityPolicyFromHandoff,
} from "./layout-authority-policy";
import { stableJson } from "../shared/stable-json";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
  type OptIrDiagnosticCode,
} from "./diagnostics";

export type OptIrBoundaryValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

type FactEntry = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;

function stableJsonForDiagnostic(value: unknown): string {
  return stableJson(value);
}

function diagnostic(
  code: OptIrDiagnosticCode,
  ownerKey: string,
  rootCauseKey: string,
  messageTemplate: string,
  args: Readonly<Record<string, string | number | boolean>> = {},
): OptIrDiagnostic {
  const stableDetail = `${messageTemplate}:${stableJsonForDiagnostic(args)}`;
  return {
    severity: "error",
    code,
    messageTemplate,
    arguments: args,
    ownerKey,
    rootCauseKey,
    stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "opt-ir-boundary",
      functionKey: "whole-program",
      code,
      ownerKey,
      rootCauseKey,
      stableDetail,
    }),
  };
}

function inputContractDiagnostic(
  ownerKey: string,
  rootCauseKey: string,
  messageTemplate: string,
): OptIrDiagnostic {
  return diagnostic(
    optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID"),
    ownerKey,
    rootCauseKey,
    messageTemplate,
  );
}

function allFactEntries(facts: CheckedFactPacket): readonly FactEntry[] {
  return [
    ...facts.ownership,
    ...facts.noalias,
    ...facts.fieldDisjointness,
    ...facts.erasures,
    ...facts.validatedBuffers,
    ...facts.packetSources,
    ...facts.privateState,
    ...facts.platformEffects,
    ...facts.capabilityFlow,
    ...facts.terminalClosure,
    ...facts.exitClosure,
    ...facts.layoutAbi,
    ...facts.origins,
  ];
}

function fingerprintKey(fingerprint: ProofAuthorityFingerprint): string {
  return stableJsonForDiagnostic(fingerprint);
}

function sameFingerprint(
  left: ProofAuthorityFingerprint,
  right: ProofAuthorityFingerprint,
): boolean {
  return fingerprintKey(left) === fingerprintKey(right);
}

function validateRequiredArtifacts(input: InternalConstructOptIrInput): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const handoff = input.handoff as Partial<CheckedOptIrHandoff> | undefined;

  if (handoff === undefined) {
    return [
      inputContractDiagnostic("handoff", "handoff", "Missing checked OptIR handoff artifact."),
    ];
  }
  for (const [key, value] of [
    ["checkedMir", handoff.checkedMir],
    ["certificates", handoff.certificates],
    ["packetValidation", handoff.packetValidation],
    ["pathCertificates", handoff.pathCertificates],
    ["semanticInlinePolicies", handoff.semanticInlinePolicies],
    ["handoffFingerprint", handoff.handoffFingerprint],
  ] as const) {
    if (value === undefined || value === null) {
      diagnostics.push(
        inputContractDiagnostic("handoff", key, `Missing checked OptIR handoff ${key}.`),
      );
    }
  }

  if (input.layoutFacts?.facts === undefined || input.layoutFacts.fingerprint === undefined) {
    diagnostics.push(
      inputContractDiagnostic("layoutFacts", "layoutFacts", "Missing authenticated layout facts."),
    );
  }
  if (input.target === undefined) {
    diagnostics.push(inputContractDiagnostic("target", "target", "Missing OptIR target surface."));
  }

  return diagnostics;
}

function validateFunctionCertificates(handoff: CheckedOptIrHandoff): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const accepted = new Set(handoff.packetValidation.acceptedFunctionInstanceIds);

  for (const [functionInstanceId, checkedFunction] of handoff.checkedMir.checkedFunctions) {
    const ownerKey = `function:${String(functionInstanceId)}`;
    if (!accepted.has(functionInstanceId)) {
      diagnostics.push(
        inputContractDiagnostic(
          ownerKey,
          "packetValidation.acceptedFunctionInstanceIds",
          "Reachable checked function was not accepted by packet validation.",
        ),
      );
    }
    if (checkedFunction.entryStateCertificate === undefined) {
      diagnostics.push(
        inputContractDiagnostic(
          ownerKey,
          "entryStateCertificate",
          "Missing accepted function entry certificate.",
        ),
      );
    }
    if (checkedFunction.acceptedBlockStates.length === 0) {
      diagnostics.push(
        inputContractDiagnostic(
          ownerKey,
          "acceptedBlockStates",
          "Missing accepted block-state certificate.",
        ),
      );
    }
    if (checkedFunction.exitCertificates.length === 0) {
      diagnostics.push(
        inputContractDiagnostic(
          ownerKey,
          "exitCertificates",
          "Missing accepted function exit certificate.",
        ),
      );
    }
    if (checkedFunction.summaryCertificate === undefined) {
      diagnostics.push(
        inputContractDiagnostic(
          ownerKey,
          "summaryCertificate",
          "Missing accepted function summary certificate.",
        ),
      );
    }
  }

  return diagnostics;
}

function validatePacketAttestation(handoff: CheckedOptIrHandoff): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const packetValidation = handoff.packetValidation;
  const acceptedFunctionInstanceIds = [...handoff.checkedMir.checkedFunctions.keys()].sort();
  const summaryCertificateIds = [...handoff.checkedMir.checkedFunctions.values()]
    .map((checkedFunction) => checkedFunction.summaryCertificate)
    .sort((left, right) => left - right);

  const checks: readonly [keyof CheckedPacketValidationAttestation, unknown, unknown][] = [
    [
      "checkedFactPacketStableKey",
      packetValidation.checkedFactPacketStableKey,
      stableJson(handoff.checkedMir.facts),
    ],
    [
      "acceptedFunctionInstanceIds",
      packetValidation.acceptedFunctionInstanceIds,
      acceptedFunctionInstanceIds,
    ],
    ["summaryCertificateIds", packetValidation.summaryCertificateIds, summaryCertificateIds],
    [
      "terminalGraphCertificateId",
      packetValidation.terminalGraphCertificateId,
      handoff.checkedMir.terminalGraph.certificateId,
    ],
    [
      "originMapStableKey",
      packetValidation.originMapStableKey,
      stableJson(handoff.checkedMir.originMap),
    ],
  ];

  for (const [key, actual, expected] of checks) {
    if (stableJson(actual) !== stableJson(expected)) {
      diagnostics.push(
        inputContractDiagnostic(
          "packetValidation",
          key,
          "Packet-validation attestation does not match checked MIR handoff content.",
        ),
      );
    }
  }

  if (packetValidation.authorityFingerprints.length === 0) {
    diagnostics.push(
      inputContractDiagnostic(
        "packetValidation",
        "authorityFingerprints",
        "Packet-validation attestation is missing authority fingerprints.",
      ),
    );
  }

  return diagnostics;
}

function validateHandoffFingerprint(handoff: CheckedOptIrHandoff): readonly OptIrDiagnostic[] {
  const expected = checkedOptIrHandoffFingerprint(handoff);
  if (sameFingerprint(handoff.handoffFingerprint, expected)) {
    return [];
  }
  return [
    inputContractDiagnostic(
      "handoffFingerprint",
      "handoffFingerprint",
      "Checked OptIR handoff fingerprint does not match embedded artifacts.",
    ),
  ];
}

function validatePathCertificates(handoff: CheckedOptIrHandoff): readonly OptIrDiagnostic[] {
  const pathCertificateIds = new Set(
    handoff.pathCertificates.map((certificate) => certificate.certificateId),
  );

  return allFactEntries(handoff.checkedMir.facts)
    .filter(
      (entry) => entry.scope.kind === "path" && !pathCertificateIds.has(entry.scope.certificateId),
    )
    .map((entry) =>
      diagnostic(
        optIrDiagnosticCode("OPT_IR_MISSING_PATH_CERTIFICATE"),
        `fact:${String(entry.factId)}`,
        `pathCertificate:${String(entry.scope.kind === "path" ? entry.scope.certificateId : "")}`,
        "Path-scoped checked fact is missing a checked path certificate.",
      ),
    );
}

function validateSemanticInlinePolicies(handoff: CheckedOptIrHandoff): readonly OptIrDiagnostic[] {
  const mandatoryPolicyKeys = new Set(
    handoff.semanticInlinePolicies
      .filter((policy) => policy.kind === "mandatory")
      .map(
        (policy) => `${String(policy.functionInstanceId)}:${String(policy.summaryCertificateId)}`,
      ),
  );

  return [...handoff.checkedMir.summaries.values()]
    .filter(
      (summary) =>
        summary.certificateId !== undefined &&
        !mandatoryPolicyKeys.has(
          `${String(summary.functionInstanceId)}:${String(summary.certificateId)}`,
        ),
    )
    .map((summary) =>
      diagnostic(
        optIrDiagnosticCode("OPT_IR_MISSING_SEMANTIC_INLINE_POLICY"),
        `function:${String(summary.functionInstanceId)}`,
        `summary:${String(summary.certificateId)}`,
        "Checked function summary is missing a mandatory semantic-inline policy.",
      ),
    );
}

function authorityDependencies(entry: FactEntry): readonly {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly entryKey: string;
}[] {
  const dependencies: { fingerprint: ProofAuthorityFingerprint; entryKey: string }[] = [];
  if (entry.subject.kind === "authority") {
    dependencies.push({ fingerprint: entry.subject.fingerprint, entryKey: entry.subject.entryKey });
  }
  for (const dependency of entry.dependencies) {
    if (dependency.kind === "authorityEntry") {
      dependencies.push({ fingerprint: dependency.fingerprint, entryKey: dependency.entryKey });
    }
  }
  for (const invalidation of entry.invalidatedBy) {
    const authorityChange = invalidation as Extract<
      CheckedFactInvalidation,
      { kind: "authorityChange" }
    >;
    if (authorityChange.kind === "authorityChange") {
      dependencies.push({ fingerprint: authorityChange.fingerprint, entryKey: "" });
    }
  }
  return dependencies;
}

function validateLayoutReferences(input: InternalConstructOptIrInput): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const policy = optIrLayoutAuthorityPolicyFromHandoff({
    handoff: input.handoff,
    layoutFacts: input.layoutFacts.facts,
    layoutFingerprint: input.layoutFacts.fingerprint,
  });
  let referencesLayoutFacts = false;
  for (const entry of allFactEntries(input.handoff.checkedMir.facts)) {
    for (const layoutKey of layoutDependencyKeys(entry)) {
      referencesLayoutFacts = true;
      if (!policy.authenticatedKeys.has(layoutKey)) {
        diagnostics.push(
          diagnostic(
            optIrDiagnosticCode("OPT_IR_LAYOUT_AUTHORITY_MISMATCH"),
            `fact:${String(entry.factId)}`,
            `layout:${layoutKey}`,
            "Checked layout or ABI fact does not exist in authenticated layout facts.",
          ),
        );
      }
    }
  }
  if (referencesLayoutFacts && !policy.fingerprintAttested(input.layoutFacts.fingerprint)) {
    diagnostics.push(
      diagnostic(
        optIrDiagnosticCode("OPT_IR_LAYOUT_AUTHORITY_MISMATCH"),
        "layoutFacts",
        `fingerprint:${input.layoutFacts.fingerprint.digestHex}`,
        "Authenticated layout fact fingerprint is not attested by packet validation.",
      ),
    );
  }
  return diagnostics;
}

function validateAuthorityReferences(
  input: InternalConstructOptIrInput,
): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const platformFingerprint = input.target.platformEffects.fingerprint;
  const runtimeFingerprint = input.target.runtimeEffects.fingerprint;

  for (const entry of allFactEntries(input.handoff.checkedMir.facts)) {
    for (const dependency of authorityDependencies(entry)) {
      if (sameFingerprint(dependency.fingerprint, platformFingerprint)) {
        if (
          dependency.entryKey.length > 0 &&
          input.target.platformEffects.resolve(dependency.entryKey) === undefined
        ) {
          diagnostics.push(
            diagnostic(
              optIrDiagnosticCode("OPT_IR_FACT_IMPORT_AUTHORITY_MISMATCH"),
              `fact:${String(entry.factId)}`,
              `platform:${dependency.entryKey}`,
              "Checked platform effect fact is missing from selected target catalog.",
            ),
          );
        }
      } else if (sameFingerprint(dependency.fingerprint, runtimeFingerprint)) {
        if (
          dependency.entryKey.length > 0 &&
          input.target.runtimeEffects.resolve(dependency.entryKey) === undefined
        ) {
          diagnostics.push(
            diagnostic(
              optIrDiagnosticCode("OPT_IR_FACT_IMPORT_AUTHORITY_MISMATCH"),
              `fact:${String(entry.factId)}`,
              `runtime:${dependency.entryKey}`,
              "Checked runtime effect fact is missing from selected target catalog.",
            ),
          );
        }
      } else if (
        dependency.fingerprint.authorityKind === "platform" ||
        dependency.fingerprint.authorityKind === "runtime"
      ) {
        diagnostics.push(
          diagnostic(
            optIrDiagnosticCode("OPT_IR_FACT_IMPORT_AUTHORITY_MISMATCH"),
            `fact:${String(entry.factId)}`,
            `authority:${fingerprintKey(dependency.fingerprint)}`,
            "Checked target effect fact fingerprint does not match selected target catalog.",
          ),
        );
      }
    }
  }

  return diagnostics;
}

export function validateOptIrConstructionBoundary(
  input: InternalConstructOptIrInput,
): OptIrBoundaryValidationResult {
  const requiredArtifactDiagnostics = validateRequiredArtifacts(input);
  if (requiredArtifactDiagnostics.length > 0) {
    return { kind: "error", diagnostics: sortOptIrDiagnostics(requiredArtifactDiagnostics) };
  }

  const diagnostics = [
    ...validateFunctionCertificates(input.handoff),
    ...validatePacketAttestation(input.handoff),
    ...validatePathCertificates(input.handoff),
    ...validateSemanticInlinePolicies(input.handoff),
    ...validateHandoffFingerprint(input.handoff),
    ...validateLayoutReferences(input),
    ...validateAuthorityReferences(input),
  ];

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortOptIrDiagnostics(diagnostics) };
  }

  return { kind: "ok" };
}
