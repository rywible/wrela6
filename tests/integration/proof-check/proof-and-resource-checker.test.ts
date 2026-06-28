import { describe, expect, test } from "bun:test";
import { checkProofAndResources } from "../../../src/proof-check/proof-checker";
import {
  checkProofAndResourcesForClosedFixture,
  proofCheckClosedFixture,
} from "../../support/proof-check/proof-check-fixtures";

describe("proof and resource checker integration", () => {
  test("checkProofAndResources returns checked mir and packet for accepted program", () => {
    const result = checkProofAndResourcesForClosedFixture();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.checked.mir.functions.entries().length).toBeGreaterThan(0);
    expect(result.checked.facts.origins.length).toBeGreaterThan(0);
  });

  test("repeated calls with the same input produce equal results", () => {
    const input = proofCheckClosedFixture();
    const first = checkProofAndResources(input);
    const second = checkProofAndResources(input);

    expect(first.kind).toBe(second.kind);
    if (first.kind !== "ok" || second.kind !== "ok") return;
    expect([...first.checked.checkedFunctions.keys()]).toEqual([
      ...second.checked.checkedFunctions.keys(),
    ]);
    expect([...first.checked.summaries.keys()]).toEqual([...second.checked.summaries.keys()]);
    expect(first.checked.facts.origins.map((entry) => entry.origin.originKey)).toEqual(
      second.checked.facts.origins.map((entry) => entry.origin.originKey),
    );
    expect(first.checked.terminalGraph.terminalKey).toBe(second.checked.terminalGraph.terminalKey);
  });
});
