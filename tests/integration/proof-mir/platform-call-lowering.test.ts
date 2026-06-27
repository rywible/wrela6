import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import {
  platformCallProofMirFixture,
  proofMirSummary,
} from "../../support/proof-mir/proof-mir-fixtures";

describe("platform call lowering integration", () => {
  test("certified platform call keeps target, edge, and ABI facts explicit", () => {
    const result = buildProofMir(platformCallProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const summary = JSON.parse(proofMirSummary(result.mir));
    expect(summary.layout.platformEdges.length).toBeGreaterThan(0);
    expect(summary.functions.length).toBeGreaterThan(1);
    expect(summary.callGraph.length).toBeGreaterThan(0);
    expect(summary.platformEdges.length).toBeGreaterThan(0);

    const platformEdge = summary.layout.platformEdges[0];
    expect(platformEdge.primitiveId).toBe("exit");
    expect(platformEdge.callConvention).toBe("wrela-platform");

    expect(proofMirSummary(result.mir)).toMatchSnapshot();
  });
});
