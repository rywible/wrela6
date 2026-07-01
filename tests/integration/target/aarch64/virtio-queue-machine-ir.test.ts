import { describe, expect, test } from "bun:test";
import { lowerOptIrToAArch64 } from "../../../../src/target/aarch64";
import {
  dispatchAArch64SemanticPlugins,
  type AArch64SemanticPlugin,
} from "../../../../src/target/aarch64/select/semantic-superselector";
import { virtioRingSelectionPlugin } from "../../../../src/target/aarch64/select/virtio-ring-selection";
import { aarch64VirtioReleaseFactSetForTest } from "../../../support/target/aarch64/facts/opt-ir-facts";
import { optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test } from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 virtio queue machine IR selection", () => {
  test("virtio ring publication is a semantic candidate when memory-order facts are present", () => {
    const result = dispatchAArch64SemanticPlugins({
      plugins: [virtioPlugin],
      pluginInput: {
        operations: [
          {
            operationId: 9,
            kind: "semanticFence",
            semanticContract: { publicationShape: "virtioAvailIndexPublication" },
            profileFeatures: ["BASE_A64"],
            vectorPolicy: "ownsVectorState",
            secretTableIndex: false,
            constantTimeTable: false,
            facts: [
              {
                factId: 10,
                extensionKey: "semantic-operation",
                packetKind: "semantic-operation",
                subjectKey: "operation:9",
                payload: { family: "fence", contractKey: "virtio-ring" },
              },
              {
                factId: 11,
                extensionKey: "memory-order",
                packetKind: "memory-order",
                subjectKey: "operation:9",
                payload: {
                  accessKind: "fence",
                  order: "release",
                  publicationShape: "virtioAvailIndexPublication",
                },
              },
            ],
          },
        ],
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.candidates).toEqual([
      {
        patternId: "semantic.virtio-ring-publish",
        consumedOperations: [9],
        liveOuts: [],
        effects: ["descriptorWrites", "availIndexPublication", "mmioNotify"],
        factsUsed: [10, 11],
      },
    ]);
  });

  test("virtio ring publication falls back when memory-order facts are absent", () => {
    const result = dispatchAArch64SemanticPlugins({
      plugins: [virtioPlugin],
      pluginInput: { hasMemoryOrder: false, operations: [] },
    });

    expect(result).toEqual({ candidates: [], diagnostics: [] });
  });

  test("public lowering preserves virtio release publication ordering", () => {
    const fixture = optimizedOptIrProgramWithVirtioReleaseStoreForAArch64Test();
    const result = lowerOptIrToAArch64({
      program: fixture.program,
      operations: fixture.operations,
      facts: aarch64VirtioReleaseFactSetForTest(),
      target: fakeAArch64TargetSurface(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected virtio lowering success");
    expect(opcodes(result)).toContain("stlr");
    expect(opcodes(result)).toContain("dmb");
    expect(
      result.machineProgram.functions
        .entries()
        .some((func) => func.schedulePlan.some((entry) => entry.startsWith("schedule:block:"))),
    ).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
});

const virtioPlugin: AArch64SemanticPlugin = {
  pluginKey: virtioRingSelectionPlugin.pluginKey,
  candidatesFor(input) {
    return virtioRingSelectionPlugin.candidatesFor(input);
  },
};

function opcodes(result: Extract<ReturnType<typeof lowerOptIrToAArch64>, { readonly kind: "ok" }>) {
  return result.machineProgram.functions
    .entries()
    .flatMap((func) =>
      func.blocks.flatMap((block) => [
        ...block.instructions,
        ...(block.terminator === undefined ? [] : [block.terminator]),
      ]),
    )
    .map((instruction) => String(instruction.opcode));
}
