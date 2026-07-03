import type { LayoutFactProgram } from "../../layout/layout-program";
import {
  proofCheckPlatformContractCatalog,
  type ProofCheckPlatformContractDraft,
} from "../../proof-check/authority/platform-contracts";
import { proofCheckRuntimeCatalog } from "../../proof-check/authority/runtime-authority";
import {
  proofSemanticsCompanion,
  proofSemanticsJudgmentKind,
  type ProofSemanticsJudgmentRequest,
  type ProofSemanticsJudgmentResult,
} from "../../proof-check/authority/semantics-companion";
import { proofCheckTypeFactCatalog } from "../../proof-check/authority/type-fact-authority";
import { proofSemanticsCertificateId } from "../../proof-check/ids";
import type { CheckProofAndResourcesInput } from "../../proof-check/input-contract";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import { runtimeCatalog as createProofMirRuntimeCatalog } from "../../runtime/runtime-catalog";
import type { PlatformPrimitiveSpec } from "../../semantic/surface/platform-surface";
import type { ProofAuthorityFingerprint } from "../../shared/proof-authority-types";
import { stableDigestHex } from "../../shared/stable-json";
import {
  canonicalUefiAArch64SemanticTargetSurface,
  fingerprintUefiPlatformPrimitiveSpec,
} from "./platform-catalog";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";
import type { UefiAArch64TargetDriverSurface } from "./target-driver-surface";

const PROOF_CHECK_AUTHORITY_VERIFIER_KEY = "uefi-aarch64-proof-check-authority";

export function productionUefiAArch64ProofCheckInputAuthority(input: {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly layout?: LayoutFactProgram;
  readonly proofMir?: ProofMirProgram;
}): UefiAArch64TargetResult<CheckProofAndResourcesInput> {
  if (input.proofMir === undefined) {
    return proofCheckAuthorityError("proof-check-authority", [
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PIPELINE_FAILED",
        ownerKey: "uefi-aarch64-package-pipeline:proof-check",
        stableDetail: "adapter-artifact:missing:build-proof-mir-result",
      }),
    ]);
  }
  if (input.layout === undefined) {
    return proofCheckAuthorityError("proof-check-authority", [
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PIPELINE_FAILED",
        ownerKey: "uefi-aarch64-package-pipeline:proof-check",
        stableDetail: "adapter-artifact:missing:compute-representation-layout-facts-result",
      }),
    ]);
  }

  const platformContracts = productionProofCheckPlatformContractCatalog(input.target);
  if (platformContracts.kind === "error") {
    return proofCheckAuthorityError("proof-check-authority", platformContracts.diagnostics);
  }

  const runtimeAuthorityFingerprint =
    input.proofMir.runtimeCatalog.fingerprint ??
    proofAuthorityFingerprint({
      authorityKind: "runtime",
      targetId: input.proofMir.runtimeCatalog.targetId,
      version: "uefi-aarch64-runtime-v1",
      content: {
        targetRuntimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
        entries: input.proofMir.runtimeCatalog.entries().map((operation) => ({
          runtimeId: operation.runtimeId,
          authorityKey: operation.authorityKey,
          name: operation.name,
          loweringOwner: operation.loweringOwner,
        })),
      },
    });
  const proofMirRuntimeCatalog = createProofMirRuntimeCatalog({
    targetId: input.proofMir.runtimeCatalog.targetId,
    features: input.proofMir.runtimeCatalog.features,
    fingerprint: runtimeAuthorityFingerprint,
    entries: input.proofMir.runtimeCatalog.entries(),
  });
  if (proofMirRuntimeCatalog.kind === "error") {
    return proofCheckAuthorityError("proof-check-authority", proofMirRuntimeCatalog.diagnostics);
  }

  const proofMir = Object.freeze({
    ...input.proofMir,
    runtimeCatalog: proofMirRuntimeCatalog.catalog,
  });
  const runtimeCatalog = proofCheckRuntimeCatalog({
    fingerprint: runtimeAuthorityFingerprint,
    targetId: input.proofMir.runtimeCatalog.targetId,
    features: input.proofMir.runtimeCatalog.features,
    entries: input.proofMir.runtimeCatalog.entries().map((operation) => ({
      operation,
      authorityKey: operation.authorityKey ?? `runtime:${operation.name}`,
    })),
  });
  if (runtimeCatalog.kind === "error") {
    return proofCheckAuthorityError("proof-check-authority", runtimeCatalog.diagnostics);
  }

  const typeFacts = proofCheckTypeFactCatalog({
    fingerprint: proofAuthorityFingerprint({
      authorityKind: "typeFacts",
      targetId: input.proofMir.runtimeCatalog.targetId,
      version: "uefi-aarch64-type-facts-v1",
      content: {
        layoutTarget: input.layout.target,
        imageEntry: input.layout.imageEntry,
        imageInstanceId: String(input.proofMir.image.imageInstanceId),
      },
    }),
    entries: [],
  });
  if (typeFacts.kind === "error") {
    return proofCheckAuthorityError("proof-check-authority", typeFacts.diagnostics);
  }

  return uefiAArch64Ok({
    value: Object.freeze({
      mir: proofMir,
      layout: input.layout,
      limits: productionUefiAArch64ProofCheckResourceLimits(),
      platformContracts: platformContracts.catalog,
      runtimeCatalog: runtimeCatalog.catalog,
      typeFacts: typeFacts.catalog,
      semantics: productionUefiAArch64ProofSemanticsCompanion(proofMir),
    }),
    verification: passedVerification(PROOF_CHECK_AUTHORITY_VERIFIER_KEY, "input"),
  });
}

function productionUefiAArch64ProofCheckResourceLimits() {
  return Object.freeze({
    maximumReachableFunctions: 4096,
    maximumBlocksPerFunction: 4096,
    maximumEdgesPerFunction: 8192,
    maximumAcceptedStateVariantsPerBlock: 256,
    maximumActiveFactsPerState: 4096,
    maximumActiveLoansPerState: 1024,
    maximumOpenObligationsPerState: 1024,
    maximumOpenValidationsPerState: 512,
    maximumOpenAttemptsPerState: 512,
    maximumLiveCapabilitiesPerState: 1024,
    maximumCounterexampleFrames: 256,
    maximumStagedPacketEntriesPerFunction: 4096,
  });
}

function productionProofCheckPlatformContractCatalog(target: UefiAArch64TargetDriverSurface) {
  const surface = canonicalUefiAArch64SemanticTargetSurface();
  const primitiveById = new Map(
    surface.platformPrimitives
      .entries()
      .map((primitive) => [String(primitive.primitiveId), primitive] as const),
  );
  const entries: ProofCheckPlatformContractDraft[] = [];
  for (const lowering of target.platformLowerings) {
    const primitive = primitiveById.get(String(lowering.primitiveId));
    if (primitive === undefined) continue;
    if (fingerprintUefiPlatformPrimitiveSpec(primitive) !== lowering.semanticPrimitiveFingerprint) {
      continue;
    }
    entries.push(platformContractDraftFromSemanticPrimitive(primitive));
  }
  return proofCheckPlatformContractCatalog({
    fingerprint: proofAuthorityFingerprint({
      authorityKind: "platform",
      targetId: surface.targetId,
      version: "uefi-aarch64-platform-contracts-v1",
      content: {
        semanticPlatformCatalogFingerprint: target.semanticPlatformCatalogFingerprint,
        lowerings: target.platformLowerings.map((lowering) => ({
          primitiveId: lowering.primitiveId,
          semanticPrimitiveFingerprint: lowering.semanticPrimitiveFingerprint,
        })),
      },
    }),
    entries,
  });
}

function platformContractDraftFromSemanticPrimitive(
  primitive: PlatformPrimitiveSpec,
): ProofCheckPlatformContractDraft {
  return {
    targetId: primitive.availability.targetId,
    primitiveId: primitive.primitiveId,
    contractId: primitive.contractId,
    signature: {
      hasReceiver: primitive.signature.receiver !== undefined,
      parameterCount: primitive.signature.parameters.length,
      hasResult:
        primitive.signature.returnType.kind !== "core" ||
        primitive.signature.returnType.coreTypeId !== "Unit",
    },
    placeholders: [],
    preconditions: [],
    postconditions: [],
    authorityKey: `uefi-aarch64:platform:${primitive.primitiveId}:${primitive.contractId}`,
    displayLabel: String(primitive.primitiveId),
  };
}

function productionUefiAArch64ProofSemanticsCompanion(proofMir: ProofMirProgram) {
  const fingerprint = proofAuthorityFingerprint({
    authorityKind: "semantics",
    targetId: proofMir.runtimeCatalog.targetId,
    version: "uefi-aarch64-semantics-v1",
    content: {
      imageInstanceId: String(proofMir.image.imageInstanceId),
      runtimeCatalogFingerprint: proofMir.runtimeCatalog.fingerprint,
    },
  });
  return proofSemanticsCompanion({
    fingerprint,
    targetId: proofMir.runtimeCatalog.targetId,
    schemaVersion: "uefi-aarch64-semantics-v1",
    providedJudgments: [proofSemanticsJudgmentKind("terminalClosure")],
    judge(request: ProofSemanticsJudgmentRequest): ProofSemanticsJudgmentResult | undefined {
      if (request.kind !== "terminalClosure") return undefined;
      return {
        kind: "terminalClosure",
        requestKind: "terminalClosure",
        requestKey: request.input.requestKey,
        companionFingerprint: fingerprint,
        subjectKey: request.input.terminalKey,
        dependencyKeys: request.input.platformBaseKeys.map((key) => `platform-base:${key}`),
        certificateId: proofSemanticsCertificateId(
          stablePositiveInteger(`terminal:${request.input.terminalKey}`),
        ),
        terminalClosureKey: request.input.terminalKey,
      };
    },
  });
}

function proofAuthorityFingerprint(input: {
  readonly authorityKind: ProofAuthorityFingerprint["authorityKind"];
  readonly targetId: ProofAuthorityFingerprint["targetId"];
  readonly version: string;
  readonly content: unknown;
}): ProofAuthorityFingerprint {
  return {
    authorityKind: input.authorityKind,
    targetId: input.targetId,
    version: input.version,
    digestAlgorithm: "sha256",
    digestHex: stableDigestHex(input.content),
  };
}

function stablePositiveInteger(seed: string): number {
  const digest = stableDigestHex(seed).slice(0, 12);
  return (Number.parseInt(digest, 16) % 900_000_000) + 1;
}

function proofCheckAuthorityError<Value = never>(
  ownerKey: string,
  diagnostics: readonly { readonly code?: string; readonly stableDetail: string }[],
): UefiAArch64TargetResult<Value> {
  return uefiAArch64Error({
    diagnostics: mapProofCheckAuthorityDiagnostics(ownerKey, diagnostics),
    verification: failedVerification(PROOF_CHECK_AUTHORITY_VERIFIER_KEY, ownerKey),
  });
}

function mapProofCheckAuthorityDiagnostics(
  ownerKey: string,
  diagnostics: readonly { readonly code?: string; readonly stableDetail: string }[],
): readonly UefiAArch64TargetDiagnostic[] {
  return Object.freeze(
    diagnostics.map((diagnostic) =>
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
        ownerKey,
        stableDetail:
          diagnostic.code === undefined
            ? diagnostic.stableDetail
            : `${diagnostic.code}:${diagnostic.stableDetail}`,
      }),
    ),
  );
}
