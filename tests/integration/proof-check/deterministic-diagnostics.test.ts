import { describe, expect, test } from "bun:test";
import { checkProofAndResources } from "../../../src/proof-check/proof-checker";
import type { ProofCheckDiagnostic } from "../../../src/proof-check/diagnostics";
import {
  checkProofAndResourcesForClosedFixture,
  proofCheckClosedFixture,
} from "../../support/proof-check/proof-check-fixtures";
import {
  checkedFactPacketStableKeysForTest,
  proofCheckResultStableKey,
  stableJsonForTest,
} from "../../support/proof-check/property-generators";

function diagnosticStableSnapshotForTest(diagnostics: readonly ProofCheckDiagnostic[]): readonly {
  readonly order: ProofCheckDiagnostic["order"];
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly counterexamplePathKeys: readonly string[];
}[] {
  return diagnostics.map((diagnostic) => ({
    order: diagnostic.order,
    ownerKey: diagnostic.ownerKey,
    rootCauseKey: diagnostic.rootCauseKey,
    stableDetail: diagnostic.stableDetail,
    counterexamplePathKeys:
      diagnostic.counterexample?.frames.map((frame) => frame.pathFrameKey) ?? [],
  }));
}

function acceptedResultStableSnapshotForTest(
  result: Extract<ReturnType<typeof checkProofAndResources>, { readonly kind: "ok" }>,
): string {
  return stableJsonForTest({
    checkedFunctions: [...result.checked.checkedFunctions.entries()]
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      .map(([functionInstanceId, checkedFunction]) => ({
        functionInstanceId: String(functionInstanceId),
        summaryCertificate: String(checkedFunction.summaryCertificate),
      })),
    summaries: [...result.checked.summaries.entries()]
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
      .map(([functionInstanceId, summary]) => ({
        functionInstanceId: String(functionInstanceId),
        certificateId: String(summary.certificateId),
      })),
    terminalGraph: result.checked.terminalGraph.terminalKey,
    packet: checkedFactPacketStableKeysForTest(result.checked.facts),
  });
}

describe("proof-check deterministic diagnostics", () => {
  test("diagnostics are deterministic across repeated invalid proof-check runs", () => {
    const first = checkProofAndResourcesForClosedFixture({
      invalidCase: "missing-platform-precondition",
    });
    const second = checkProofAndResourcesForClosedFixture({
      invalidCase: "missing-platform-precondition",
    });

    expect(first.kind).toBe("error");
    expect(second.kind).toBe("error");
    if (first.kind !== "error" || second.kind !== "error") {
      return;
    }

    expect(first.diagnostics.map((diagnostic) => diagnostic.order)).toEqual(
      second.diagnostics.map((diagnostic) => diagnostic.order),
    );
    expect(first.diagnostics.map((diagnostic) => diagnostic.ownerKey)).toEqual(
      second.diagnostics.map((diagnostic) => diagnostic.ownerKey),
    );
    expect(first.diagnostics.map((diagnostic) => diagnostic.rootCauseKey)).toEqual(
      second.diagnostics.map((diagnostic) => diagnostic.rootCauseKey),
    );
    expect(first.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(
      second.diagnostics.map((diagnostic) => diagnostic.stableDetail),
    );
    expect(
      first.diagnostics.map(
        (diagnostic) => diagnostic.counterexample?.frames.map((frame) => frame.pathFrameKey) ?? [],
      ),
    ).toEqual(
      second.diagnostics.map(
        (diagnostic) => diagnostic.counterexample?.frames.map((frame) => frame.pathFrameKey) ?? [],
      ),
    );
    expect(proofCheckResultStableKey(first)).toBe(proofCheckResultStableKey(second));
  });

  test("accepted proof-check runs are deterministic across repeated calls", () => {
    const input = proofCheckClosedFixture();

    const first = checkProofAndResources(input);
    const second = checkProofAndResources(input);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") {
      return;
    }

    expect([...first.checked.checkedFunctions.keys()]).toEqual([
      ...second.checked.checkedFunctions.keys(),
    ]);
    expect([...first.checked.summaries.keys()]).toEqual([...second.checked.summaries.keys()]);
    for (const functionInstanceId of first.checked.checkedFunctions.keys()) {
      const firstChecked = first.checked.checkedFunctions.get(functionInstanceId);
      const secondChecked = second.checked.checkedFunctions.get(functionInstanceId);
      expect(firstChecked?.summaryCertificate).toBe(secondChecked?.summaryCertificate);
      const firstSummary = first.checked.summaries.get(functionInstanceId);
      const secondSummary = second.checked.summaries.get(functionInstanceId);
      expect(firstSummary?.certificateId).toBe(secondSummary?.certificateId);
    }
    expect(first.checked.terminalGraph.terminalKey).toBe(second.checked.terminalGraph.terminalKey);
    expect(checkedFactPacketStableKeysForTest(first.checked.facts)).toEqual(
      checkedFactPacketStableKeysForTest(second.checked.facts),
    );
    expect(proofCheckResultStableKey(first)).toBe(proofCheckResultStableKey(second));
  });

  test("invalid diagnostic stable snapshot is byte-identical across repeated runs", () => {
    const first = checkProofAndResourcesForClosedFixture({
      invalidCase: "missing-platform-precondition",
    });
    const second = checkProofAndResourcesForClosedFixture({
      invalidCase: "missing-platform-precondition",
    });

    expect(first.kind).toBe("error");
    expect(second.kind).toBe("error");
    if (first.kind !== "error" || second.kind !== "error") {
      return;
    }

    const firstSnapshot = stableJsonForTest(diagnosticStableSnapshotForTest(first.diagnostics));
    const secondSnapshot = stableJsonForTest(diagnosticStableSnapshotForTest(second.diagnostics));

    expect(firstSnapshot).toBe(secondSnapshot);
    expect(firstSnapshot).toMatchSnapshot();
  });

  test("accepted result stable snapshot is byte-identical across repeated runs", () => {
    const input = proofCheckClosedFixture();

    const first = checkProofAndResources(input);
    const second = checkProofAndResources(input);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") {
      return;
    }

    const firstSnapshot = acceptedResultStableSnapshotForTest(first);
    const secondSnapshot = acceptedResultStableSnapshotForTest(second);

    expect(firstSnapshot).toBe(secondSnapshot);
    expect(firstSnapshot).toMatchSnapshot();
  });
});
