import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import type { MonomorphizedHirProgram } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirOwnedCallIdKey } from "../ids";
import type { DraftProofMirFact } from "../domains/fact-recording";
import type { ProofMirLayoutBindingIndex } from "../domains/layout-binding-index";
import type { ProofMirFactRecorder } from "../domains/fact-recording";
import type {
  DraftRecordedProofMirPlatformEdge,
  ProofMirCallLoweringRecorder,
} from "../lower/call-lowerer";
import type { DraftProofMirBuildContext } from "./draft-builder-context";
import type {
  DraftProofMirCanonicalTableAcceptResult,
  DraftProofMirFunctionDraft,
  DraftProofMirProgramDraft,
} from "./draft-program";

function acceptOrCollectDiagnostic(
  buildContext: DraftProofMirBuildContext,
  result: DraftProofMirCanonicalTableAcceptResult,
): void {
  if (result.kind === "error") {
    for (const diagnostic of result.diagnostics) {
      buildContext.addDiagnostic(diagnostic);
    }
  }
}

function platformEdgeDraftKey(
  edgeId: DraftRecordedProofMirPlatformEdge["edgeId"],
): ProofMirCanonicalKey {
  return proofMirCanonicalKey(`platformEdge:${proofMetadataIdKey(edgeId)}`);
}

function callByIdFromFunctionDrafts(input: {
  readonly buildContext: DraftProofMirBuildContext;
  readonly program: MonomorphizedHirProgram;
}): Map<
  string,
  { readonly callKey: ProofMirCanonicalKey; readonly originKey: ProofMirCanonicalKey }
> {
  const callById = new Map<
    string,
    { readonly callKey: ProofMirCanonicalKey; readonly originKey: ProofMirCanonicalKey }
  >();
  for (const functionInstance of input.program.functions.entries()) {
    const functionDraft = input.buildContext.functionDraft(functionInstance.instanceId);
    if (functionDraft === undefined) {
      continue;
    }
    for (const call of functionDraft.calls.entries()) {
      callById.set(`${String(call.functionInstanceId)}:${String(call.callId)}`, {
        callKey: call.key,
        originKey: call.originKey,
      });
    }
  }
  return callById;
}

export function mergeCallRecorderIntoProgramDraft(input: {
  readonly programDraft: DraftProofMirProgramDraft;
  readonly callRecorder: ProofMirCallLoweringRecorder;
  readonly buildContext: DraftProofMirBuildContext;
  readonly program: MonomorphizedHirProgram;
}): void {
  const callById = callByIdFromFunctionDrafts({
    buildContext: input.buildContext,
    program: input.program,
  });

  for (const edge of input.callRecorder.callGraphEdges) {
    const matchingCall = callById.get(
      `${String(edge.callId.functionInstanceId)}:${String(edge.callId.callId)}`,
    );
    if (matchingCall === undefined) {
      continue;
    }
    acceptOrCollectDiagnostic(
      input.buildContext,
      input.programDraft.callGraph.accept({
        key: proofMirCanonicalKey(`callGraph:${proofMirOwnedCallIdKey(edge.callId)}`),
        callKey: matchingCall.callKey,
        functionInstanceId: edge.callId.functionInstanceId,
        callId: edge.callId,
        target: edge.target,
        originKey: edge.originKey,
      }),
    );
  }

  for (const edge of input.callRecorder.platformEdges) {
    acceptOrCollectDiagnostic(
      input.buildContext,
      input.programDraft.platformEdges.accept({
        key: platformEdgeDraftKey(edge.edgeId),
        edgeId: edge.edgeId,
        primitiveId: edge.primitiveId,
        abi: edge.abi,
        originKey: edge.originKey,
      }),
    );
  }

  for (const contract of input.callRecorder.runtimeCalls) {
    const matchingCall = callById.get(
      `${String(contract.callId.functionInstanceId)}:${String(contract.callId.callId)}`,
    );
    if (matchingCall === undefined) {
      continue;
    }
    acceptOrCollectDiagnostic(
      input.buildContext,
      input.programDraft.runtimeCalls.accept({
        key: proofMirCanonicalKey(`runtimeCall:${String(contract.runtimeCallId)}`),
        functionInstanceId: contract.callId.functionInstanceId,
        callKey: matchingCall.callKey,
        originKey: matchingCall.originKey,
        runtimeCallId: contract.runtimeCallId,
        runtimeId: contract.runtimeId,
        callId: contract.callId,
        requiredFactKeys: [...contract.requiredFactKeys],
        consumedCapabilityPlaceKeys: [...contract.consumedCapabilityPlaceKeys],
        producedCapabilityPlaceKeys: [...contract.producedCapabilityPlaceKeys],
        effects: [...contract.effects],
      }),
    );
  }

  for (const fact of input.callRecorder.ensuredFacts) {
    acceptOrCollectDiagnostic(
      input.buildContext,
      input.programDraft.facts.accept(factDraftRecord(fact)),
    );
    acceptOrCollectDiagnostic(
      input.buildContext,
      input.programDraft.origins.accept({
        key: fact.originKey,
        ownerKey: "program",
        note: `fact:${fact.kind.kind}`,
      }),
    );
  }
}

export function mergeFunctionLoweringIntoProgramDraft(input: {
  readonly programDraft: DraftProofMirProgramDraft;
  readonly functionDraft: DraftProofMirFunctionDraft;
  readonly factRecorder: ProofMirFactRecorder;
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly buildContext: DraftProofMirBuildContext;
}): void {
  for (const origin of input.functionDraft.origins.entries()) {
    acceptOrCollectDiagnostic(input.buildContext, input.programDraft.origins.accept(origin));
  }

  for (const fact of input.factRecorder.entries()) {
    acceptOrCollectDiagnostic(
      input.buildContext,
      input.programDraft.facts.accept(factDraftRecord(fact)),
    );
  }

  for (const layoutTerm of input.layoutBindingIndex.layoutTermRecords()) {
    acceptOrCollectDiagnostic(
      input.buildContext,
      input.programDraft.layoutTerms.accept(layoutTerm),
    );
  }

  for (const generation of input.factRecorder.privateStateGenerations()) {
    acceptOrCollectDiagnostic(
      input.buildContext,
      input.programDraft.privateStateGenerations.accept({
        key: generation.canonicalKey,
        functionInstanceId: generation.functionInstanceId,
        placeKey: generation.placeKey,
        generationOrdinal: generation.generationOrdinal,
        originKey: generation.originKey,
        ...(generation.previousGenerationKey === undefined
          ? {}
          : { previousGenerationKey: generation.previousGenerationKey }),
        ...(generation.producedBy === undefined ? {} : { producedBy: generation.producedBy }),
      }),
    );
  }
}

function factDraftRecord(fact: DraftProofMirFact) {
  return {
    key: fact.canonicalKey,
    role: fact.role,
    kind: fact.kind.kind,
    authorityKey: authorityKeyForDraftFact(fact),
    originKey: fact.originKey,
    factKind: fact.kind,
    dependsOn: fact.dependsOn,
  };
}

function authorityKeyForDraftFact(fact: DraftProofMirFact): string {
  switch (fact.kind.kind) {
    case "platformEnsured":
      return `platformEnsured:${proofMetadataIdKey(fact.kind.edgeId)}`;
    case "runtimeEnsured":
      return `runtimeEnsured:${String(fact.kind.runtimeCallId)}`;
    case "terminalCall":
      return `terminalCall:${proofMetadataIdKey(fact.kind.terminalCallId)}`;
    default:
      return `${fact.kind.kind}:${String(fact.canonicalKey)}`;
  }
}
