import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import {
  ordinaryIteratorProofMirFixture,
  proofMirSummary,
  streamForLoopProofMirFixture,
} from "../../support/proof-mir/proof-mir-fixtures";
import { proofMirRuntimeCatalogFake } from "../../support/proof-mir/proof-mir-fakes";

describe("iterator protocol integration", () => {
  test("ordinary checked iterator for keeps loop and protocol edges explicit", () => {
    const result = buildProofMir(ordinaryIteratorProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const summary = JSON.parse(proofMirSummary(result.mir));
    const iteratorFunction = summary.functions.find(
      (functionGraph: { functionInstanceId: string }) =>
        functionGraph.functionInstanceId === "fn:iterator-protocol",
    );
    expect(iteratorFunction).toBeDefined();
    if (iteratorFunction === undefined) {
      return;
    }

    expect(iteratorFunction.blocks.length).toBeGreaterThan(1);
    expect(iteratorFunction.edges.length).toBeGreaterThan(0);
    expect(
      iteratorFunction.edges.some((edge: { effects: readonly { kind: string }[] }) =>
        edge.effects.some((effect) => effect.kind === "introducePlace"),
      ),
    ).toBe(true);
    expect(
      iteratorFunction.edges.some((edge: { effects: readonly { kind: string }[] }) =>
        edge.effects.some((effect) => effect.kind === "dischargeObligation"),
      ),
    ).toBe(true);
    expect(summary.proofMetadata.callSiteRequirements.length).toBeGreaterThan(0);
    expect(summary.proofMetadata.obligations.length).toBeGreaterThan(0);

    expect(proofMirSummary(result.mir)).toMatchSnapshot();
  });

  test("stream for builds Proof MIR when streamLoop target feature is enabled", () => {
    const input = streamForLoopProofMirFixture();
    const result = buildProofMir({
      ...input,
      target: {
        ...input.target,
        features: [...input.target.features, "streamLoop"],
        runtimeCatalog: proofMirRuntimeCatalogFake({
          targetId: input.target.runtimeCatalog.targetId,
          features: [...input.target.runtimeCatalog.features, "streamLoop"],
          operations: input.target.runtimeCatalog.entries(),
        }),
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const summary = JSON.parse(proofMirSummary(result.mir));
    const streamFunction = summary.functions.find(
      (functionGraph: { functionInstanceId: string }) =>
        functionGraph.functionInstanceId === "fn:iterator-protocol",
    );
    expect(streamFunction).toBeDefined();
    expect(
      streamFunction.blocks.some(
        (block: { stateMerge?: { boundaryResources: { sessionMembers: readonly unknown[] } } }) =>
          (block.stateMerge?.boundaryResources.sessionMembers.length ?? 0) > 0,
      ),
    ).toBe(true);

    expect(proofMirSummary(result.mir)).toMatchSnapshot();
  });
});
