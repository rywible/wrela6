import { describe, expect, test } from "bun:test";
import {
  proofCheckLiveValueScopeId,
  proofCheckTypeFactCatalog,
} from "../../../src/proof-check/authority/type-fact-authority";
import {
  proofSemanticsCompanion,
  proofSemanticsJudgmentKind,
  type ProofCrossCoreOwnershipJudgmentResult,
  type ProofSemanticsJudgmentRequest,
} from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkCrossCoreOwnershipTransfer,
  crossCoreOwnershipOrderingFactKeyForTest,
  type CrossCoreOwnershipTransferInput,
  type CrossCoreTransferCatalogSpec,
} from "../../../src/proof-check/domains/cross-core-ownership";
import { proofCheckTransitionId, proofSemanticsCertificateId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import type { ProofCheckStatePatch } from "../../../src/proof-check/kernel/state-patch";
import { proofMirPlaceId } from "../../../src/proof-mir/ids";
import { targetId } from "../../../src/semantic/ids";
import { monoCoreType } from "../../support/mono/monomorphization-fixtures";
import {
  proofSemanticsCompanionFake,
  proofAuthorityFingerprintForTest,
} from "../../support/proof-check/authority-fakes";
import {
  activeFactForTest,
  exclusiveLoanForTest,
  obligationStateForTest,
  ownedPlaceForTest,
  packetSourceForTest,
  privateGenerationForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
  streamSessionForTest,
  testPlaceResolverForState,
} from "../../support/proof-check/state-fixtures";
import { capabilityRequirementForTest } from "../../support/proof-check/term-fixtures";

const defaultFingerprint = proofAuthorityFingerprintForTest({
  authorityKind: "semantics",
  digestSeed: "semantics",
});
const defaultTarget = targetId("proof-check-test-target");
const defaultCertificate: ProofCheckCertificateId = {
  kind: "semantics",
  id: proofSemanticsCertificateId(1),
};

function emptyCrossCorePatch(
  entries: ProofCheckStatePatch<"crossCoreOwnership">["entries"],
): ProofCheckStatePatch<"crossCoreOwnership"> {
  return {
    kind: "crossCoreOwnership",
    transitionId: proofCheckTransitionId(1),
    certificate: defaultCertificate,
    entries,
  };
}

function crossCoreCompanionForTest(input?: {
  readonly providedJudgments?: readonly string[];
  readonly judge?: (
    request: ProofSemanticsJudgmentRequest,
  ) => ProofCrossCoreOwnershipJudgmentResult | undefined;
}): ReturnType<typeof proofSemanticsCompanionFake> {
  return proofSemanticsCompanionFake({
    fingerprint: defaultFingerprint,
    providedJudgments: input?.providedJudgments ?? ["crossCoreOwnership"],
    judge:
      input?.judge ??
      ((request) => {
        if (request.kind !== "crossCoreOwnership") {
          return undefined;
        }
        const orderingFactKey = request.input.orderingFactKey;
        return {
          kind: "crossCoreOwnership",
          requestKind: "crossCoreOwnership",
          requestKey: request.input.requestKey,
          companionFingerprint: defaultFingerprint,
          subjectKey: request.input.sourcePlaceKey,
          dependencyKeys: [],
          certificateId: proofSemanticsCertificateId(1),
          patch: emptyCrossCorePatch([
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
          ]),
        };
      }),
  });
}

function catalogForTest(input?: {
  readonly resourceKind?: CrossCoreTransferCatalogSpec["resourceKind"];
  readonly authorityKey?: string;
  readonly capabilityKind?: CrossCoreTransferCatalogSpec["typeFacts"] extends never
    ? never
    : ReturnType<typeof capabilityRequirementForTest>["capabilityKind"];
}): CrossCoreTransferCatalogSpec {
  const authorityKey = input?.authorityKey ?? "cross-core:transfer";
  const capabilityKind =
    input?.capabilityKind ?? capabilityRequirementForTest("cap:dma").capabilityKind;
  const concreteType = monoCoreType("u8");
  const catalogResult = proofCheckTypeFactCatalog({
    fingerprint: {
      authorityKind: "typeFacts",
      targetId: defaultTarget,
      version: "type-facts-v1",
      digestAlgorithm: "sha256",
      digestHex: "dd".repeat(32),
    },
    entries: [
      {
        concreteType,
        capabilityKind,
        liveValueScope: proofCheckLiveValueScopeId("reachable-local"),
        placeholders: [{ kind: "layoutTerm", layoutKey: "subject" }],
        facts: [
          {
            kind: "comparison",
            left: { kind: "place", place: { kind: "subject" } },
            operator: "eq",
            right: { kind: "literal", literal: { kind: "bool", value: true } },
          },
        ],
        invalidatedBy: [{ kind: "moveTransfers" }],
        authorityKey,
      },
    ],
  });
  if (catalogResult.kind === "error") {
    throw new Error("catalogForTest failed to build type fact catalog");
  }
  return {
    typeFacts: catalogResult.catalog,
    concreteType,
    resourceKind: input?.resourceKind ?? "Affine",
    operationAuthorityKey: authorityKey,
    liveValueScope: proofCheckLiveValueScopeId("reachable-local"),
  };
}

export function crossCoreOwnershipInputForTest(
  overrides: Partial<CrossCoreOwnershipTransferInput> = {},
): CrossCoreOwnershipTransferInput {
  const sourcePlace = overrides.sourcePlace ?? proofCheckPlaceForTest("buffer");
  const destinationCoreKey = overrides.destinationCoreKey ?? "core:1";
  const state =
    overrides.state ??
    proofCheckStateForTest({
      places: [ownedPlaceForTest(sourcePlace.placeKey)],
    });
  return {
    state,
    sourcePlace,
    destinationCoreKey,
    capabilityKind:
      overrides.capabilityKind ?? capabilityRequirementForTest("cap:dma").capabilityKind,
    companion: overrides.companion ?? crossCoreCompanionForTest(),
    transitionId: overrides.transitionId ?? proofCheckTransitionId(1),
    catalog: overrides.catalog ?? catalogForTest(),
    orderingFactKey:
      overrides.orderingFactKey ??
      crossCoreOwnershipOrderingFactKeyForTest({
        sourcePlaceKey: sourcePlace.placeKey,
        destinationCoreKey,
      }),
    operationOriginKey: overrides.operationOriginKey,
    dependencyKeys: overrides.dependencyKeys,
    placeResolver: overrides.placeResolver ?? testPlaceResolverForState(state),
  };
}

describe("checkCrossCoreOwnershipTransfer", () => {
  test("cross-core transfer without companion certificate is rejected", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
        sourcePlace: proofCheckPlaceForTest("buffer"),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CROSS_CORE_CERTIFICATE_MISSING"),
    );
  });

  test("accepted transfer replays companion patch and emits packet facts", () => {
    const result = checkCrossCoreOwnershipTransfer(crossCoreOwnershipInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches.some((patch) => patch.kind === "placeState")).toBe(true);
    expect(result.patches.some((patch) => patch.kind === "fact" && patch.action === "add")).toBe(
      true,
    );
    expect(result.packetEntries.map((entry) => entry.kind as string)).toEqual([
      "capabilityFlow",
      "platformEffect",
    ]);
    expect(result.certificates.some((certificate) => certificate.kind === "semantics")).toBe(true);
  });

  test("transfer rejects borrowed source place before companion dispatch", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("buffer")],
          loans: [exclusiveLoanForTest("buffer")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("borrowed:buffer");
  });

  test("transfer rejects open obligation before companion dispatch", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("buffer")],
          obligations: [obligationStateForTest("obligation:rx")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("open-obligation:obligation:rx");
  });

  test("transfer rejects open session before companion dispatch", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("buffer")],
          sessions: [streamSessionForTest("session:rx")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("open-session:session:rx");
  });

  test("transfer rejects pending validation before companion dispatch", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("buffer")],
          validations: [{ validationKey: "validation:rx", status: "pending" }],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("pending-validation:validation:rx");
  });

  test("transfer rejects pending attempt before companion dispatch", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("buffer")],
          attempts: [{ attemptKey: "attempt:rx", status: "pending" }],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("pending-attempt:attempt:rx");
  });

  test("transfer rejects packet source binding before companion dispatch", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("buffer")],
          packetSources: [packetSourceForTest("buffer", "source:a")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("packet-source-bound:buffer");
  });

  test("transfer rejects private-state binding before companion dispatch", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("buffer")],
          privateState: [privateGenerationForTest("buffer", "generation:1")],
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("private-state-bound:buffer");
  });

  test("transfer rejects non-core-movable resource kind from catalog", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        catalog: catalogForTest({ resourceKind: "ValidatedBuffer" }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("non-transferable-resource-kind");
  });

  test("transfer rejects missing catalog transfer eligibility", () => {
    const catalog = catalogForTest({ authorityKey: "cross-core:transfer" });
    const missingCatalog = proofCheckTypeFactCatalog({
      fingerprint: {
        authorityKind: "typeFacts",
        targetId: defaultTarget,
        version: "type-facts-v1",
        digestAlgorithm: "sha256",
        digestHex: "ee".repeat(32),
      },
      entries: [],
    });
    if (missingCatalog.kind === "error") {
      throw new Error("missing catalog setup failed");
    }

    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        catalog: {
          ...catalog,
          typeFacts: missingCatalog.catalog,
        },
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain(
      "missing-transfer-eligibility-catalog-entry",
    );
  });

  test("companion patch missing ordering fact is rejected", () => {
    const companion = proofSemanticsCompanion({
      fingerprint: defaultFingerprint,
      targetId: defaultTarget,
      schemaVersion: "semantics-v1",
      providedJudgments: [proofSemanticsJudgmentKind("crossCoreOwnership")],
      judge: (request) => {
        if (request.kind !== "crossCoreOwnership") {
          return undefined;
        }
        return {
          kind: "crossCoreOwnership",
          requestKind: "crossCoreOwnership",
          requestKey: request.input.requestKey,
          companionFingerprint: defaultFingerprint,
          subjectKey: request.input.sourcePlaceKey,
          dependencyKeys: [],
          certificateId: proofSemanticsCertificateId(2),
          patch: emptyCrossCorePatch([
            {
              kind: "placeState",
              place: proofMirPlaceId(1),
              state: {
                placeKey: request.input.sourcePlaceKey,
                lifecycle: "moved",
              },
            },
          ]),
        };
      },
    });

    const result = checkCrossCoreOwnershipTransfer(crossCoreOwnershipInputForTest({ companion }));

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CROSS_CORE_CERTIFICATE_MISSING"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("missing-ordering-fact");
  });
});
