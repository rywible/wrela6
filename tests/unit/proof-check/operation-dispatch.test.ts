import { describe, expect, test } from "bun:test";
import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoProofMetadata } from "../../../src/mono/mono-hir";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  dispatchProofCheckOperation,
  operationForProofMirProgramPoint,
  proofCheckOperationKey,
  proofCheckOperationKindOwnerKey,
  type ProofCheckOperationTransferRegistry,
} from "../../../src/proof-check/kernel/operation-dispatch";
import {
  PROOF_CHECK_OPERATION_KINDS,
  proofCheckProgramPointKey,
  type ProofCheckOperation,
  type ProofCheckProgramPoint,
  type ProofCheckTransitionResult,
} from "../../../src/proof-check/kernel/transition-api";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import {
  proofMirBlockId,
  proofMirCallId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirScopeId,
  proofMirStatementId,
  proofMirTerminatorId,
} from "../../../src/proof-mir/ids";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirFunction,
  ProofMirStatement,
} from "../../../src/proof-mir/model/graph";
import type { ProofMirCallGraphEdge } from "../../../src/proof-mir/model/calls";
import type { ProofMirOwnedCallId } from "../../../src/proof-mir/ids";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import type { ProofMirRuntimeCatalog } from "../../../src/runtime/runtime-catalog-types";
import { functionId, itemId } from "../../../src/semantic/ids";
import { SourceSpan } from "../../../src/shared/source-span";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import { proofCheckPatchKind } from "../../../src/proof-check/kernel/state-patch";
import { proofCheckDiagnosticForTest } from "../../support/proof-check/state-fixtures";
import { transitionForTest } from "./transition-api.test";

const defaultFunctionInstanceId = monoInstanceId("1");
const entryBlockId = proofMirBlockId(0);
const mergeBlockId = proofMirBlockId(1);
const loopHeaderBlockId = proofMirBlockId(2);
const statementId = proofMirStatementId(1);
const terminatorId = proofMirTerminatorId(1);
const edgeId = proofMirControlEdgeId(1);
const exitId = proofMirExitEdgeId(1);
const callId = proofMirOwnedCallId(defaultFunctionInstanceId, proofMirCallId(1));
const terminalKey = checkedTerminalClosureKey("terminal:main");
const origin = proofMirOriginId(0);

export interface ProofCheckOperationForTestInput {
  readonly kind: ProofCheckOperation["kind"];
}

function proofMirStatementForTest(): ProofMirStatement {
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

function proofMirExitEdgeForTest(): ProofMirExitEdge {
  return {
    exitId,
    fromBlockId: entryBlockId,
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

function proofMirCallGraphEdgeForTest(): ProofMirCallGraphEdge {
  return {
    callId,
    target: {
      kind: "sourceFunction",
      functionInstanceId: defaultFunctionInstanceId,
      abi: { kind: "functionAbi", functionInstanceId: defaultFunctionInstanceId },
    },
    origin,
  };
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

function proofMirFunctionForOperationDispatchTest(): ProofMirFunction {
  const entryBlock: ProofMirBlock = {
    blockId: entryBlockId,
    scopeId: proofMirScopeId(0),
    parameters: [],
    statements: [proofMirStatementForTest()],
    terminator: {
      terminatorId,
      kind: { kind: "unreachable", reason: "unreachableSource" },
      outgoingEdges: [edgeId],
      origin,
    },
    incomingEdges: [],
    origin,
  };

  const mergeBlock: ProofMirBlock = {
    blockId: mergeBlockId,
    scopeId: proofMirScopeId(1),
    parameters: [],
    statements: [],
    terminator: {
      terminatorId: proofMirTerminatorId(2),
      kind: { kind: "unreachable", reason: "unreachableSource" },
      outgoingEdges: [],
      origin,
    },
    incomingEdges: [edgeId],
    origin,
  };

  const loopHeaderBlock: ProofMirBlock = {
    blockId: loopHeaderBlockId,
    scopeId: proofMirScopeId(2),
    parameters: [],
    statements: [],
    terminator: {
      terminatorId: proofMirTerminatorId(3),
      kind: { kind: "unreachable", reason: "unreachableSource" },
      outgoingEdges: [],
      origin,
    },
    incomingEdges: [],
    stateMerge: {
      kind: "loopHeader",
      loopScopeId: proofMirScopeId(2),
      boundaryResources: {
        places: [],
        loans: [],
        obligations: [],
        sessionMembers: [],
        privateStateGenerations: [],
      },
      origin,
    },
    origin,
  };

  const blocks = proofMirDeterministicTable({
    entries: [entryBlock, mergeBlock, loopHeaderBlock],
    keyOf: (block) => proofMirCanonicalKey(`block:${String(block.blockId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`block:${String(id)}`),
    normalizePayload: (block) => String(block.blockId),
  });
  if (blocks.kind !== "ok") {
    throw new Error("block table failed");
  }

  const edge: ProofMirControlEdge = {
    edgeId,
    fromBlockId: entryBlockId,
    toBlockId: mergeBlockId,
    kind: "normal",
    arguments: [],
    facts: [],
    effects: [],
    crossedScopes: [],
    origin,
  };

  const edges = proofMirDeterministicTable({
    entries: [edge],
    keyOf: (entry) => proofMirCanonicalKey(`edge:${String(entry.edgeId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`edge:${String(id)}`),
    normalizePayload: (entry) => String(entry.edgeId),
  });
  if (edges.kind !== "ok") {
    throw new Error("edge table failed");
  }

  const signature = {
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
  } satisfies MonoFunctionSignature;

  return {
    functionInstanceId: defaultFunctionInstanceId,
    sourceFunctionId: functionId(0),
    signature,
    entryBlockId,
    blocks: blocks.table,
    edges: edges.table,
    values: emptyDeterministicTable("value"),
    locals: emptyDeterministicTable("local"),
    places: emptyDeterministicTable("place"),
    scopes: emptyDeterministicTable("scope"),
    exits: [proofMirExitEdgeForTest()],
    origin,
  };
}

function proofMirProgramForOperationDispatchTest(): ProofMirProgram {
  const functionGraph = proofMirFunctionForOperationDispatchTest();
  const functions = proofMirDeterministicTable({
    entries: [functionGraph],
    keyOf: (entry) => proofMirCanonicalKey(`function:${String(entry.functionInstanceId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`function:${String(id)}`),
    normalizePayload: (entry) => String(entry.functionInstanceId),
  });
  if (functions.kind !== "ok") {
    throw new Error("function table failed");
  }

  const callGraph = proofMirDeterministicTable<ProofMirOwnedCallId, ProofMirCallGraphEdge>({
    entries: [proofMirCallGraphEdgeForTest()],
    keyOf: (entry) => proofMirCanonicalKey(`call:${String(entry.callId.callId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`call:${String(id.callId)}`),
    normalizePayload: (entry) => String(entry.callId.callId),
  });
  if (callGraph.kind !== "ok") {
    throw new Error("call graph table failed");
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
    callGraph: callGraph.table,
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

function programPointForTest(kind: ProofCheckProgramPoint["kind"]): ProofCheckProgramPoint {
  switch (kind) {
    case "functionEntry":
      return { kind, functionInstanceId: defaultFunctionInstanceId };
    case "statement":
      return {
        kind,
        functionInstanceId: defaultFunctionInstanceId,
        blockId: entryBlockId,
        statementId,
      };
    case "terminator":
      return {
        kind,
        functionInstanceId: defaultFunctionInstanceId,
        blockId: entryBlockId,
        terminatorId,
      };
    case "edge":
      return {
        kind,
        functionInstanceId: defaultFunctionInstanceId,
        edgeId,
      };
    case "join":
      return {
        kind,
        functionInstanceId: defaultFunctionInstanceId,
        blockId: mergeBlockId,
      };
    case "loopHeader":
      return {
        kind,
        functionInstanceId: defaultFunctionInstanceId,
        blockId: loopHeaderBlockId,
      };
    case "call":
      return {
        kind,
        functionInstanceId: defaultFunctionInstanceId,
        callId,
      };
    case "exit":
      return {
        kind,
        functionInstanceId: defaultFunctionInstanceId,
        exitId,
      };
    case "terminalClosure":
      return {
        kind,
        terminalKey,
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function proofCheckOperationForTest(
  input: ProofCheckOperationForTestInput,
): ProofCheckOperation {
  switch (input.kind) {
    case "call":
      return { kind: "call", call: proofMirCallGraphEdgeForTest() };
    case "exit":
      return { kind: "exit", exit: proofMirExitEdgeForTest() };
    case "terminalClosure":
      return { kind: "terminalClosure", terminalKey };
    default: {
      const result = operationForProofMirProgramPoint({
        mir: proofMirProgramForOperationDispatchTest(),
        location: programPointForTest(input.kind),
      });
      if (result.kind !== "ok") {
        throw new Error(
          `proofCheckOperationForTest failed for ${input.kind}: ${result.diagnostics[0]?.stableDetail ?? "unknown"}`,
        );
      }
      return result.operation;
    }
  }
}

export function emptyProofCheckOperationTransferRegistryForTest(): ProofCheckOperationTransferRegistry {
  const noopHandler = (): ProofCheckTransitionResult => okTransferForTest();
  return {
    functionEntry: noopHandler,
    statement: noopHandler,
    terminator: noopHandler,
    edge: noopHandler,
    call: noopHandler,
    join: noopHandler,
    loopHeader: noopHandler,
    exit: noopHandler,
    terminalClosure: noopHandler,
  };
}

function okTransferForTest(): ProofCheckTransitionResult {
  return {
    kind: "ok",
    patch: {
      kind: proofCheckPatchKind("coreTransfer"),
      certificate: { kind: "core", id: proofCheckCoreCertificateId(1) },
      transitionId: proofCheckTransitionId(1),
      entries: [],
    },
    certificates: [],
    packetEntries: [],
    diagnostics: [],
  };
}

describe("operationForProofMirProgramPoint", () => {
  test("maps every scheduled program point kind to the matching ProofCheckOperation variant", () => {
    const mir = proofMirProgramForOperationDispatchTest();
    const scheduledProgramPointKinds = [
      "functionEntry",
      "statement",
      "terminator",
      "edge",
      "join",
      "loopHeader",
      "call",
      "exit",
      "terminalClosure",
    ] as const satisfies readonly ProofCheckProgramPoint["kind"][];

    for (const kind of scheduledProgramPointKinds) {
      const location = programPointForTest(kind);
      const result = operationForProofMirProgramPoint({ mir, location });

      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.operation.kind).toBe(kind);
    }
  });

  test("statement program points resolve the exact Proof MIR statement record", () => {
    const mir = proofMirProgramForOperationDispatchTest();
    const location = programPointForTest("statement");
    const result = operationForProofMirProgramPoint({ mir, location });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.operation).toEqual({
      kind: "statement",
      statement: proofMirStatementForTest(),
    });
  });

  test("missing MIR nodes return PROOF_CHECK_INPUT_CONTRACT_INVALID", () => {
    const mir = proofMirProgramForOperationDispatchTest();
    const result = operationForProofMirProgramPoint({
      mir,
      location: {
        kind: "statement",
        functionInstanceId: defaultFunctionInstanceId,
        blockId: entryBlockId,
        statementId: proofMirStatementId(99),
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
    );
  });

  test("identical MIR program points produce identical operation keys across repeated calls", () => {
    const mir = proofMirProgramForOperationDispatchTest();
    const location = programPointForTest("edge");

    const first = operationForProofMirProgramPoint({ mir, location });
    const second = operationForProofMirProgramPoint({ mir, location });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    expect(proofCheckOperationKey(first.operation, location)).toBe(
      proofCheckOperationKey(second.operation, location),
    );
    expect(proofCheckOperationKey(first.operation, location)).toBe(
      proofCheckProgramPointKey(location),
    );
  });
});

describe("dispatchProofCheckOperation", () => {
  test("operation dispatch invokes the registered handler for the operation kind", () => {
    const result = dispatchProofCheckOperation({
      registry: emptyProofCheckOperationTransferRegistryForTest(),
      transition: transitionForTest({
        operation: proofCheckOperationForTest({ kind: "statement" }),
      }),
    });

    expect(result.kind).toBe("ok");
  });

  test("registered handler receives the transition and matching operation variant", () => {
    let receivedOperationKind: ProofCheckOperation["kind"] | undefined;
    const registry: ProofCheckOperationTransferRegistry = {
      ...emptyProofCheckOperationTransferRegistryForTest(),
      join: ({ operation }) => {
        receivedOperationKind = operation.kind;
        return okTransferForTest();
      },
    };

    const result = dispatchProofCheckOperation({
      registry,
      transition: transitionForTest({
        operation: proofCheckOperationForTest({ kind: "join" }),
      }),
    });

    expect(result.kind).toBe("ok");
    expect(receivedOperationKind).toBe("join");
  });

  test("every operation kind uses a stable owner key prefix", () => {
    for (const kind of PROOF_CHECK_OPERATION_KINDS) {
      expect(proofCheckOperationKindOwnerKey(kind as never)).toBe(`operation:${kind}`);
    }
  });

  test("default test registry handlers return ok for every operation kind", () => {
    for (const kind of PROOF_CHECK_OPERATION_KINDS) {
      const result = dispatchProofCheckOperation({
        registry: emptyProofCheckOperationTransferRegistryForTest(),
        transition: transitionForTest({
          operation: proofCheckOperationForTest({ kind }),
        }),
      });

      expect(result.kind).toBe("ok");
    }
  });

  test("registered handler diagnostics pass through unchanged", () => {
    const diagnostic = proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT");
    const registry: ProofCheckOperationTransferRegistry = {
      ...emptyProofCheckOperationTransferRegistryForTest(),
      exit: () => ({
        kind: "error",
        diagnostics: [diagnostic],
      }),
    };

    const result = dispatchProofCheckOperation({
      registry,
      transition: transitionForTest({
        operation: proofCheckOperationForTest({ kind: "exit" }),
      }),
    });

    expect(result).toEqual({
      kind: "error",
      diagnostics: [diagnostic],
    });
  });
});
