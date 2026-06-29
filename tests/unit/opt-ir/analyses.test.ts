import { describe, expect, test } from "bun:test";
import { computeOptIrDominance } from "../../../src/opt-ir/analyses/dominance";
import { computeOptIrLiveness } from "../../../src/opt-ir/analyses/liveness";
import type { OptIrBlockParameter } from "../../../src/opt-ir/values";
import type { OptIrValueId } from "../../../src/opt-ir/ids";
import {
  diamondAnalysisFixture,
  linearAnalysisFixture,
} from "../../support/opt-ir/analysis-fixtures";

describe("OptIR dominance and liveness analyses", () => {
  test("dominance and liveness handle diamond block arguments and return values", () => {
    const fixture = diamondAnalysisFixture();
    const dominance = computeOptIrDominance(fixture.func);
    const liveness = computeOptIrLiveness({
      func: fixture.func,
      operationForId(operationId) {
        return fixture.operations.get(Number(operationId));
      },
    });

    expect(dominance.dominates(fixture.blocks.entry.blockId, fixture.blocks.join.blockId)).toBe(
      true,
    );
    expect(dominance.dominates(fixture.blocks.thenBlock.blockId, fixture.blocks.join.blockId)).toBe(
      false,
    );
    expect(
      dominance.strictlyDominates(fixture.blocks.entry.blockId, fixture.blocks.join.blockId),
    ).toBe(true);
    expect(dominance.immediateDominator(fixture.blocks.join.blockId)).toBe(
      fixture.blocks.entry.blockId,
    );
    expect(dominance.dominators(fixture.blocks.join.blockId)).toEqual([
      fixture.blocks.entry.blockId,
      fixture.blocks.join.blockId,
    ]);

    const entryArgument = requireParameter(fixture.blocks.entry.parameters[0]);
    const condition = requireParameter(fixture.blocks.entry.parameters[1]);
    const thenValue = requireValueId(fixture.operations.get(20)?.resultIds[0]);

    expect(liveness.liveIn(fixture.blocks.thenBlock.blockId)).toEqual([
      entryArgument.valueId,
      condition.valueId,
    ]);
    expect(liveness.liveOut(fixture.blocks.thenBlock.blockId)).toEqual([
      entryArgument.valueId,
      condition.valueId,
      thenValue,
    ]);
    expect(liveness.liveIn(fixture.blocks.join.blockId)).toEqual([
      entryArgument.valueId,
      condition.valueId,
    ]);
    expect(liveness.liveOut(fixture.blocks.join.blockId)).toEqual([]);
  });

  test("dominance chooses the closest immediate dominator in a linear chain", () => {
    const fixture = linearAnalysisFixture();
    const dominance = computeOptIrDominance(fixture.func);

    expect(dominance.dominators(fixture.blocks.exit.blockId)).toEqual([
      fixture.blocks.entry.blockId,
      fixture.blocks.middle.blockId,
      fixture.blocks.exit.blockId,
    ]);
    expect(dominance.immediateDominator(fixture.blocks.exit.blockId)).toBe(
      fixture.blocks.middle.blockId,
    );
  });
});

function requireParameter(parameter: OptIrBlockParameter | undefined): OptIrBlockParameter {
  if (parameter === undefined) {
    throw new Error("Expected analysis fixture to contain block parameter.");
  }
  return parameter;
}

function requireValueId(valueId: OptIrValueId | undefined): OptIrValueId {
  if (valueId === undefined) {
    throw new Error("Expected analysis fixture to contain operation result.");
  }
  return valueId;
}
