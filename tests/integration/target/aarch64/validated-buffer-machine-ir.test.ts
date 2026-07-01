import { describe, expect, test } from "bun:test";
import { optIrRegionId } from "../../../../src/opt-ir/ids";
import { lowerOptIrToAArch64 } from "../../../../src/target/aarch64";
import { packetZeroCopyPlugin } from "../../../../src/target/aarch64/select/packet-superpatterns";
import {
  dispatchAArch64SemanticPlugins,
  type AArch64SemanticPlugin,
} from "../../../../src/target/aarch64/select/semantic-superselector";
import { aarch64RegionMemoryTypeFactSetForTest } from "../../../support/target/aarch64/facts/opt-ir-facts";
import {
  optimizedOptIrProgramWithEndianDecodeForAArch64Test,
  optimizedOptIrProgramWithValidatedBufferPairForAArch64Test,
} from "../../../support/target/aarch64/selection/optimized-opt-ir-fixtures";
import { fakeAArch64TargetSurface } from "../../../support/target/aarch64/target-surface/fakes";

describe("AArch64 validated-buffer machine IR selection", () => {
  test("direct validated payload views lower through the packet zero-copy semantic helper", () => {
    const result = dispatchAArch64SemanticPlugins({
      plugins: [packetPlugin],
      pluginInput: {
        operations: [
          {
            operationId: 7,
            kind: "semanticRegionMarker",
            semanticContract: { regionId: 1 },
            profileFeatures: ["BASE_A64"],
            vectorPolicy: "ownsVectorState",
            secretTableIndex: false,
            constantTimeTable: false,
            facts: [
              {
                factId: 1,
                extensionKey: "semantic-operation",
                packetKind: "semantic-operation",
                subjectKey: "operation:7",
                payload: { family: "regionMarker", contractKey: "region:1" },
              },
              {
                factId: 2,
                extensionKey: "footprint",
                packetKind: "footprint",
                subjectKey: "region:1",
                payload: { access: "read" },
              },
            ],
          },
        ],
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.candidates).toMatchObject([
      {
        patternId: "semantic.packet-zero-copy-view",
        consumedOperations: [7],
        liveOuts: ["packet-field"],
        effects: [],
        factsUsed: [1, 2],
      },
    ]);
  });

  test("validated payload helper is not selected without footprint evidence", () => {
    const result = dispatchAArch64SemanticPlugins({
      plugins: [packetPlugin],
      pluginInput: { hasFootprint: false, operations: [] },
    });

    expect(result).toEqual({ candidates: [], diagnostics: [] });
  });

  test("public validated-buffer parser path emits direct pair loads and endian swaps", () => {
    const pairFixture = optimizedOptIrProgramWithValidatedBufferPairForAArch64Test();
    const pair = lowerOptIrToAArch64({
      program: pairFixture.program,
      operations: pairFixture.operations,
      facts: aarch64RegionMemoryTypeFactSetForTest({
        regionId: optIrRegionId(4),
        memoryType: "validatedPayload",
        backingRegion: optIrRegionId(1),
        certifiedOffset: 16n,
      }),
      target: fakeAArch64TargetSurface(),
    });
    const endianFixture = optimizedOptIrProgramWithEndianDecodeForAArch64Test(16);
    const endian = lowerOptIrToAArch64({
      program: endianFixture.program,
      operations: endianFixture.operations,
      facts: aarch64RegionMemoryTypeFactSetForTest({
        regionId: optIrRegionId(1),
        memoryType: "normalCacheable",
      }),
      target: fakeAArch64TargetSurface(),
    });

    expect(pair.kind).toBe("ok");
    expect(endian.kind).toBe("ok");
    if (pair.kind !== "ok" || endian.kind !== "ok")
      throw new Error("expected public lowering success");
    expect(opcodes(pair)).toContain("ldp-signed-offset");
    expect(opcodes(pair)).not.toContain("blr");
    expect(opcodes(pair)).not.toContain("b-cond");
    expect(opcodes(pair)).not.toContain("trap");
    expect(opcodes(endian)).toContain("rev16");
  });
});

const packetPlugin: AArch64SemanticPlugin = {
  pluginKey: packetZeroCopyPlugin.pluginKey,
  candidatesFor(input) {
    return packetZeroCopyPlugin.candidatesFor(input);
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
