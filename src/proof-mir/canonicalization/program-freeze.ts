import type { LayoutFactProgram } from "../../layout/layout-program";
import type { MonoInstanceId } from "../../mono/ids";
import type { MonoExternalRootReason } from "../../mono/mono-hir";
import type { MonoFunctionInstance, MonoProofMetadata } from "../../mono/mono-hir";
import type { ProofMirRuntimeCatalog } from "../../runtime/runtime-catalog-types";
import { sortProofMirDiagnostics, type ProofMirDiagnostic } from "../diagnostics";
import { compareCodeUnitStrings } from "../../semantic/surface/deterministic-sort";
import type { DraftProofMirFunctionDraft, DraftProofMirProgramDraft } from "../draft/draft-program";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import { proofMirDeterministicTable } from "./canonical-order";
import { collectProofMirDiagnostics, requireProofMirCanonicalKeyReference } from "./id-assignment";
import type {
  ProofMirExternalRoot,
  ProofMirFunction,
  ProofMirImage,
  ProofMirProgram,
} from "../model/program";
import { freezeFunctionDraft } from "./program-freeze-function-draft";
import { freezeProgramLevelTables } from "./program-freeze-program-tables";
import { functionCanonicalKey } from "./program-freeze-shared";

export interface FreezeDraftProgramExternalRootInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: MonoExternalRootReason;
  readonly originKey: ProofMirCanonicalKey;
}

export interface FreezeDraftProgramImageInput {
  readonly imageInstanceId: MonoInstanceId;
  readonly entryFunctionInstanceId: MonoInstanceId;
  readonly externalRoots: readonly FreezeDraftProgramExternalRootInput[];
  readonly layout: ProofMirImage["layout"];
  readonly originKey: ProofMirCanonicalKey;
}

export interface FreezeDraftProgramInput {
  readonly programDraft: DraftProofMirProgramDraft;
  readonly functions: readonly DraftProofMirFunctionDraft[];
  readonly functionInstances: ReadonlyMap<MonoInstanceId, MonoFunctionInstance>;
  readonly layout: LayoutFactProgram;
  readonly proofMetadata: MonoProofMetadata;
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
  readonly image: FreezeDraftProgramImageInput;
}

export type FreezeDraftProgramResult =
  | { readonly kind: "ok"; readonly program: ProofMirProgram }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function freezeDraftProgram(input: FreezeDraftProgramInput): FreezeDraftProgramResult {
  const diagnostics: ProofMirDiagnostic[] = [];

  const programTables = freezeProgramLevelTables({
    programDraft: input.programDraft,
    functionDrafts: input.functions,
    diagnostics,
  });
  if (programTables === "error") {
    return { kind: "error", diagnostics: collectProofMirDiagnostics(diagnostics) };
  }

  const frozenFunctions: ProofMirFunction[] = [];
  const sortedFunctionDrafts = [...input.functions].sort((left, right) =>
    compareCodeUnitStrings(String(left.functionInstanceId), String(right.functionInstanceId)),
  );
  for (const functionDraft of sortedFunctionDrafts) {
    const frozenFunction = freezeFunctionDraft({
      functionDraft,
      functionInstance: input.functionInstances.get(functionDraft.functionInstanceId),
      proofMetadata: input.proofMetadata,
      programLookups: {
        factLookup: programTables.factLookup,
        layoutTermLookup: programTables.layoutTermLookup,
        privateStateGenerationLookup: programTables.privateStateGenerationLookup,
        privateStateGenerationRecords: programTables.privateStateGenerationRecords,
        resolveProgramOrigin: (key, referenceKind) =>
          requireProofMirCanonicalKeyReference({
            lookup: programTables.originLookup,
            key,
            referenceKind,
            ownerKey: "program",
            diagnostics,
          }),
      },
      diagnostics,
    });
    if (frozenFunction === "error") {
      return { kind: "error", diagnostics: collectProofMirDiagnostics(diagnostics) };
    }
    frozenFunctions.push(frozenFunction);
  }

  const imageOrigin = requireProofMirCanonicalKeyReference({
    lookup: programTables.originLookup,
    key: input.image.originKey,
    referenceKind: "imageOriginKey",
    ownerKey: "image",
    diagnostics,
  });
  if (imageOrigin === undefined) {
    return { kind: "error", diagnostics: collectProofMirDiagnostics(diagnostics) };
  }

  const frozenExternalRoots: ProofMirExternalRoot[] = [];
  for (const externalRoot of input.image.externalRoots) {
    const origin = requireProofMirCanonicalKeyReference({
      lookup: programTables.originLookup,
      key: externalRoot.originKey,
      referenceKind: "externalRootOriginKey",
      ownerKey: `function:${String(externalRoot.functionInstanceId)}`,
      diagnostics,
    });
    if (origin === undefined) {
      return { kind: "error", diagnostics: collectProofMirDiagnostics(diagnostics) };
    }
    frozenExternalRoots.push({
      functionInstanceId: externalRoot.functionInstanceId,
      reason: externalRoot.reason,
      origin,
    });
  }

  const functionsTable = proofMirDeterministicTable({
    entries: frozenFunctions,
    keyOf: (func) => functionCanonicalKey(func.functionInstanceId),
    lookupKeyOf: (id: MonoInstanceId) => functionCanonicalKey(id),
    normalizePayload: (func) => String(func.functionInstanceId),
  });
  if (functionsTable.kind === "error") {
    return {
      kind: "error",
      diagnostics: sortProofMirDiagnostics([...diagnostics, ...functionsTable.diagnostics]),
    };
  }

  const image: ProofMirImage = {
    imageInstanceId: input.image.imageInstanceId,
    entryFunctionInstanceId: input.image.entryFunctionInstanceId,
    externalRoots: frozenExternalRoots,
    layout: input.image.layout,
    origin: imageOrigin,
  };

  return {
    kind: "ok",
    program: {
      image,
      functions: functionsTable.table,
      layout: input.layout,
      proofMetadata: input.proofMetadata,
      origins: programTables.origins,
      facts: programTables.facts,
      layoutTerms: programTables.layoutTerms,
      privateStateGenerations: programTables.privateStateGenerations,
      callGraph: programTables.callGraph,
      platformEdges: programTables.platformEdges,
      runtimeCatalog: input.runtimeCatalog,
      runtimeCalls: programTables.runtimeCalls,
    },
  };
}
