import { describe, expect, test, beforeEach } from "bun:test";
import { transferMovePlace } from "../../../src/proof-check/domains/ownership";
import { applyPlatformContractEffects } from "../../../src/proof-check/domains/platform-contract-effects";
import { checkLocalTerminalExit } from "../../../src/proof-check/domains/terminal";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  certifyProofErasure,
  proofOnlyValueForTest,
  resetProofCheckErasureCertificateIdsForTest,
} from "../../../src/proof-check/domains/erasure";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { checkedTerminalClosureKey } from "../../../src/proof-check/model/certificates";
import {
  CHECKED_PACKET_FACT_KINDS,
  checkedFactKindId,
  layoutFactKey,
  type CheckedFactDependencyKind,
  type CheckedFactPacketEntry,
  type CheckedFactKindId,
  type CheckedFactPacket,
  type CheckedFactSubject,
} from "../../../src/proof-check/model/fact-packet";
import {
  sortCheckedFactPacketEntries,
  validateCheckedFactPacketEnvelope,
} from "../../../src/proof-check/validation/packet-validator";
import { compareCodeUnitStrings } from "../../../src/semantic/surface/deterministic-sort";
import {
  activeFactForTest,
  ownedPlaceForTest,
  proofCheckPlaceForTest,
  proofCheckStateForTest,
  testPlaceResolverForKeys,
} from "../../support/proof-check/state-fixtures";
import { expectProofCheckDiagnosticOrderForTest } from "../../support/proof-check/integration-fixtures";
import { checkProofAndResourcesForClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import { contractForTest } from "../../unit/proof-check/platform-contract-transfer.test";
import { checkedPacketEnvelopeForTest } from "../../unit/proof-check/packet-envelope-validator.test";
import { proofCheckStatePatchForTest } from "../../unit/proof-check/state-patch-reducer.test";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

beforeEach(() => {
  resetProofCheckErasureCertificateIdsForTest();
});

describe("checked fact packet erasure integration", () => {
  test("accepted erasure certification produces valid packet envelope and state erasure fact", () => {
    const state = proofCheckStateForTest({
      facts: [activeFactForTest("value:proof-token:entails")],
    });

    const result = certifyProofErasure({
      state,
      subject: proofOnlyValueForTest("value:proof-token"),
      runtimeUses: [],
      operationOriginKey: "integration:erasure:proof-token",
      replacementTransitionKeys: ["transition:close-fact"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packetEntries.length).toBe(1);
    expect(result.packetEntries[0]?.kind).toBe(checkedFactKindId("erasure"));
    expect(
      validateCheckedFactPacketEnvelope(
        result.packetEntries[0] as NonNullable<(typeof result)["packetEntries"][0]>,
      ),
    ).toEqual([]);

    const nextState = reduceProofCheckState(
      state,
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(2502),
        certificate: defaultCertificate,
        entries: result.patches,
      }),
    );
    expect(nextState.kind).toBe("ok");
    if (nextState.kind !== "ok") return;
    expect(nextState.state.erasures.get("erasure:value:proof-token")?.subjectKey).toBe(
      "value:proof-token",
    );
  });

  test("runtime branch dependency rejects erasure with deterministic diagnostics", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest(),
      subject: proofOnlyValueForTest("value:proof-branch"),
      runtimeUses: [{ kind: "branchCondition", valueKey: "value:proof-branch" }],
      operationOriginKey: "integration:erasure:branch",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expectProofCheckDiagnosticOrderForTest(result.diagnostics, [
      {
        code: "PROOF_CHECK_INVALID_ERASURE",
        ownerKey: "integration:erasure:branch",
        rootCauseKey: "value:proof-branch",
      },
    ]);
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_ERASURE"),
    );
  });

  test("multiple erasure packet entries sort deterministically by kind and subject", () => {
    const first = certifyProofErasure({
      state: proofCheckStateForTest(),
      subject: proofOnlyValueForTest("value:token:b"),
      runtimeUses: [],
    });
    const second = certifyProofErasure({
      state: proofCheckStateForTest(),
      subject: proofOnlyValueForTest("value:token:a"),
      runtimeUses: [],
    });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    const sorted = sortCheckedFactPacketEntries([...first.packetEntries, ...second.packetEntries]);
    expect(sorted.map((entry) => entry.kind)).toEqual([
      checkedFactKindId("erasure"),
      checkedFactKindId("erasure"),
    ]);
    expect(sorted.length).toBe(2);
  });
});

describe("checked fact packet cross-domain integration", () => {
  function dependencyKinds(
    entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
  ): readonly CheckedFactDependencyKind[] {
    return entry.dependencies.map((dependency) => dependency.kind);
  }

  function packetSectionKeysForTest(facts: CheckedFactPacket): readonly string[] {
    return Object.keys(facts).sort(compareCodeUnitStrings);
  }

  const CHECKED_FACT_PACKET_SECTION_KEYS = [
    "ownership",
    "noalias",
    "fieldDisjointness",
    "erasures",
    "validatedBuffers",
    "packetSources",
    "privateState",
    "platformEffects",
    "capabilityFlow",
    "terminalClosure",
    "exitClosure",
    "layoutAbi",
    "origins",
  ] as const;

  test("checked fact packet section keys remain in canonical sorted order", () => {
    const result = checkProofAndResourcesForClosedFixture({
      validCase: "packet-rich-accepted-program",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(packetSectionKeysForTest(result.checked.facts)).toEqual(
      [...CHECKED_FACT_PACKET_SECTION_KEYS].sort(compareCodeUnitStrings),
    );
    expect(CHECKED_PACKET_FACT_KINDS).toContain("ownership");
    expect(CHECKED_PACKET_FACT_KINDS).toContain("validatedBuffer");
    expect(CHECKED_PACKET_FACT_KINDS).toContain("layoutAbi");
    expect(CHECKED_PACKET_FACT_KINDS).toContain("origin");
  });

  test("accepted end-to-end program includes origin facts", () => {
    const result = checkProofAndResourcesForClosedFixture({
      validCase: "validated-buffer-success",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.origins.length).toBeGreaterThan(0);
    expect(result.checked.facts.origins.map((entry) => entry.origin.originKey)).toEqual(
      result.checked.facts.origins
        .map((entry) => entry.origin.originKey)
        .sort(compareCodeUnitStrings),
    );
  });

  test("representative packet entries sort deterministically and expose expected dependency kinds", () => {
    const sourcePlaceKey = "proofMirPlace:1";
    const destinationPlaceKey = "proofMirPlace:2";
    const ownershipState = proofCheckStateForTest({
      places: [ownedPlaceForTest(sourcePlaceKey), ownedPlaceForTest(destinationPlaceKey)],
    });
    const ownershipResult = transferMovePlace({
      state: ownershipState,
      source: proofCheckPlaceForTest(sourcePlaceKey),
      destination: proofCheckPlaceForTest(destinationPlaceKey),
      operationOriginKey: "integration:packet:ownership",
      placeResolver: testPlaceResolverForKeys([sourcePlaceKey, destinationPlaceKey]),
    });
    expect(ownershipResult.kind).toBe("ok");
    if (ownershipResult.kind !== "ok") return;
    const ownershipEntry = ownershipResult.packetEntries.find(
      (entry) => entry.kind === checkedFactKindId("ownership"),
    );
    expect(ownershipEntry).toBeDefined();
    if (ownershipEntry === undefined) return;
    expect(dependencyKinds(ownershipEntry)).toEqual(["proofMirPlace", "proofMirPlace"]);

    const platformResult = applyPlatformContractEffects({
      state: proofCheckStateForTest(),
      contract: contractForTest({
        preconditions: [],
        effects: [{ kind: "writesMemory", place: { kind: "parameter", index: 0 } }],
      }),
      preFacts: [],
      operationOriginKey: "integration:packet:platform-effect",
      placeResolver: testPlaceResolverForKeys(["proofMirPlace:1"]),
      operandBindings: { arguments: [{ placeKey: "proofMirPlace:1" }] },
    });
    expect(platformResult.kind).toBe("ok");
    if (platformResult.kind !== "ok") return;
    const platformEntry = platformResult.packetEntries.find(
      (entry) => entry.kind === checkedFactKindId("platformEffect"),
    );
    expect(platformEntry).toBeDefined();
    if (platformEntry === undefined) return;
    expect(dependencyKinds(platformEntry)).toEqual(["proofMirPlace"]);

    const terminalResult = checkLocalTerminalExit({
      state: proofCheckStateForTest({
        terminal: [{ terminalKey: checkedTerminalClosureKey("terminal:integration") }],
      }),
      terminalReachabilityRequired: true,
      operationOriginKey: "integration:packet:terminal-closure",
    });
    expect(terminalResult.kind).toBe("ok");
    if (terminalResult.kind !== "ok") return;
    const terminalEntry = terminalResult.packetEntries.find(
      (entry) => entry.kind === checkedFactKindId("terminalClosure"),
    );
    expect(terminalEntry).toBeDefined();
    if (terminalEntry === undefined) return;
    expect(dependencyKinds(terminalEntry)).toEqual([]);

    const validatedBufferEntry = checkedPacketEnvelopeForTest({
      kind: checkedFactKindId("validatedBuffer"),
      dependencies: [
        { kind: "layoutFact", layoutKey: layoutFactKey("layout:Packet") },
        { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(42) },
      ],
    });
    const layoutAbiEntry = checkedPacketEnvelopeForTest({
      kind: checkedFactKindId("layoutAbi"),
      dependencies: [
        { kind: "layoutFact", layoutKey: layoutFactKey("layout:image-entry") },
        { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(43) },
      ],
    });

    const erasureResult = certifyProofErasure({
      state: proofCheckStateForTest({
        facts: [activeFactForTest("value:proof-token:entails")],
      }),
      subject: proofOnlyValueForTest("value:proof-token"),
      runtimeUses: [],
      operationOriginKey: "integration:packet:erasure",
    });
    expect(erasureResult.kind).toBe("ok");
    if (erasureResult.kind !== "ok") return;

    const combined = sortCheckedFactPacketEntries([
      ...erasureResult.packetEntries,
      layoutAbiEntry,
      validatedBufferEntry,
      terminalEntry,
      platformEntry,
      ownershipEntry,
    ]);

    expect(combined.map((entry) => entry.kind)).toEqual([
      checkedFactKindId("erasure"),
      checkedFactKindId("layoutAbi"),
      checkedFactKindId("ownership"),
      checkedFactKindId("platformEffect"),
      checkedFactKindId("terminalClosure"),
      checkedFactKindId("validatedBuffer"),
    ]);
    expect(validateCheckedFactPacketEnvelope(validatedBufferEntry)).toEqual([]);
    expect(validateCheckedFactPacketEnvelope(layoutAbiEntry)).toEqual([]);
    expect(dependencyKinds(validatedBufferEntry)).toEqual(["layoutFact", "coreCertificate"]);
    expect(dependencyKinds(layoutAbiEntry)).toEqual(["layoutFact", "coreCertificate"]);
  });

  test("accepted end-to-end program includes domain packet facts from checking", () => {
    const result = checkProofAndResourcesForClosedFixture({
      validCase: "packet-rich-accepted-program",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.capabilityFlow.length).toBeGreaterThan(0);
  });

  test("accepted packet contains erasure and origin facts from end-to-end checking", () => {
    const result = checkProofAndResourcesForClosedFixture();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.origins.length).toBeGreaterThan(0);
    expect(result.checked.facts.exitClosure.length).toBeGreaterThan(0);
  });

  test("accepted platform-reaching terminal program includes terminalClosure facts", () => {
    const result = checkProofAndResourcesForClosedFixture({ terminalPlatformBase: true });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.facts.terminalClosure.length).toBeGreaterThan(0);
    expect(result.checked.facts.terminalClosure[0]?.certificate.kind).toBe("semantics");
  });
});
