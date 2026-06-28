import { describe, expect, test, beforeEach } from "bun:test";
import { hirPlatformContractEdgeId } from "../../../src/hir/ids";
import type { HirPlatformContractEdgeId } from "../../../src/hir/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoInstantiatedProofId, MonoPlatformContractEdge } from "../../../src/mono/mono-hir";
import { proofMirCallId, proofMirOriginId } from "../../../src/proof-mir/ids";
import type { ProofMirCallGraphEdge } from "../../../src/proof-mir/model/calls";
import type { ProofMirPlatformEdge } from "../../../src/proof-mir/model/program";
import type { ProofCheckPlatformContract } from "../../../src/proof-check/authority/platform-contracts";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkPlatformContractTransfer,
  platformCallIdForTest,
  resolvePlatformContract,
  type PlatformContractTransferInput,
} from "../../../src/proof-check/domains/platform-contract-transfer";
import { resetProofCheckCoreCertificateIdsForTest } from "../../../src/proof-check/domains/facts";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import { platformContractId, platformPrimitiveId, targetId } from "../../../src/semantic/ids";
import {
  proofCheckPlatformCatalogFake,
  proofCheckPlatformContractFake,
} from "../../support/proof-check/authority-fakes";
import {
  exclusiveLoanForTest,
  movedPlaceForTest,
  ownedPlaceForTest,
  proofCheckStateForTest,
  testPlaceResolverForState,
} from "../../support/proof-check/state-fixtures";
import {
  capabilityRequirementForTest,
  comparisonTerm,
  literalInt,
  valueTerm,
} from "../../support/proof-check/term-fixtures";

const defaultFunctionInstanceId = monoInstanceId("fn:main");
const defaultTarget = targetId("proof-check-test-target");
const defaultPrimitive = platformPrimitiveId("send");
const defaultContractName = platformContractId("default");
const defaultEdgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId> = {
  owner: { kind: "function", instanceId: defaultFunctionInstanceId },
  hirId: hirPlatformContractEdgeId(1),
  instanceId: defaultFunctionInstanceId,
};

function platformEdgeForTest(overrides: Partial<ProofMirPlatformEdge> = {}): ProofMirPlatformEdge {
  return {
    edgeId: defaultEdgeId,
    primitiveId: defaultPrimitive,
    abi: {
      kind: "platformAbi",
      edgeId: defaultEdgeId,
    },
    origin: proofMirOriginId(1),
    ...overrides,
  };
}

function monoEdgeForTest(
  overrides: Partial<MonoPlatformContractEdge> = {},
): MonoPlatformContractEdge {
  return {
    edgeId: defaultEdgeId,
    sourceFunctionId: 1 as never,
    primitiveId: defaultPrimitive,
    contractId: defaultContractName,
    targetId: defaultTarget,
    callExpressionId: 1 as never,
    instantiatedOwnerTypeArguments: [],
    instantiatedFunctionTypeArguments: [],
    monomorphicEdgeKey: "edge:test" as never,
    abi: {
      targetId: defaultTarget,
      primitiveId: defaultPrimitive,
      contractId: defaultContractName,
    },
    ensuredFacts: [],
    sourceOrigin: "test:platform-call",
    ...overrides,
  };
}

function certifiedPlatformCallForTest(
  overrides: Partial<ProofMirCallGraphEdge> = {},
): ProofMirCallGraphEdge {
  const callId = platformCallIdForTest(defaultFunctionInstanceId, proofMirCallId(1));
  return {
    callId,
    target: {
      kind: "certifiedPlatform",
      edgeId: defaultEdgeId,
      primitiveId: defaultPrimitive,
      abi: {
        kind: "platformAbi",
        edgeId: defaultEdgeId,
      },
    },
    origin: proofMirOriginId(2),
    ...overrides,
  };
}

function contractForTest(input?: {
  readonly preconditions?: ProofCheckPlatformContract["preconditions"];
  readonly postconditions?: ProofCheckPlatformContract["postconditions"];
  readonly guardedPostconditions?: ProofCheckPlatformContract["guardedPostconditions"];
  readonly effects?: ProofCheckPlatformContract["effects"];
  readonly consumedCapabilities?: ProofCheckPlatformContract["consumedCapabilities"];
  readonly producedCapabilities?: ProofCheckPlatformContract["producedCapabilities"];
}): ProofCheckPlatformContract {
  const catalog = proofCheckPlatformCatalogFake({
    entries: [proofCheckPlatformContractFake({ authorityKey: "platform:send" })],
  });
  const contract = catalog.get({
    targetId: defaultTarget,
    primitiveId: defaultPrimitive,
    contractId: defaultContractName,
  });
  if (contract === undefined) {
    throw new Error("contractForTest failed to build contract");
  }
  return {
    ...contract,
    ...(input?.preconditions === undefined ? {} : { preconditions: input.preconditions }),
    ...(input?.postconditions === undefined ? {} : { postconditions: input.postconditions }),
    ...(input?.guardedPostconditions === undefined
      ? {}
      : { guardedPostconditions: input.guardedPostconditions }),
    ...(input?.effects === undefined ? {} : { effects: input.effects }),
    ...(input?.consumedCapabilities === undefined
      ? {}
      : { consumedCapabilities: input.consumedCapabilities }),
    ...(input?.producedCapabilities === undefined
      ? {}
      : { producedCapabilities: input.producedCapabilities }),
  };
}

export { contractForTest };

export function platformTransferInputForTest(
  input: {
    readonly state?: ReturnType<typeof proofCheckStateForTest>;
    readonly preconditions?: ProofCheckPlatformContract["preconditions"];
    readonly postconditions?: ProofCheckPlatformContract["postconditions"];
    readonly guardedPostconditions?: ProofCheckPlatformContract["guardedPostconditions"];
    readonly effects?: ProofCheckPlatformContract["effects"];
    readonly consumedCapabilities?: ProofCheckPlatformContract["consumedCapabilities"];
    readonly producedCapabilities?: ProofCheckPlatformContract["producedCapabilities"];
    readonly operandBindings?: PlatformContractTransferInput["operandBindings"];
    readonly activeFactTerms?: PlatformContractTransferInput["activeFactTerms"];
    readonly preFacts?: PlatformContractTransferInput["preFacts"];
    readonly programPointScope?: PlatformContractTransferInput["programPointScope"];
    readonly privateStateAdvance?: PlatformContractTransferInput["privateStateAdvance"];
    readonly contract?: ProofCheckPlatformContract;
    readonly monoEdge?: MonoPlatformContractEdge;
    readonly platformEdge?: ProofMirPlatformEdge;
    readonly call?: ProofMirCallGraphEdge;
    readonly operationOriginKey?: string;
  } = {},
): PlatformContractTransferInput {
  const contract =
    input.contract ??
    contractForTest({
      preconditions: input.preconditions,
      postconditions: input.postconditions,
      guardedPostconditions: input.guardedPostconditions,
      effects: input.effects,
      consumedCapabilities: input.consumedCapabilities,
      producedCapabilities: input.producedCapabilities,
    });
  const state = input.state ?? proofCheckStateForTest();
  const operandPlaceKeys =
    input.operandBindings === undefined
      ? []
      : [
          ...(input.operandBindings.receiver !== undefined
            ? [input.operandBindings.receiver.placeKey]
            : []),
          ...(input.operandBindings.arguments ?? []).map((argument) => argument.placeKey),
          ...(input.operandBindings.capabilityPlaceKeys?.values() ?? []),
        ];
  return {
    state,
    call: input.call ?? certifiedPlatformCallForTest(),
    platformEdge: input.platformEdge ?? platformEdgeForTest(),
    contract,
    monoEdge: input.monoEdge ?? monoEdgeForTest(),
    catalog: proofCheckPlatformCatalogFake({
      entries: [proofCheckPlatformContractFake({ authorityKey: contract.authorityKey })],
    }),
    operandBindings: input.operandBindings,
    activeFactTerms: input.activeFactTerms,
    preFacts: input.preFacts,
    programPointScope: input.programPointScope,
    privateStateAdvance: input.privateStateAdvance,
    operationOriginKey: input.operationOriginKey ?? "test:platform-transfer",
    placeResolver: testPlaceResolverForState(state, [
      ...operandPlaceKeys,
      ...(input.privateStateAdvance !== undefined ? [input.privateStateAdvance.placeKey] : []),
    ]),
  };
}

export function proofCheckProgramWithPlatformCall(input: {
  readonly preconditions?: ProofCheckPlatformContract["preconditions"];
  readonly state?: ReturnType<typeof proofCheckStateForTest>;
}): PlatformContractTransferInput {
  return platformTransferInputForTest(input);
}

beforeEach(() => {
  resetProofCheckCoreCertificateIdsForTest();
});

describe("resolvePlatformContract", () => {
  test("resolves catalog contract from platform edge and mono metadata", () => {
    const catalog = proofCheckPlatformCatalogFake({
      entries: [proofCheckPlatformContractFake({ authorityKey: "platform:send" })],
    });
    const result = resolvePlatformContract({
      call: certifiedPlatformCallForTest(),
      platformEdge: platformEdgeForTest(),
      monoEdge: monoEdgeForTest(),
      catalog,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.resolution.authorityKey).toBe("platform:send");
    expect(result.resolution.primitiveId).toBe(defaultPrimitive);
    expect(result.resolution.contractId).toBe(defaultContractName);
    expect(result.resolution.edgeId).toEqual(defaultEdgeId);
  });

  test("missing catalog contract is rejected", () => {
    const catalog = proofCheckPlatformCatalogFake({ entries: [] });
    const result = resolvePlatformContract({
      call: certifiedPlatformCallForTest(),
      platformEdge: platformEdgeForTest(),
      monoEdge: monoEdgeForTest(),
      catalog,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_CONTRACT_MISSING"),
    );
  });
});

describe("checkPlatformContractTransfer", () => {
  test("platform primitive call without entailed catalog precondition is rejected", () => {
    const input = platformTransferInputForTest({
      preconditions: [capabilityRequirementForTest("capability:tx")],
      state: proofCheckStateForTest({ capabilities: [] }),
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_PRECONDITION_FAILED"),
    );
  });

  test("comparison catalog precondition is accepted when active facts entail it", () => {
    const requirement = comparisonTerm(valueTerm("argument:0"), "le", literalInt(8n));
    const input = platformTransferInputForTest({
      preconditions: [requirement],
      activeFactTerms: [requirement],
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("ok");
  });

  test("mismatched platform contract metadata is rejected", () => {
    const input = platformTransferInputForTest({
      monoEdge: monoEdgeForTest({ contractId: platformContractId("other") }),
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_CONTRACT_MISSING"),
    );
  });

  test("observed operand requires ownership and rejects moved places", () => {
    const input = platformTransferInputForTest({
      preconditions: [],
      state: proofCheckStateForTest({
        places: [movedPlaceForTest("argument:0")],
      }),
      operandBindings: {
        arguments: [
          {
            mode: "observe",
            placeKey: "argument:0",
            resourceKind: "Copy",
          },
        ],
      },
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"),
    );
  });

  test("observed operand rejects conflicting exclusive loans", () => {
    const input = platformTransferInputForTest({
      preconditions: [],
      state: proofCheckStateForTest({
        places: [ownedPlaceForTest("argument:0")],
        loans: [exclusiveLoanForTest("argument:0")],
      }),
      operandBindings: {
        arguments: [
          {
            mode: "observe",
            placeKey: "argument:0",
            resourceKind: "Copy",
          },
        ],
      },
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_CONFLICTING_LOAN"),
    );
  });

  test("consumed affine operand is consumed on success", () => {
    const input = platformTransferInputForTest({
      preconditions: [],
      state: proofCheckStateForTest({
        places: [ownedPlaceForTest("argument:0")],
      }),
      operandBindings: {
        arguments: [
          {
            mode: "consume",
            placeKey: "argument:0",
            resourceKind: "Affine",
          },
        ],
      },
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patches.some(
        (patch) => patch.kind === "placeState" && patch.state.lifecycle === "consumed",
      ),
    ).toBe(true);
  });

  test("produced and consumed capabilities emit patch entries and capability-flow certificates", () => {
    const consumedCapability = {
      kind: "synthetic" as const,
      id: "capability:tx" as never,
    };
    const producedCapability = {
      kind: "synthetic" as const,
      id: "capability:rx" as never,
    };
    const input = platformTransferInputForTest({
      preconditions: [],
      consumedCapabilities: [consumedCapability],
      producedCapabilities: [producedCapability],
      state: proofCheckStateForTest({
        capabilities: [{ capabilityKey: "capability:tx", capabilityKind: "capability:tx" }],
      }),
      operandBindings: {
        capabilityPlaceKeys: new Map([
          ["capability:tx", "capability:tx"],
          ["capability:rx", "capability:rx"],
        ]),
      },
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches.some((patch) => patch.kind === "capability")).toBe(true);
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("capabilityFlow")),
    ).toBe(true);
  });

  test("missing consumed capability reports capability-flow mismatch", () => {
    const input = platformTransferInputForTest({
      preconditions: [],
      consumedCapabilities: [{ kind: "synthetic", id: "capability:tx" as never }],
      state: proofCheckStateForTest({ capabilities: [] }),
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_CAPABILITY_FLOW_MISMATCH"),
    );
  });
});
