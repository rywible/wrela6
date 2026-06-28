import { describe, expect, test } from "bun:test";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { monoInstanceId, type MonoInstanceId } from "../../../src/mono/ids";
import type { MonoFunctionSignature, MonoProofMetadata } from "../../../src/mono/mono-hir";
import {
  proofCheckDiagnosticCode,
  proofCheckDiagnostic,
} from "../../../src/proof-check/diagnostics";
import {
  computeProofCheckCoreMeet,
  resetProofCheckGraphWorklistTransitionIdsForTest,
  runProofCheckFunctionKernel,
  type ProofCheckFunctionKernelResult,
} from "../../../src/proof-check/kernel/checker-kernel";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import {
  dispatchProofCheckOperation,
  type ProofCheckOperationTransferRegistry,
} from "../../../src/proof-check/kernel/operation-dispatch";
import { proofCheckStateKey } from "../../../src/proof-check/kernel/state-key";
import { proofCheckPatchKind } from "../../../src/proof-check/kernel/state-patch";
import type { ProofCheckState } from "../../../src/proof-check/kernel/state";
import type {
  ProofCheckOperation,
  ProofCheckTransitionResult,
} from "../../../src/proof-check/kernel/transition-api";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirOriginId,
  proofMirPlaceId,
  proofMirScopeId,
  proofMirStatementId,
  proofMirTerminatorId,
  type ProofMirBlockId,
  type ProofMirControlEdgeId,
  type ProofMirStatementId,
  type ProofMirTerminatorId,
} from "../../../src/proof-mir/ids";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirFunction,
  ProofMirStatement,
  ProofMirTerminator,
} from "../../../src/proof-mir/model/graph";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import type { ProofMirRuntimeCatalog } from "../../../src/runtime/runtime-catalog-types";
import { functionId, itemId } from "../../../src/semantic/ids";
import { SourceSpan } from "../../../src/shared/source-span";
import {
  activeFactForTest,
  movedPlaceForTest,
  ownedPlaceForTest,
  proofCheckStateForTest,
  uninitializedPlaceForTest,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "./state-patch-reducer.test";

const defaultFunctionInstanceId = monoInstanceId("1");
const origin = proofMirOriginId(0);
const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

const entryBlockId = proofMirBlockId(0);
const trueArmBlockId = proofMirBlockId(1);
const falseArmBlockId = proofMirBlockId(2);
const mergeBlockId = proofMirBlockId(3);
const singleBlockId = proofMirBlockId(0);

const trueEdgeId = proofMirControlEdgeId(1);
const falseEdgeId = proofMirControlEdgeId(2);
const trueToMergeEdgeId = proofMirControlEdgeId(3);
const falseToMergeEdgeId = proofMirControlEdgeId(4);
const exitId = proofMirExitEdgeId(1);

const branchPlaceKey = "branch:subject";
const branchPlaceId = proofMirPlaceId(1);

export interface ProofCheckKernelTestProgram {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly entryState: ProofCheckState;
  readonly edgeStates?: ReadonlyMap<number, ProofCheckState>;
  readonly blockLabels?: ReadonlyMap<ProofMirBlockId, string>;
  readonly registry?: ProofCheckOperationTransferRegistry;
}

function emptyDeterministicTable<LookupId, Entry>(prefix: string) {
  const result = proofMirDeterministicTable<LookupId, Entry>({
    entries: [],
    keyOf: (entry) => proofMirCanonicalKey(`${prefix}:${JSON.stringify(entry)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`${prefix}:${String(id)}`),
    normalizePayload: () => "",
  });
  if (result.kind !== "ok") {
    throw new Error(`${prefix} table failed`);
  }
  return result.table;
}

function proofMirStatementForTest(statementId: ProofMirStatementId): ProofMirStatement {
  return {
    statementId,
    kind: {
      kind: "literal",
      value: 0 as never,
      literal: { kind: "integer", text: "0", value: 0n },
    },
    origin,
  };
}

function proofMirTerminatorForTest(input: {
  readonly terminatorId: ProofMirTerminatorId;
  readonly outgoingEdges?: readonly ProofMirControlEdgeId[];
  readonly kind?: ProofMirTerminator["kind"];
}): ProofMirTerminator {
  return {
    terminatorId: input.terminatorId,
    kind: input.kind ?? { kind: "unreachable", reason: "unreachableSource" },
    outgoingEdges: input.outgoingEdges ?? [],
    origin,
  };
}

function proofMirExitEdgeForTest(fromBlockId: ProofMirBlockId): ProofMirExitEdge {
  return {
    exitId,
    fromBlockId,
    kind: "ordinaryReturn",
    boundary: { kind: "function", unwind: "none" },
    crossedScopes: [],
    closure: {
      kind: "functionExit",
      requireNoLiveLoans: true,
      requireNoOpenObligations: true,
      requireNoLiveSessionMembers: true,
      requireNoPendingValidationResults: true,
      terminalReachability: "notRequired",
    },
    origin,
  };
}

function proofMirControlEdgeForTest(input: {
  readonly edgeId: ProofMirControlEdgeId;
  readonly fromBlockId: ProofMirBlockId;
  readonly toBlockId: ProofMirBlockId;
}): ProofMirControlEdge {
  return {
    edgeId: input.edgeId,
    fromBlockId: input.fromBlockId,
    toBlockId: input.toBlockId,
    kind: "normal",
    arguments: [],
    facts: [],
    effects: [],
    crossedScopes: [],
    origin,
  };
}

function mergeBranchStates(input: {
  readonly state: ProofCheckState;
  readonly placeLifecycle: "owned" | "moved";
}): ProofCheckState {
  return proofCheckStateForTest({
    places:
      input.state.places.size > 0
        ? [...input.state.places.values()]
        : [
            input.placeLifecycle === "owned"
              ? ownedPlaceForTest(branchPlaceKey)
              : movedPlaceForTest(branchPlaceKey),
          ],
    facts: [...input.state.facts.values()],
    loans: [...input.state.loans.values()],
    obligations: [...input.state.obligations.values()],
    sessions: [...input.state.sessions.values()],
    validations: [...input.state.validations.values()],
    attempts: [...input.state.attempts.values()],
    privateState: [...input.state.privateState.values()],
    layout: [...input.state.layout.values()],
    packetSources: [...input.state.packetSources.values()],
    capabilities: [...input.state.capabilities.values()],
    terminal: [...input.state.terminal.values()],
    divergence: [...input.state.divergence.values()],
    erasures: [...input.state.erasures.values()],
  });
}

function branchEdgeTransfer(input: {
  readonly targetState: ProofCheckState;
  readonly placeLifecycle: "owned" | "moved";
}): ProofCheckTransitionResult {
  return {
    kind: "ok",
    patch: proofCheckStatePatchForTest({
      kind: "coreTransfer",
      entries: [
        {
          kind: "placeState",
          place: branchPlaceId,
          state:
            input.placeLifecycle === "owned"
              ? ownedPlaceForTest(branchPlaceKey)
              : movedPlaceForTest(branchPlaceKey),
        },
        ...[...input.targetState.facts.values()].map((fact) => ({
          kind: "fact" as const,
          action: "add" as const,
          fact,
        })),
      ],
    }),
    certificates: [defaultCertificate],
    packetEntries: [],
    diagnostics: [],
  };
}

function identityTransfer(): ProofCheckTransitionResult {
  return {
    kind: "ok",
    patch: proofCheckStatePatchForTest({
      kind: "coreTransfer",
      entries: [],
    }),
    certificates: [defaultCertificate],
    packetEntries: [],
    diagnostics: [],
  };
}

function defaultRegistryForProgram(
  program: ProofCheckKernelTestProgram,
): ProofCheckOperationTransferRegistry {
  const edgeLifecycleById = new Map<number, "owned" | "moved">([
    [Number(trueToMergeEdgeId), "owned"],
    [Number(falseToMergeEdgeId), "moved"],
  ]);

  return {
    functionEntry: () => identityTransfer(),
    statement: () => identityTransfer(),
    terminator: () => identityTransfer(),
    edge: ({ operation }) => {
      const edgeState = program.edgeStates?.get(Number(operation.edge.edgeId));
      const placeLifecycle = edgeLifecycleById.get(Number(operation.edge.edgeId));
      if (edgeState !== undefined && placeLifecycle !== undefined) {
        return branchEdgeTransfer({ targetState: edgeState, placeLifecycle });
      }
      return identityTransfer();
    },
    call: () => identityTransfer(),
    join: () => identityTransfer(),
    loopHeader: () => identityTransfer(),
    exit: () => identityTransfer(),
    terminalClosure: () => identityTransfer(),
  };
}

function functionSignatureForTest(): MonoFunctionSignature {
  return {
    functionId: functionId(0),
    itemId: itemId(0),
    parameters: [],
    returnType: { kind: "primitive", name: "unit" } as never,
    returnKind: "Copy",
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
}

function buildMirProgram(functionGraph: ProofMirFunction): ProofMirProgram {
  const functions = proofMirDeterministicTable({
    entries: [functionGraph],
    keyOf: (entry) => proofMirCanonicalKey(`function:${String(entry.functionInstanceId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`function:${String(id)}`),
    normalizePayload: (entry) => String(entry.functionInstanceId),
  });
  if (functions.kind !== "ok") {
    throw new Error("function table failed");
  }

  return {
    image: {
      imageInstanceId: monoInstanceId("0"),
      entryFunctionInstanceId: defaultFunctionInstanceId,
      externalRoots: [],
      layout: { kind: "imageEntryAbi", imageInstanceId: monoInstanceId("0") },
      origin,
    },
    reachableFunctions: emptyDeterministicTable("reachable"),
    functions: functions.table,
    layout: {} as LayoutFactProgram,
    proofMetadata: {} as MonoProofMetadata,
    origins: emptyDeterministicTable("origin"),
    facts: emptyDeterministicTable("fact"),
    layoutTerms: emptyDeterministicTable("layout-term"),
    privateStateGenerations: emptyDeterministicTable("private-state"),
    callGraph: emptyDeterministicTable("call"),
    platformEdges: emptyDeterministicTable("platform-edge"),
    runtimeCatalog: {
      targetId: "x64-test" as never,
      features: [],
      get: () => undefined,
      entries: () => [],
    } satisfies ProofMirRuntimeCatalog,
    runtimeCalls: emptyDeterministicTable("runtime-call"),
  };
}

function proofMirFunctionWithBranch(): ProofMirFunction {
  const entryBlock: ProofMirBlock = {
    blockId: entryBlockId,
    scopeId: proofMirScopeId(0),
    parameters: [],
    statements: [proofMirStatementForTest(proofMirStatementId(1))],
    terminator: proofMirTerminatorForTest({
      terminatorId: proofMirTerminatorId(1),
      kind: {
        kind: "branch",
        condition: 0 as never,
        whenTrue: { edgeId: trueEdgeId, blockId: trueArmBlockId },
        whenFalse: { edgeId: falseEdgeId, blockId: falseArmBlockId },
      },
      outgoingEdges: [trueEdgeId, falseEdgeId],
    }),
    incomingEdges: [],
    origin,
  };

  const trueArmBlock: ProofMirBlock = {
    blockId: trueArmBlockId,
    scopeId: proofMirScopeId(1),
    parameters: [],
    statements: [],
    terminator: proofMirTerminatorForTest({
      terminatorId: proofMirTerminatorId(2),
      outgoingEdges: [trueToMergeEdgeId],
    }),
    incomingEdges: [trueEdgeId],
    origin,
  };

  const falseArmBlock: ProofMirBlock = {
    blockId: falseArmBlockId,
    scopeId: proofMirScopeId(2),
    parameters: [],
    statements: [],
    terminator: proofMirTerminatorForTest({
      terminatorId: proofMirTerminatorId(3),
      outgoingEdges: [falseToMergeEdgeId],
    }),
    incomingEdges: [falseEdgeId],
    origin,
  };

  const mergeBlock: ProofMirBlock = {
    blockId: mergeBlockId,
    scopeId: proofMirScopeId(3),
    parameters: [],
    statements: [],
    terminator: proofMirTerminatorForTest({
      terminatorId: proofMirTerminatorId(4),
      outgoingEdges: [],
    }),
    incomingEdges: [trueToMergeEdgeId, falseToMergeEdgeId],
    origin,
  };

  const blocks = proofMirDeterministicTable({
    entries: [entryBlock, trueArmBlock, falseArmBlock, mergeBlock],
    keyOf: (block) => proofMirCanonicalKey(`block:${String(block.blockId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`block:${String(id)}`),
    normalizePayload: (block) => String(block.blockId),
  });
  if (blocks.kind !== "ok") {
    throw new Error("block table failed");
  }

  const edges = proofMirDeterministicTable({
    entries: [
      proofMirControlEdgeForTest({
        edgeId: trueEdgeId,
        fromBlockId: entryBlockId,
        toBlockId: trueArmBlockId,
      }),
      proofMirControlEdgeForTest({
        edgeId: falseEdgeId,
        fromBlockId: entryBlockId,
        toBlockId: falseArmBlockId,
      }),
      proofMirControlEdgeForTest({
        edgeId: trueToMergeEdgeId,
        fromBlockId: trueArmBlockId,
        toBlockId: mergeBlockId,
      }),
      proofMirControlEdgeForTest({
        edgeId: falseToMergeEdgeId,
        fromBlockId: falseArmBlockId,
        toBlockId: mergeBlockId,
      }),
    ],
    keyOf: (entry) => proofMirCanonicalKey(`edge:${String(entry.edgeId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`edge:${String(id)}`),
    normalizePayload: (entry) => String(entry.edgeId),
  });
  if (edges.kind !== "ok") {
    throw new Error("edge table failed");
  }

  return {
    functionInstanceId: defaultFunctionInstanceId,
    sourceFunctionId: functionId(0),
    signature: functionSignatureForTest(),
    entryBlockId,
    blocks: blocks.table,
    edges: edges.table,
    values: emptyDeterministicTable("value"),
    locals: emptyDeterministicTable("local"),
    places: emptyDeterministicTable("place"),
    scopes: emptyDeterministicTable("scope"),
    exits: [proofMirExitEdgeForTest(entryBlockId)],
    origin,
  };
}

function proofMirFunctionWithSingleBlock(): ProofMirFunction {
  const block: ProofMirBlock = {
    blockId: singleBlockId,
    scopeId: proofMirScopeId(0),
    parameters: [],
    statements: [proofMirStatementForTest(proofMirStatementId(1))],
    terminator: proofMirTerminatorForTest({
      terminatorId: proofMirTerminatorId(1),
      outgoingEdges: [],
    }),
    incomingEdges: [],
    origin,
  };

  const blocks = proofMirDeterministicTable({
    entries: [block],
    keyOf: (entry) => proofMirCanonicalKey(`block:${String(entry.blockId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`block:${String(id)}`),
    normalizePayload: (entry) => String(entry.blockId),
  });
  if (blocks.kind !== "ok") {
    throw new Error("block table failed");
  }

  return {
    functionInstanceId: defaultFunctionInstanceId,
    sourceFunctionId: functionId(0),
    signature: functionSignatureForTest(),
    entryBlockId: singleBlockId,
    blocks: blocks.table,
    edges: emptyDeterministicTable("edge"),
    values: emptyDeterministicTable("value"),
    locals: emptyDeterministicTable("local"),
    places: emptyDeterministicTable("place"),
    scopes: emptyDeterministicTable("scope"),
    exits: [proofMirExitEdgeForTest(singleBlockId)],
    origin,
  };
}

export function proofCheckProgramWithSingleBlock(input?: {
  readonly entryState?: ProofCheckState;
}): ProofCheckKernelTestProgram {
  return {
    mir: buildMirProgram(proofMirFunctionWithSingleBlock()),
    functionInstanceId: defaultFunctionInstanceId,
    entryState: input?.entryState ?? proofCheckStateForTest(),
  };
}

export function proofCheckProgramWithBranch(input: {
  readonly trueState: ProofCheckState;
  readonly falseState: ProofCheckState;
}): ProofCheckKernelTestProgram {
  const trueState = mergeBranchStates({
    state: input.trueState,
    placeLifecycle: "owned",
  });
  const falseState = mergeBranchStates({
    state: input.falseState,
    placeLifecycle: "moved",
  });

  return {
    mir: buildMirProgram(proofMirFunctionWithBranch()),
    functionInstanceId: defaultFunctionInstanceId,
    entryState: proofCheckStateForTest({
      places: [uninitializedPlaceForTest(branchPlaceKey)],
    }),
    edgeStates: new Map<number, ProofCheckState>([
      [Number(trueToMergeEdgeId), trueState],
      [Number(falseToMergeEdgeId), falseState],
    ]),
    blockLabels: new Map<ProofMirBlockId, string>([[mergeBlockId, "merge"]]),
  };
}

export function runProofCheckKernelForTest(
  program: ProofCheckKernelTestProgram,
): ProofCheckFunctionKernelResult {
  resetProofCheckGraphWorklistTransitionIdsForTest();
  return runProofCheckFunctionKernel({
    mir: program.mir,
    functionInstanceId: program.functionInstanceId,
    entryState: program.entryState,
    registry: program.registry ?? defaultRegistryForProgram(program),
    ...(program.blockLabels !== undefined ? { blockLabels: program.blockLabels } : {}),
  });
}

describe("computeProofCheckCoreMeet", () => {
  test("exact state equality accepts immediately", () => {
    const state = proofCheckStateForTest({ facts: [activeFactForTest("fact:a")] });
    const meet = computeProofCheckCoreMeet([state, state]);
    expect(meet?.kind).toBe("exact");
    if (meet?.kind !== "exact") return;
    expect(proofCheckStateKey(meet.state)).toBe(proofCheckStateKey(state));
  });

  test("core meet intersects facts and preserves matching resources", () => {
    const left = proofCheckStateForTest({
      facts: [activeFactForTest("fact:shared"), activeFactForTest("fact:left-only")],
    });
    const right = proofCheckStateForTest({
      facts: [activeFactForTest("fact:shared"), activeFactForTest("fact:right-only")],
    });

    const meet = computeProofCheckCoreMeet([left, right]);
    expect(meet?.kind).toBe("coreMeet");
    if (meet?.kind !== "coreMeet") return;
    expect([...meet.state.facts.keys()]).toEqual(["fact:shared"]);
  });

  test("core meet rejects mismatched resource components", () => {
    const left = proofCheckStateForTest({ places: [ownedPlaceForTest("place:a")] });
    const right = proofCheckStateForTest({ places: [movedPlaceForTest("place:a")] });

    const meet = computeProofCheckCoreMeet([left, right]);
    expect(meet?.kind).toBe("failed");
    if (meet?.kind !== "failed") return;
    expect(meet.failedComponentKeys).toContain("places");
  });
});

describe("runProofCheckFunctionKernel", () => {
  test("single-block program accepts with stable block visit order", () => {
    const program = proofCheckProgramWithSingleBlock({
      entryState: proofCheckStateForTest({ facts: [activeFactForTest("fact:entry")] }),
    });

    const result = runProofCheckKernelForTest(program);

    expect(result.kind).toBe("ok");
    expect(result.acceptedBlockStates.map((certificate) => String(certificate.blockId))).toEqual([
      String(singleBlockId),
    ]);
  });

  test("failed join records root diagnostic and suppression candidates", () => {
    const program = proofCheckProgramWithBranch({
      trueState: proofCheckStateForTest({ facts: [activeFactForTest("fact:true-only")] }),
      falseState: proofCheckStateForTest({ facts: [activeFactForTest("fact:false-only")] }),
    });

    const result = runProofCheckKernelForTest(program);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(
      result.diagnostics.filter(
        (diagnostic) => diagnostic.code === proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_JOIN"),
      ),
    ).toHaveLength(1);
    expect(result.debug.suppressionCandidates.map((candidate) => candidate.rootCauseKey)).toContain(
      "join:block:merge",
    );
  });

  test("failed join diagnostic includes counterexample path frames", () => {
    const program = proofCheckProgramWithBranch({
      trueState: proofCheckStateForTest({ facts: [activeFactForTest("fact:true-only")] }),
      falseState: proofCheckStateForTest({ facts: [activeFactForTest("fact:false-only")] }),
    });

    const result = runProofCheckKernelForTest(program);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    const joinDiagnostic = result.diagnostics.find(
      (diagnostic) => diagnostic.code === proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_JOIN"),
    );
    expect(joinDiagnostic?.counterexample?.frames.length).toBeGreaterThan(0);
    const frame = joinDiagnostic?.counterexample?.frames.at(-1);
    expect(frame?.blockKey).toBe("merge");
    expect(frame?.programPointKey).toBe("join:function:1/block:3");
    expect(frame?.beforeState.stateKey.length).toBeGreaterThan(0);
    expect(frame?.afterState.stateKey.length).toBeGreaterThan(0);
    expect(frame?.failedComponentKeys.length).toBeGreaterThan(0);
  });

  test("kernel exposes no-op resource, join, and suppression hook defaults", () => {
    const program = proofCheckProgramWithSingleBlock();
    const result = runProofCheckFunctionKernel({
      mir: program.mir,
      functionInstanceId: program.functionInstanceId,
      entryState: program.entryState,
      registry: defaultRegistryForProgram(program),
    });

    expect(result.kind).toBe("ok");
    expect(result.debug.suppressionCandidates).toEqual([]);
  });
});

describe("proofCheckOperationTransferRegistry integration", () => {
  test("handler errors surface through graph worklist transitions", () => {
    const program = proofCheckProgramWithSingleBlock();
    const result = runProofCheckFunctionKernel({
      mir: program.mir,
      functionInstanceId: program.functionInstanceId,
      entryState: program.entryState,
      registry: {
        ...defaultRegistryForProgram(program),
        statement: () => ({
          kind: "error",
          diagnostics: [
            proofCheckDiagnostic({
              severity: "error",
              code: proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
              messageTemplateId: "proof-check.input-contract-invalid",
              messageArguments: [{ kind: "text", value: "statement-handler-error" }],
              message: "statement-handler-error",
              ownerKey: "operation:statement",
              rootCauseKey: "operation:statement",
              stableDetail: "statement-handler-error",
            }),
          ],
        }),
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    );
  });
});

describe("dispatchProofCheckOperation", () => {
  test("registry wiring remains compatible with kernel transitions", () => {
    const program = proofCheckProgramWithSingleBlock();
    const registry = defaultRegistryForProgram(program);
    const transfer = dispatchProofCheckOperation({
      registry,
      transition: {
        transitionId: proofCheckTransitionId(1),
        functionInstanceId: program.functionInstanceId,
        location: {
          kind: "functionEntry",
          functionInstanceId: program.functionInstanceId,
        },
        inputState: program.entryState,
        operation: {
          kind: "functionEntry",
          functionInstanceId: program.functionInstanceId,
        } satisfies ProofCheckOperation,
      },
    });

    expect(transfer.kind).toBe("ok");
    if (transfer.kind !== "ok") return;
    expect(transfer.patch.kind).toBe(proofCheckPatchKind("coreTransfer"));
  });
});
