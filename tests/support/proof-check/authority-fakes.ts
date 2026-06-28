import { createHash } from "node:crypto";

import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofCheckPlatformContractCatalog,
  type ProofCheckPlatformContractCatalog,
  type ProofCheckPlatformContractDraft,
  type TargetSurfaceProofPlaceholder,
} from "../../../src/proof-check/authority/platform-contracts";
import {
  proofCheckRuntimeCatalog,
  type ProofCheckRuntimeCatalog,
  type ProofCheckRuntimeOperationDraft,
} from "../../../src/proof-check/authority/runtime-authority";
import {
  proofCheckTypeFactCatalog,
  type ProofCheckTypeFactCatalog,
  type ProofCheckTypeFactCatalogEntryDraft,
} from "../../../src/proof-check/authority/type-fact-authority";
import {
  proofSemanticsCompanion,
  proofSemanticsJudgmentKind,
  type ProofEntailmentJudgmentInput,
  type ProofEntailmentJudgmentResult,
  type ProofSemanticsCompanion,
  type ProofSemanticsJudgmentKind,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
} from "../../../src/proof-check/authority/semantics-companion";
import type { ProofCheckAuthorityCatalogResult } from "../../../src/proof-check/authority/authority-catalog-helpers";
import { proofSemanticsCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { proofMirPlaceId } from "../../../src/proof-mir/ids";
import { activeFactForTest } from "./state-fixtures";
import type { ProofMirRuntimeCatalog } from "../../../src/runtime/runtime-catalog";
import { platformContractId, platformPrimitiveId, targetId } from "../../../src/semantic/ids";
import { comparisonTerm, proofCheckValueOperandForTest } from "./term-fixtures";

const DEFAULT_TEST_TARGET_NAME = "proof-check-test-target";
const DEFAULT_SEMANTICS_SCHEMA_VERSION = "semantics-v1";

function deterministicHexDigestForTest(seed: string): string {
  return createHash("sha256").update(`proof-check-authority-test:${seed}`).digest("hex");
}

function defaultSemanticsFingerprint(): ProofAuthorityFingerprint {
  return proofAuthorityFingerprintForTest({
    authorityKind: "semantics",
    version: DEFAULT_SEMANTICS_SCHEMA_VERSION,
    digestSeed: "semantics",
  });
}

function defaultPlatformPlaceholders(): readonly TargetSurfaceProofPlaceholder[] {
  return [{ kind: "receiver", name: "self" }, { kind: "parameter", index: 0 }, { kind: "result" }];
}

function authorityKeySuffix(authorityKey: string, prefix: string): string {
  if (authorityKey.startsWith(`${prefix}:`)) {
    return authorityKey.slice(prefix.length + 1);
  }
  return authorityKey;
}

function unwrapAuthorityCatalogResult<TCatalog>(
  label: string,
  result: ProofCheckAuthorityCatalogResult<TCatalog>,
): TCatalog {
  if (result.kind === "error") {
    throw new Error(
      `${label} failed: ${result.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`,
    );
  }
  return result.catalog;
}

export function proofAuthorityFingerprintForTest(input: {
  readonly authorityKind: ProofAuthorityFingerprint["authorityKind"];
  readonly targetName?: string;
  readonly version?: string;
  readonly digestSeed?: string;
}): ProofAuthorityFingerprint {
  return {
    authorityKind: input.authorityKind,
    targetId: targetId(input.targetName ?? DEFAULT_TEST_TARGET_NAME),
    version: input.version ?? "test-v1",
    digestAlgorithm: "sha256",
    digestHex: deterministicHexDigestForTest(input.digestSeed ?? input.authorityKind),
  };
}

export function proofCheckPlatformContractFake(input?: {
  readonly authorityKey?: string;
  readonly targetName?: string;
  readonly primitiveName?: string;
  readonly contractName?: string;
  readonly displayLabel?: string;
}): ProofCheckPlatformContractDraft {
  const authorityKey = input?.authorityKey ?? "platform:send";
  const target = targetId(input?.targetName ?? DEFAULT_TEST_TARGET_NAME);
  const primitiveName = input?.primitiveName ?? authorityKeySuffix(authorityKey, "platform");
  return {
    targetId: target,
    primitiveId: platformPrimitiveId(primitiveName),
    contractId: platformContractId(input?.contractName ?? "default"),
    signature: {
      hasReceiver: true,
      parameterCount: 1,
      hasResult: false,
    },
    placeholders: defaultPlatformPlaceholders(),
    preconditions: [
      {
        kind: "comparison",
        left: {
          kind: "place",
          place: { kind: "parameter", index: 0 },
        },
        operator: "le",
        right: {
          kind: "value",
          value: { kind: "synthetic", name: "limit" },
        },
      },
    ],
    postconditions: [],
    authorityKey,
    ...(input?.displayLabel === undefined ? {} : { displayLabel: input.displayLabel }),
  };
}

export function proofCheckPlatformCatalogFake(input: {
  readonly entries: readonly ProofCheckPlatformContractDraft[];
  readonly fingerprint?: ProofAuthorityFingerprint;
  readonly targetName?: string;
  readonly version?: string;
}): ProofCheckPlatformContractCatalog {
  const fingerprint =
    input.fingerprint ??
    proofAuthorityFingerprintForTest({
      authorityKind: "platform",
      targetName: input.targetName,
      version: input.version ?? "contracts-v1",
      digestSeed: "platform",
    });
  return unwrapAuthorityCatalogResult(
    "proofCheckPlatformCatalogFake",
    proofCheckPlatformContractCatalog({
      fingerprint,
      entries: [...input.entries],
    }),
  );
}

export function proofCheckRuntimeCatalogFake(input?: {
  readonly embedded?: ProofMirRuntimeCatalog;
  readonly fingerprintName?: string;
  readonly targetName?: string;
  readonly version?: string;
  readonly features?: readonly string[];
  readonly entries?: readonly ProofCheckRuntimeOperationDraft[];
}): ProofCheckRuntimeCatalog {
  const embedded = input?.embedded;
  const catalogTargetId =
    embedded?.targetId ?? targetId(input?.targetName ?? DEFAULT_TEST_TARGET_NAME);
  const catalogFeatures = input?.features ?? embedded?.features ?? [];
  const runtimeEntries =
    input?.entries ??
    (embedded === undefined
      ? []
      : embedded.entries().map((operation) => ({
          authorityKey: operation.authorityKey ?? `runtime:${operation.name}`,
          operation,
        })));

  const fingerprint =
    input?.fingerprintName === undefined
      ? (embedded?.fingerprint ??
        proofAuthorityFingerprintForTest({
          authorityKind: "runtime",
          targetName: input?.targetName,
          version: input?.version ?? "runtime-v1",
          digestSeed: "runtime",
        }))
      : proofAuthorityFingerprintForTest({
          authorityKind: "runtime",
          targetName: input?.targetName,
          version: input?.version ?? "runtime-v1",
          digestSeed: input.fingerprintName,
        });

  return unwrapAuthorityCatalogResult(
    "proofCheckRuntimeCatalogFake",
    proofCheckRuntimeCatalog({
      fingerprint,
      targetId: catalogTargetId,
      features: [...catalogFeatures],
      entries: [...runtimeEntries],
    }),
  );
}

export function proofCheckTypeFactCatalogFake(input: {
  readonly entries: readonly ProofCheckTypeFactCatalogEntryDraft[];
  readonly fingerprint?: ProofAuthorityFingerprint;
  readonly version?: string;
}): ProofCheckTypeFactCatalog {
  const fingerprint =
    input.fingerprint ??
    proofAuthorityFingerprintForTest({
      authorityKind: "typeFacts",
      version: input.version ?? "type-facts-v1",
      digestSeed: "typeFacts",
    });
  return unwrapAuthorityCatalogResult(
    "proofCheckTypeFactCatalogFake",
    proofCheckTypeFactCatalog({
      fingerprint,
      entries: [...input.entries],
    }),
  );
}

export function proofEntailmentRequestForTest(
  overrides: Partial<ProofEntailmentJudgmentInput> = {},
): ProofSemanticsJudgmentRequest {
  return {
    kind: "entailment",
    input: {
      requestKey: "request:entailment:1",
      subjectKey: "wanted-request",
      environmentFactKeys: ["fact:a"],
      requirement: comparisonTerm(
        proofCheckValueOperandForTest("value:a"),
        "eq",
        proofCheckValueOperandForTest("value:b"),
      ),
      allowedAuthorityKeys: ["authority:layout"],
      ...overrides,
    },
  };
}

export function proofSemanticsEntailmentOkForTest(
  overrides: Partial<ProofEntailmentJudgmentResult> = {},
): ProofEntailmentJudgmentResult {
  const companionFingerprint = defaultSemanticsFingerprint();
  return {
    kind: "entailment",
    requestKind: "entailment",
    requestKey: "request:entailment:1",
    companionFingerprint,
    subjectKey: "wanted-request",
    dependencyKeys: ["authority:layout"],
    certificateId: proofSemanticsCertificateId(1),
    entailed: true,
    ...overrides,
  };
}

function stableNumericSeedForCompanion(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(31, hash) + seed.charCodeAt(index)) >>> 0;
  }
  return (hash % 900_000) + 1_000;
}

function defaultCompanionJudgeForTest(
  providedJudgments: readonly ProofSemanticsJudgmentKind[],
  companionFingerprint: ProofAuthorityFingerprint,
): (request: ProofSemanticsJudgmentRequest) => ProofSemanticsJudgmentResult | undefined {
  const providedSet = new Set(providedJudgments.map((judgment) => String(judgment)));
  return (request) => {
    if (!providedSet.has(String(request.kind))) {
      return undefined;
    }
    switch (request.kind) {
      case "terminalClosure":
        return {
          kind: "terminalClosure",
          requestKind: "terminalClosure",
          requestKey: request.input.requestKey,
          companionFingerprint,
          subjectKey: String(request.input.terminalKey),
          dependencyKeys: request.input.platformBaseKeys.map((key) => `platform-base:${key}`),
          certificateId: proofSemanticsCertificateId(
            stableNumericSeedForCompanion(
              `semantics:terminal:${String(request.input.terminalKey)}`,
            ),
          ),
          terminalClosureKey: request.input.terminalKey,
        };
      case "crossCoreOwnership": {
        const orderingFactKey =
          request.input.orderingFactKey ??
          `ordering:${request.input.sourcePlaceKey}->${request.input.destinationCoreKey}`;
        const certificate: ProofCheckCertificateId = {
          kind: "semantics",
          id: proofSemanticsCertificateId(1),
        };
        return {
          kind: "crossCoreOwnership",
          requestKind: "crossCoreOwnership",
          requestKey: request.input.requestKey,
          companionFingerprint,
          subjectKey: request.input.sourcePlaceKey,
          dependencyKeys: [],
          certificateId: proofSemanticsCertificateId(1),
          patch: {
            kind: "crossCoreOwnership",
            transitionId: proofCheckTransitionId(1),
            certificate,
            entries: [
              {
                kind: "placeState",
                place: proofMirPlaceId(1),
                state: {
                  placeKey: request.input.sourcePlaceKey,
                  lifecycle: "moved",
                },
              },
              {
                kind: "fact",
                action: "add",
                fact: activeFactForTest(orderingFactKey),
              },
            ],
          },
        };
      }
      case "extensionTransfer":
        return {
          kind: "extensionTransfer",
          requestKind: "extensionTransfer",
          requestKey: request.input.requestKey,
          companionFingerprint,
          subjectKey: request.input.extensionSchemaKey,
          dependencyKeys: [],
          certificateId: proofSemanticsCertificateId(2),
          patch: {
            kind: "extensionTransfer",
            transitionId: proofCheckTransitionId(2),
            certificate: { kind: "semantics", id: proofSemanticsCertificateId(2) },
            entries: [],
          },
          packetEntryKeys: [],
        };
      case "stateJoin":
        return {
          kind: "stateJoin",
          requestKind: "stateJoin",
          requestKey: request.input.requestKey,
          companionFingerprint,
          subjectKey: `join:${request.input.functionInstanceId}:${request.input.blockId}`,
          dependencyKeys: [],
          certificateId: proofSemanticsCertificateId(3),
          patch: {
            kind: "stateJoin",
            transitionId: proofCheckTransitionId(3),
            certificate: { kind: "semantics", id: proofSemanticsCertificateId(3) },
            entries: [],
          },
        };
      case "loopConvergence":
        return {
          kind: "loopConvergence",
          requestKind: "loopConvergence",
          requestKey: request.input.requestKey,
          companionFingerprint,
          subjectKey: `loop:${request.input.functionInstanceId}:${request.input.headerBlockId}`,
          dependencyKeys: [],
          certificateId: proofSemanticsCertificateId(4),
          patch: {
            kind: "loopConvergence",
            transitionId: proofCheckTransitionId(4),
            certificate: { kind: "semantics", id: proofSemanticsCertificateId(4) },
            entries: [],
          },
          replayWitnessKey: request.input.requestKey,
        };
      default:
        return undefined;
    }
  };
}

export function proofSemanticsCompanionFake(input?: {
  readonly providedJudgments?: readonly (ProofSemanticsJudgmentKind | string)[];
  readonly fingerprint?: ProofAuthorityFingerprint;
  readonly targetName?: string;
  readonly schemaVersion?: string;
  readonly judge?: (
    request: ProofSemanticsJudgmentRequest,
  ) => ProofSemanticsJudgmentResult | undefined;
  readonly result?: ProofSemanticsJudgmentResult;
}): ProofSemanticsCompanion {
  const providedJudgments = [...(input?.providedJudgments ?? [])].map((kind) =>
    typeof kind === "string" ? proofSemanticsJudgmentKind(kind) : kind,
  );
  const fingerprint = input?.fingerprint ?? defaultSemanticsFingerprint();
  const result = input?.result;
  const defaultJudge = defaultCompanionJudgeForTest(providedJudgments, fingerprint);
  const judge =
    input?.judge ??
    ((request) => defaultJudge(request) ?? (result === undefined ? undefined : result));

  return proofSemanticsCompanion({
    fingerprint,
    targetId: targetId(input?.targetName ?? DEFAULT_TEST_TARGET_NAME),
    schemaVersion: input?.schemaVersion ?? DEFAULT_SEMANTICS_SCHEMA_VERSION,
    providedJudgments,
    judge,
  });
}
