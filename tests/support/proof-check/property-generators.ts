import fastCheck from "fast-check";
import {
  attemptId,
  hirExpressionId,
  hirLocalId,
  hirOriginId,
  hirStatementId,
  resourcePlaceId,
  validationId,
} from "../../../src/hir/ids";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import { layoutFunctionKeyString } from "../../../src/layout/layout-fact-builder-support";
import type { LayoutFunctionAbiFact } from "../../../src/layout/layout-program";
import { monoInstanceId, instantiatedHirId, type MonoInstanceId } from "../../../src/mono/ids";
import {
  monoExpressionIdFor,
  monoStatementIdFor,
} from "../../../src/mono/function-instantiator-shell";
import type { MonoReachableFunction, MonoReachableFunctionTable } from "../../../src/mono/mono-hir";
import { buildProofMir } from "../../../src/proof-mir/proof-mir-builder";
import type { ProofMirFunction } from "../../../src/proof-mir/model/graph";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import type { CheckProofAndResourcesResult } from "../../../src/proof-check/proof-checker";
import type { ProofCounterexamplePath } from "../../../src/proof-check/diagnostics";
import { compareCodeUnitStrings } from "../../../src/semantic/surface/deterministic-sort";
import type { CheckedFactPacket } from "../../../src/proof-check/model/fact-packet";
import { coreTypeId, functionId } from "../../../src/semantic/ids";
import {
  closedProofMirFixture,
  ifReturnProofMirFixture,
  nestedBranchProofMirFixture,
} from "../proof-mir/proof-mir-fixtures";
import {
  platformCallProofMirFixture,
  validatedBufferProofMirLayoutFixture,
} from "../proof-mir/proof-mir-layout-fixtures";
import {
  proofMirBuildInputFromMonoLayout,
  proofMirDefaultLayoutTarget,
  type ProofMirBuildInput,
} from "../proof-mir/proof-mir-build-input";

export const PROOF_MIR_PROGRAM_BOUNDS = {
  maxFunctions: 4,
  maxBlocksPerFunction: 6,
  maxEdgesPerFunction: 10,
  maxFacts: 12,
  maxPlaces: 8,
  maxLoans: 4,
  maxObligations: 4,
  maxValidations: 3,
  maxAttempts: 3,
  maxExits: 4,
} as const;

export type ProofMirProgramShape =
  | "acyclicBranch"
  | "reachableSourceCall"
  | "validationSplit"
  | "attemptSplit"
  | "terminalExit";

export interface ProofMirProgramMetrics {
  readonly functions: number;
  readonly maxBlocksPerFunction: number;
  readonly maxEdgesPerFunction: number;
  readonly facts: number;
  readonly places: number;
  readonly loans: number;
  readonly obligations: number;
  readonly validations: number;
  readonly attempts: number;
  readonly exits: number;
}

type ProofMirProgramTemplate = {
  readonly shapes: readonly ProofMirProgramShape[];
  readonly buildInput: () => ProofMirBuildInput;
};

function stableJsonValueForTest(value: unknown): unknown {
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "function") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(stableJsonValueForTest);
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entryValue]) => [stableJsonValueForTest(key), stableJsonValueForTest(entryValue)])
      .sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
  }
  if (value instanceof Set) {
    return [...value.values()]
      .map(stableJsonValueForTest)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value !== null && typeof value === "object") {
    if ("entries" in value && typeof value.entries === "function") {
      return stableJsonValueForTest((value as { entries: () => readonly unknown[] }).entries());
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined && typeof entryValue !== "function")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableJsonValueForTest(entryValue)]),
    );
  }
  return value;
}

export function stableJsonForTest(value: unknown): string {
  return JSON.stringify(stableJsonValueForTest(value));
}

function countLoansInFunction(functionGraph: ProofMirFunction): number {
  let loans = 0;
  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      if (statement.kind.kind === "borrowPlace") {
        loans += 1;
      }
    }
  }
  return loans;
}

function countValidationShapes(functionGraph: ProofMirFunction): number {
  let count = 0;
  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      if (statement.kind.kind === "validate") {
        count += 1;
      }
    }
    if (block.terminator.kind.kind === "matchValidation") {
      count += 1;
    }
    for (const edgeId of block.terminator.outgoingEdges) {
      const edge = functionGraph.edges.get(edgeId);
      if (edge?.kind === "validationOk" || edge?.kind === "validationErr") {
        count += 1;
      }
    }
  }
  return count;
}

function countAttemptShapes(functionGraph: ProofMirFunction): number {
  let count = 0;
  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      if (statement.kind.kind === "attempt") {
        count += 1;
      }
    }
    if (block.terminator.kind.kind === "matchAttempt") {
      count += 1;
    }
    for (const edgeId of block.terminator.outgoingEdges) {
      const edge = functionGraph.edges.get(edgeId);
      if (edge?.kind === "attemptSuccess" || edge?.kind === "attemptError") {
        count += 1;
      }
    }
  }
  return count;
}

function functionGraphHasBranch(functionGraph: ProofMirFunction): boolean {
  return functionGraph.blocks.entries().some((block) => block.terminator.kind.kind === "branch");
}

const ACYCLIC_BRANCH_EDGE_KINDS = new Set([
  "normal",
  "branchTrue",
  "branchFalse",
  "switchCase",
  "validationOk",
  "validationErr",
  "attemptSuccess",
  "attemptError",
]);

function functionGraphIsAcyclic(functionGraph: ProofMirFunction): boolean {
  const blockIds = functionGraph.blocks.entries().map((block) => block.blockId);
  const blockIdSet = new Set(blockIds.map((blockId) => String(blockId)));
  const adjacency = new Map<string, readonly string[]>();

  for (const block of functionGraph.blocks.entries()) {
    const outgoingBlockIds: string[] = [];
    for (const edgeId of block.terminator.outgoingEdges) {
      const edge = functionGraph.edges.get(edgeId);
      if (edge === undefined || edge.toBlockId === undefined) {
        continue;
      }
      if (!ACYCLIC_BRANCH_EDGE_KINDS.has(edge.kind)) {
        continue;
      }
      outgoingBlockIds.push(String(edge.toBlockId));
    }
    adjacency.set(String(block.blockId), outgoingBlockIds);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(blockKey: string): boolean {
    if (visiting.has(blockKey)) {
      return false;
    }
    if (visited.has(blockKey)) {
      return true;
    }
    if (!blockIdSet.has(blockKey)) {
      return true;
    }
    visiting.add(blockKey);
    for (const successor of adjacency.get(blockKey) ?? []) {
      if (!visit(successor)) {
        return false;
      }
    }
    visiting.delete(blockKey);
    visited.add(blockKey);
    return true;
  }

  for (const blockId of blockIdSet) {
    if (!visit(blockId)) {
      return false;
    }
  }
  return true;
}

export function proofMirProgramMetricsForTest(mir: ProofMirProgram): ProofMirProgramMetrics {
  let maxBlocksPerFunction = 0;
  let maxEdgesPerFunction = 0;
  let places = 0;
  let loans = 0;
  let exits = 0;

  for (const functionGraph of mir.functions.entries()) {
    maxBlocksPerFunction = Math.max(maxBlocksPerFunction, functionGraph.blocks.entries().length);
    maxEdgesPerFunction = Math.max(maxEdgesPerFunction, functionGraph.edges.entries().length);
    places += functionGraph.places.entries().length;
    loans += countLoansInFunction(functionGraph);
    exits += functionGraph.exits.length;
  }

  return {
    functions: mir.functions.entries().length,
    maxBlocksPerFunction,
    maxEdgesPerFunction,
    facts: mir.facts.entries().length,
    places,
    loans,
    obligations: mir.proofMetadata.obligations.entries().length,
    validations: mir.proofMetadata.validations.entries().length,
    attempts: mir.proofMetadata.attempts.entries().length,
    exits,
  };
}

export function proofMirProgramWithinBoundsForTest(mir: ProofMirProgram): boolean {
  const metrics = proofMirProgramMetricsForTest(mir);
  return (
    metrics.functions <= PROOF_MIR_PROGRAM_BOUNDS.maxFunctions &&
    metrics.maxBlocksPerFunction <= PROOF_MIR_PROGRAM_BOUNDS.maxBlocksPerFunction &&
    metrics.maxEdgesPerFunction <= PROOF_MIR_PROGRAM_BOUNDS.maxEdgesPerFunction &&
    metrics.facts <= PROOF_MIR_PROGRAM_BOUNDS.maxFacts &&
    metrics.places <= PROOF_MIR_PROGRAM_BOUNDS.maxPlaces &&
    metrics.loans <= PROOF_MIR_PROGRAM_BOUNDS.maxLoans &&
    metrics.obligations <= PROOF_MIR_PROGRAM_BOUNDS.maxObligations &&
    metrics.validations <= PROOF_MIR_PROGRAM_BOUNDS.maxValidations &&
    metrics.attempts <= PROOF_MIR_PROGRAM_BOUNDS.maxAttempts &&
    metrics.exits <= PROOF_MIR_PROGRAM_BOUNDS.maxExits
  );
}

export function proofMirProgramShapesForTest(
  mir: ProofMirProgram,
): readonly ProofMirProgramShape[] {
  const shapes = new Set<ProofMirProgramShape>();

  if (
    mir.functions
      .entries()
      .some(
        (functionGraph) =>
          functionGraphHasBranch(functionGraph) && functionGraphIsAcyclic(functionGraph),
      )
  ) {
    shapes.add("acyclicBranch");
  }

  if (
    mir.callGraph.entries().some((edge) => edge.target.kind === "sourceFunction") &&
    mir.reachableFunctions.entries().some((reachable) => reachable.reason === "sourceCall")
  ) {
    shapes.add("reachableSourceCall");
  }

  if (mir.functions.entries().some((functionGraph) => countValidationShapes(functionGraph) > 0)) {
    shapes.add("validationSplit");
  }

  if (mir.functions.entries().some((functionGraph) => countAttemptShapes(functionGraph) > 0)) {
    shapes.add("attemptSplit");
  }

  if (
    mir.functions
      .entries()
      .some((functionGraph) =>
        functionGraph.exits.some(
          (exit) => exit.kind === "ordinaryReturn" || exit.kind === "terminalReturn",
        ),
      )
  ) {
    shapes.add("terminalExit");
  }

  return [...shapes];
}

function monoReachableFunctionTableForTest(
  entries: readonly MonoReachableFunction[],
): MonoReachableFunctionTable {
  return {
    get: (functionInstanceId) =>
      entries.find((entry) => entry.functionInstanceId === functionInstanceId),
    has: (functionInstanceId) =>
      entries.some((entry) => entry.functionInstanceId === functionInstanceId),
    entries: () => entries,
  };
}

function minimalLayoutFunctionAbiFact(functionInstanceId: MonoInstanceId) {
  const neverLayout = {
    key: { kind: "core" as const, coreTypeId: coreTypeId("Never") },
    sizeBytes: 0n,
    alignmentBytes: 1n,
    strideBytes: 0n,
    representation: { kind: "zeroSized" as const, reason: "unit" as const },
    sourceOrigin: "property-generators",
  };
  return {
    functionInstanceId,
    sourceFunctionId: functionId(1),
    hiddenParameters: [],
    parameters: [],
    returnValue: {
      type: neverLayout.key,
      layout: neverLayout,
      shape: { kind: "none" as const, reason: "never" as const, proofCarrying: false },
      sourceOrigin: "property-generators",
    },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: "property-generators",
  };
}

function withExtraFunctionAbiFacts(
  layout: ReturnType<typeof validatedBufferProofMirLayoutFixture>["layout"],
  extraFunctionIds: readonly MonoInstanceId[],
) {
  const mergedFacts = [...layout.functions.entries()];
  for (const functionInstanceId of extraFunctionIds) {
    if (!layout.functions.has(functionInstanceId)) {
      mergedFacts.push(minimalLayoutFunctionAbiFact(functionInstanceId));
    }
  }
  return {
    ...layout,
    functions: layoutDeterministicTable({
      entries: mergedFacts,
      keyOf: (entry) => entry.functionInstanceId,
      keyString: layoutFunctionKeyString,
    }),
  };
}

function validationSplitProofMirBuildInput(): ProofMirBuildInput {
  const layoutFixture = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ 1 len source.len - 1"],
  });
  const helperFunctionId = layoutFixture.program.functions.entries()[0]?.instanceId;
  if (helperFunctionId === undefined) {
    throw new RangeError("validation split template is missing helper function metadata.");
  }
  const functionInstanceId = monoInstanceId("fn:property-validation");
  const buffer = layoutFixture.program.validatedBuffers.get(layoutFixture.bufferInstanceId);
  if (buffer === undefined) {
    throw new RangeError("validation split template is missing validated buffer metadata.");
  }

  const sourceLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(1)),
    name: "source",
    type: { kind: "applied", constructor: { kind: "source", typeId: buffer.typeId } },
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: "source:local:source",
  } as const;
  const pendingLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(2)),
    name: "validation",
    type: { kind: "primitive", name: "unit" },
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "sourceLet",
    sourceOrigin: "source:local:validation",
  } as const;
  const packetLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(3)),
    name: "packet",
    type: buffer.typeId,
    resourceKind: "Affine",
    mode: "ordinary",
    introducedBy: "validationArm",
    sourceOrigin: "source:local:packet",
  } as const;
  const errLocal = {
    localId: instantiatedHirId(functionInstanceId, hirLocalId(4)),
    name: "errorPayload",
    type: { kind: "primitive", name: "unit" },
    resourceKind: "Copy",
    mode: "ordinary",
    introducedBy: "validationArm",
    sourceOrigin: "source:local:error",
  } as const;
  const validationProofId = {
    owner: { kind: "function" as const, instanceId: functionInstanceId },
    hirId: validationId(7),
    instanceId: functionInstanceId,
  };
  const validation = {
    validationId: validationProofId,
    validationExpressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(11)),
    sourcePlace: {
      placeId: {
        owner: { kind: "function" as const, instanceId: functionInstanceId },
        hirId: resourcePlaceId(1),
        instanceId: functionInstanceId,
      },
      canonicalKey: `function:${String(functionInstanceId)}/local:source`,
      root: { kind: "local" as const, localId: sourceLocal.localId },
      projection: [],
      type: sourceLocal.type,
      resourceKind: sourceLocal.resourceKind,
      sourceOrigin: sourceLocal.sourceOrigin,
      kind: "local" as const,
      localId: sourceLocal.localId,
    },
    pendingResultPlace: {
      placeId: {
        owner: { kind: "function" as const, instanceId: functionInstanceId },
        hirId: resourcePlaceId(2),
        instanceId: functionInstanceId,
      },
      canonicalKey: `function:${String(functionInstanceId)}/local:validation`,
      root: { kind: "local" as const, localId: pendingLocal.localId },
      projection: [],
      type: pendingLocal.type,
      resourceKind: pendingLocal.resourceKind,
      sourceOrigin: pendingLocal.sourceOrigin,
      kind: "local" as const,
      localId: pendingLocal.localId,
    },
    validatedBufferTypeId: buffer.typeId,
    okPayloadType: { kind: "applied", constructor: { kind: "source", typeId: buffer.typeId } },
    errPayloadType: { kind: "primitive", name: "unit" },
    sourceOrigin: "source:validation:7",
  };
  const okArm = {
    patternText: "ok",
    body: { statements: [], sourceOrigin: "source:arm:ok" },
    bindingLocals: [packetLocal],
    sourceOrigin: "source:arm:ok",
  };
  const errArm = {
    patternText: "err",
    body: { statements: [], sourceOrigin: "source:arm:err" },
    bindingLocals: [errLocal],
    sourceOrigin: "source:arm:err",
  };
  const body = {
    statements: [
      {
        statementId: monoStatementIdFor(functionInstanceId, hirStatementId(7)),
        kind: {
          kind: "validationMatch" as const,
          statement: {
            validationMatchId: validationProofId,
            scrutinee: {
              expressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(70)),
              kind: { kind: "literal" as const, literal: { kind: "integer" as const, text: "0" } },
              type: { kind: "primitive", name: "u8" },
              resourceKind: "Copy",
              sourceOrigin: "source:expr:70",
            },
            validation,
            okArm,
            errArm,
            sourceOrigin: "source:validationMatch:7",
          },
        },
        sourceOrigin: "source:stmt:validationMatch:7",
      },
    ],
    sourceOrigin: "source:function",
  };
  const entryFunction = {
    instanceId: functionInstanceId,
    sourceFunctionId: 1 as never,
    sourceItemId: 1 as never,
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: {
      functionId: 1 as never,
      itemId: 1 as never,
      parameters: [],
      returnType: { kind: "primitive", name: "unit" },
      returnKind: "Copy",
      modifiers: { isTerminal: false },
      sourceSpan: { start: 0, end: 0 },
    },
    bodyStatus: "sourceBody" as const,
    body,
    bodyIndex: {
      statements: { entries: () => body.statements, get: () => undefined },
      expressions: { entries: () => [], get: () => undefined },
    },
    locals: {
      entries: () => [sourceLocal, pendingLocal, packetLocal, errLocal],
      get: () => undefined,
    },
    declaredRequirements: [],
    sourceOrigin: "source:function",
  };
  const functions = [
    ...layoutFixture.program.functions
      .entries()
      .filter((entry) => entry.instanceId !== functionInstanceId),
    entryFunction,
  ];
  const externalRoots = [
    { functionInstanceId, reason: "imageEntry" as const, origin: hirOriginId(99) },
    {
      functionInstanceId: helperFunctionId,
      reason: "targetRequired" as const,
      origin: hirOriginId(1),
    },
  ];
  const reachableFunctions = monoReachableFunctionTableForTest([
    { functionInstanceId, reason: "imageEntry", origin: hirOriginId(99) },
    { functionInstanceId: helperFunctionId, reason: "targetRequired", origin: hirOriginId(1) },
  ]);
  const program = {
    ...layoutFixture.program,
    image: { ...layoutFixture.program.image, entryFunctionInstanceId: functionInstanceId },
    externalRoots,
    reachableFunctions,
    functions: {
      entries: () => functions,
      get: (instanceId: typeof functionInstanceId) =>
        functions.find((functionInstance) => functionInstance.instanceId === instanceId),
      has: (instanceId: typeof functionInstanceId) =>
        functions.some((functionInstance) => functionInstance.instanceId === instanceId),
    },
  };
  const layout = withExtraFunctionAbiFacts(layoutFixture.layout, [functionInstanceId]);
  return proofMirBuildInputFromMonoLayout({
    program: program as never,
    layout: {
      ...layout,
      imageEntry: { ...layout.imageEntry, entryFunctionInstanceId: functionInstanceId },
    },
    layoutTarget: proofMirDefaultLayoutTarget(),
  });
}

function attemptSplitProofMirBuildInput(): ProofMirBuildInput {
  const layoutFixture = validatedBufferProofMirLayoutFixture({
    layoutSource: ["tag: u8 @ 0", "payload: u8 @ 1 len source.len - 1"],
  });
  const functionInstanceId = monoInstanceId("fn:property-attempt");
  const attempt = {
    attemptId: {
      owner: { kind: "function" as const, instanceId: functionInstanceId },
      hirId: attemptId(8),
      instanceId: functionInstanceId,
    },
    attemptExpressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(80)),
    fallibleExpression: {
      expressionId: monoExpressionIdFor(functionInstanceId, hirExpressionId(8)),
      kind: { kind: "literal" as const, literal: { kind: "integer" as const, text: "0" } },
      type: { kind: "primitive", name: "u8" },
      resourceKind: "Copy",
      sourceOrigin: "source:expr:8",
    },
    declaredInputPlaces: [],
    sourceOrigin: "source:attempt:8",
  };
  const body = {
    statements: [
      {
        statementId: monoStatementIdFor(functionInstanceId, hirStatementId(8)),
        kind: {
          kind: "expression" as const,
          expression: {
            expressionId: attempt.attemptExpressionId,
            kind: { kind: "attempt" as const, attempt },
            type: { kind: "primitive", name: "u8" },
            resourceKind: "Copy",
            sourceOrigin: attempt.sourceOrigin,
          },
        },
        sourceOrigin: "source:stmt:attempt:8",
      },
    ],
    sourceOrigin: "source:function",
  };
  const entryFunction = {
    instanceId: functionInstanceId,
    sourceFunctionId: 1 as never,
    sourceItemId: 1 as never,
    ownerTypeArguments: [],
    functionTypeArguments: [],
    signature: {
      functionId: 1 as never,
      itemId: 1 as never,
      parameters: [],
      returnType: { kind: "primitive", name: "unit" },
      returnKind: "Copy",
      modifiers: { isTerminal: false },
      sourceSpan: { start: 0, end: 0 },
    },
    bodyStatus: "sourceBody" as const,
    body,
    bodyIndex: {
      statements: { entries: () => body.statements, get: () => undefined },
      expressions: { entries: () => [], get: () => undefined },
    },
    locals: { entries: () => [], get: () => undefined },
    declaredRequirements: [],
    sourceOrigin: "source:function",
  };
  const functions = [
    ...layoutFixture.program.functions
      .entries()
      .filter((entry) => entry.instanceId !== functionInstanceId),
    entryFunction,
  ];
  const externalRoots = [
    { functionInstanceId, reason: "imageEntry" as const, origin: hirOriginId(100) },
  ];
  const reachableFunctions = monoReachableFunctionTableForTest([
    { functionInstanceId, reason: "imageEntry", origin: hirOriginId(100) },
  ]);
  const program = {
    ...layoutFixture.program,
    image: { ...layoutFixture.program.image, entryFunctionInstanceId: functionInstanceId },
    externalRoots,
    reachableFunctions,
    functions: {
      entries: () => functions,
      get: (instanceId: typeof functionInstanceId) =>
        functions.find((functionInstance) => functionInstance.instanceId === instanceId),
      has: (instanceId: typeof functionInstanceId) =>
        functions.some((functionInstance) => functionInstance.instanceId === instanceId),
    },
  };
  const layout = withExtraFunctionAbiFacts(layoutFixture.layout, [functionInstanceId]);
  return proofMirBuildInputFromMonoLayout({
    program: program as never,
    layout: {
      ...layout,
      imageEntry: { ...layout.imageEntry, entryFunctionInstanceId: functionInstanceId },
    },
    layoutTarget: proofMirDefaultLayoutTarget(),
  });
}

const PROOF_MIR_PROGRAM_TEMPLATES: readonly ProofMirProgramTemplate[] = [
  {
    shapes: ["terminalExit"],
    buildInput: closedProofMirFixture,
  },
  {
    shapes: ["acyclicBranch", "terminalExit"],
    buildInput: ifReturnProofMirFixture,
  },
  {
    shapes: ["acyclicBranch", "terminalExit"],
    buildInput: nestedBranchProofMirFixture,
  },
  {
    shapes: ["reachableSourceCall"],
    buildInput: platformCallProofMirFixture,
  },
  {
    shapes: ["validationSplit", "terminalExit"],
    buildInput: validationSplitProofMirBuildInput,
  },
  {
    shapes: ["attemptSplit", "terminalExit"],
    buildInput: attemptSplitProofMirBuildInput,
  },
];

function buildProofMirProgramFromTemplate(template: ProofMirProgramTemplate): ProofMirProgram {
  const result = buildProofMir(template.buildInput());
  if (result.kind !== "ok") {
    throw new RangeError(
      `property generator failed to build Proof MIR: ${result.diagnostics
        .map((diagnostic) => String(diagnostic.code))
        .join(", ")}`,
    );
  }
  if (!proofMirProgramWithinBoundsForTest(result.mir)) {
    throw new RangeError("property generator produced a program outside bounded limits.");
  }
  return result.mir;
}

const SMALL_PROOF_MIR_PROGRAMS: readonly ProofMirProgram[] = PROOF_MIR_PROGRAM_TEMPLATES.map(
  (template) => buildProofMirProgramFromTemplate(template),
);

export function smallProofMirProgramArbitrary(): fastCheck.Arbitrary<ProofMirProgram> {
  return fastCheck.constantFrom(...SMALL_PROOF_MIR_PROGRAMS);
}

function packetEntryStableKeys(
  entries: readonly { readonly factId: unknown }[],
): readonly string[] {
  return entries.map((entry) => String(entry.factId));
}

export function checkedFactPacketStableKeysForTest(
  facts: CheckedFactPacket,
): Record<string, readonly string[]> {
  return {
    ownership: packetEntryStableKeys(facts.ownership),
    noalias: packetEntryStableKeys(facts.noalias),
    fieldDisjointness: packetEntryStableKeys(facts.fieldDisjointness),
    erasures: packetEntryStableKeys(facts.erasures),
    validatedBuffers: packetEntryStableKeys(facts.validatedBuffers),
    packetSources: packetEntryStableKeys(facts.packetSources),
    privateState: packetEntryStableKeys(facts.privateState),
    platformEffects: packetEntryStableKeys(facts.platformEffects),
    capabilityFlow: packetEntryStableKeys(facts.capabilityFlow),
    terminalClosure: packetEntryStableKeys(facts.terminalClosure),
    exitClosure: packetEntryStableKeys(facts.exitClosure),
    layoutAbi: packetEntryStableKeys(facts.layoutAbi),
    origins: facts.origins.map((entry) => entry.origin.originKey),
  };
}

function counterexamplePathKeysForTest(
  counterexample: ProofCounterexamplePath | undefined,
): readonly string[] {
  if (counterexample === undefined) {
    return [];
  }
  return counterexample.frames.map((frame) => frame.pathFrameKey);
}

export function proofCheckResultStableKey(result: CheckProofAndResourcesResult): string {
  if (result.kind === "error") {
    return stableJsonForTest({
      kind: "error",
      diagnostics: result.diagnostics.map((diagnostic) => diagnostic.order),
      counterexamples: result.diagnostics.map((diagnostic) =>
        counterexamplePathKeysForTest(diagnostic.counterexample),
      ),
    });
  }

  return stableJsonForTest({
    kind: "ok",
    checkedFunctions: [...result.checked.checkedFunctions.entries()]
      .sort((left, right) => compareCodeUnitStrings(String(left[0]), String(right[0])))
      .map(([functionInstanceId, checkedFunction]) => ({
        functionInstanceId: String(functionInstanceId),
        summaryCertificate: String(checkedFunction.summaryCertificate),
        entryStateCertificate: String(checkedFunction.entryStateCertificate.id),
      })),
    summaries: [...result.checked.summaries.entries()]
      .sort((left, right) => compareCodeUnitStrings(String(left[0]), String(right[0])))
      .map(([functionInstanceId, summary]) => ({
        functionInstanceId: String(functionInstanceId),
        certificateId: String(summary.certificateId),
      })),
    terminalGraph: result.checked.terminalGraph.terminalKey,
    packet: checkedFactPacketStableKeysForTest(result.checked.facts),
  });
}

export function proofMirProgramTemplateShapesForTest(): ReadonlyMap<
  ProofMirProgram,
  readonly ProofMirProgramShape[]
> {
  return new Map(
    PROOF_MIR_PROGRAM_TEMPLATES.map((template, index) => [
      SMALL_PROOF_MIR_PROGRAMS[index] as ProofMirProgram,
      template.shapes,
    ]),
  );
}
