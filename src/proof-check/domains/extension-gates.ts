import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type {
  ProofExtensionTransferJudgmentInput,
  ProofMirExtensionKind,
  ProofSemanticsCompanion,
  ProofSemanticsJudgmentRequest,
} from "../authority/semantics-companion";
import {
  validateProofSemanticsJudgmentResult,
  type ProofExtensionTransferJudgmentResult,
} from "../authority/semantics-companion";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import type { ProofCheckTransitionId } from "../ids";
import type { ProofCheckState } from "../kernel/state";
import {
  proofCheckStatePatchWithTransitionId,
  type ProofCheckPatchKind,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchEntryKind,
} from "../kernel/state-patch";
import { reduceProofCheckState } from "../kernel/state-reducer";

export interface ExtensionTransferSchema {
  readonly allowedPatchKinds: readonly ProofCheckPatchKind[];
  readonly allowedExtensionEntryKinds: readonly ProofCheckStatePatchEntryKind[];
  readonly allowedPacketEntryKeys: readonly string[];
}

export interface ExtensionGateTransferInput {
  readonly state: ProofCheckState;
  readonly extensionKind: ProofMirExtensionKind;
  readonly extensionSchemaKey: string;
  readonly companion: ProofSemanticsCompanion;
  readonly enabledFeatureGates: readonly string[];
  readonly schema: ExtensionTransferSchema;
  readonly transitionId: ProofCheckTransitionId;
  readonly operandKeys?: readonly string[];
  readonly placeKeys?: readonly string[];
  readonly brandKeys?: readonly string[];
  readonly obligationKeys?: readonly string[];
  readonly capabilityKeys?: readonly string[];
  readonly declaredEffectKeys?: readonly string[];
  readonly dependencyKeys?: ReadonlySet<string>;
  readonly operationOriginKey?: string;
}

export type ExtensionGateTransferResult =
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly patch: ProofCheckStatePatch<"extensionTransfer">;
      readonly packetEntryKeys: readonly string[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

function extensionOwnerKey(extensionKind: ProofMirExtensionKind): string {
  return `extension:${extensionKind}`;
}

function requiredFeatureGate(input: {
  readonly extensionKind: ProofMirExtensionKind;
  readonly extensionSchemaKey: string;
}): string {
  switch (input.extensionKind) {
    case "coroutineYield":
      return "coroutineYield";
    case "streamLoop":
      return "streamLoop";
    case "crossCoreOwnership":
      return "crossCoreOwnership";
    case "targetSpecific":
      return input.extensionSchemaKey;
    default: {
      const unreachable: never = input.extensionKind;
      return unreachable;
    }
  }
}

function featureGateEnabled(enabledFeatureGates: readonly string[], requiredGate: string): boolean {
  return enabledFeatureGates.includes(requiredGate);
}

function unsafeExtensionDiagnostic(input: {
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly message: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_UNSAFE_EXTENSION",
    messageTemplateId: "proof-check.extension.unsafe",
    messageArguments: [{ kind: "text", value: input.stableDetail }],
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: input.ownerKey,
    stableDetail: input.stableDetail,
  });
}

function remapDiagnostics(
  diagnostics: readonly ProofCheckDiagnostic[],
  ownerKey: string,
  code: "PROOF_CHECK_UNSAFE_EXTENSION" | "PROOF_CHECK_INVALID_STATE_PATCH",
): readonly ProofCheckDiagnostic[] {
  return sortProofCheckDiagnostics(
    diagnostics.map((diagnostic) =>
      proofCheckDiagnostic({
        ...diagnostic,
        code,
        ownerKey,
        rootCauseKey: ownerKey,
      }),
    ),
  );
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareCodeUnitStrings);
}

function validateCoreExtensionOperands(
  input: ExtensionGateTransferInput,
): readonly ProofCheckDiagnostic[] {
  const ownerKey = extensionOwnerKey(input.extensionKind);
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const placeKey of input.placeKeys ?? []) {
    const place = input.state.places.get(placeKey);
    if (place === undefined) {
      diagnostics.push(
        unsafeExtensionDiagnostic({
          ownerKey,
          stableDetail: `missing-place:${placeKey}`,
          message: `Extension transfer references missing place ${placeKey}.`,
        }),
      );
      continue;
    }
    if (place.lifecycle !== "owned") {
      diagnostics.push(
        unsafeExtensionDiagnostic({
          ownerKey,
          stableDetail: `invalid-place:${placeKey}:${place.lifecycle}`,
          message: `Extension transfer requires owned place ${placeKey}.`,
        }),
      );
    }
  }

  for (const operandKey of input.operandKeys ?? []) {
    if (input.state.places.has(operandKey)) {
      continue;
    }
    if (input.state.facts.has(operandKey)) {
      continue;
    }
    diagnostics.push(
      unsafeExtensionDiagnostic({
        ownerKey,
        stableDetail: `missing-operand:${operandKey}`,
        message: `Extension transfer references missing operand ${operandKey}.`,
      }),
    );
  }

  for (const obligationKey of input.obligationKeys ?? []) {
    const obligation = input.state.obligations.get(obligationKey);
    if (obligation === undefined || obligation.status !== "open") {
      diagnostics.push(
        unsafeExtensionDiagnostic({
          ownerKey,
          stableDetail: `missing-obligation:${obligationKey}`,
          message: `Extension transfer references missing open obligation ${obligationKey}.`,
        }),
      );
    }
  }

  for (const capabilityKey of input.capabilityKeys ?? []) {
    if (!input.state.capabilities.has(capabilityKey)) {
      diagnostics.push(
        unsafeExtensionDiagnostic({
          ownerKey,
          stableDetail: `missing-capability:${capabilityKey}`,
          message: `Extension transfer references missing capability ${capabilityKey}.`,
        }),
      );
    }
  }

  for (const brandKey of input.brandKeys ?? []) {
    const brandPresent =
      [...input.state.sessions.values()].some((session) => session.brandKey === brandKey) ||
      [...input.state.obligations.values()].some((obligation) => obligation.memberKey === brandKey);
    if (!brandPresent) {
      diagnostics.push(
        unsafeExtensionDiagnostic({
          ownerKey,
          stableDetail: `missing-brand:${brandKey}`,
          message: `Extension transfer references missing brand ${brandKey}.`,
        }),
      );
    }
  }

  return sortProofCheckDiagnostics(diagnostics);
}

function buildExtensionTransferRequest(
  input: ExtensionGateTransferInput,
): ProofSemanticsJudgmentRequest {
  const requestKey = `request:extension:${input.extensionSchemaKey}`;
  const judgmentInput: ProofExtensionTransferJudgmentInput = {
    requestKey,
    extensionKind: input.extensionKind,
    extensionSchemaKey: input.extensionSchemaKey,
    operandKeys: sortedUnique([...(input.operandKeys ?? []), ...(input.placeKeys ?? [])]),
    allowedPatchKinds: [...input.schema.allowedPatchKinds],
  };
  return { kind: "extensionTransfer", input: judgmentInput };
}

function validatePacketEntryKeys(
  packetEntryKeys: readonly string[],
  schema: ExtensionTransferSchema,
  ownerKey: string,
): readonly ProofCheckDiagnostic[] {
  const diagnostics: ProofCheckDiagnostic[] = [];
  const allowed = new Set(schema.allowedPacketEntryKeys);
  for (const packetEntryKey of packetEntryKeys) {
    if (allowed.has(packetEntryKey)) {
      continue;
    }
    diagnostics.push(
      unsafeExtensionDiagnostic({
        ownerKey,
        stableDetail: `packet-entry:${packetEntryKey}:outside-schema`,
        message: `Extension transfer emitted packet entry outside schema: ${packetEntryKey}.`,
      }),
    );
  }
  return sortProofCheckDiagnostics(diagnostics);
}

function applyCompanionPatch(input: {
  readonly state: ProofCheckState;
  readonly patch: ProofCheckStatePatch<"extensionTransfer">;
  readonly transitionId: ProofCheckTransitionId;
  readonly ownerKey: string;
}):
  | { readonly kind: "ok"; readonly state: ProofCheckState }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] } {
  const reduction = reduceProofCheckState(
    input.state,
    proofCheckStatePatchWithTransitionId(input.patch, input.transitionId),
  );
  if (reduction.kind === "error") {
    return {
      kind: "error",
      diagnostics: remapDiagnostics(
        reduction.diagnostics,
        input.ownerKey,
        "PROOF_CHECK_INVALID_STATE_PATCH",
      ),
    };
  }
  return { kind: "ok", state: reduction.state };
}

export function checkExtensionGateTransfer(
  input: ExtensionGateTransferInput,
): ExtensionGateTransferResult {
  const ownerKey = extensionOwnerKey(input.extensionKind);
  const requiredGate = requiredFeatureGate({
    extensionKind: input.extensionKind,
    extensionSchemaKey: input.extensionSchemaKey,
  });

  if (!featureGateEnabled(input.enabledFeatureGates, requiredGate)) {
    return {
      kind: "error",
      diagnostics: [
        unsafeExtensionDiagnostic({
          ownerKey,
          stableDetail: `missing-feature-gate:${requiredGate}`,
          message: `Extension transfer requires enabled feature gate ${requiredGate}.`,
        }),
      ],
    };
  }

  const coreDiagnostics = validateCoreExtensionOperands(input);
  if (coreDiagnostics.length > 0) {
    return { kind: "error", diagnostics: coreDiagnostics };
  }

  const dependencyKeys = input.dependencyKeys ?? new Set<string>();
  const request = buildExtensionTransferRequest(input);
  const validation = validateProofSemanticsJudgmentResult({
    companion: input.companion,
    request,
    dependencyKeys,
  });

  if (validation.kind === "error") {
    return {
      kind: "error",
      diagnostics: remapDiagnostics(
        validation.diagnostics,
        ownerKey,
        "PROOF_CHECK_UNSAFE_EXTENSION",
      ),
    };
  }

  if (validation.result.kind !== "extensionTransfer") {
    return {
      kind: "error",
      diagnostics: [
        unsafeExtensionDiagnostic({
          ownerKey,
          stableDetail: "missing-companion-judgment:extensionTransfer",
          message: "Missing companion judgment: extensionTransfer.",
        }),
      ],
    };
  }

  const extensionResult = validation.result as ProofExtensionTransferJudgmentResult;
  const patch = {
    ...extensionResult.patch,
    constraints: {
      ...extensionResult.patch.constraints,
      allowedExtensionEntryKinds:
        extensionResult.patch.constraints?.allowedExtensionEntryKinds ??
        input.schema.allowedExtensionEntryKinds,
    },
  } satisfies ProofCheckStatePatch<"extensionTransfer">;

  const packetDiagnostics = validatePacketEntryKeys(
    extensionResult.packetEntryKeys,
    input.schema,
    ownerKey,
  );
  if (packetDiagnostics.length > 0) {
    return { kind: "error", diagnostics: packetDiagnostics };
  }

  const applied = applyCompanionPatch({
    state: input.state,
    patch,
    transitionId: input.transitionId,
    ownerKey,
  });
  if (applied.kind === "error") {
    return applied;
  }

  return {
    kind: "ok",
    state: applied.state,
    patch: proofCheckStatePatchWithTransitionId(patch, input.transitionId),
    packetEntryKeys: [...extensionResult.packetEntryKeys],
  };
}
