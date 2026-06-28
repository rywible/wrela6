import { describe, expect, test } from "bun:test";
import { hirPlatformContractEdgeId } from "../../../src/hir/ids";
import type {
  LayoutFactProgram,
  LayoutFunctionAbiFact,
  LayoutPlatformAbiFact,
} from "../../../src/layout/layout-program";
import {
  emptyImageDeviceTable,
  emptyPlatformAbiTable,
  emptyValidatedBufferTable,
} from "../../../src/layout/layout-fact-builder-support";
import type { LayoutCanonicalKeyString } from "../../../src/layout/ids";
import { layoutDeterministicTable } from "../../../src/layout/type-key";
import {
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
} from "../../support/layout/layout-fixtures";
import type { MonoInstantiatedProofId, MonoProofMetadata } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { proofMirDeterministicTable } from "../../../src/proof-mir/canonicalization/canonical-order";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  proofMirBlockId,
  proofMirCallId,
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirOwnedCallIdKey,
  proofMirOwnedPlaceId,
  proofMirPlaceId,
  proofMirRuntimeCallId,
  proofMirRuntimeOperationId,
  proofMirStatementId,
  proofMirTerminatorId,
} from "../../../src/proof-mir/ids";
import type {
  ProofMirCallGraphEdge,
  ProofMirRuntimeCallContract,
} from "../../../src/proof-mir/model/calls";
import type { ProofMirFunction } from "../../../src/proof-mir/model/graph";
import type { ProofMirProgram } from "../../../src/proof-mir/model/program";
import { validateProofMirCalls } from "../../../src/proof-mir/validation/call-validator";
import {
  proofMirRuntimeCatalogFake,
  proofMirRuntimeOperationFake,
} from "../../support/proof-mir/proof-mir-fakes";
import {
  coreTypeId,
  functionId,
  itemId,
  platformContractId,
  platformPrimitiveId,
  targetId,
} from "../../../src/semantic/ids";

const FUNCTION_INSTANCE_ID = monoInstanceId("function:main");
const CALLEE_INSTANCE_ID = monoInstanceId("function:callee");
const PLATFORM_EDGE_ID: MonoInstantiatedProofId<ReturnType<typeof hirPlatformContractEdgeId>> = {
  owner: { kind: "function", instanceId: FUNCTION_INSTANCE_ID },
  hirId: hirPlatformContractEdgeId(0),
  instanceId: FUNCTION_INSTANCE_ID,
};

function emptyTable<_Key, _Value>() {
  return {
    get: () => undefined,
    has: () => false,
    entries: () => [],
    keyOf: () => proofMirCanonicalKey("empty"),
    lookupKeyOf: () => proofMirCanonicalKey("empty"),
  };
}

function minimalFunctionAbi(
  functionInstanceId: ReturnType<typeof monoInstanceId>,
): LayoutFunctionAbiFact {
  const neverLayout = {
    key: { kind: "core" as const, coreTypeId: coreTypeId("Never") },
    sizeBytes: 0n,
    alignmentBytes: 1n,
    strideBytes: 0n,
    representation: { kind: "zeroSized" as const, reason: "unit" as const },
    sourceOrigin: "call-validator.test",
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
      sourceOrigin: "call-validator.test",
    },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: "call-validator.test",
  };
}

function minimalPlatformAbi(): LayoutPlatformAbiFact {
  return {
    edgeId: PLATFORM_EDGE_ID,
    primitiveId: platformPrimitiveId("uefi.exit"),
    contractId: platformContractId("exit"),
    targetId: targetId("x64-test"),
    hiddenParameters: [],
    arguments: [],
    result: { kind: "none", reason: "never", proofCarrying: false },
    callConvention: "wrela-source" as LayoutFunctionAbiFact["callConvention"],
    sourceOrigin: "call-validator.test",
  };
}

function layoutProgramForCalls(): LayoutFactProgram {
  const target = layoutTargetSurfaceFake();
  return {
    target: normalizeTargetFactsForTest(target),
    types: layoutDeterministicTable({
      entries: [],
      keyOf: () => ({}) as never,
      keyString: () => "core:test" as LayoutCanonicalKeyString,
    } as never),
    fields: layoutDeterministicTable({
      entries: [],
      keyOf: () => ({}) as never,
      keyString: () => "field:test" as LayoutCanonicalKeyString,
    } as never),
    enums: layoutDeterministicTable({
      entries: [],
      keyOf: () => ({}) as never,
      keyString: () => "enum:test" as LayoutCanonicalKeyString,
    } as never),
    validatedBuffers: emptyValidatedBufferTable(),
    imageDevices: emptyImageDeviceTable(),
    functions: layoutDeterministicTable({
      entries: [minimalFunctionAbi(CALLEE_INSTANCE_ID)],
      keyOf: (entry) => entry.functionInstanceId,
      keyString: (key) => `function:${String(key)}` as LayoutCanonicalKeyString,
    }),
    platformEdges: layoutDeterministicTable({
      entries: [minimalPlatformAbi()],
      keyOf: (entry) => entry.edgeId,
      keyString: () => "platform-edge:test" as LayoutCanonicalKeyString,
    }),
    imageEntry: {} as LayoutFactProgram["imageEntry"],
  };
}

function functionWithCall(input: {
  readonly callId: ReturnType<typeof proofMirCallId>;
  readonly target: ProofMirCallGraphEdge["target"];
}): ProofMirFunction {
  const origin = proofMirOriginId(0);
  const blockId = proofMirBlockId(0);
  const function_: ProofMirFunction = {
    functionInstanceId: FUNCTION_INSTANCE_ID,
    sourceFunctionId: functionId(0),
    signature: {
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
      sourceSpan: { start: 0, end: 0, length: 0 },
    },
    entryBlockId: blockId,
    blocks: emptyTable(),
    edges: emptyTable(),
    values: emptyTable(),
    locals: emptyTable(),
    places: emptyTable(),
    scopes: emptyTable(),
    exits: [],
    origin,
  };

  const block = {
    blockId,
    scopeId: 0 as never,
    parameters: [],
    statements: [
      {
        statementId: proofMirStatementId(0),
        kind: {
          kind: "call" as const,
          call: {
            callId: input.callId,
            target: input.target,
            arguments: [],
            requirements: [],
            origin,
          },
        },
        origin,
      },
    ],
    terminator: {
      terminatorId: proofMirTerminatorId(0),
      kind: { kind: "unreachable" as const, reason: "unreachableSource" as const },
      outgoingEdges: [],
      origin,
    },
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

  return { ...function_, blocks: blocks.table };
}

function callGraphTable(entries: readonly ProofMirCallGraphEdge[]) {
  const result = proofMirDeterministicTable({
    entries,
    keyOf: (entry) => proofMirCanonicalKey(`call:${proofMirOwnedCallIdKey(entry.callId)}`),
    lookupKeyOf: (id: ProofMirCallGraphEdge["callId"]) =>
      proofMirCanonicalKey(`call:${proofMirOwnedCallIdKey(id)}`),
    normalizePayload: (entry) => entry.target.kind,
  });
  if (result.kind !== "ok") {
    throw new Error("call graph table failed");
  }
  return result.table;
}

function baseProgram(input: {
  readonly layout?: LayoutFactProgram;
  readonly functions?: readonly ProofMirFunction[];
  readonly callGraph?: readonly ProofMirCallGraphEdge[];
  readonly runtimeCalls?: readonly ProofMirRuntimeCallContract[];
  readonly runtimeCatalog?: ReturnType<typeof proofMirRuntimeCatalogFake>;
}): ProofMirProgram {
  const imageInstanceId = monoInstanceId("image:main");
  const functions = proofMirDeterministicTable({
    entries: input.functions ?? [],
    keyOf: (entry) => proofMirCanonicalKey(`function:${String(entry.functionInstanceId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`function:${String(id)}`),
    normalizePayload: (entry) => String(entry.functionInstanceId),
  });
  if (functions.kind !== "ok") {
    throw new Error("function table failed");
  }

  const runtimeCalls = proofMirDeterministicTable({
    entries: input.runtimeCalls ?? [],
    keyOf: (entry) => proofMirCanonicalKey(`runtime-call:${String(entry.runtimeCallId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`runtime-call:${String(id)}`),
    normalizePayload: (entry) => String(entry.runtimeId),
  });
  if (runtimeCalls.kind !== "ok") {
    throw new Error("runtime call table failed");
  }

  const platformEdges = proofMirDeterministicTable({
    entries: [
      {
        edgeId: PLATFORM_EDGE_ID,
        primitiveId: platformPrimitiveId("uefi.exit"),
        abi: { kind: "platformAbi" as const, edgeId: PLATFORM_EDGE_ID },
        origin: proofMirOriginId(1),
      },
    ],
    keyOf: (entry) => proofMirCanonicalKey(`platform-edge:${String(entry.edgeId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`platform-edge:${String(id)}`),
    normalizePayload: (entry) => String(entry.edgeId),
  });
  if (platformEdges.kind !== "ok") {
    throw new Error("platform edge table failed");
  }

  return {
    image: {
      imageInstanceId,
      entryFunctionInstanceId: FUNCTION_INSTANCE_ID,
      externalRoots: [],
      layout: { kind: "imageEntryAbi", imageInstanceId },
      origin: proofMirOriginId(0),
    },
    reachableFunctions: emptyTable(),
    functions: functions.table,
    layout: input.layout ?? layoutProgramForCalls(),
    proofMetadata: {} as MonoProofMetadata,
    origins: emptyTable(),
    facts: emptyTable(),
    layoutTerms: emptyTable(),
    privateStateGenerations: emptyTable(),
    callGraph: callGraphTable(input.callGraph ?? []),
    platformEdges: platformEdges.table,
    runtimeCatalog:
      input.runtimeCatalog ??
      proofMirRuntimeCatalogFake({
        operations: [
          proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(1),
            name: "panic_abort",
          }),
        ],
      }),
    runtimeCalls: runtimeCalls.table,
  };
}

describe("validateProofMirCalls", () => {
  test("call statement without call graph edge is rejected", () => {
    const callId = proofMirCallId(1);
    const program = baseProgram({
      functions: [
        functionWithCall({
          callId,
          target: {
            kind: "sourceFunction",
            functionInstanceId: CALLEE_INSTANCE_ID,
            abi: { kind: "functionAbi", functionInstanceId: CALLEE_INSTANCE_ID },
          },
        }),
      ],
    });

    const diagnostics = validateProofMirCalls(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_CALL_ID"),
    );
  });

  test("platform call missing layout ABI fact is rejected", () => {
    const callId = proofMirCallId(2);
    const ownedCallId = proofMirOwnedCallId(FUNCTION_INSTANCE_ID, callId);
    const target = {
      kind: "certifiedPlatform" as const,
      edgeId: PLATFORM_EDGE_ID,
      primitiveId: platformPrimitiveId("uefi.exit"),
      abi: { kind: "platformAbi" as const, edgeId: PLATFORM_EDGE_ID },
    };
    const layoutWithoutPlatformAbi: LayoutFactProgram = {
      ...layoutProgramForCalls(),
      platformEdges: emptyPlatformAbiTable(),
    };
    const program = baseProgram({
      layout: layoutWithoutPlatformAbi,
      functions: [functionWithCall({ callId, target })],
      callGraph: [{ callId: ownedCallId, target, origin: proofMirOriginId(0) }],
    });

    const diagnostics = validateProofMirCalls(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_PLATFORM_ABI_FACT"),
    );
  });

  test("compiler-runtime call missing runtime call contract is rejected", () => {
    const callId = proofMirCallId(3);
    const ownedCallId = proofMirOwnedCallId(FUNCTION_INSTANCE_ID, callId);
    const runtimeCallId = proofMirRuntimeCallId(1);
    const target = {
      kind: "compilerRuntime" as const,
      runtimeId: proofMirRuntimeOperationId(1),
      runtimeCallId,
    };
    const program = baseProgram({
      functions: [functionWithCall({ callId, target })],
      callGraph: [{ callId: ownedCallId, target, origin: proofMirOriginId(0) }],
    });

    const diagnostics = validateProofMirCalls(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_RUNTIME_CALL_CONTRACT"),
    );
  });

  test("runtime catalog entries containing function-local IDs are rejected", () => {
    const catalog = proofMirRuntimeCatalogFake({
      operations: [
        {
          ...proofMirRuntimeOperationFake({
            runtimeId: proofMirRuntimeOperationId(2),
            name: "bad_runtime",
          }),
          requiredFactSchemas: [
            {
              name: "bad_fact",
              role: "requirement",
              operands: [
                {
                  kind: "argument",
                  index: 0,
                  functionInstanceId: FUNCTION_INSTANCE_ID,
                  valueId: 0 as never,
                } as never,
              ],
            },
          ],
        },
      ],
    });
    const program = baseProgram({ runtimeCatalog: catalog });

    const diagnostics = validateProofMirCalls(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY"),
    );
  });

  test("runtime call contract owner mismatch is rejected", () => {
    const callId = proofMirCallId(5);
    const ownedCallId = proofMirOwnedCallId(FUNCTION_INSTANCE_ID, callId);
    const otherFunctionCallId = proofMirOwnedCallId(CALLEE_INSTANCE_ID, callId);
    const target = {
      kind: "compilerRuntime" as const,
      runtimeId: proofMirRuntimeOperationId(1),
      runtimeCallId: proofMirRuntimeCallId(0),
      abi: { kind: "compilerRuntime" as const, symbol: "__wr_panic_abort" },
    };
    const program = baseProgram({
      functions: [functionWithCall({ callId, target })],
      callGraph: [{ callId: ownedCallId, target, origin: proofMirOriginId(0) }],
      runtimeCalls: [
        {
          runtimeCallId: proofMirRuntimeCallId(0),
          runtimeId: proofMirRuntimeOperationId(1),
          callId: otherFunctionCallId,
          requiredFacts: [],
          consumedCapabilities: [],
          producedCapabilities: [],
          effects: [{ kind: "mayPanic" }],
          origin: proofMirOriginId(2),
        },
      ],
    });

    const diagnostics = validateProofMirCalls(program);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_RUNTIME_CALL_CONTRACT"),
    );
  });

  test("matching source call with call graph edge is accepted", () => {
    const callId = proofMirCallId(4);
    const ownedCallId = proofMirOwnedCallId(FUNCTION_INSTANCE_ID, callId);
    const target = {
      kind: "sourceFunction" as const,
      functionInstanceId: CALLEE_INSTANCE_ID,
      abi: { kind: "functionAbi" as const, functionInstanceId: CALLEE_INSTANCE_ID },
    };
    const runtimeCallId = proofMirRuntimeCallId(0);
    const program = baseProgram({
      functions: [functionWithCall({ callId, target })],
      callGraph: [{ callId: ownedCallId, target, origin: proofMirOriginId(0) }],
      runtimeCalls: [
        {
          runtimeCallId,
          runtimeId: proofMirRuntimeOperationId(1),
          callId: ownedCallId,
          requiredFacts: [],
          consumedCapabilities: [proofMirOwnedPlaceId(FUNCTION_INSTANCE_ID, proofMirPlaceId(0))],
          producedCapabilities: [],
          effects: [{ kind: "mayPanic" }],
          origin: proofMirOriginId(2),
        },
      ],
    });

    const diagnostics = validateProofMirCalls(program);

    expect(diagnostics).toEqual([]);
  });
});
