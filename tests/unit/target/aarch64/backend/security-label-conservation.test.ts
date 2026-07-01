import { describe, expect, test } from "bun:test";

import { verifyAArch64SecurityLabelConservation } from "../../../../../src/target/aarch64/backend/facts/security-label-conservation";

describe("AArch64 security label conservation", () => {
  test("permits no-spill values assigned only to registers", () => {
    const result = verifyAArch64SecurityLabelConservation({
      labels: [{ kind: "no-spill", subjectKey: "vreg:2" }],
      placements: [{ subjectKey: "vreg:2", locationKind: "register", locationKey: "x19" }],
    });

    expect(result).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("rejects no-spill placement into stack memory", () => {
    const result = verifyAArch64SecurityLabelConservation({
      labels: [{ kind: "no-spill", subjectKey: "vreg:4" }],
      placements: [{ subjectKey: "vreg:4", locationKind: "stack-slot", locationKey: "slot:0" }],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected no-spill diagnostic");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "security:no-spill-memory-placement:vreg:4:stack-slot:slot:0",
    ]);
  });

  test("wipe-on-spill obligation must be present before tail call exit", () => {
    const result = verifyAArch64SecurityLabelConservation({
      labels: [{ kind: "wipe-on-spill", subjectKey: "vreg:4", slotKey: "slot:1" }],
      exits: [{ exitKey: "tail:main:exit", exitKind: "tail-call" }],
      wipes: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing wipe");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "security:wipe-on-spill-missing-before-exit:vreg:4:slot:1:tail:main:exit",
    ]);
  });

  test("wipe-on-spill obligation must be present before trap exit", () => {
    const result = verifyAArch64SecurityLabelConservation({
      labels: [{ kind: "wipe-on-spill", subjectKey: "vreg:4", slotKey: "slot:1" }],
      exits: [{ exitKey: "trap:main:exit", exitKind: "trap" }],
      wipes: [],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected missing trap wipe");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "security:wipe-on-spill-missing-before-exit:vreg:4:slot:1:trap:main:exit",
    ]);
  });

  test("exit-scoped wipe-on-spill obligations do not cross-check unrelated exits", () => {
    const result = verifyAArch64SecurityLabelConservation({
      labels: [
        {
          kind: "wipe-on-spill",
          subjectKey: "vreg:4",
          slotKey: "slot:1",
          exitScopeKey: "return:callee",
        },
      ],
      exits: [
        { exitKey: "return:caller", exitKind: "return" },
        { exitKey: "return:callee", exitKind: "return" },
      ],
      wipes: [
        {
          subjectKey: "vreg:4",
          slotKey: "slot:1",
          beforeExitKey: "return:callee",
        },
      ],
    });

    expect(result).toEqual({ kind: "ok", diagnostics: [] });
  });

  test("rejects secret branch and table access", () => {
    const result = verifyAArch64SecurityLabelConservation({
      labels: [{ kind: "secret", subjectKey: "vreg:7" }],
      branches: [{ branchKey: "branch:secret", conditionSubjectKey: "vreg:7" }],
      tableAccesses: [{ tableKey: "tbl:secret", indexSubjectKey: "vreg:7" }],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected secret diagnostics");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "security:secret-branch-condition:branch:secret:vreg:7",
      "security:secret-table-index:tbl:secret:vreg:7",
    ]);
  });

  test("approved constant-time helper permits secret operand call", () => {
    const result = verifyAArch64SecurityLabelConservation({
      labels: [{ kind: "secret", subjectKey: "vreg:2" }],
      helperCalls: [{ helperKey: "ct.memcmp.fixed", argumentSubjectKeys: ["vreg:2"] }],
      constantTimeHelpers: ["ct.memcmp.fixed"],
    });

    expect(result).toEqual({ kind: "ok", diagnostics: [] });
  });
});
