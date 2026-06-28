import type { LayoutFactProgram } from "../layout/layout-program";
import type { MonomorphizedHirProgram, MonoReachableFunction } from "../mono/mono-hir";
import type { ProofMirRuntimeCatalog } from "../runtime/runtime-catalog-types";
import type { TargetId } from "../semantic/ids";
import {
  freezeDraftProgram,
  type FreezeDraftProgramExternalRootInput,
} from "./canonicalization/program-freeze";
import {
  createDraftProofMirBuildContext,
  type CreateDraftProofMirBuildContextInput,
  type DraftProofMirBuildContext,
  type DraftProofMirBuildTargetContext,
} from "./draft/draft-builder-context";
import type { DraftProofMirFunctionDraft, DraftProofMirProgramDraft } from "./draft/draft-program";
import { compareCodeUnitStrings } from "../semantic/surface/deterministic-sort";
import { draftOriginKey } from "./draft/draft-keys";
import { mergeCallRecorderIntoProgramDraft } from "./draft/program-draft-merge";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "./diagnostics";
import {
  createCallLoweringRecorder,
  type ProofMirCallLoweringRecorder,
} from "./lower/call-lowerer";
import {
  lowerProofMirFunction,
  type ProofMirFunctionLowererBuildInput,
} from "./lower/function-lowerer";
import {
  createWiredProofMirLoweringRegistry,
  type ResolvedLoweringRegistryResult,
} from "./lower/lowering-registry-wiring";
import { validateProofMirBuildInputCompatibility } from "./validation/input-compatibility-validator";
import { validateProofMirGraph, type ProofMirValidatorProgram } from "./validation/graph-validator";
import { validateProofMirOperands } from "./validation/operand-validator";
import { validateProofMirEffects } from "./validation/effect-validator";
import { validateProofMirFacts } from "./validation/fact-validator";
import { validateProofMirCalls } from "./validation/call-validator";
import { validateProofMirLayout } from "./validation/layout-validator";
import type { ProofMirCanonicalKey } from "./canonicalization/canonical-keys";
import type { ProofMirProgram } from "./model/program";

function registerReachableFunctionOrigins(input: {
  readonly programDraft: DraftProofMirProgramDraft;
  readonly program: MonomorphizedHirProgram;
  readonly diagnostics: ProofMirDiagnostic[];
  readonly loweredFunctionInstanceIds: ReadonlySet<string>;
}): void {
  for (const reachableFunction of input.program.reachableFunctions.entries()) {
    if (!input.loweredFunctionInstanceIds.has(String(reachableFunction.functionInstanceId))) {
      continue;
    }
    if (reachableFunction.reason !== "sourceCall") {
      continue;
    }
    const originKey = draftOriginKey({
      owner: { kind: "function", functionInstanceId: reachableFunction.functionInstanceId },
      hirOriginId: reachableFunction.origin,
      note: `reachable-function:${reachableFunction.reason}`,
    });
    acceptProgramOrigin(
      input.programDraft,
      {
        key: originKey,
        ownerKey: `function:${String(reachableFunction.functionInstanceId)}`,
        note: `reachable-function:${reachableFunction.reason}`,
        sourceOrigin: String(reachableFunction.origin),
      },
      input.diagnostics,
    );
  }
}

export interface ProofMirBuildTargetContext {
  readonly targetId: TargetId;
  readonly features: readonly string[];
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
}

export interface BuildProofMirInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: ProofMirBuildTargetContext;
}

export type BuildProofMirResult =
  | {
      readonly kind: "ok";
      readonly mir: ProofMirProgram;
      readonly diagnostics: readonly ProofMirDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly ProofMirDiagnostic[];
    };

export interface BuildProofMirDraftProgramInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: DraftProofMirBuildTargetContext;
}

export interface BuildProofMirDraftProgramOptions {
  readonly registryFactory?: (input: {
    readonly callRecorder: ProofMirCallLoweringRecorder;
  }) => ResolvedLoweringRegistryResult;
}

export type BuildProofMirDraftProgramResult =
  | {
      readonly kind: "ok";
      readonly buildContext: DraftProofMirBuildContext;
      readonly programDraft: DraftProofMirProgramDraft;
      readonly callRecorder: ProofMirCallLoweringRecorder;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly ProofMirDiagnostic[];
      readonly traceContext: DraftProofMirBuildContext;
    };

function toBuildContextInput(
  input: BuildProofMirDraftProgramInput,
): CreateDraftProofMirBuildContextInput {
  return {
    program: input.program,
    layout: input.layout,
    target: input.target,
  };
}

function toFunctionBuildInput(
  input: BuildProofMirDraftProgramInput,
): ProofMirFunctionLowererBuildInput {
  return {
    program: input.program,
    layout: input.layout,
    target: input.target,
  };
}

function hasSuccessfulFunctionDrafts(buildContext: DraftProofMirBuildContext): boolean {
  for (const functionInstance of buildContext.program.functions.entries()) {
    if (functionInstance.bodyStatus !== "sourceBody") {
      continue;
    }
    if (buildContext.isFunctionFailed(functionInstance.instanceId)) {
      continue;
    }
    if (buildContext.functionDraft(functionInstance.instanceId) !== undefined) {
      return true;
    }
  }
  return false;
}

export function buildProofMirDraftProgram(
  input: BuildProofMirDraftProgramInput,
  options?: BuildProofMirDraftProgramOptions,
): BuildProofMirDraftProgramResult {
  const compatibilityDiagnostics = validateProofMirBuildInputCompatibility({
    program: input.program,
    layout: input.layout,
    target: input.target,
  });
  if (compatibilityDiagnostics.length > 0) {
    const buildContext = createDraftProofMirBuildContext(toBuildContextInput(input));
    for (const diagnostic of compatibilityDiagnostics) {
      buildContext.addDiagnostic(diagnostic);
    }
    return {
      kind: "error",
      diagnostics: buildContext.diagnostics(),
      traceContext: buildContext,
    };
  }

  const buildContext = createDraftProofMirBuildContext(toBuildContextInput(input));
  const functionBuildInput = toFunctionBuildInput(input);
  let hadFunctionLoweringError = false;
  const sharedCallRecorder = createCallLoweringRecorder();

  for (const functionInstance of input.program.functions.entries()) {
    const registryResult =
      options?.registryFactory !== undefined
        ? options.registryFactory({ callRecorder: sharedCallRecorder })
        : createWiredProofMirLoweringRegistry({ callRecorder: sharedCallRecorder });
    if (registryResult.kind === "error") {
      for (const diagnostic of registryResult.diagnostics) {
        buildContext.addDiagnostic(diagnostic);
      }
      return {
        kind: "error",
        diagnostics: buildContext.diagnostics(),
        traceContext: buildContext,
      };
    }

    const lowered = lowerProofMirFunction({
      buildInput: functionBuildInput,
      buildContext,
      registry: registryResult.registry,
      functionInstance,
    });

    if (lowered.kind === "error") {
      hadFunctionLoweringError = true;
      const seen = new Set(
        buildContext
          .diagnostics()
          .map((diagnostic) => `${diagnostic.code}|${diagnostic.stableDetail}`),
      );
      for (const diagnostic of lowered.diagnostics) {
        const key = `${diagnostic.code}|${diagnostic.stableDetail}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        buildContext.addDiagnostic(diagnostic);
      }
    }
  }

  const diagnostics = buildContext.diagnostics();
  const hasErrorDiagnostic = diagnostics.some((diagnostic) => diagnostic.severity === "error");

  if (hadFunctionLoweringError || hasErrorDiagnostic) {
    return {
      kind: "error",
      diagnostics,
      traceContext: buildContext,
    };
  }

  if (!hasSuccessfulFunctionDrafts(buildContext)) {
    buildContext.addDiagnostic(
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_FUNCTION_BODY",
        message: "Proof MIR build produced no successful source-body function drafts.",
        ownerKey: "program",
        rootCauseKey: "function-body",
        stableDetail: "no-successful-source-body-drafts",
      }),
    );
    return {
      kind: "error",
      diagnostics: buildContext.diagnostics(),
      traceContext: buildContext,
    };
  }

  return {
    kind: "ok",
    buildContext,
    programDraft: buildContext.programDraft,
    callRecorder: sharedCallRecorder,
  };
}

function buildProofMirErrorResult(diagnostics: readonly ProofMirDiagnostic[]): BuildProofMirResult {
  return {
    kind: "error",
    diagnostics: sortProofMirDiagnostics(diagnostics),
  };
}

function structuralValidatorProgram(program: ProofMirProgram): ProofMirValidatorProgram {
  return {
    functions: program.functions.entries(),
  };
}

function runStructuralValidators(program: ProofMirProgram): ProofMirDiagnostic[] {
  const adapted = structuralValidatorProgram(program);
  return sortProofMirDiagnostics([
    ...validateProofMirGraph(adapted),
    ...validateProofMirOperands(adapted),
    ...validateProofMirEffects(adapted),
    ...validateProofMirFacts(program),
    ...validateProofMirCalls(program),
    ...validateProofMirLayout(program),
  ]);
}

function collectSuccessfulFunctionDrafts(
  buildContext: DraftProofMirBuildContext,
  program: MonomorphizedHirProgram,
): DraftProofMirFunctionDraft[] {
  const functionDrafts: DraftProofMirFunctionDraft[] = [];
  for (const functionInstance of program.functions.entries()) {
    const functionDraft = buildContext.functionDraft(functionInstance.instanceId);
    if (functionDraft !== undefined) {
      functionDrafts.push(functionDraft);
    }
  }
  return functionDrafts.sort((left, right) =>
    compareCodeUnitStrings(String(left.functionInstanceId), String(right.functionInstanceId)),
  );
}

function reachableFunctionsForProofMirProgram(input: {
  readonly program: MonomorphizedHirProgram;
  readonly functionDrafts: readonly DraftProofMirFunctionDraft[];
}): readonly MonoReachableFunction[] {
  const loweredFunctionIds = new Set(
    input.functionDrafts.map((functionDraft) => String(functionDraft.functionInstanceId)),
  );
  return input.program.reachableFunctions
    .entries()
    .filter((reachableFunction) =>
      loweredFunctionIds.has(String(reachableFunction.functionInstanceId)),
    );
}

function acceptProgramOrigin(
  programDraft: DraftProofMirProgramDraft,
  input: {
    readonly key: ProofMirCanonicalKey;
    readonly ownerKey: string;
    readonly note: string;
    readonly sourceOrigin?: string;
  },
  diagnostics: ProofMirDiagnostic[],
): void {
  const acceptResult = programDraft.origins.accept({
    key: input.key,
    ownerKey: input.ownerKey,
    note: input.note,
    ...(input.sourceOrigin === undefined ? {} : { sourceOrigin: input.sourceOrigin }),
  });
  if (acceptResult.kind === "error") {
    for (const diagnostic of acceptResult.diagnostics) {
      diagnostics.push(diagnostic);
    }
  }
}

function registerProgramLevelOrigins(input: {
  readonly programDraft: DraftProofMirProgramDraft;
  readonly program: MonomorphizedHirProgram;
  readonly diagnostics: ProofMirDiagnostic[];
}): {
  readonly imageOriginKey: ProofMirCanonicalKey;
  readonly externalRoots: readonly FreezeDraftProgramExternalRootInput[];
} {
  const imageInstanceId = input.program.image.instanceId;
  const imageOriginKey = draftOriginKey({
    owner: { kind: "image", imageInstanceId },
    note: "image-entry",
  });
  acceptProgramOrigin(
    input.programDraft,
    {
      key: imageOriginKey,
      ownerKey: `image:${String(imageInstanceId)}`,
      note: "image-entry",
    },
    input.diagnostics,
  );

  const externalRoots: FreezeDraftProgramExternalRootInput[] = [];
  for (const externalRoot of input.program.externalRoots) {
    const externalRootOriginKey = draftOriginKey({
      owner: { kind: "function", functionInstanceId: externalRoot.functionInstanceId },
      hirOriginId: externalRoot.origin,
      note: `external-root:${externalRoot.reason}`,
    });
    acceptProgramOrigin(
      input.programDraft,
      {
        key: externalRootOriginKey,
        ownerKey: `function:${String(externalRoot.functionInstanceId)}`,
        note: `external-root:${externalRoot.reason}`,
        sourceOrigin: String(externalRoot.origin),
      },
      input.diagnostics,
    );
    externalRoots.push({
      functionInstanceId: externalRoot.functionInstanceId,
      reason: externalRoot.reason,
      originKey: externalRootOriginKey,
    });
  }

  return { imageOriginKey, externalRoots };
}

function nonErrorDiagnostics(
  diagnostics: readonly ProofMirDiagnostic[],
): readonly ProofMirDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity !== "error");
}

export function buildProofMir(input: BuildProofMirInput): BuildProofMirResult {
  const draftResult = buildProofMirDraftProgram(input);
  if (draftResult.kind === "error") {
    return buildProofMirErrorResult(draftResult.diagnostics);
  }

  const entryFunctionInstanceId = input.program.image.entryFunctionInstanceId;
  if (entryFunctionInstanceId === undefined) {
    return buildProofMirErrorResult(draftResult.buildContext.diagnostics());
  }

  const functionDrafts = collectSuccessfulFunctionDrafts(draftResult.buildContext, input.program);
  const loweredFunctionInstanceIds = new Set(
    functionDrafts.map((functionDraft) => String(functionDraft.functionInstanceId)),
  );

  const programLevelDiagnostics: ProofMirDiagnostic[] = [];
  registerReachableFunctionOrigins({
    programDraft: draftResult.programDraft,
    program: input.program,
    diagnostics: programLevelDiagnostics,
    loweredFunctionInstanceIds,
  });
  const { imageOriginKey, externalRoots } = registerProgramLevelOrigins({
    programDraft: draftResult.programDraft,
    program: input.program,
    diagnostics: programLevelDiagnostics,
  });
  if (programLevelDiagnostics.length > 0) {
    for (const diagnostic of programLevelDiagnostics) {
      draftResult.buildContext.addDiagnostic(diagnostic);
    }
    return buildProofMirErrorResult(draftResult.buildContext.diagnostics());
  }

  const functionInstances = new Map(
    input.program.functions
      .entries()
      .map((functionInstance) => [functionInstance.instanceId, functionInstance]),
  );

  if (draftResult.callRecorder !== undefined) {
    mergeCallRecorderIntoProgramDraft({
      programDraft: draftResult.programDraft,
      callRecorder: draftResult.callRecorder,
      buildContext: draftResult.buildContext,
      program: input.program,
    });
  }

  const freezeResult = freezeDraftProgram({
    programDraft: draftResult.programDraft,
    functions: functionDrafts,
    functionInstances,
    layout: input.layout,
    proofMetadata: input.program.proofMetadata,
    runtimeCatalog: input.target.runtimeCatalog,
    reachableFunctions: reachableFunctionsForProofMirProgram({
      program: input.program,
      functionDrafts,
    }),
    image: {
      imageInstanceId: input.program.image.instanceId,
      entryFunctionInstanceId,
      externalRoots,
      layout: {
        kind: "imageEntryAbi",
        imageInstanceId: input.program.image.instanceId,
      },
      originKey: imageOriginKey,
    },
  });

  const draftDiagnostics = draftResult.buildContext.diagnostics();
  if (freezeResult.kind === "error") {
    return buildProofMirErrorResult([...draftDiagnostics, ...freezeResult.diagnostics]);
  }

  const mir = freezeResult.program;

  const validationDiagnostics = runStructuralValidators(mir);
  const combinedDiagnostics = sortProofMirDiagnostics([
    ...draftDiagnostics,
    ...validationDiagnostics,
  ]);

  if (combinedDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return buildProofMirErrorResult(combinedDiagnostics);
  }

  return {
    kind: "ok",
    mir,
    diagnostics: nonErrorDiagnostics(combinedDiagnostics),
  };
}
