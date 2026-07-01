import type { AArch64SemanticCandidate } from "../select/semantic-superselector";
import { aarch64SelectionPatternById } from "../select/pattern-catalog";
import type {
  AArch64MachineVerifierContext,
  AArch64MachineVerifierDescriptor,
} from "./verifier-suite";

export const aarch64SuperselectionVerifierDescriptor: AArch64MachineVerifierDescriptor = {
  key: "superselection",
  verify(context) {
    return (context.semanticCandidates ?? []).flatMap((candidate) =>
      verifyAArch64Superselection({
        candidate,
        manifestLiveOuts: context.semanticManifestLiveOuts?.[candidate.patternId],
        context,
      }),
    );
  },
};

export function verifyAArch64Superselection(input: {
  readonly candidate: AArch64SemanticCandidate;
  readonly manifestLiveOuts: readonly string[] | undefined;
  readonly context: AArch64MachineVerifierContext;
}) {
  const diagnostics = [];
  const targetProfileFeatures = new Set(input.context.targetProfileFeatures ?? ["BASE_A64"]);
  if (input.manifestLiveOuts === undefined) {
    diagnostics.push(
      input.context.makeDiagnostic({
        code: "AARCH64_SUPERSELECTION_INVALID",
        ownerKey: input.candidate.patternId,
        rootCauseKey: input.candidate.patternId,
        stableDetail: "semantic-candidate:unknown-manifest",
      }),
    );
  }
  const manifestRecord = aarch64SelectionPatternById(input.candidate.patternId);
  if (manifestRecord !== undefined && input.candidate.consumedOperations.length === 0) {
    diagnostics.push(
      input.context.makeDiagnostic({
        code: "AARCH64_SUPERSELECTION_INVALID",
        ownerKey: input.candidate.patternId,
        rootCauseKey: input.candidate.patternId,
        stableDetail: "semantic-boundary:empty-consumed-operations",
      }),
    );
  }
  if (manifestRecord !== undefined && manifestRecord.requiredFacts.length > 0) {
    const factsUsed = input.candidate.factsUsed ?? [];
    if (factsUsed.length === 0) {
      diagnostics.push(
        input.context.makeDiagnostic({
          code: "AARCH64_SUPERSELECTION_INVALID",
          ownerKey: input.candidate.patternId,
          rootCauseKey: input.candidate.patternId,
          stableDetail: `semantic-boundary:missing-required-facts:${manifestRecord.requiredFacts.join(",")}`,
        }),
      );
    }
  }
  if (manifestRecord !== undefined) {
    for (const feature of manifestRecord.requiredProfileFeatures) {
      if (!targetProfileFeatures.has(feature)) {
        diagnostics.push(
          input.context.makeDiagnostic({
            code: "AARCH64_SUPERSELECTION_INVALID",
            ownerKey: input.candidate.patternId,
            rootCauseKey: feature,
            stableDetail: `semantic-boundary:missing-profile-feature:${feature}`,
          }),
        );
      }
    }
  }
  const consumedOperations = new Set<number>();
  for (const operationId of input.candidate.consumedOperations) {
    if (consumedOperations.has(operationId)) {
      diagnostics.push(
        input.context.makeDiagnostic({
          code: "AARCH64_SUPERSELECTION_INVALID",
          ownerKey: input.candidate.patternId,
          rootCauseKey: `operation:${operationId}`,
          stableDetail: `semantic-boundary:duplicated-consumed-operation:${operationId}`,
        }),
      );
    }
    consumedOperations.add(operationId);
  }
  if (manifestRecord !== undefined && input.context.semanticOperationKindsById !== undefined) {
    for (const operationId of input.candidate.consumedOperations) {
      const operationKind = input.context.semanticOperationKindsById[operationId];
      if (operationKind === undefined) {
        diagnostics.push(
          input.context.makeDiagnostic({
            code: "AARCH64_SUPERSELECTION_INVALID",
            ownerKey: input.candidate.patternId,
            rootCauseKey: `operation:${operationId}`,
            stableDetail: `semantic-boundary:missing-consumed-operation:${operationId}`,
          }),
        );
        continue;
      }
      if (!manifestRecord.coveredOperationKinds.includes(operationKind)) {
        diagnostics.push(
          input.context.makeDiagnostic({
            code: "AARCH64_SUPERSELECTION_INVALID",
            ownerKey: input.candidate.patternId,
            rootCauseKey: `operation:${operationId}`,
            stableDetail: `semantic-boundary:operation-kind-mismatch:${operationId}:${operationKind}`,
          }),
        );
      }
    }
  }
  const manifest = new Set(input.manifestLiveOuts ?? []);
  diagnostics.push(
    ...input.candidate.liveOuts
      .filter((liveOut) => !manifest.has(liveOut))
      .map((liveOut) =>
        input.context.makeDiagnostic({
          code: "AARCH64_SUPERSELECTION_INVALID",
          ownerKey: input.candidate.patternId,
          rootCauseKey: liveOut,
          stableDetail: "semantic-boundary:hidden-live-out",
        }),
      ),
  );
  const manifestEffects = new Set(manifestRecord?.declaredEffects ?? []);
  const seenEffects = new Set<string>();
  for (const effect of input.candidate.effects) {
    if (seenEffects.has(effect)) {
      diagnostics.push(
        input.context.makeDiagnostic({
          code: "AARCH64_SUPERSELECTION_INVALID",
          ownerKey: input.candidate.patternId,
          rootCauseKey: effect,
          stableDetail: "semantic-boundary:duplicated-effect",
        }),
      );
    }
    seenEffects.add(effect);
    if (manifestRecord !== undefined && !manifestEffects.has(effect)) {
      diagnostics.push(
        input.context.makeDiagnostic({
          code: "AARCH64_SUPERSELECTION_INVALID",
          ownerKey: input.candidate.patternId,
          rootCauseKey: effect,
          stableDetail: "semantic-boundary:hidden-effect",
        }),
      );
    }
  }
  return diagnostics;
}
