import { describe, expect, test } from "bun:test";
import { complementProofMirComparisonOperator } from "../../../src/proof-mir/domains/fact-recording";
import {
  lowerProofMirControlFlowForTest,
  lowerProofMirIfStatementForTest,
} from "../../support/proof-mir/lower-harness/if-lowerer-harness";

describe("ProofMirIfLowerer", () => {
  test("if scalar join uses edge arguments on predecessor edges", () => {
    const lowered = lowerProofMirIfStatementForTest({
      source: ["let x = 0", "if flag:", "    x = 1", "else:", "    x = 2", "return x"],
      scalarLocals: ["flag", "x"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.join?.parameters.map((parameter) => parameter.parameterKind.kind)).toEqual([
      "copyScalar",
    ]);
    expect(lowered.edgesTo(lowered.join!.blockKey).map((edge) => edge.arguments.length)).toEqual([
      1, 1,
    ]);
  });

  test("if lowers branch terminator with condition value and arm blocks", () => {
    const lowered = lowerProofMirIfStatementForTest({
      source: ["if flag:", "    return 1", "else:", "    return 2"],
      scalarLocals: ["flag"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.branch?.terminator?.kind).toBe("branch");
    if (lowered.branch?.terminator?.kind !== "branch") return;
    expect(lowered.branch.terminator.condition).toBeDefined();
    expect(lowered.thenBranch?.blockKey).toBeDefined();
    expect(lowered.else?.blockKey).toBeDefined();
    expect(lowered.join).toBeUndefined();
  });

  test("comparison branch facts use complement on the false edge", () => {
    const lowered = lowerProofMirIfStatementForTest({
      source: ["if value >= 2:", "    return value", "else:", "    return 0"],
      scalarLocals: ["value"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const trueEdge = lowered.branch?.whenTrue;
    const falseEdge = lowered.branch?.whenFalse;
    expect(trueEdge).toBeDefined();
    expect(falseEdge).toBeDefined();
    if (trueEdge === undefined || falseEdge === undefined) return;

    expect(trueEdge.factKeys.length).toBeGreaterThan(0);
    expect(falseEdge.factKeys.length).toBeGreaterThan(0);

    const trueComparison = lowered.factForKey(trueEdge.factKeys[0]!);
    const falseComparison = lowered.factForKey(falseEdge.factKeys[0]!);
    expect(trueComparison?.kind.kind).toBe("comparison");
    expect(falseComparison?.kind.kind).toBe("comparison");
    if (trueComparison?.kind.kind !== "comparison" || falseComparison?.kind.kind !== "comparison") {
      return;
    }

    expect(falseComparison.kind.operator).toBe(
      complementProofMirComparisonOperator(trueComparison.kind.operator),
    );
  });

  test("boolean condition branch facts compare against true and false", () => {
    const lowered = lowerProofMirIfStatementForTest({
      source: ["if flag:", "    return 1", "else:", "    return 0"],
      scalarLocals: ["flag"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const trueComparison = lowered.factForKey(lowered.branch!.whenTrue.factKeys[0]!);
    const falseComparison = lowered.factForKey(lowered.branch!.whenFalse.factKeys[0]!);
    expect(trueComparison?.kind.kind).toBe("comparison");
    expect(falseComparison?.kind.kind).toBe("comparison");
    if (trueComparison?.kind.kind !== "comparison" || falseComparison?.kind.kind !== "comparison") {
      return;
    }

    expect(trueComparison.kind.operator).toBe("eq");
    expect(trueComparison.kind.right).toMatchObject({ kind: "bool", value: true });
    expect(falseComparison.kind.operator).toBe("eq");
    expect(falseComparison.kind.right).toMatchObject({ kind: "bool", value: false });
  });

  test("continuing branch targets continuation without join when the other arm exits", () => {
    const lowered = lowerProofMirIfStatementForTest({
      source: ["let x = 0", "if flag:", "    return x", "else:", "    x = 2", "return x"],
      scalarLocals: ["flag", "x"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.join).toBeUndefined();
    expect(lowered.continuation?.blockKey).toBeDefined();
    const elseTerminator = lowered.blockTerminator(lowered.else!.blockKey);
    expect(elseTerminator?.kind).toBe("goto");
    if (elseTerminator?.kind !== "goto") return;
    expect(elseTerminator.target.block).toBe(lowered.continuation!.blockKey);
    expect(lowered.edgesTo(lowered.continuation!.blockKey)).toHaveLength(1);
    expect(lowered.edgesTo(lowered.continuation!.blockKey)[0]?.arguments).toHaveLength(0);
  });

  test("lowerProofMirControlFlowForTest dispatches if statements", () => {
    const lowered = lowerProofMirControlFlowForTest({
      source: ["if flag:", "    return 1", "else:", "    return 0"],
      scalarLocals: ["flag"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;
    expect(lowered.branch?.terminator?.kind).toBe("branch");
  });
});
