import { describe, expect, test } from "bun:test";

import { constructOptIr } from "../../../src/opt-ir/public-api";
import {
  validConstructOptIrInputForTest,
  validConstructOptIrInputWithReachableBlocksForTest,
} from "../../support/opt-ir/construction-fixtures";

describe("checked MIR to OptIR construction", () => {
  test("constructs verified OptIR from a checked MIR handoff fixture", () => {
    const result = constructOptIr(validConstructOptIrInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected checked MIR handoff to lower.");
    }

    const function_ = result.program.functions.entries()[0];
    expect(function_?.blocks).toHaveLength(1);
    expect(function_?.blocks[0]?.parameters).toEqual([]);
    expect(function_?.edges.entries()).toHaveLength(1);
    expect(result.program.provenance.originIds.length).toBeGreaterThan(0);
  });

  test("preserves reachable skeleton blocks through construction cleanup", () => {
    const result = constructOptIr(validConstructOptIrInputWithReachableBlocksForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected multi-block checked MIR handoff to lower.");
    }

    const function_ = result.program.functions.entries()[0];
    expect(function_?.blocks.map((block) => block.terminator?.kind)).toEqual(["jump", "return"]);
    expect(function_?.edges.entries().map((edge) => edge.kind)).toEqual(["normal", "returnExit"]);
  });
});
