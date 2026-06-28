import { describe, expect, test, beforeEach } from "bun:test";
import { proofCheckDiagnosticCode } from "../../../src/proof-check/diagnostics";
import {
  certifyProofErasure,
  proofOnlyPlaceForTest,
  proofOnlyValueForTest,
  resetProofCheckErasureCertificateIdsForTest,
  resourceOnlyValueForTest,
  type ProofCheckRuntimeUse,
} from "../../../src/proof-check/domains/erasure";
import { reduceProofCheckState } from "../../../src/proof-check/kernel/state-reducer";
import { proofCheckCoreCertificateId, proofCheckTransitionId } from "../../../src/proof-check/ids";
import type { ProofCheckCertificateId } from "../../../src/proof-check/model/certificates";
import { checkedFactKindId } from "../../../src/proof-check/model/fact-packet";
import { validateCheckedFactPacketEnvelope } from "../../../src/proof-check/validation/packet-validator";
import {
  activeFactForTest,
  consumedPlaceForTest,
  exclusiveLoanForTest,
  obligationStateForTest,
  ownedPlaceForTest,
  proofCheckStateForTest,
} from "../../support/proof-check/state-fixtures";
import { proofCheckStatePatchForTest } from "./state-patch-reducer.test";

const defaultCertificate: ProofCheckCertificateId = {
  kind: "core",
  id: proofCheckCoreCertificateId(1),
};

beforeEach(() => {
  resetProofCheckErasureCertificateIdsForTest();
});

describe("certifyProofErasure", () => {
  test("proof-only branch condition is not certified for erasure", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest(),
      subject: proofOnlyValueForTest("value:proof-branch"),
      runtimeUses: [{ kind: "branchCondition", valueKey: "value:proof-branch" }],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_ERASURE"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("branchCondition");
  });

  test("proof-only value with no runtime dependencies is certified", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest({
        facts: [activeFactForTest("value:proof-token:entails")],
      }),
      subject: proofOnlyValueForTest("value:proof-token"),
      runtimeUses: [],
      replacementTransitionKeys: ["transition:consume-fact"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.packetEntries.some((entry) => entry.kind === checkedFactKindId("erasure"))).toBe(
      true,
    );
    expect(result.certificates.length).toBeGreaterThan(0);
    expect(
      validateCheckedFactPacketEnvelope(
        result.packetEntries[0] as NonNullable<(typeof result)["packetEntries"][0]>,
      ),
    ).toEqual([]);
  });

  test("resource-only value is certified when represented resources are closed", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest({
        places: [consumedPlaceForTest("token")],
      }),
      subject: resourceOnlyValueForTest("token"),
      runtimeUses: [],
    });

    expect(result.kind).toBe("ok");
  });

  test("runtime representation rejects erasure", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest(),
      subject: {
        kind: "value",
        valueKey: "value:runtime",
        representation: { kind: "runtime" },
      },
      runtimeUses: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_ERASURE"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain("representation:runtime");
  });

  test("fact representation rejects erasure", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest(),
      subject: {
        kind: "value",
        valueKey: "value:fact",
        representation: { kind: "fact" },
      },
      runtimeUses: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_ERASURE"),
    );
  });

  test.each(
    (
      [
        "abi",
        "runtime",
        "platform",
        "layout",
        "stackSlot",
        "callTarget",
        "argumentOrder",
        "memoryAddress",
        "observableTargetBehavior",
      ] as const satisfies readonly ProofCheckRuntimeUse["kind"][]
    ).map((kind) => [kind] as const),
  )("runtime dependency %s rejects erasure", (kind) => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest(),
      subject: proofOnlyValueForTest("value:used"),
      runtimeUses: [{ kind, valueKey: "value:used" } as ProofCheckRuntimeUse],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.code).toBe(
      proofCheckDiagnosticCode("PROOF_CHECK_INVALID_ERASURE"),
    );
    expect(result.diagnostics[0]?.stableDetail).toContain(kind);
  });

  test("owned place subject with live lifecycle rejects erasure", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest({
        places: [ownedPlaceForTest("obligation")],
      }),
      subject: proofOnlyPlaceForTest("obligation"),
      runtimeUses: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("live-resource");
  });

  test("live loan on subject place rejects erasure", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest({
        loans: [exclusiveLoanForTest("buffer")],
      }),
      subject: proofOnlyPlaceForTest("buffer"),
      runtimeUses: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("loan:");
  });

  test("open obligation on subject rejects erasure", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest({
        obligations: [obligationStateForTest("obligation:token")],
      }),
      subject: proofOnlyPlaceForTest("obligation:token"),
      runtimeUses: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics[0]?.stableDetail).toContain("obligation:");
  });

  test("erasure certificate names replacement facts and transitions", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest({
        facts: [activeFactForTest("value:proof-token:entails")],
      }),
      subject: proofOnlyValueForTest("value:proof-token"),
      runtimeUses: [],
      replacementTransitionKeys: ["transition:close-fact"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const reduced = reduceProofCheckState(
      proofCheckStateForTest({
        facts: [activeFactForTest("value:proof-token:entails")],
      }),
      proofCheckStatePatchForTest({
        kind: "coreTransfer",
        transitionId: proofCheckTransitionId(2501),
        certificate: defaultCertificate,
        entries: result.patches,
      }),
    );
    expect(reduced.kind).toBe("ok");
    if (reduced.kind !== "ok") return;
    expect(reduced.state.erasures.has("erasure:value:proof-token")).toBe(true);
  });

  test("unrelated runtime uses do not block erasure", () => {
    const result = certifyProofErasure({
      state: proofCheckStateForTest(),
      subject: proofOnlyValueForTest("value:proof-token"),
      runtimeUses: [{ kind: "branchCondition", valueKey: "value:other-branch" }],
    });

    expect(result.kind).toBe("ok");
  });
});
