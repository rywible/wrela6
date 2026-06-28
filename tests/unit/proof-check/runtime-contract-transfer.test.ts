import { describe, expect, test, beforeEach } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  proofMirCallId,
  proofMirOriginId,
  proofMirOwnedPlaceId,
  proofMirOwnedPlaceIdKey,
  proofMirRuntimeCallId,
} from "../../../src/proof-mir/ids";
import type { ProofMirRuntimeCallContract } from "../../../src/proof-mir/model/calls";
import {
  authenticateProofCheckRuntimeCatalog,
  normalizeRuntimeFactSchemaRequirement,
  type ProofCheckRuntimeOperation,
} from "../../../src/proof-check/authority/runtime-authority";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  checkRuntimeContractTransfer,
  runtimeCallGraphEdgeForTest,
  type RuntimeContractTransferInput,
} from "../../../src/proof-check/domains/runtime-contract-transfer";
import { resetProofCheckCoreCertificateIdsForTest } from "../../../src/proof-check/domains/facts";
import { resetPlatformEffectCertificateIdsForTest } from "../../../src/proof-check/domains/platform-contract-effects";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import { proofMirRuntimeOperationId } from "../../../src/runtime/runtime-catalog";
import { targetId } from "../../../src/semantic/ids";
import { proofCheckRuntimeCatalogFake } from "../../support/proof-check/authority-fakes";
import {
  proofMirRuntimeCallContractFake,
  proofMirRuntimeCatalogFake,
  proofMirRuntimeOperationFake,
} from "../../support/proof-mir/proof-mir-fakes";
import {
  activeFactForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
const defaultFunctionInstanceId = monoInstanceId("fn:main");
const defaultRuntimeId = proofMirRuntimeOperationId(1);
const defaultRuntimeCallId = proofMirRuntimeCallId(1);
const defaultCallId = proofMirCallId(1);
const defaultTargetName = "x64-test";
const defaultTarget = targetId(defaultTargetName);

export function runtimeOperationForTest(input?: {
  readonly authorityKey?: string;
  readonly requiredFactSchemas?: ProofCheckRuntimeOperation["requiredFactSchemas"];
  readonly consumedCapabilitySchemas?: ProofCheckRuntimeOperation["consumedCapabilitySchemas"];
  readonly producedCapabilitySchemas?: ProofCheckRuntimeOperation["producedCapabilitySchemas"];
  readonly effectSchemas?: ProofCheckRuntimeOperation["effectSchemas"];
}): ProofCheckRuntimeOperation {
  const catalog = proofCheckRuntimeCatalogFake({
    fingerprintName: "runtime-test",
    targetName: defaultTargetName,
    entries: [
      {
        authorityKey: input?.authorityKey ?? "runtime:read_validated_u8",
        operation: proofMirRuntimeOperationFake({
          runtimeId: defaultRuntimeId,
          name: "read_validated_u8",
          loweringOwner: "validatedBufferHelper",
          requiredFactSchemas: input?.requiredFactSchemas ?? [
            {
              name: "buffer_valid",
              role: "requirement",
              operands: [{ kind: "argument", index: 0 }],
            },
          ],
          consumedCapabilitySchemas: input?.consumedCapabilitySchemas ?? [],
          producedCapabilitySchemas: input?.producedCapabilitySchemas ?? [],
          effectSchemas: input?.effectSchemas ?? [{ kind: "pure" }],
        }),
      },
    ],
  });
  const operation = catalog.get(defaultRuntimeId);
  if (operation === undefined) {
    throw new Error("runtimeOperationForTest failed to build operation");
  }
  return operation;
}

function matchingRuntimeCatalogs(input?: {
  readonly fingerprintName?: string;
  readonly operation?: ProofCheckRuntimeOperation;
}) {
  const operation = input?.operation ?? runtimeOperationForTest();
  const fingerprintName = input?.fingerprintName ?? "runtime-test";
  const embedded = proofMirRuntimeCatalogFake({
    fingerprintName,
    targetId: defaultTarget,
    targetName: defaultTargetName,
    operations: [
      {
        ...proofMirRuntimeOperationFake({
          runtimeId: operation.runtimeId,
          name: operation.name,
          loweringOwner: operation.loweringOwner,
          requiredFactSchemas: operation.requiredFactSchemas,
          consumedCapabilitySchemas: operation.consumedCapabilitySchemas,
          producedCapabilitySchemas: operation.producedCapabilitySchemas,
          effectSchemas: operation.effectSchemas,
          abi: operation.abi,
          targetAvailability: operation.targetAvailability,
        }),
        authorityKey: operation.authorityKey,
      },
    ],
  });
  const selected = proofCheckRuntimeCatalogFake({
    fingerprintName,
    targetName: defaultTargetName,
    entries: [
      {
        authorityKey: operation.authorityKey,
        operation: proofMirRuntimeOperationFake({
          runtimeId: operation.runtimeId,
          name: operation.name,
          loweringOwner: operation.loweringOwner,
          requiredFactSchemas: operation.requiredFactSchemas,
          consumedCapabilitySchemas: operation.consumedCapabilitySchemas,
          producedCapabilitySchemas: operation.producedCapabilitySchemas,
          effectSchemas: operation.effectSchemas,
          abi: operation.abi,
          targetAvailability: operation.targetAvailability,
        }),
      },
    ],
  });
  return { embedded, selected, operation };
}

function runtimeCallForTest(input?: {
  readonly operation?: ProofCheckRuntimeOperation;
  readonly requiredFacts?: ProofMirRuntimeCallContract["requiredFacts"];
  readonly consumedCapabilities?: ProofMirRuntimeCallContract["consumedCapabilities"];
  readonly producedCapabilities?: ProofMirRuntimeCallContract["producedCapabilities"];
  readonly effects?: ProofMirRuntimeCallContract["effects"];
}): ProofMirRuntimeCallContract {
  const operation = input?.operation ?? runtimeOperationForTest();
  return proofMirRuntimeCallContractFake({
    runtimeCallId: defaultRuntimeCallId,
    runtimeId: operation.runtimeId,
    callId: {
      functionInstanceId: defaultFunctionInstanceId,
      callId: defaultCallId,
    },
    requiredFacts: input?.requiredFacts ?? [],
    consumedCapabilities: input?.consumedCapabilities ?? [],
    producedCapabilities: input?.producedCapabilities ?? [],
    effects: input?.effects ?? [{ kind: "pure" }],
    origin: proofMirOriginId(1),
  });
}

export function runtimeTransferInputForTest(
  input: {
    readonly state?: ReturnType<typeof proofCheckStateForTest>;
    readonly operation?: ProofCheckRuntimeOperation;
    readonly runtimeCall?: ProofMirRuntimeCallContract;
    readonly embeddedCatalog?: ReturnType<typeof proofMirRuntimeCatalogFake>;
    readonly selectedCatalog?: ReturnType<typeof proofCheckRuntimeCatalogFake>;
    readonly activeFactTerms?: RuntimeContractTransferInput["activeFactTerms"];
    readonly operandBindings?: RuntimeContractTransferInput["operandBindings"];
    readonly operationOriginKey?: string;
    readonly authenticate?: boolean;
  } = {},
): RuntimeContractTransferInput {
  const catalogs = matchingRuntimeCatalogs({ operation: input.operation });
  const operation = input.operation ?? catalogs.operation;
  return {
    state: input.state ?? proofCheckStateForTest(),
    runtimeCall: input.runtimeCall ?? runtimeCallForTest({ operation }),
    operation,
    call: runtimeCallGraphEdgeForTest({
      functionInstanceId: defaultFunctionInstanceId,
      callId: defaultCallId,
      runtimeId: operation.runtimeId,
      runtimeCallId: defaultRuntimeCallId,
    }),
    ...(input.authenticate === false
      ? {}
      : {
          embeddedCatalog: input.embeddedCatalog ?? catalogs.embedded,
          selectedCatalog: input.selectedCatalog ?? catalogs.selected,
        }),
    activeFactTerms: input.activeFactTerms,
    operandBindings: input.operandBindings,
    operationOriginKey: input.operationOriginKey ?? "test:runtime-transfer",
  };
}

export function proofCheckProgramWithRuntimeCall(
  input: {
    readonly operation?: ProofCheckRuntimeOperation;
    readonly state?: ReturnType<typeof proofCheckStateForTest>;
    readonly activeFactTerms?: RuntimeContractTransferInput["activeFactTerms"];
  } = {},
): RuntimeContractTransferInput {
  return runtimeTransferInputForTest(input);
}

beforeEach(() => {
  resetProofCheckCoreCertificateIdsForTest();
  resetPlatformEffectCertificateIdsForTest();
});

describe("authenticateProofCheckRuntimeCatalog", () => {
  test("runtime fingerprint mismatch rejects before runtime transfer", () => {
    const result = authenticateProofCheckRuntimeCatalog({
      embedded: proofMirRuntimeCatalogFake({
        fingerprintName: "embedded",
        operations: [
          proofMirRuntimeOperationFake({
            runtimeId: defaultRuntimeId,
            name: "read_validated_u8",
          }),
        ],
      }),
      selected: proofCheckRuntimeCatalogFake({
        fingerprintName: "selected",
        entries: [
          {
            authorityKey: "runtime:read_validated_u8",
            operation: proofMirRuntimeOperationFake({
              runtimeId: defaultRuntimeId,
              name: "read_validated_u8",
            }),
          },
        ],
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED"),
    );
  });

  test("selected catalog missing embedded operation is rejected", () => {
    const embedded = proofMirRuntimeCatalogFake({
      operations: [
        proofMirRuntimeOperationFake({ runtimeId: defaultRuntimeId, name: "read_validated_u8" }),
        proofMirRuntimeOperationFake({
          runtimeId: proofMirRuntimeOperationId(2),
          name: "other",
          authorityKey: "runtime:other",
        }),
      ],
    });
    const selected = proofCheckRuntimeCatalogFake({
      entries: [
        {
          authorityKey: "runtime:read_validated_u8",
          operation: proofMirRuntimeOperationFake({
            runtimeId: defaultRuntimeId,
            name: "read_validated_u8",
          }),
        },
      ],
    });

    const result = authenticateProofCheckRuntimeCatalog({ embedded, selected });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("selected-missing-operation"),
      ),
    ).toBe(true);
  });

  test("matching runtime catalogs authenticate successfully", () => {
    const { embedded, selected } = matchingRuntimeCatalogs();
    const result = authenticateProofCheckRuntimeCatalog({ embedded, selected });
    expect(result.kind).toBe("ok");
  });
});

describe("checkRuntimeContractTransfer", () => {
  test("runtime call without entailed catalog precondition is rejected", () => {
    const schema = {
      name: "buffer_valid",
      role: "requirement" as const,
      operands: [{ kind: "argument" as const, index: 0 }],
    };
    const operation = runtimeOperationForTest({
      requiredFactSchemas: [schema],
    });
    const input = runtimeTransferInputForTest({
      operation,
      activeFactTerms: [],
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_PRECONDITION_FAILED"),
    );
  });

  test("comparison catalog precondition is accepted when active facts entail it", () => {
    const schema = {
      name: "buffer_valid",
      role: "requirement" as const,
      operands: [{ kind: "argument" as const, index: 0 }],
    };
    const operation = runtimeOperationForTest({
      requiredFactSchemas: [schema],
    });
    const requirement = normalizeRuntimeFactSchemaRequirement(schema);
    const input = runtimeTransferInputForTest({
      operation,
      activeFactTerms: [requirement],
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("ok");
  });

  test("runtime catalog fingerprint mismatch rejects before runtime transfer", () => {
    const { operation } = matchingRuntimeCatalogs();
    const input = runtimeTransferInputForTest({
      operation,
      embeddedCatalog: proofMirRuntimeCatalogFake({
        fingerprintName: "embedded",
        operations: [
          {
            ...proofMirRuntimeOperationFake({
              runtimeId: operation.runtimeId,
              name: operation.name,
            }),
            authorityKey: operation.authorityKey,
          },
        ],
      }),
      selectedCatalog: proofCheckRuntimeCatalogFake({
        fingerprintName: "selected",
        entries: [
          {
            authorityKey: operation.authorityKey,
            operation: proofMirRuntimeOperationFake({
              runtimeId: operation.runtimeId,
              name: operation.name,
            }),
          },
        ],
      }),
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED"),
    );
  });

  test("writesMemory drops facts depending on touched buffer subject", () => {
    const bufferPlace = proofMirOwnedPlaceId(defaultFunctionInstanceId, 100 as never);
    const operation = runtimeOperationForTest({
      requiredFactSchemas: [],
      effectSchemas: [{ kind: "writesMemory", place: { kind: "argument", index: 0 } }],
    });
    const input = runtimeTransferInputForTest({
      operation,
      state: proofCheckStateForTest({
        facts: [activeFactForTest("buffer:capacity"), activeFactForTest("other:capacity")],
      }),
      runtimeCall: runtimeCallForTest({
        operation,
        effects: [{ kind: "writesMemory", place: bufferPlace }],
      }),
      operandBindings: {
        ownedPlaceKeys: new Map([[proofMirOwnedPlaceIdKey(bufferPlace), "buffer"]]),
      },
      authenticate: false,
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patches.some(
        (patch) => patch.kind === "fact" && patch.fact.factKey === "buffer:capacity",
      ),
    ).toBe(true);
    expect(
      result.patches.some(
        (patch) => patch.kind === "fact" && patch.fact.factKey === "other:capacity",
      ),
    ).toBe(false);
  });

  test("trusted axiom schemas emit runtime trusted-axiom packet entries", () => {
    const operation = runtimeOperationForTest({
      requiredFactSchemas: [
        {
          name: "helper_axiom",
          role: "trustedAxiom",
          operands: [{ kind: "synthetic", name: "helper" }],
        },
      ],
    });
    const input = runtimeTransferInputForTest({
      operation,
      runtimeCall: runtimeCallForTest({
        operation,
        requiredFacts: [1 as never],
      }),
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packetEntries).toEqual([]);
    expect(result.patches.some((patch) => patch.kind === "fact" && patch.action === "add")).toBe(
      true,
    );
  });

  test("produced capability without catalog schema is rejected", () => {
    const operation = runtimeOperationForTest({
      requiredFactSchemas: [],
    });
    const input = runtimeTransferInputForTest({
      operation,
      runtimeCall: runtimeCallForTest({
        operation,
        producedCapabilities: [proofMirOwnedPlaceId(defaultFunctionInstanceId, 9 as never)],
      }),
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_FORGED_TRUSTED_AXIOM"),
    );
  });

  test("accepted capability flow emits capabilityFlow packet entries", () => {
    const operation = runtimeOperationForTest({
      requiredFactSchemas: [],
      consumedCapabilitySchemas: [{ kind: "synthetic", name: "capability:tx" }],
      producedCapabilitySchemas: [{ kind: "synthetic", name: "capability:rx" }],
    });
    const input = runtimeTransferInputForTest({
      operation,
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

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("capabilityFlow")),
    ).toBe(true);
  });

  test("mismatched runtime call target is rejected", () => {
    const operation = runtimeOperationForTest();
    const input = runtimeTransferInputForTest({ operation });
    const brokenInput = {
      ...input,
      call: runtimeCallGraphEdgeForTest({
        functionInstanceId: defaultFunctionInstanceId,
        callId: defaultCallId,
        runtimeId: proofMirRuntimeOperationId(99),
        runtimeCallId: defaultRuntimeCallId,
      }),
    };

    const result = checkRuntimeContractTransfer(brokenInput);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_PRECONDITION_FAILED"),
    );
  });
});
