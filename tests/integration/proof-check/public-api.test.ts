import { describe, expect, test } from "bun:test";
import { proofCheck } from "../../../src";
import { proofCheckClosedFixture } from "../../support/proof-check/proof-check-fixtures";

describe("proof-check public namespace", () => {
  test("top-level namespace exports checkProofAndResources", () => {
    expect(typeof proofCheck.checkProofAndResources).toBe("function");
  });

  test("accepted closed fixture returns checked mir through namespace", () => {
    const result = proofCheck.checkProofAndResources(proofCheckClosedFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.checkedFunctions.size).toBeGreaterThan(0);
    expect(result.checked.facts.origins.length).toBeGreaterThan(0);
  });

  test("error results never include checked mir", () => {
    const result = proofCheck.checkProofAndResources({
      ...proofCheckClosedFixture(),
      limits: {
        maximumReachableFunctions: 0,
        maximumBlocksPerFunction: 1,
        maximumEdgesPerFunction: 1,
        maximumAcceptedStateVariantsPerBlock: 1,
        maximumActiveFactsPerState: 1,
        maximumActiveLoansPerState: 1,
        maximumOpenObligationsPerState: 1,
        maximumOpenValidationsPerState: 1,
        maximumOpenAttemptsPerState: 1,
        maximumLiveCapabilitiesPerState: 1,
        maximumCounterexampleFrames: 1,
        maximumStagedPacketEntriesPerFunction: 1,
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect("checked" in result).toBe(false);
  });
});
