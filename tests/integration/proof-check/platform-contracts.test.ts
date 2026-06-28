import { describe, expect, test, beforeEach } from "bun:test";
import { checkProofAndResources } from "../../../src/proof-check/proof-checker";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  proofMirBlockId,
  proofMirOwnedPlaceId,
  proofMirOwnedPlaceIdKey,
} from "../../../src/proof-mir/ids";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import { checkPlatformContractTransfer } from "../../../src/proof-check/domains/platform-contract-transfer";
import { checkCrossCoreOwnershipTransfer } from "../../../src/proof-check/domains/cross-core-ownership";
import { checkRuntimeContractTransfer } from "../../../src/proof-check/domains/runtime-contract-transfer";
import { normalizeRuntimeFactSchemaRequirement } from "../../../src/proof-check/authority/runtime-authority";
import { resetProofCheckCoreCertificateIdsForTest } from "../../../src/proof-check/domains/facts";
import { resetProofCheckPrivateStateCertificateIdsForTest } from "../../../src/proof-check/domains/private-state";
import { resetPlatformEffectCertificateIdsForTest } from "../../../src/proof-check/domains/platform-contract-effects";
import {
  normalizeProofCheckTerm,
  syntheticBinderId,
} from "../../../src/proof-check/model/fact-language";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import { proofCheckRuntimeCatalogFake } from "../../support/proof-check/authority-fakes";
import {
  proofMirRuntimeCatalogFake,
  proofMirRuntimeOperationFake,
} from "../../support/proof-mir/proof-mir-fakes";
import {
  activeFactForTest,
  privateGenerationForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import {
  checkProofSourceForTest,
  expectProofCheckDiagnosticOrderForTest,
  probeProofCheckSourceSyntaxForTest,
} from "../../support/proof-check/integration-fixtures";
import {
  checkProofAndResourcesForClosedFixture,
  proofCheckClosedFixture,
} from "../../support/proof-check/proof-check-fixtures";
import { comparisonTerm, literalInt, valueTerm } from "../../support/proof-check/term-fixtures";
import {
  contractForTest,
  platformTransferInputForTest,
} from "../../unit/proof-check/platform-contract-transfer.test";
import {
  proofCheckProgramWithRuntimeCall,
  runtimeOperationForTest,
  runtimeTransferInputForTest,
} from "../../unit/proof-check/runtime-contract-transfer.test";
import { applyPlatformGuardedPostconditions } from "../../../src/proof-check/domains/platform-contract-effects";
import {
  initializedPrefixAdvanceWhenContiguousForTest,
  platformEffectInputForTest,
} from "../../unit/proof-check/platform-effects.test";
import { crossCoreOwnershipInputForTest } from "../../unit/proof-check/cross-core-ownership.test";

beforeEach(() => {
  resetProofCheckCoreCertificateIdsForTest();
  resetProofCheckPrivateStateCertificateIdsForTest();
  resetPlatformEffectCertificateIdsForTest();
});

describe("platform contracts integration", () => {
  test("accepted platform call discharges catalog comparison precondition", () => {
    const requirement = comparisonTerm(valueTerm("argument:0"), "le", literalInt(4n));
    const input = platformTransferInputForTest({
      preconditions: [requirement],
      activeFactTerms: [requirement],
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.resolution.authorityKey).toBe("platform:send");
  });

  test("rejected platform call reports missing catalog precondition deterministically", () => {
    const requirement = comparisonTerm(valueTerm("argument:0"), "le", literalInt(4n));
    const input = platformTransferInputForTest({
      preconditions: [requirement],
      state: proofCheckStateForTest({ facts: [] }),
      operationOriginKey: "integration:platform:send",
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_PLATFORM_PRECONDITION_FAILED",
        ownerKey: "integration:platform:send",
        rootCauseKey: `call-requirement:${normalizeProofCheckTerm(requirement).key}`,
      },
    ]);
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_PRECONDITION_FAILED"),
    );
  });

  test("accepted capability-flow transfer emits capabilityFlow packet entries", () => {
    const input = platformTransferInputForTest({
      preconditions: [],
      consumedCapabilities: [{ kind: "synthetic", id: "capability:tx" as never }],
      producedCapabilities: [{ kind: "synthetic", id: "capability:rx" as never }],
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
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("capabilityFlow")),
    ).toBe(true);
  });

  test("accepted contiguous write advances initialized prefix through guarded postconditions", () => {
    const contract = contractForTest({
      preconditions: [],
      guardedPostconditions: [initializedPrefixAdvanceWhenContiguousForTest()],
    });
    const input = platformTransferInputForTest({
      contract,
      preconditions: [],
      preFacts: [
        comparisonTerm(valueTerm("offset"), "eq", valueTerm("initialized_prefix")),
        comparisonTerm(valueTerm("initialized_prefix"), "eq", literalInt(0n)),
      ],
      operationOriginKey: "integration:platform:write-contiguous",
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patches.some(
        (patch) =>
          patch.kind === "fact" &&
          patch.action === "add" &&
          patch.fact.termKey.includes("initialized_prefix"),
      ),
    ).toBe(true);
  });

  test("rejected private-state advance reports deterministic mismatch", () => {
    const contract = contractForTest({
      preconditions: [],
      effects: [
        {
          kind: "advancesPrivateState",
          place: { kind: "synthetic", id: syntheticBinderId("cell") },
        },
      ],
    });
    const input = platformTransferInputForTest({
      contract,
      preconditions: [],
      state: proofCheckStateForTest(),
      operationOriginKey: "integration:platform:private-state",
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_PRIVATE_STATE_ADVANCE_MISMATCH",
        ownerKey: "integration:platform:private-state",
        rootCauseKey: "private-state-advance:cell",
      },
    ]);
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_PRIVATE_STATE_ADVANCE_MISMATCH"),
    );
  });

  test("accepted private-state effect emits privateState patch entries", () => {
    const contract = contractForTest({
      preconditions: [],
      effects: [
        {
          kind: "advancesPrivateState",
          place: { kind: "synthetic", id: syntheticBinderId("cell") },
        },
      ],
    });
    const input = platformTransferInputForTest({
      contract,
      preconditions: [],
      state: proofCheckStateForTest({
        privateState: [privateGenerationForTest("cell", "generation:1")],
        facts: [activeFactForTest("cell.is_open@generation:1")],
      }),
      privateStateAdvance: {
        placeKey: "cell",
        nextGenerationKey: "generation:2",
        transitionKey: "platform:close",
      },
      programPointScope: {
        kind: "blockEntry",
        functionInstanceId: monoInstanceId("fn:main"),
        blockId: proofMirBlockId(0),
      },
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.patches.some((patch) => patch.kind === "privateState")).toBe(true);
  });

  test("rejected cross-core transfer reports missing companion certificate deterministically", () => {
    const input = crossCoreOwnershipInputForTest({
      operationOriginKey: "integration:cross-core:transfer",
      companion: crossCoreOwnershipInputForTest().companion,
    });
    const result = checkCrossCoreOwnershipTransfer({
      ...input,
      companion: {
        ...input.companion,
        providedJudgments: [],
        judge: () => undefined,
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_CROSS_CORE_CERTIFICATE_MISSING",
        ownerKey: "integration:cross-core:transfer",
        rootCauseKey: "integration:cross-core:transfer",
      },
    ]);
  });

  test("accepted cross-core transfer emits capabilityFlow and ordering packet entries", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        operationOriginKey: "integration:cross-core:success",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("capabilityFlow")),
    ).toBe(true);
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("platformEffect")),
    ).toBe(true);
  });
});

describe("runtime contracts integration", () => {
  const defaultRuntimeRequirementSchema = {
    name: "buffer_valid",
    role: "requirement" as const,
    operands: [{ kind: "argument" as const, index: 0 }],
  };

  test("accepted runtime call discharges catalog comparison precondition", () => {
    const requirement = normalizeRuntimeFactSchemaRequirement(defaultRuntimeRequirementSchema);
    const input = proofCheckProgramWithRuntimeCall({
      activeFactTerms: [requirement],
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("ok");
  });

  test("rejected runtime call reports missing catalog precondition deterministically", () => {
    const requirement = normalizeRuntimeFactSchemaRequirement(defaultRuntimeRequirementSchema);
    const input = runtimeTransferInputForTest({
      state: proofCheckStateForTest({ facts: [] }),
      activeFactTerms: [],
      operationOriginKey: "integration:runtime:read",
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_RUNTIME_PRECONDITION_FAILED",
        ownerKey: "integration:runtime:read",
        rootCauseKey: `call-requirement:${normalizeProofCheckTerm(requirement).key}`,
      },
    ]);
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_PRECONDITION_FAILED"),
    );
  });

  test("runtime catalog fingerprint mismatch rejects before transfer", () => {
    const operation = runtimeOperationForTest({ requiredFactSchemas: [] });
    const input = runtimeTransferInputForTest({
      operation,
      embeddedCatalog: proofMirRuntimeCatalogFake({
        fingerprintName: "embedded-runtime",
        targetName: "x64-test",
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
        fingerprintName: "selected-runtime",
        targetName: "x64-test",
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
      operationOriginKey: "integration:runtime:fingerprint",
    });

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED"),
    );
    expect(result.diagnostics[0]?.rootCauseKey).toBe("fingerprint");
  });

  test("accepted runtime writesMemory invalidates dependent active facts", () => {
    const bufferPlace = proofMirOwnedPlaceId(monoInstanceId("fn:main"), 100 as never);
    const operation = runtimeOperationForTest({
      requiredFactSchemas: [],
      effectSchemas: [{ kind: "writesMemory", place: { kind: "argument", index: 0 } }],
    });
    const base = runtimeTransferInputForTest({
      operation,
      authenticate: false,
    });
    const input = {
      ...base,
      state: proofCheckStateForTest({
        facts: [activeFactForTest("buffer:initialized_prefix")],
      }),
      runtimeCall: {
        ...base.runtimeCall,
        effects: [{ kind: "writesMemory" as const, place: bufferPlace }],
      },
      operandBindings: {
        ownedPlaceKeys: new Map([[proofMirOwnedPlaceIdKey(bufferPlace), "buffer"]]),
      },
    };

    const result = checkRuntimeContractTransfer(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.patches.some(
        (patch) => patch.kind === "fact" && patch.fact.factKey === "buffer:initialized_prefix",
      ),
    ).toBe(true);
  });
});

describe("platform and runtime end-to-end integration", () => {
  const PLATFORM_REQUIRES_SOURCE = [
    "platform fn send(data: u8) -> u8",
    "    requires:",
    "        data <= 4",
    "",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ].join("\n");

  test("runtime catalog fingerprint mismatch is rejected end to end", () => {
    const input = proofCheckClosedFixture({
      runtimeCatalogFingerprintName: "selected-runtime",
      embeddedRuntimeCatalogFingerprintName: "embedded-runtime",
    });

    const result = checkProofAndResources(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED"),
    );
    expect(result.diagnostics[0]?.rootCauseKey).toBe("proof-check:runtime-catalog");
  });

  test("missing platform precondition fixture is rejected end to end", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "missing-platform-precondition",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(
      codes.includes(proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_PRECONDITION_FAILED")) ||
        codes.includes(proofCheckDiagnosticCode("PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH")),
    ).toBe(true);
  });

  test("missing cross-core certificate is rejected end to end", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "missing-cross-core-certificate",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("non-core-movable MoveRing transfer is rejected end to end", () => {
    const result = checkProofAndResourcesForClosedFixture({
      invalidCase: "non-core-movable-move-ring-transfer",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
    );
  });

  test("mismatched platform capability consumption is rejected deterministically", () => {
    const input = platformTransferInputForTest({
      preconditions: [],
      consumedCapabilities: [{ kind: "synthetic", id: "capability:missing" as never }],
      state: proofCheckStateForTest({ capabilities: [] }),
      operationOriginKey: "integration:e2e:capability-mismatch",
    });

    const result = checkPlatformContractTransfer(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_PLATFORM_CAPABILITY_FLOW_MISMATCH",
        ownerKey: "integration:e2e:capability-mismatch",
        rootCauseKey: "capability:missing",
      },
    ]);
  });

  test("sparse write does not advance initialized prefix before contiguous send", () => {
    const sparseResult = applyPlatformGuardedPostconditions(
      platformEffectInputForTest({
        preFacts: [comparisonTerm(valueTerm("offset"), "gt", valueTerm("initialized_prefix"))],
        guardedPostconditions: [initializedPrefixAdvanceWhenContiguousForTest()],
        operationOriginKey: "integration:e2e:sparse-write",
      }),
    );
    expect(sparseResult.kind).toBe("ok");
    if (sparseResult.kind !== "ok") return;
    expect(sparseResult.patch.entries.some((entry) => entry.kind === "fact")).toBe(false);

    const contiguousResult = applyPlatformGuardedPostconditions(
      platformEffectInputForTest({
        preFacts: [
          comparisonTerm(valueTerm("offset"), "eq", valueTerm("initialized_prefix")),
          comparisonTerm(valueTerm("initialized_prefix"), "eq", literalInt(0n)),
        ],
        guardedPostconditions: [initializedPrefixAdvanceWhenContiguousForTest()],
        operationOriginKey: "integration:e2e:contiguous-write",
      }),
    );
    expect(contiguousResult.kind).toBe("ok");
    if (contiguousResult.kind !== "ok") return;
    expect(contiguousResult.patch.entries.some((entry) => entry.kind === "fact")).toBe(true);
  });

  test("accepted cross-core transfer emits capabilityFlow packet entries end to end", () => {
    const result = checkCrossCoreOwnershipTransfer(
      crossCoreOwnershipInputForTest({
        operationOriginKey: "integration:e2e:cross-core-success",
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(
      result.packetEntries.some((entry) => entry.kind === checkedFactKindId("capabilityFlow")),
    ).toBe(true);
  });

  test("checkProofSourceForTest routes platform precondition snippets through fixture fallback when unsupported", () => {
    const syntax = probeProofCheckSourceSyntaxForTest(PLATFORM_REQUIRES_SOURCE);
    const result = checkProofSourceForTest(PLATFORM_REQUIRES_SOURCE, {
      fixtureFallback: { invalidCase: "missing-platform-precondition" },
    });

    expect(["supported", "unsupported-source-syntax"]).toContain(syntax);
    if (syntax === "unsupported-source-syntax") {
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
