import type { MonoBlock } from "../../../../src/mono/mono-hir";
import type { LayoutFactProgram } from "../../../../src/layout/layout-program";
import type {
  MonoFunctionInstance,
  MonoLocal,
  MonomorphizedHirProgram,
} from "../../../../src/mono/mono-hir";
import type { MonoInstanceId } from "../../../../src/mono/ids";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { createProofMirCallTargetIndex } from "../../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../../src/proof-mir/domains/effects-resources";
import { createProofMirFactRecorder } from "../../../../src/proof-mir/domains/fact-recording";
import {
  createProofMirGraphSsa,
  proofMirSsaLocalKey,
} from "../../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../../src/proof-mir/draft/draft-builder-context";
import {
  createDraftGraphBuilder,
  type DraftGraphBuilder,
} from "../../../../src/proof-mir/draft/draft-graph-builder";
import { draftLocalKey } from "../../../../src/proof-mir/draft/draft-keys";
import type { ProofMirCallLoweringRecorder } from "../../../../src/proof-mir/lower/call-lowerer";
import {
  collectLoopCarriedLocalsForLoop,
  createProofMirLocalClassifier,
  placeBackedLocalsFromClassification,
} from "../../../../src/proof-mir/lower/local-classifier";
import {
  createProofMirLoweringContext,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
  type ProofMirLocalClassifier,
  type ProofMirLoweringContext,
  type ProofMirLoweringRegistry,
  type ProofMirLoweringResult,
  type ProofMirLoweringTargetContext,
} from "../../../../src/proof-mir/lower/lowering-context";
import { createWiredProofMirLoweringRegistry } from "../../../../src/proof-mir/lower/lowering-registry-wiring";
import {
  createProofMirScopePlaceLowerer,
  type ProofMirFunctionScopePlaceLowerer,
} from "../../../../src/proof-mir/lower/scope-place-lowerer";
import { targetId } from "../../../../src/semantic/ids";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function defaultTargetForLoweringHarness(): ProofMirLoweringTargetContext {
  return {
    targetId: targetId("x64-test"),
    features: [],
    runtimeCatalog: {
      targetId: targetId("x64-test"),
      features: [],
      get: () => undefined,
      entries: () => [],
    },
  };
}

function emptyProgramForLoweringHarness(): MonomorphizedHirProgram {
  return {
    functions: { entries: () => [], get: () => undefined },
  } as unknown as MonomorphizedHirProgram;
}

function seedScalarLocalsForLoweringHarness(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly graph: DraftGraphBuilder;
  readonly ssa: ReturnType<typeof createProofMirGraphSsa>;
  readonly entryBlock: ProofMirCanonicalKey;
  readonly locals: readonly MonoLocal[];
  readonly placeBackedLocalNames: ReadonlySet<string>;
}): void {
  const copyScalarParameters: {
    readonly ssaKey: ReturnType<typeof proofMirSsaLocalKey>;
    readonly valueKey: ProofMirCanonicalKey;
  }[] = [];
  for (const local of input.locals) {
    const origin = input.graph.allocateSyntheticOrigin(`local:${local.name}`);
    const localKey = draftLocalKey({
      functionInstanceId: input.functionInstanceId,
      monoLocalId: local.localId,
    });
    input.graph.createLocal({
      monoLocalId: local.localId,
      name: local.name,
      origin,
    });
    if (input.placeBackedLocalNames.has(local.name)) {
      input.graph.createPlace({
        monoPlaceCanonicalKey: `local:${local.name}`,
        origin,
      });
      continue;
    }
    const valueKey = input.graph.createValue({
      role: `seed:${local.name}`,
      origin,
    });
    copyScalarParameters.push({
      ssaKey: proofMirSsaLocalKey(localKey),
      valueKey,
    });
  }
  if (copyScalarParameters.length > 0) {
    input.ssa.createEntryParameters({
      blockKey: input.entryBlock,
      copyScalarParameters,
    });
    for (const parameter of copyScalarParameters) {
      input.ssa.defineScalar({
        blockKey: input.entryBlock,
        ssaKey: parameter.ssaKey,
        valueKey: parameter.valueKey,
      });
    }
  }
}

export interface CreateProofMirLoweringHarnessContextInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly functionInstance: MonoFunctionInstance;
  readonly locals: readonly MonoLocal[];
  readonly program?: MonomorphizedHirProgram;
  readonly layout?: LayoutFactProgram;
  readonly target?: ProofMirLoweringTargetContext;
  readonly placeBackedLocalNames?: ReadonlySet<string>;
  readonly collectLoopCarriedLocalsForLoop?: ProofMirLocalClassifier["collectLoopCarriedLocalsForLoop"];
  readonly placeBackedLocals?: ProofMirLocalClassifier["placeBackedLocals"];
}

export interface ProofMirLoweringHarnessContext {
  readonly context: ProofMirLoweringContext;
  readonly graph: DraftGraphBuilder;
  readonly registry: ProofMirLoweringRegistry;
  readonly entryBlockKey: ProofMirCanonicalKey;
  readonly scopePlaceLowerer: ProofMirFunctionScopePlaceLowerer;
  readonly callRecorder: ProofMirCallLoweringRecorder;
}

export function createProofMirLoweringHarnessContext(
  input: CreateProofMirLoweringHarnessContextInput,
): ProofMirLoweringResult<ProofMirLoweringHarnessContext> {
  const classifierResult = createProofMirLocalClassifier({
    functionInstance: input.functionInstance,
  });
  if (classifierResult.kind === "error") {
    return classifierResult;
  }

  const originMap = createProofMirOriginMap();
  const scopePlaceLowererResult = createProofMirScopePlaceLowerer({
    functionInstanceId: input.functionInstanceId,
    body: input.functionInstance.body as MonoBlock,
    originMap,
  });
  if (scopePlaceLowererResult.kind === "error") {
    return scopePlaceLowererResult;
  }
  const scopePlaceLowerer = scopePlaceLowererResult.value;

  const program = input.program ?? emptyProgramForLoweringHarness();
  const layout = input.layout ?? ({} as LayoutFactProgram);
  const target = input.target ?? defaultTargetForLoweringHarness();
  const placeBackedLocalNames = input.placeBackedLocalNames ?? new Set<string>();

  const graph = createDraftGraphBuilder({ functionInstanceId: input.functionInstanceId });
  const origin = graph.allocateSyntheticOrigin("entry");
  const entryBlockKey = graph.createBlock({
    role: "entry",
    scope: graph.rootScopeKey(),
    origin,
  });
  const ssa = createProofMirGraphSsa({
    functionInstanceId: input.functionInstanceId,
    ownerKey: `function:${String(input.functionInstanceId)}`,
  });
  ssa.registerBlock(entryBlockKey, { sealed: true });
  seedScalarLocalsForLoweringHarness({
    functionInstanceId: input.functionInstanceId,
    graph,
    ssa,
    entryBlock: entryBlockKey,
    locals: input.locals,
    placeBackedLocalNames,
  });

  const classification = classifierResult.value.classification();
  const context = createProofMirLoweringContext({
    program,
    layout,
    target,
    buildContext: createDraftProofMirBuildContext({ program, layout, target }),
    functionInstanceId: input.functionInstanceId,
    originMap,
    layoutBindingIndex: createProofMirLayoutBindingIndex({ layout }),
    callTargetIndex: createProofMirCallTargetIndex({
      program,
      layout,
      target,
      callerFunctionInstanceId: input.functionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: {
      functionInstanceId: input.functionInstanceId,
      storageForLocal(monoLocalId) {
        const local = classification.localById(monoLocalId);
        if (local === undefined) {
          return undefined;
        }
        if (placeBackedLocalNames.has(local.local.name)) {
          return "placeBacked";
        }
        return local.storage;
      },
      storageForParameter: () => undefined,
      collectLoopCarriedLocalsForLoop:
        input.collectLoopCarriedLocalsForLoop ??
        ((loopBody: MonoBlock) =>
          collectLoopCarriedLocalsForLoop({
            classification,
            allLocals: input.locals,
            loopBody,
          })),
      placeBackedLocals:
        input.placeBackedLocals ?? (() => placeBackedLocalsFromClassification(classification)),
    },
    scopePlaceLowerer: {
      functionInstanceId: input.functionInstanceId,
      lowerMonoPlace(placeInput) {
        const lowered = scopePlaceLowerer.lowerMonoPlace({
          monoPlace: placeInput.monoPlace,
          originKey: placeInput.originKey,
        });
        if (lowered.kind !== "ok") {
          return lowered;
        }
        return loweringOk(lowered.value.placeKey);
      },
    },
    functionScopePlaceLowerer: scopePlaceLowerer,
    graph,
    ssa,
    effects: createProofMirEffectsResources({ functionInstanceId: input.functionInstanceId }),
  });

  const registryResult = createWiredProofMirLoweringRegistry();
  if (registryResult.kind === "error") {
    return registryResult;
  }

  return loweringOk({
    context,
    graph,
    registry: registryResult.registry,
    entryBlockKey,
    scopePlaceLowerer,
    callRecorder: registryResult.callRecorder,
  });
}

export {
  defaultTargetForLoweringHarness,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
  emptyProgramForLoweringHarness,
  loweringOk,
};
