import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import type { ProofCheckTransitionResult } from "../kernel/transition-api";
import {
  checkCrossCoreOwnershipTransfer,
  type CrossCoreOwnershipTransferInput,
  type CrossCoreOwnershipTransferResult,
} from "./cross-core-ownership";
import {
  checkExtensionGateTransfer,
  type ExtensionGateTransferInput,
  type ExtensionGateTransferResult,
} from "./extension-gates";
import {
  checkStreamLoopTransfer,
  type StreamLoopTransferInput,
  type StreamLoopTransferResult,
} from "./stream-loop";
import {
  checkYieldResumeTransfer,
  type YieldResumeTransferInput,
  type YieldResumeTransferResult,
} from "./yield-resume";
import { proofCheckCoreCertificateId, type ProofCheckTransitionId } from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";

export type ProofCheckExtensionTransferCategory =
  | "extensionGate"
  | "yieldResume"
  | "streamLoop"
  | "crossCoreOwnership";

export const PROOF_CHECK_EXTENSION_TRANSFER_CATEGORIES = [
  "extensionGate",
  "yieldResume",
  "streamLoop",
  "crossCoreOwnership",
] as const satisfies readonly ProofCheckExtensionTransferCategory[];

const PROOF_CHECK_EXTENSION_TRANSFER_CATEGORY_SET: ReadonlySet<string> = new Set(
  PROOF_CHECK_EXTENSION_TRANSFER_CATEGORIES,
);

export type ProofCheckExtensionTransferInput =
  | { readonly category: "extensionGate"; readonly input: ExtensionGateTransferInput }
  | { readonly category: "yieldResume"; readonly input: YieldResumeTransferInput }
  | { readonly category: "streamLoop"; readonly input: StreamLoopTransferInput }
  | { readonly category: "crossCoreOwnership"; readonly input: CrossCoreOwnershipTransferInput };

export type ProofCheckExtensionTransferResult =
  | (Extract<ProofCheckTransitionResult, { readonly kind: "ok" }> & {
      readonly delegatedTo: ProofCheckExtensionTransferCategory;
    })
  | (Extract<ProofCheckTransitionResult, { readonly kind: "error" }> & {
      readonly delegatedTo?: ProofCheckExtensionTransferCategory;
    });

function defaultTransitionCertificate(): ProofCheckCertificateId {
  return { kind: "core", id: proofCheckCoreCertificateId(1) };
}

function extensionOwnerKey(category: string): string {
  return `extension:${category}`;
}

function unsafeExtensionCategoryDiagnostic(category: string): ProofCheckDiagnostic {
  const ownerKey = extensionOwnerKey(category);
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_UNSAFE_EXTENSION",
    messageTemplateId: "proof-check.extension.unsafe",
    messageArguments: [{ kind: "text", value: category }],
    message: `Unknown or unsupported extension transfer category: ${category}.`,
    ownerKey,
    rootCauseKey: ownerKey,
    stableDetail: `unknown-category:${category}`,
  });
}

function extensionGateTransitionResult(
  result: ExtensionGateTransferResult,
): ProofCheckExtensionTransferResult {
  if (result.kind === "error") {
    return {
      kind: "error",
      delegatedTo: "extensionGate",
      diagnostics: sortProofCheckDiagnostics(result.diagnostics),
    };
  }
  return {
    kind: "ok",
    delegatedTo: "extensionGate",
    patch: result.patch,
    certificates: [result.patch.certificate],
    packetEntries: [],
    diagnostics: [],
  };
}

function yieldResumeTransitionResult(
  result: YieldResumeTransferResult,
): ProofCheckExtensionTransferResult {
  if (result.kind === "error") {
    return {
      kind: "error",
      delegatedTo: "yieldResume",
      diagnostics: sortProofCheckDiagnostics(result.diagnostics),
    };
  }
  return {
    kind: "ok",
    delegatedTo: "yieldResume",
    patch: result.patch,
    certificates: [result.patch.certificate],
    packetEntries: [],
    diagnostics: [],
  };
}

function streamLoopTransitionResult(
  result: StreamLoopTransferResult,
): ProofCheckExtensionTransferResult {
  if (result.kind === "error") {
    return {
      kind: "error",
      delegatedTo: "streamLoop",
      diagnostics: sortProofCheckDiagnostics(result.diagnostics),
    };
  }
  return {
    kind: "ok",
    delegatedTo: "streamLoop",
    patch: result.patch,
    certificates: [result.patch.certificate],
    packetEntries: [],
    diagnostics: [],
  };
}

function crossCoreTransitionResult(
  result: CrossCoreOwnershipTransferResult,
  transitionId: ProofCheckTransitionId,
): ProofCheckExtensionTransferResult {
  if (result.kind === "error") {
    return {
      kind: "error",
      delegatedTo: "crossCoreOwnership",
      diagnostics: sortProofCheckDiagnostics(result.diagnostics),
    };
  }

  const certificate =
    result.certificates.find((entry) => entry.kind === "semantics") ??
    result.certificates[0] ??
    defaultTransitionCertificate();

  return {
    kind: "ok",
    delegatedTo: "crossCoreOwnership",
    patch: {
      kind: "crossCoreOwnership",
      transitionId,
      certificate,
      entries: result.patches,
    },
    certificates: [...result.certificates],
    packetEntries: [...result.packetEntries],
    diagnostics: [],
  };
}

export function isProofCheckExtensionTransferCategory(
  category: string,
): category is ProofCheckExtensionTransferCategory {
  return PROOF_CHECK_EXTENSION_TRANSFER_CATEGORY_SET.has(category);
}

export function checkProofCheckExtensionTransfer(
  request:
    | ProofCheckExtensionTransferInput
    | { readonly category: string; readonly input?: unknown },
): ProofCheckExtensionTransferResult {
  if (!isProofCheckExtensionTransferCategory(request.category)) {
    return {
      kind: "error",
      diagnostics: [unsafeExtensionCategoryDiagnostic(request.category)],
    };
  }

  const categorizedRequest = request as ProofCheckExtensionTransferInput;

  switch (categorizedRequest.category) {
    case "extensionGate":
      return extensionGateTransitionResult(checkExtensionGateTransfer(categorizedRequest.input));
    case "yieldResume":
      return yieldResumeTransitionResult(checkYieldResumeTransfer(categorizedRequest.input));
    case "streamLoop":
      return streamLoopTransitionResult(checkStreamLoopTransfer(categorizedRequest.input));
    case "crossCoreOwnership":
      return crossCoreTransitionResult(
        checkCrossCoreOwnershipTransfer(categorizedRequest.input),
        categorizedRequest.input.transitionId,
      );
    default: {
      const unreachable: never = categorizedRequest;
      return unreachable;
    }
  }
}
