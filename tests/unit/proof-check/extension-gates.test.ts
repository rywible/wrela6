import { describe, expect, test } from "bun:test";
import type { ProofAuthorityFingerprint } from "../../../src/proof-check/authority/authority-types";
import {
  proofSemanticsCompanion,
  proofSemanticsJudgmentKind,
  type ProofExtensionTransferJudgmentInput,
  type ProofExtensionTransferJudgmentResult,
  type ProofSemanticsCompanion,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
} from "../../../src/proof-check/authority/semantics-companion";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkExtensionGateTransfer,
  type ExtensionGateTransferInput,
  type ExtensionTransferSchema,
} from "../../../src/proof-check/domains/extension-gates";
import {
  proofCheckCoreCertificateId,
  proofCheckTransitionId,
  proofSemanticsCertificateId,
} from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  proofCheckPatchKind,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchEntry,
} from "../../../src/proof-check/kernel/state-patch";
import { targetId } from "../../../src/semantic/ids";
import { proofSemanticsCompanionFake } from "../../support/proof-check/authority-fakes";
import {
  activeFactForTest,
  consumedPlaceForTest,
  obligationStateForTest,
  ownedPlaceForTest,
  proofCheckStateForTest,
  streamMemberObligationForTest,
  streamSessionForTest,
} from "../../support/proof-check/state-fixtures";

const defaultSchemaKey = "schema:target";
const defaultFingerprint: ProofAuthorityFingerprint = {
  authorityKind: "semantics",
  targetId: targetId("proof-check-test-target"),
  version: "semantics-v1",
  digestAlgorithm: "sha256",
  digestHex: "aa".repeat(32),
};

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

const defaultExtensionSchema: ExtensionTransferSchema = {
  allowedPatchKinds: [proofCheckPatchKind("extensionTransfer")],
  allowedExtensionEntryKinds: ["divergence"],
  allowedPacketEntryKeys: ["packet:extension:1"],
};

function emptyExtensionPatch(
  entries: readonly ProofCheckStatePatchEntry[] = [],
  constraints?: ProofCheckStatePatch<"extensionTransfer">["constraints"],
): ProofCheckStatePatch<"extensionTransfer"> {
  return {
    kind: "extensionTransfer",
    transitionId: proofCheckTransitionId(1),
    certificate: defaultCertificate,
    entries,
    ...(constraints !== undefined ? { constraints } : {}),
  };
}

function extensionTransferOkResult(input: {
  readonly request: ProofSemanticsJudgmentRequest;
  readonly patchEntries?: readonly ProofCheckStatePatchEntry[];
  readonly packetEntryKeys?: readonly string[];
}): Extract<ProofSemanticsJudgmentResult, { readonly kind: "extensionTransfer" }> {
  if (input.request.kind !== "extensionTransfer") {
    throw new Error("extensionTransferOkResult requires an extensionTransfer request.");
  }
  return {
    kind: "extensionTransfer",
    requestKind: "extensionTransfer",
    requestKey: input.request.input.requestKey,
    companionFingerprint: defaultFingerprint,
    subjectKey: input.request.input.extensionSchemaKey,
    dependencyKeys: [],
    certificateId: proofSemanticsCertificateId(1),
    packetEntryKeys: input.packetEntryKeys ?? ["packet:extension:1"],
    patch: emptyExtensionPatch(input.patchEntries ?? [], {
      allowedExtensionEntryKinds: ["divergence"],
    }) as ProofExtensionTransferJudgmentResult["patch"],
  };
}

function extensionCompanionWithJudge(
  judge: (request: ProofSemanticsJudgmentRequest) => ProofSemanticsJudgmentResult | undefined,
): ProofSemanticsCompanion {
  return proofSemanticsCompanion({
    fingerprint: defaultFingerprint,
    targetId: targetId("proof-check-test-target"),
    schemaVersion: "semantics-v1",
    providedJudgments: [proofSemanticsJudgmentKind("extensionTransfer")],
    judge,
  });
}

export function extensionGateInputForTest(
  overrides: Partial<ExtensionGateTransferInput> = {},
): ExtensionGateTransferInput {
  const baseInput: ExtensionGateTransferInput = {
    state: proofCheckStateForTest({
      places: [ownedPlaceForTest("operand:a")],
      facts: [activeFactForTest("fact:extension")],
    }),
    extensionKind: "targetSpecific",
    extensionSchemaKey: defaultSchemaKey,
    enabledFeatureGates: [defaultSchemaKey],
    schema: defaultExtensionSchema,
    transitionId: proofCheckTransitionId(1),
    operandKeys: ["operand:a"],
    companion: extensionCompanionWithJudge((request) => {
      if (request.kind !== "extensionTransfer") {
        return undefined;
      }
      return extensionTransferOkResult({ request });
    }),
  };

  return {
    ...baseInput,
    ...overrides,
    ...(overrides.companion !== undefined ? { companion: overrides.companion } : {}),
    ...(overrides.schema !== undefined ? { schema: overrides.schema } : {}),
  };
}

describe("checkExtensionGateTransfer", () => {
  test("extension record without enabled companion judgment is rejected", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        extensionKind: "targetSpecific",
        companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSAFE_EXTENSION"),
    );
    expect(result.diagnostics[0]?.ownerKey).toBe("extension:targetSpecific");
  });

  test("missing enabled feature gate is rejected", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        enabledFeatureGates: [],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSAFE_EXTENSION"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("missing-feature-gate");
  });

  test("core rejects extension operands that are not present in state", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        operandKeys: ["operand:missing"],
        placeKeys: ["operand:missing"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "missing-operand:operand:missing",
      "missing-place:operand:missing",
    ]);
  });

  test("core rejects places that are not owned", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        state: proofCheckStateForTest({
          places: [consumedPlaceForTest("operand:a")],
        }),
        placeKeys: ["operand:a"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toBe("invalid-place:operand:a:consumed");
  });

  test("core validates obligations, capabilities, and brands before companion dispatch", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        obligationKeys: ["obligation:missing"],
        capabilityKeys: ["capability:missing"],
        brandKeys: ["brand:missing"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail).sort()).toEqual([
      "missing-brand:brand:missing",
      "missing-capability:capability:missing",
      "missing-obligation:obligation:missing",
    ]);
  });

  test("accepted companion patch is replayed through reduceProofCheckState", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("operand:a")],
          facts: [activeFactForTest("fact:extension")],
          obligations: [obligationStateForTest("obligation:open")],
          sessions: [streamSessionForTest("session:rx")],
        }),
        placeKeys: ["operand:a"],
        obligationKeys: ["obligation:open"],
        companion: extensionCompanionWithJudge((request) => {
          if (request.kind !== "extensionTransfer") {
            return undefined;
          }
          return extensionTransferOkResult({
            request,
            patchEntries: [
              {
                kind: "divergence",
                divergence: {
                  divergenceKey: "divergence:extension",
                  kind: "doesNotReturn",
                },
              },
            ],
          });
        }),
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.state.divergence.get("divergence:extension")).toEqual({
      divergenceKey: "divergence:extension",
      kind: "doesNotReturn",
    });
    expect(result.packetEntryKeys).toEqual(["packet:extension:1"]);
  });

  test("companion packet entries outside schema are rejected", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        companion: extensionCompanionWithJudge((request) => {
          if (request.kind !== "extensionTransfer") {
            return undefined;
          }
          return extensionTransferOkResult({
            request,
            packetEntryKeys: ["packet:extension:unexpected"],
          });
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("outside-schema");
  });

  test("companion patch entries outside declared extension schema are rejected", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        companion: extensionCompanionWithJudge((request) => {
          if (request.kind !== "extensionTransfer") {
            return undefined;
          }
          return extensionTransferOkResult({
            request,
            patchEntries: [
              {
                kind: "loan",
                action: "open",
                loan: {
                  loanKey: "loan:1",
                  mode: "exclusive",
                  placeKey: "operand:a",
                },
              },
            ],
          });
        }),
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_UNSAFE_EXTENSION"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("outside-declared-schema");
  });

  test("known extension kinds require their feature gates", () => {
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        extensionKind: "streamLoop",
        extensionSchemaKey: "schema:stream",
        enabledFeatureGates: ["schema:stream"],
      }),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toBe("missing-feature-gate:streamLoop");
  });

  test("builds extension transfer request with declared operands and schema patch kinds", () => {
    const captured: ProofExtensionTransferJudgmentInput[] = [];
    const result = checkExtensionGateTransfer(
      extensionGateInputForTest({
        declaredEffectKeys: ["effect:terminal"],
        brandKeys: ["member:rx"],
        state: proofCheckStateForTest({
          places: [ownedPlaceForTest("operand:a")],
          sessions: [
            {
              sessionKey: "session:rx",
              brandKey: "member:rx",
            },
          ],
          obligations: [streamMemberObligationForTest("member:rx", "session:rx")],
        }),
        companion: extensionCompanionWithJudge((request) => {
          if (request.kind !== "extensionTransfer") {
            return undefined;
          }
          captured.push(request.input);
          return extensionTransferOkResult({ request });
        }),
      }),
    );

    expect(result.kind).toBe("ok");
    expect(captured[0]).toEqual({
      requestKey: `request:extension:${defaultSchemaKey}`,
      extensionKind: "targetSpecific",
      extensionSchemaKey: defaultSchemaKey,
      operandKeys: ["operand:a"],
      allowedPatchKinds: [proofCheckPatchKind("extensionTransfer")],
    } satisfies ProofExtensionTransferJudgmentInput);
  });
});
