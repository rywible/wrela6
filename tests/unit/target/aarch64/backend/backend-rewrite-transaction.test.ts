import { describe, expect, test } from "bun:test";

import { type FactTransferBehavior } from "../../../../../src/shared/facts";
import {
  commitAArch64InstructionRewrite,
  type AArch64RewriteableInstruction,
} from "../../../../../src/target/aarch64/backend/api/backend-rewrite-application";
import {
  beginAArch64BackendRewriteTransaction,
  type AArch64CommittedFactTransfer,
  type AArch64BackendInstructionSnapshot,
  type AArch64BackendRewriteSnapshot,
  type AArch64RewriteProvenanceRecord,
  moveFactTransferPlan,
  rejectFactTransferPlan,
} from "../../../../../src/target/aarch64/backend/facts/backend-rewrite-transaction";

describe("AArch64 backend rewrite transaction", () => {
  test("rewrite transfer behavior is assignable to the shared fact transfer contract", () => {
    const plan = moveFactTransferPlan({
      sourceKey: "instruction:i0",
      destinationKey: "instruction:i1",
    });
    if (plan.behavior === "reject") throw new Error("expected committed transfer behavior");
    const planBehavior: FactTransferBehavior = plan.behavior;
    const committed: AArch64CommittedFactTransfer = {
      behavior: planBehavior,
      sourceKey: "instruction:i0",
      destinationKeys: ["instruction:i1"],
      extensionKey: "all",
    };
    const committedBehavior: FactTransferBehavior = committed.behavior;

    expect(committedBehavior).toBe("move");
  });

  test("replace instruction commits atomically with deterministic verifier plan", () => {
    const snapshot = backendSnapshotForTest({
      instructions: [backendInstructionForTest({ stableKey: "i0", opcode: "movz" })],
    });

    const result = beginAArch64BackendRewriteTransaction({
      kind: "instruction-replacement",
      snapshot,
    })
      .replaceInstruction({
        oldInstructionKey: "i0",
        replacements: [backendInstructionForTest({ stableKey: "i1", opcode: "movk" })],
        transfer: moveFactTransferPlan({
          sourceKey: "instruction:i0",
          destinationKey: "instruction:i1",
        }),
      })
      .commit();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected rewrite commit");
    expect(result.snapshot.instructions.map((instruction) => instruction.stableKey)).toEqual([
      "i1",
    ]);
    expect(result.verifierPlan.map((run) => run.verifierKey)).toEqual([
      "fact-transfer",
      "provenance",
      "security",
    ]);
  });

  test("commit rolls back when transfer rejects no-spill spill insertion", () => {
    const snapshot = backendSnapshotForTest({
      instructions: [backendInstructionForTest({ stableKey: "i0", opcode: "movz" })],
    });

    const result = beginAArch64BackendRewriteTransaction({
      kind: "spill-insertion",
      snapshot,
    })
      .replaceInstruction({
        oldInstructionKey: "i0",
        replacements: [backendInstructionForTest({ stableKey: "spill0", opcode: "str" })],
        transfer: rejectFactTransferPlan({
          extensionKey: "security.no-spill",
          subjectKey: "vreg:2",
          reason: "spill-insertion",
        }),
      })
      .commit();

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected rejected rewrite");
    expect(result.snapshot).toBe(snapshot);
    expect(snapshot.instructions.map((instruction) => instruction.stableKey)).toEqual(["i0"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "rewrite-transfer:rejected:security.no-spill:spill-insertion:vreg:2",
    ]);
  });

  test("default rewrite transfer resolves affected fact families instead of preserving all", () => {
    const result = commitAArch64InstructionRewrite({
      kind: "instruction-replacement",
      source: rewriteableInstructionForTest({ stableKey: "i0", opcode: "movz" }),
      replacements: [rewriteableInstructionForTest({ stableKey: "i1", opcode: "movk" })],
      affectedFacts: [
        {
          extensionKey: "ownership-lifetime",
          subjectKey: "vreg:1",
          payload: { kind: "lifetime-bound" },
        },
        {
          extensionKey: "disjoint-field-and-private-generation",
          subjectKey: "vreg:2",
          payload: { kind: "private-generation" },
        },
        {
          extensionKey: "rematerialization-authority",
          subjectKey: "vreg:3",
          payload: { kind: "constant-remat", value: 7n },
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected family transfer plan");
    expect(
      result.value.factTransfers.map((transfer) => ({
        behavior: transfer.behavior,
        extensionKey: transfer.extensionKey,
      })),
    ).toEqual([
      { behavior: "weaken", extensionKey: "ownership-lifetime" },
      { behavior: "invalidate", extensionKey: "disjoint-field-and-private-generation" },
      { behavior: "rederive-from-catalog", extensionKey: "rematerialization-authority" },
    ]);
    expect(result.value.factTransfers.some((transfer) => transfer.extensionKey === "all")).toBe(
      false,
    );
  });

  test("rewrite rejects affected fact families with reject transfer behavior", () => {
    const result = commitAArch64InstructionRewrite({
      kind: "spill-insertion",
      source: rewriteableInstructionForTest({ stableKey: "i0", opcode: "str" }),
      replacements: [rewriteableInstructionForTest({ stableKey: "spill0", opcode: "str" })],
      affectedFacts: [
        {
          extensionKey: "security.no-spill",
          subjectKey: "vreg:2",
          payload: { label: "key" },
        },
      ],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected rejected family transfer");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "rewrite-transfer:rejected:security.no-spill:spill-insertion:vreg:2",
    ]);
  });
});

function backendInstructionForTest(input: {
  readonly stableKey: string;
  readonly opcode: string;
  readonly operands?: readonly string[];
  readonly provenance?: readonly string[];
}): AArch64BackendInstructionSnapshot {
  return Object.freeze({
    stableKey: input.stableKey,
    opcode: input.opcode,
    operands: Object.freeze([...(input.operands ?? [])]),
    provenance: Object.freeze([...(input.provenance ?? [])]),
  });
}

function backendSnapshotForTest(
  input: {
    readonly instructions?: readonly AArch64BackendInstructionSnapshot[];
    readonly factTransfers?: readonly AArch64CommittedFactTransfer[];
    readonly provenance?: readonly AArch64RewriteProvenanceRecord[];
  } = {},
): AArch64BackendRewriteSnapshot {
  return Object.freeze({
    instructions: Object.freeze([...(input.instructions ?? [])]),
    factTransfers: Object.freeze([...(input.factTransfers ?? [])]),
    provenance: Object.freeze([...(input.provenance ?? [])]),
  });
}

function rewriteableInstructionForTest(input: {
  readonly stableKey: string;
  readonly opcode: string;
}): AArch64RewriteableInstruction {
  return Object.freeze({
    stableKey: input.stableKey,
    opcode: input.opcode,
    operands: Object.freeze([]),
  });
}
