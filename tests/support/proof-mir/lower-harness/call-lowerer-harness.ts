import type {
  CallSiteRequirementId,
  HirPlatformContractEdgeId,
  HirRequirementId,
} from "../../../../src/hir/ids";
import {
  callSiteRequirementId,
  hirExpressionId,
  hirPlatformContractEdgeId,
  hirRequirementId,
} from "../../../../src/hir/ids";
import type {
  LayoutFactProgram,
  LayoutFunctionAbiFact,
  LayoutPlatformAbiFact,
} from "../../../../src/layout/layout-program";
import {
  emptyFunctionAbiTable,
  emptyImageDeviceTable,
  emptyPlatformAbiTable,
  emptyValidatedBufferTable,
} from "../../../../src/layout/layout-fact-builder-support";
import type { LayoutCanonicalKeyString } from "../../../../src/layout/ids";
import { layoutDeterministicTable } from "../../../../src/layout/type-key";
import { instantiatedHirId, monoInstanceId, type MonoInstanceId } from "../../../../src/mono/ids";
import type {
  MonoCallArgument,
  MonoCallExpression,
  MonoCallSiteRequirement,
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoPlatformContractEdge,
  MonomorphizedHirProgram,
} from "../../../../src/mono/mono-hir";
import { buildMonomorphicPlatformEdgeKey } from "../../../../src/mono/platform-contract-edge";
import {
  emptyMonoResolvedCallTargetTable,
  monoResolvedCallTargetTableFromEntries,
} from "../../../../src/mono/resolved-call-targets";
import { buildMonoTable, proofMetadataIdKey } from "../../../../src/mono/proof-metadata-tables";
import type { ProofMirRuntimeCatalog } from "../../../../src/runtime/runtime-catalog-types";
import type { TargetId } from "../../../../src/semantic/ids";
import type { ConcreteResourceKind } from "../../../../src/semantic/surface/resource-kind";
import {
  coreTypeId,
  functionId,
  platformContractId,
  platformPrimitiveId,
  targetId,
} from "../../../../src/semantic/ids";
import type { ProofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirCanonicalKey } from "../../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../../../../src/proof-mir/diagnostics";
import { createProofMirCallTargetIndex } from "../../../../src/proof-mir/domains/call-targets";
import { createProofMirEffectsResources } from "../../../../src/proof-mir/domains/effects-resources";
import {
  createProofMirFactRecorder,
  type DraftProofMirFact,
} from "../../../../src/proof-mir/domains/fact-recording";
import { createProofMirGraphSsa } from "../../../../src/proof-mir/domains/graph-ssa";
import { createProofMirLayoutBindingIndex } from "../../../../src/proof-mir/domains/layout-binding-index";
import { createProofMirOriginMap } from "../../../../src/proof-mir/domains/origin-map";
import { createDraftProofMirBuildContext } from "../../../../src/proof-mir/draft/draft-builder-context";
import { createDraftGraphBuilder } from "../../../../src/proof-mir/draft/draft-graph-builder";
import {
  proofMirRuntimeOperationId,
  type ProofMirRuntimeCallId,
  type ProofMirRuntimeOperationId,
} from "../../../../src/proof-mir/ids";
import type { ProofMirDraftOperand } from "../../../../src/proof-mir/lower/lowering-operands";
import {
  createProofMirLoweringContext,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  emptyCollectLoopCarriedLocalsForLoop,
  emptyPlaceBackedLocals,
} from "../../../../src/proof-mir/lower/lowering-context";
import type { TargetLayoutFacts } from "../../../../src/layout/layout-program";
import { runtimeCatalog } from "../../../../src/runtime/runtime-catalog";
import type {
  ProofMirRuntimeLoweringOwner,
  ProofMirRuntimeOperation,
} from "../../../../src/runtime/runtime-catalog-types";
import {
  createProofMirCallLowerer,
  createCallLoweringRecorder,
  recordedCallFromFunctionDraft,
  type DraftRecordedProofMirCall,
  type DraftRecordedProofMirCallGraphEdge,
  type DraftRecordedProofMirRuntimeCallContract,
  type DraftRecordedProofMirPlatformEdge,
} from "../../../../src/proof-mir/lower/call-lowerer";

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

export type CallLoweringTestResult =
  | {
      readonly kind: "ok";
      readonly call: DraftRecordedProofMirCall;
      readonly callGraphEdges: readonly DraftRecordedProofMirCallGraphEdge[];
      readonly platformEdges: readonly DraftRecordedProofMirPlatformEdge[];
      readonly runtimeCalls: readonly DraftRecordedProofMirRuntimeCallContract[];
      readonly ensuredFacts: readonly DraftProofMirFact[];
      readonly operand: ProofMirDraftOperand;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export interface ProofMirCallLowererFixture {
  readonly buildInput: {
    readonly program: MonomorphizedHirProgram;
    readonly layout: LayoutFactProgram;
    readonly target: {
      readonly targetId: TargetId;
      readonly features: readonly string[];
      readonly runtimeCatalog: ProofMirRuntimeCatalog;
    };
  };
  readonly callerFunctionInstanceId: MonoInstanceId;
  readonly calleeFunctionInstanceId?: MonoInstanceId;
  readonly call: MonoCallExpression;
  readonly monoExpressionId: MonoExpressionId;
  readonly resultType: MonoCheckedType;
  readonly resultResourceKind: ConcreteResourceKind;
  readonly expressionLowerer: ProofMirExpressionLowerer;
  readonly callSiteRequirementId?: MonoInstantiatedProofId<CallSiteRequirementId>;
  readonly platformEdgeId?: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
}

export interface ProofMirCallLowererFixtureOptions {
  readonly call?: MonoCallExpression;
  readonly expressionLowerer?: ProofMirExpressionLowerer;
  readonly includeCallSiteRequirement?: boolean;
  readonly includePlatformEnsuredFact?: boolean;
}

export interface CompilerRuntimeCallLoweringTestInput {
  readonly functionInstanceId?: MonoInstanceId;
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly runtimeCallId: ProofMirRuntimeCallId;
  readonly arguments: readonly MonoCallArgument[];
  readonly expressionLowerer?: ProofMirExpressionLowerer;
  readonly runtimeCatalog?: ProofMirRuntimeCatalog;
}
const FIXTURE_SOURCE_ORIGIN = "proof-mir:call-lowerer:test";

function minimalTargetLayoutFacts(
  targetIdValue: TargetId = targetId("x64-test"),
): TargetLayoutFacts {
  return {
    targetId: targetIdValue,
    endian: "little",
    addressableUnit: "byte",
    pointerWidthBits: 64,
    pointerSizeBytes: 8n,
    pointerAlignmentBytes: 8n,
    sizeType: { kind: "core", coreTypeId: coreTypeId("usize") },
    maximumObjectSizeBytes: 1_000_000n,
    maximumAlignmentBytes: 16n,
  };
}

export function runtimeOperationForFixture(input: {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly name: string;
  readonly loweringOwner?: ProofMirRuntimeLoweringOwner;
  readonly targetAvailability?: ProofMirRuntimeOperation["targetAvailability"];
}): ProofMirRuntimeOperation {
  const loweringOwner = input.loweringOwner ?? "panicAbort";
  return {
    runtimeId: input.runtimeId,
    name: input.name,
    targetAvailability: input.targetAvailability ?? { kind: "allTargets" },
    loweringOwner,
    abi: { kind: "compilerRuntime", symbol: `__wr_${input.name}` },
    requiredFactSchemas: [],
    consumedCapabilitySchemas: [],
    producedCapabilitySchemas: [],
    effectSchemas:
      loweringOwner === "panicAbort" ? [{ kind: "doesNotReturn" }] : [{ kind: "pure" }],
  };
}

export function runtimeCatalogForFixture(
  operations: readonly ProofMirRuntimeOperation[],
): ProofMirRuntimeCatalog {
  const result = runtimeCatalog({
    targetId: targetId("x64-test"),
    features: [],
    entries: operations,
  });
  if (result.kind !== "ok") {
    throw new RangeError(
      `call-lowerer fixture runtime catalog failed: ${result.diagnostics.map((diagnostic) => diagnostic.code).join(",")}`,
    );
  }
  return result.catalog;
}
function neverMonoType() {
  return { kind: "core", coreTypeId: coreTypeId("Never") } as never;
}

function monoFunctionTable(
  functions: readonly MonoFunctionInstance[],
): MonomorphizedHirProgram["functions"] {
  const lookup = new Map(functions.map((entry) => [entry.instanceId, entry]));
  return {
    get: (key) => lookup.get(key),
    entries: () => functions,
  };
}

function monoProofMetadataTable<LookupId, Entry>(
  entries: readonly Entry[],
  keyOf: (entry: Entry) => string,
  lookupKeyOf: (id: LookupId) => string,
): { get: (id: LookupId) => Entry | undefined; entries: () => readonly Entry[] } {
  return buildMonoTable(entries, keyOf, lookupKeyOf);
}

function minimalFunctionAbiFact(functionInstanceId: MonoInstanceId): LayoutFunctionAbiFact {
  const neverLayout = {
    key: { kind: "core" as const, coreTypeId: coreTypeId("Never") },
    sizeBytes: 0n,
    alignmentBytes: 1n,
    strideBytes: 0n,
    representation: { kind: "zeroSized" as const, reason: "unit" as const },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
  return {
    functionInstanceId,
    sourceFunctionId: functionId(1),
    hiddenParameters: [],
    parameters: [],
    returnValue: {
      type: neverLayout.key,
      layout: neverLayout,
      shape: { kind: "none", reason: "never", proofCarrying: false },
      sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function minimalPlatformAbiFact(
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
  primitiveId: ReturnType<typeof platformPrimitiveId>,
): LayoutPlatformAbiFact {
  return {
    edgeId,
    primitiveId,
    contractId: platformContractId("exit"),
    targetId: targetId("x64-test"),
    hiddenParameters: [],
    arguments: [],
    result: { kind: "none", reason: "never", proofCarrying: false },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function emptyLayoutTypesTable(): LayoutFactProgram["types"] {
  return {
    get: () => undefined,
    has: () => false,
    entries: () => [],
    keyString: () => "type:empty" as LayoutCanonicalKeyString,
  };
}

function emptyLayoutFieldsTable(): LayoutFactProgram["fields"] {
  return {
    get: () => undefined,
    has: () => false,
    entries: () => [],
    keyString: () => "field:empty" as LayoutCanonicalKeyString,
  };
}

function emptyLayoutEnumsTable(): LayoutFactProgram["enums"] {
  return {
    get: () => undefined,
    has: () => false,
    entries: () => [],
    keyString: () => "enum:empty" as LayoutCanonicalKeyString,
  };
}

function layoutProgramForCallLowererTest(
  input: {
    readonly functions?: readonly LayoutFunctionAbiFact[];
    readonly platformEdges?: readonly LayoutPlatformAbiFact[];
  } = {},
): LayoutFactProgram {
  return {
    target: minimalTargetLayoutFacts(),
    types: emptyLayoutTypesTable(),
    fields: emptyLayoutFieldsTable(),
    enums: emptyLayoutEnumsTable(),
    validatedBuffers: emptyValidatedBufferTable(),
    imageDevices: emptyImageDeviceTable(),
    functions:
      input.functions === undefined
        ? emptyFunctionAbiTable()
        : layoutDeterministicTable({
            entries: input.functions,
            keyOf: (entry) => entry.functionInstanceId,
            keyString: (key) => `function:${String(key)}` as LayoutCanonicalKeyString,
          }),
    platformEdges:
      input.platformEdges === undefined
        ? emptyPlatformAbiTable()
        : layoutDeterministicTable({
            entries: input.platformEdges,
            keyOf: (entry) => entry.edgeId,
            keyString: () => "platform-edge:test" as LayoutCanonicalKeyString,
          }),
    imageEntry: {} as LayoutFactProgram["imageEntry"],
  };
}

function minimalFunctionInstance(input: {
  readonly instanceId: MonoInstanceId;
  readonly bodyStatus: MonoFunctionInstance["bodyStatus"];
}): MonoFunctionInstance {
  return {
    instanceId: input.instanceId,
    sourceFunctionId: functionId(1),
    bodyStatus: input.bodyStatus,
    locals: { entries: () => [], get: () => undefined },
    bodyIndex: {
      statements: { entries: () => [], get: () => undefined },
      expressions: { entries: () => [], get: () => undefined },
    },
    signature: {
      modifiers: {
        isTerminal: false,
        isPlatform: false,
        isPredicate: false,
        isConstructor: false,
        isPrivate: false,
      },
      parameters: [],
    },
  } as unknown as MonoFunctionInstance;
}

function normalizePlatformCallExpression(input: {
  readonly call: MonoCallExpression;
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly primitiveId: ReturnType<typeof platformPrimitiveId>;
}): MonoCallExpression {
  if (input.call.resolvedTarget?.kind !== "certifiedPlatform") {
    return input.call;
  }
  return {
    ...input.call,
    resolvedTarget: {
      kind: "certifiedPlatform",
      targetPlatformEdgeId: input.edgeId,
      primitiveId: input.primitiveId,
    },
  };
}

function argumentExpressionPlaceholder(
  functionInstanceId: MonoInstanceId,
  index: number,
): MonoExpression {
  return {
    expressionId: instantiatedHirId(functionInstanceId, hirExpressionId(index + 1)),
    kind: { kind: "literal", literal: { kind: "integer", text: "0" } },
    type: neverMonoType(),
    resourceKind: "Copy",
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function minimalCallExpression(input: {
  readonly callerFunctionInstanceId: MonoInstanceId;
  readonly monoExpressionId: MonoExpressionId;
  readonly resolvedTarget: MonoCallExpression["resolvedTarget"];
  readonly arguments?: readonly MonoCallArgument[];
}): MonoCallExpression {
  return {
    callee: argumentExpressionPlaceholder(input.callerFunctionInstanceId, 0),
    ownerTypeArguments: [],
    ownerTypeArgumentSource: "none",
    arguments: input.arguments ?? [],
    typeArguments: [],
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    ...(input.resolvedTarget === undefined ? {} : { resolvedTarget: input.resolvedTarget }),
  };
}

function platformEdgeForFixture(
  callerFunctionInstanceId: MonoInstanceId,
  edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>,
  monoExpressionId: MonoExpressionId,
  primitiveId: ReturnType<typeof platformPrimitiveId>,
  ensuredFacts: MonoPlatformContractEdge["ensuredFacts"] = [],
): MonoPlatformContractEdge {
  return {
    edgeId,
    sourceFunctionId: functionId(0),
    primitiveId,
    contractId: platformContractId("exit"),
    targetId: targetId("x64-test"),
    callExpressionId: monoExpressionId,
    instantiatedOwnerTypeArguments: [],
    instantiatedFunctionTypeArguments: [],
    monomorphicEdgeKey: buildMonomorphicPlatformEdgeKey({
      callerInstanceId: callerFunctionInstanceId,
      callExpressionId: monoExpressionId,
      calleeFunctionId: functionId(0),
      ownerTypeArguments: [],
      functionTypeArguments: [],
    }),
    abi: {
      targetId: targetId("x64-test"),
      primitiveId,
      contractId: platformContractId("exit"),
    },
    ensuredFacts,
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function callSiteRequirementForFixture(input: {
  readonly callerFunctionInstanceId: MonoInstanceId;
  readonly monoExpressionId: MonoExpressionId;
  readonly requirementId: MonoInstantiatedProofId<CallSiteRequirementId>;
}): MonoCallSiteRequirement {
  const requirementProofId: MonoInstantiatedProofId<HirRequirementId> = {
    owner: { kind: "function", instanceId: input.callerFunctionInstanceId },
    instanceId: input.callerFunctionInstanceId,
    hirId: hirRequirementId(1),
  };
  return {
    callSiteRequirementId: input.requirementId,
    callExpressionId: input.monoExpressionId,
    requirement: {
      requirementId: requirementProofId,
      owner: { kind: "function", functionInstanceId: input.callerFunctionInstanceId },
      expression: { kind: "opaque", text: "requires proof" },
      sourceOrigin: FIXTURE_SOURCE_ORIGIN,
    },
    sourceOrigin: FIXTURE_SOURCE_ORIGIN,
  };
}

function defaultExpressionLowerer(): ProofMirExpressionLowerer {
  return {
    lowerExpression: () => ({
      kind: "ok",
      value: { kind: "value", value: proofMirCanonicalKey("harness:value:0") },
    }),
    lowerExpressionAsPlace: () => ({
      kind: "ok",
      value: { kind: "place", place: proofMirCanonicalKey("harness:place:0") },
    }),
  };
}

function buildCallLoweringContext(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: ProofMirCallLowererFixture["buildInput"]["target"];
  readonly callerFunctionInstanceId: MonoInstanceId;
}): { readonly context: ProofMirLoweringContext; readonly entryBlockKey: ProofMirCanonicalKey } {
  const graph = createDraftGraphBuilder({ functionInstanceId: input.callerFunctionInstanceId });
  const origin = graph.allocateSyntheticOrigin("entry");
  const entryBlockKey = graph.createBlock({
    role: "entry",
    scope: graph.rootScopeKey(),
    origin,
  });

  const context = createProofMirLoweringContext({
    program: input.program,
    layout: input.layout,
    target: input.target,
    buildContext: createDraftProofMirBuildContext({
      program: input.program,
      layout: input.layout,
      target: input.target,
    }),
    functionInstanceId: input.callerFunctionInstanceId,
    originMap: createProofMirOriginMap(),
    layoutBindingIndex: createProofMirLayoutBindingIndex({
      layout: input.layout,
    }),
    callTargetIndex: createProofMirCallTargetIndex({
      program: input.program,
      layout: input.layout,
      target: input.target,
      callerFunctionInstanceId: input.callerFunctionInstanceId,
    }),
    factRecorder: createProofMirFactRecorder(),
    localClassifier: {
      functionInstanceId: input.callerFunctionInstanceId,
      storageForLocal: () => "scalarSsa",
      storageForParameter: () => undefined,
      collectLoopCarriedLocalsForLoop: emptyCollectLoopCarriedLocalsForLoop,
      placeBackedLocals: emptyPlaceBackedLocals,
    },
    scopePlaceLowerer: {
      functionInstanceId: input.callerFunctionInstanceId,
      lowerMonoPlace: () => loweringOk("place:test" as never),
    },
    functionScopePlaceLowerer: {
      functionInstanceId: input.callerFunctionInstanceId,
      scopeTree: {
        scopeKey: () => "scope:test" as never,
        parentRole: () => undefined,
        scopeStack: () => [],
      },
      scopeEntries: [],
      effectsResources: {} as never,
      scopeKind: () => undefined,
      allocateSyntheticOrigin: () => "origin:test" as never,
      lowerMonoPlace: () => ({ kind: "ok", value: { placeKey: "place:test" as never } as never }),
      collectLoopBoundarySet: () => ({
        places: [],
        loans: [],
        obligations: [],
        sessionMembers: [],
        privateStateGenerations: [],
      }),
    },
    graph,
    ssa: createProofMirGraphSsa({
      functionInstanceId: input.callerFunctionInstanceId,
      ownerKey: `function:${String(input.callerFunctionInstanceId)}`,
    }),
    effects: createProofMirEffectsResources({ functionInstanceId: input.callerFunctionInstanceId }),
  });

  return { context, entryBlockKey };
}

export function platformCallLowererFixture(
  options: ProofMirCallLowererFixtureOptions = {},
): ProofMirCallLowererFixture {
  const callerFunctionInstanceId = monoInstanceId("fn:caller");
  const monoExpressionId = instantiatedHirId(callerFunctionInstanceId, hirExpressionId(2));
  const edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId> = {
    owner: { kind: "function", instanceId: callerFunctionInstanceId },
    instanceId: callerFunctionInstanceId,
    hirId: hirPlatformContractEdgeId(1),
  };
  const primitive = platformPrimitiveId("uefi.exit");
  const callSiteRequirementProofId: MonoInstantiatedProofId<CallSiteRequirementId> = {
    owner: { kind: "function", instanceId: callerFunctionInstanceId },
    instanceId: callerFunctionInstanceId,
    hirId: callSiteRequirementId(1),
  };

  const platformEdges = [
    platformEdgeForFixture(
      callerFunctionInstanceId,
      edgeId,
      monoExpressionId,
      primitive,
      options.includePlatformEnsuredFact === true
        ? [
            {
              sourceFunctionId: functionId(0),
              primitiveId: primitive,
              contractId: platformContractId("exit"),
              targetId: targetId("x64-test"),
              fingerprint: "device.closed",
              fact: {
                kind: "state" as const,
                stateKind: "closed" as const,
                argumentBindings: [],
              },
            },
          ]
        : [],
    ),
  ];

  const callSiteRequirements =
    options.includeCallSiteRequirement === true
      ? [
          callSiteRequirementForFixture({
            callerFunctionInstanceId,
            monoExpressionId,
            requirementId: callSiteRequirementProofId,
          }),
        ]
      : [];

  const call =
    options.call === undefined
      ? minimalCallExpression({
          callerFunctionInstanceId,
          monoExpressionId,
          resolvedTarget: {
            kind: "certifiedPlatform",
            targetPlatformEdgeId: edgeId,
            primitiveId: primitive,
          },
        })
      : normalizePlatformCallExpression({
          call: options.call,
          edgeId,
          primitiveId: primitive,
        });

  const program = {
    functions: monoFunctionTable([
      minimalFunctionInstance({ instanceId: callerFunctionInstanceId, bodyStatus: "sourceBody" }),
    ]),
    proofMetadata: {
      platformContractEdges: monoProofMetadataTable(
        platformEdges,
        (entry) => proofMetadataIdKey(entry.edgeId),
        proofMetadataIdKey,
      ),
      callSiteRequirements: monoProofMetadataTable(
        callSiteRequirements,
        (entry) => proofMetadataIdKey(entry.callSiteRequirementId),
        proofMetadataIdKey,
      ),
    },
    resolvedCallTargets:
      call.resolvedTarget === undefined
        ? emptyMonoResolvedCallTargetTable()
        : monoResolvedCallTargetTableFromEntries([
            {
              callerInstanceId: callerFunctionInstanceId,
              callExpressionId: monoExpressionId,
              resolvedTarget: call.resolvedTarget,
            },
          ]),
  } as unknown as MonomorphizedHirProgram;

  const layout = layoutProgramForCallLowererTest({
    platformEdges: [minimalPlatformAbiFact(edgeId, primitive)],
  });
  const target = {
    targetId: targetId("x64-test"),
    features: [] as readonly string[],
    runtimeCatalog: runtimeCatalogForFixture([
      runtimeOperationForFixture({
        runtimeId: proofMirRuntimeOperationId(1),
        name: "panic_abort",
      }),
    ]),
  };

  return {
    buildInput: { program, layout, target },
    callerFunctionInstanceId,
    call,
    monoExpressionId,
    resultType: neverMonoType(),
    resultResourceKind: "Copy",
    expressionLowerer: options.expressionLowerer ?? defaultExpressionLowerer(),
    ...(options.includeCallSiteRequirement === true
      ? { callSiteRequirementId: callSiteRequirementProofId }
      : {}),
    platformEdgeId: edgeId,
  };
}

export function sourceCallLowererFixture(): ProofMirCallLowererFixture {
  const callerFunctionInstanceId = monoInstanceId("fn:caller");
  const calleeFunctionInstanceId = monoInstanceId("fn:callee");
  const monoExpressionId = instantiatedHirId(callerFunctionInstanceId, hirExpressionId(2));

  const call = minimalCallExpression({
    callerFunctionInstanceId,
    monoExpressionId,
    resolvedTarget: {
      kind: "sourceFunction",
      targetFunctionInstanceId: calleeFunctionInstanceId,
    },
  });

  const program = {
    functions: monoFunctionTable([
      minimalFunctionInstance({ instanceId: callerFunctionInstanceId, bodyStatus: "sourceBody" }),
      minimalFunctionInstance({ instanceId: calleeFunctionInstanceId, bodyStatus: "sourceBody" }),
    ]),
    proofMetadata: {
      platformContractEdges: monoProofMetadataTable<
        MonoInstantiatedProofId<HirPlatformContractEdgeId>,
        MonoPlatformContractEdge
      >([], (entry) => proofMetadataIdKey(entry.edgeId), proofMetadataIdKey),
      callSiteRequirements: monoProofMetadataTable<
        MonoInstantiatedProofId<CallSiteRequirementId>,
        MonoCallSiteRequirement
      >([], (entry) => proofMetadataIdKey(entry.callSiteRequirementId), proofMetadataIdKey),
    },
    resolvedCallTargets: monoResolvedCallTargetTableFromEntries([
      {
        callerInstanceId: callerFunctionInstanceId,
        callExpressionId: monoExpressionId,
        resolvedTarget: call.resolvedTarget!,
      },
    ]),
  } as unknown as MonomorphizedHirProgram;

  const layout = layoutProgramForCallLowererTest({
    functions: [minimalFunctionAbiFact(calleeFunctionInstanceId)],
  });
  const target = {
    targetId: targetId("x64-test"),
    features: [] as readonly string[],
    runtimeCatalog: runtimeCatalogForFixture([
      runtimeOperationForFixture({
        runtimeId: proofMirRuntimeOperationId(1),
        name: "panic_abort",
      }),
    ]),
  };

  return {
    buildInput: { program, layout, target },
    callerFunctionInstanceId,
    calleeFunctionInstanceId,
    monoExpressionId,
    call,
    resultType: neverMonoType(),
    resultResourceKind: "Copy",
    expressionLowerer: defaultExpressionLowerer(),
  };
}

export function lowerProofMirCallForTest(
  fixture: ProofMirCallLowererFixture,
): CallLoweringTestResult {
  const { context, entryBlockKey } = buildCallLoweringContext({
    program: fixture.buildInput.program,
    layout: fixture.buildInput.layout,
    target: fixture.buildInput.target,
    callerFunctionInstanceId: fixture.callerFunctionInstanceId,
  });
  const recorder = createCallLoweringRecorder();
  const lowerer = createProofMirCallLowerer({
    expression: fixture.expressionLowerer,
    recorder,
  });

  const lowered = lowerer.lowerCall({
    context,
    call: fixture.call,
    monoExpressionId: fixture.monoExpressionId,
    blockKey: entryBlockKey,
    resultType: fixture.resultType,
    resultResourceKind: fixture.resultResourceKind,
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  const call = recordedCallFromFunctionDraft({ context, blockKey: entryBlockKey });
  if (call === undefined) {
    return {
      kind: "error",
      diagnostics: [
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
          message: "Call lowerer test harness did not record a call.",
          ownerKey: `function:${String(fixture.callerFunctionInstanceId)}`,
          rootCauseKey: "missing-call-record",
          stableDetail: "test-harness",
          functionInstanceId: fixture.callerFunctionInstanceId,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    call,
    callGraphEdges: recorder.callGraphEdges,
    platformEdges: recorder.platformEdges,
    runtimeCalls: recorder.runtimeCalls,
    ensuredFacts: recorder.ensuredFacts,
    operand: lowered.value,
  };
}

export function lowerProofMirCompilerRuntimeCallForTest(
  input: CompilerRuntimeCallLoweringTestInput,
): CallLoweringTestResult {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("fn:runtime");
  const program = {
    functions: monoFunctionTable([
      minimalFunctionInstance({ instanceId: functionInstanceId, bodyStatus: "sourceBody" }),
    ]),
    proofMetadata: {
      platformContractEdges: monoProofMetadataTable<
        MonoInstantiatedProofId<HirPlatformContractEdgeId>,
        MonoPlatformContractEdge
      >([], (entry) => proofMetadataIdKey(entry.edgeId), proofMetadataIdKey),
      callSiteRequirements: monoProofMetadataTable<
        MonoInstantiatedProofId<CallSiteRequirementId>,
        MonoCallSiteRequirement
      >([], (entry) => proofMetadataIdKey(entry.callSiteRequirementId), proofMetadataIdKey),
    },
    resolvedCallTargets: emptyMonoResolvedCallTargetTable(),
  } as unknown as MonomorphizedHirProgram;
  const layout = layoutProgramForCallLowererTest();
  const target = {
    targetId: targetId("x64-test"),
    features: [] as readonly string[],
    runtimeCatalog:
      input.runtimeCatalog ??
      runtimeCatalogForFixture([
        runtimeOperationForFixture({
          runtimeId: proofMirRuntimeOperationId(1),
          name: "panic_abort",
        }),
      ]),
  };

  const { context, entryBlockKey } = buildCallLoweringContext({
    program,
    layout,
    target,
    callerFunctionInstanceId: functionInstanceId,
  });
  const recorder = createCallLoweringRecorder();
  const expressionLowerer = input.expressionLowerer ?? defaultExpressionLowerer();
  const monoExpressionId = instantiatedHirId(functionInstanceId, hirExpressionId(1));
  const lowerer = createProofMirCallLowerer({
    expression: expressionLowerer,
    recorder,
  });

  const lowered = lowerer.lowerCompilerRuntimeCall({
    context,
    runtimeId: input.runtimeId,
    runtimeCallId: input.runtimeCallId,
    arguments: input.arguments,
    blockKey: entryBlockKey,
    monoExpressionId,
    resultType: neverMonoType(),
    resultResourceKind: "Copy",
  });
  if (lowered.kind === "error") {
    return { kind: "error", diagnostics: lowered.diagnostics };
  }

  const call = recordedCallFromFunctionDraft({ context, blockKey: entryBlockKey });
  if (call === undefined) {
    return {
      kind: "error",
      diagnostics: [
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
          message: "Compiler runtime call lowerer test harness did not record a call.",
          ownerKey: `function:${String(functionInstanceId)}`,
          rootCauseKey: "missing-call-record",
          stableDetail: "test-harness",
          functionInstanceId,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    call,
    callGraphEdges: recorder.callGraphEdges,
    platformEdges: recorder.platformEdges,
    runtimeCalls: recorder.runtimeCalls,
    ensuredFacts: recorder.ensuredFacts,
    operand: lowered.value,
  };
}

// Re-export types used by tests for call graph edge shape checks.
