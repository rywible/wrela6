export {
  assignProofMirDenseIds,
  buildProofMirCanonicalKeyLookup,
  buildProofMirFrozenDeterministicTable,
  collectProofMirDiagnostics,
  requireProofMirCanonicalKeyReference,
} from "./canonicalization/id-assignment";
export type {
  ProofMirCanonicalKeyLookup,
  ProofMirDenseIdAssignmentResult,
} from "./canonicalization/id-assignment";

export { freezeDraftProgram } from "./canonicalization/program-freeze";
export type {
  FreezeDraftProgramExternalRootInput,
  FreezeDraftProgramImageInput,
  FreezeDraftProgramInput,
  FreezeDraftProgramResult,
} from "./canonicalization/program-freeze";

export {
  createDraftProofMirBuildContext,
  createEmptyDraftProofMirFunctionDraft,
} from "./draft/draft-builder-context";
export type {
  CreateDraftProofMirBuildContextInput,
  DraftProofMirBuildContext,
  DraftProofMirBuildTargetContext,
} from "./draft/draft-builder-context";

export {
  createDraftProofMirCanonicalTable,
  createEmptyDraftProofMirProgramDraft,
} from "./draft/draft-program";
export type {
  DraftProofMirBlockRecord,
  DraftProofMirCallRecord,
  DraftProofMirCanonicalTable,
  DraftProofMirCanonicalTableAcceptResult,
  DraftProofMirControlEdgeRecord,
  DraftProofMirExitEdgeRecord,
  DraftProofMirFactRecord,
  DraftProofMirFunctionDraft,
  DraftProofMirLayoutTermRecord,
  DraftProofMirLocalRecord,
  DraftProofMirOriginRecord,
  DraftProofMirPlaceRecord,
  DraftProofMirPrivateStateGenerationRecord,
  DraftProofMirProgramDraft,
  DraftProofMirRuntimeCallRecord,
  DraftProofMirScopeRecord,
  DraftProofMirStatementRecord,
  DraftProofMirTerminatorRecord,
  DraftProofMirValueRecord,
} from "./draft/draft-program";

export {
  draftBlockKey,
  draftCallKey,
  draftControlEdgeKey,
  draftExitEdgeKey,
  draftFactKey,
  draftLayoutTermKey,
  draftLocalKey,
  draftOriginKey,
  draftPlaceKey,
  draftPrivateStateGenerationKey,
  draftRuntimeCallKey,
  draftScopeKey,
  draftStatementKey,
  draftTerminatorKey,
  draftValueKey,
} from "./draft/draft-keys";
export type { DraftProofMirOriginOwner } from "./draft/draft-keys";

export {
  buildProofMirDraftProgram,
  type BuildProofMirDraftProgramOptions,
  type BuildProofMirDraftProgramInput,
  type BuildProofMirDraftProgramResult,
} from "./proof-mir-builder";
export {
  createBranchingControlFlowLowerer,
  createWiredProofMirLoweringRegistry,
} from "./lower/lowering-registry-wiring";
export type { ResolvedLoweringRegistryResult } from "./lower/lowering-registry-wiring";

/** @deprecated Use `buildProofMirDraftProgram` instead. */
export { buildProofMirDraftProgram as buildProofMirDraftProgramForTest } from "./proof-mir-builder";
/** @deprecated Use `BuildProofMirDraftProgramOptions` instead. */
export type { BuildProofMirDraftProgramOptions as BuildProofMirDraftProgramForTestOptions } from "./proof-mir-builder";
/** @deprecated Use `createWiredProofMirLoweringRegistry` instead. */
export { createWiredProofMirLoweringRegistry as createProofMirLoweringRegistryForTest } from "./lower/lowering-registry-wiring";
