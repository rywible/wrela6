import { describe, expect, test } from "bun:test";
import { lowerProofMirLoopForTest } from "../../support/proof-mir/lower-harness/loop-lowerer-harness";

describe("ProofMirLoopLowerer", () => {
  test("while loop predeclares loop-carried scalar parameter", () => {
    const lowered = lowerProofMirLoopForTest({
      source: ["let i = 0", "while i < 3:", "    i = i + 1", "return i"],
      loopCarriedLocals: ["i"],
      scalarLocals: ["i"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.parameters.map((parameter) => parameter.parameterKind.kind)).toEqual([
      "copyScalar",
    ]);
    expect(lowered.backEdge?.arguments).toHaveLength(1);
  });

  test("while loop lowers header condition branch body back-edge and exit", () => {
    const lowered = lowerProofMirLoopForTest({
      source: ["let i = 0", "while i < 3:", "    i = i + 1", "return i"],
      loopCarriedLocals: ["i"],
      scalarLocals: ["i"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.kind).toBe("loopHeader");
    expect(lowered.body?.blockKey).toBeDefined();
    expect(lowered.exit?.blockKey).toBeDefined();
    expect(lowered.backEdge!.kind).toBe("normal");
    expect(lowered.blockTerminator(lowered.header.blockKey)?.kind).toBe("branch");
    expect(
      lowered.edgesTo(lowered.exit!.blockKey).some((edge) => edge.kind === "branchFalse"),
    ).toBe(true);
  });

  test("infinite loop lowers header body back-edge and break exit", () => {
    const lowered = lowerProofMirLoopForTest({
      source: [
        "let i = 0",
        "loop:",
        "    if i == 2:",
        "        break",
        "    i = i + 1",
        "return i",
      ],
      loopCarriedLocals: ["i"],
      scalarLocals: ["i", "flag"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.kind).toBe("loopHeader");
    expect(lowered.body?.blockKey).toBeDefined();
    expect(lowered.backEdge?.arguments).toHaveLength(1);
    const breakEdges = lowered
      .edgesTo(lowered.exit!.blockKey)
      .filter((edge) => edge.kind === "scopeBreak");
    expect(breakEdges.length).toBeGreaterThan(0);
    expect(breakEdges[0]?.crossedScopes.length).toBeGreaterThan(0);
  });

  test("break emits scopeBreak edge to loop exit with crossed scopes", () => {
    const lowered = lowerProofMirLoopForTest({
      source: ["loop:", "    break", "return 0"],
      scalarLocals: [],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const breakEdge = lowered
      .edgesTo(lowered.exit!.blockKey)
      .find((edge) => edge.kind === "scopeBreak");
    expect(breakEdge).toBeDefined();
    expect(breakEdge!.crossedScopes.length).toBeGreaterThan(0);
  });

  test("same-role break edges in one function lower with deterministic distinct keys", () => {
    const lowered = lowerProofMirLoopForTest({
      source: [
        "let flag = 0",
        "loop:",
        "    if flag == 0:",
        "        break",
        "    else:",
        "        break",
        "return flag",
      ],
      scalarLocals: ["flag"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const breakEdges = lowered
      .edgesTo(lowered.exit!.blockKey)
      .filter((edge) => edge.kind === "scopeBreak");
    const breakEdgeKeys = breakEdges.map((edge) => String(edge.edgeKey));
    const sortedBreakEdgeKeys = [...breakEdgeKeys].sort();

    expect(breakEdges).toHaveLength(2);
    expect(new Set(breakEdgeKeys).size).toBe(2);
    expect(breakEdgeKeys).toEqual(sortedBreakEdgeKeys);
  });

  test("continue emits scopeContinue edge with loop-carried arguments", () => {
    const lowered = lowerProofMirLoopForTest({
      source: ["let i = 0", "while i < 3:", "    i = i + 1", "    continue", "return i"],
      loopCarriedLocals: ["i"],
      scalarLocals: ["i"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    const continueEdge = lowered
      .edgesTo(lowered.header.blockKey)
      .find((edge) => edge.kind === "scopeContinue");
    expect(continueEdge).toBeDefined();
    expect(continueEdge!.arguments).toHaveLength(1);
    expect(continueEdge!.crossedScopes).toBeDefined();
  });

  test("predeclared loop-header parameters win over on-demand incomplete parameters", () => {
    const lowered = lowerProofMirLoopForTest({
      source: ["let i = 0", "while i < 3:", "    i = i + 1", "return i"],
      loopCarriedLocals: ["i"],
      scalarLocals: ["i"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.parameters).toHaveLength(1);
    expect(lowered.header.parameters[0]?.predeclared).toBe(true);
  });

  test("loop resource state is named in boundary set not scalar parameters", () => {
    const lowered = lowerProofMirLoopForTest({
      source: ["let packet = 0", "while 0 < 1:", "return packet"],
      loopCarriedLocals: [],
      scalarLocals: [],
      placeBackedLocals: ["packet"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.parameters).toHaveLength(0);
    expect(lowered.header.boundaryResources?.places.length).toBeGreaterThan(0);
    const placeKeys = lowered.header.boundaryResources?.places.map(String) ?? [];
    expect(placeKeys.some((placeKey) => placeKey.includes("root:local"))).toBe(true);
    expect(placeKeys.some((placeKey) => placeKey.includes("local:packet"))).toBe(false);
  });
});
