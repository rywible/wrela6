import { describe, expect, test } from "bun:test";

import { constructOptIr } from "../../../src/opt-ir/public-api";
import {
  validConstructOptIrInputWithAttemptMatchForTest,
  validConstructOptIrInputWithCallResultPlaceLoadForTest,
  validConstructOptIrInputForTest,
  validConstructOptIrInputWithReachableBlocksForTest,
  validConstructOptIrInputWithScalarStatementsForTest,
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

  test("lowers checked MIR scalar statements into canonical OptIR operations", () => {
    const result = constructOptIr(validConstructOptIrInputWithScalarStatementsForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected scalar checked MIR handoff to lower.");
    }

    expect(result.program.operations?.map((operation) => operation.kind)).toEqual([
      "constant",
      "constant",
      "integerBinary",
      "integerCompare",
    ]);
    const function_ = result.program.functions.entries()[0];
    const returnBlock = function_?.blocks.find((block) => block.terminator?.kind === "return");
    expect(returnBlock?.operations).toEqual(
      result.program.operations?.map((operation) => operation.operationId),
    );
    expect(returnBlock?.terminator).toMatchObject({
      kind: "return",
      values: [result.program.operations?.at(-1)?.resultIds[0]],
    });
  });

  test("aliases value-and-place call results for later loads", () => {
    const result = constructOptIr(validConstructOptIrInputWithCallResultPlaceLoadForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error(
        `Expected call result place load to lower: ${result.diagnostics
          .map((diagnostic) => diagnostic.stableDetail)
          .join(",")}`,
      );
    }

    expect(result.program.operations?.map((operation) => operation.kind)).toContain("sourceCall");
    expect(
      result.program.operations?.some((operation) => operation.kind === "aggregateExtract"),
    ).toBe(false);
  });

  test("lowers checked MIR attempt matches into runtime status switches", () => {
    const result = constructOptIr(validConstructOptIrInputWithAttemptMatchForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error(
        `Expected attempt match to lower: ${result.diagnostics
          .map((diagnostic) => diagnostic.stableDetail)
          .join(",")}`,
      );
    }

    const function_ = result.program.functions.entries()[0];
    const entry = function_?.blocks.find((block) =>
      block.operations.some((operationId) =>
        result.program.operations?.some(
          (operation) => operation.operationId === operationId && operation.kind === "constant",
        ),
      ),
    );
    expect(entry?.terminator?.kind).toBe("switch");
    if (entry?.terminator?.kind !== "switch") {
      throw new Error("expected attempt entry block to end in a switch");
    }
    const successEdge = function_?.edges.entries().find((edge) => edge.kind === "attemptSuccess");
    const errorEdge = function_?.edges.entries().find((edge) => edge.kind === "attemptError");
    if (successEdge === undefined || errorEdge === undefined) {
      throw new Error("expected attempt success and error edges");
    }
    expect(entry.terminator.cases).toEqual([{ label: "0", edge: successEdge.edgeId }]);
    expect(entry.terminator.defaultEdge).toBe(errorEdge.edgeId);
    expect(
      result.program.operations?.some((operation) => operation.kind === "aggregateExtract"),
    ).toBe(false);
  });
});
