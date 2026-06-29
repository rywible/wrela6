import { describe, expect, test } from "bun:test";

import { CHECKED_PACKET_FACT_KINDS } from "../../../src/proof-check/model/fact-packet";
import { optIrAliasClassId, optIrProgramId } from "../../../src/opt-ir/ids";
import { checkedMirProgramForOptIrTest } from "../../support/opt-ir/checked-mir-fixtures";
import { checkedOptIrHandoffForTest } from "../../support/opt-ir/opt-ir-handoff-fixtures";
import {
  checkedFactPacketEntryForOptIrTest,
  checkedFactPacketWithEveryKindForOptIrTest,
} from "../../support/opt-ir/fact-packet-fixtures";
import {
  effectRequirementForTest,
  targetOptimizationSurfaceForTest,
} from "../../support/opt-ir/target-optimization-fakes";
import { smallOptIrProgramForTest } from "../../support/opt-ir/small-program-fixtures";

describe("OptIR checked MIR and handoff fixtures", () => {
  test("wraps an accepted proof-check closed fixture", () => {
    const checkedMir = checkedMirProgramForOptIrTest({ functionCount: 1 });

    expect(checkedMir.checkedFunctions.size).toBe(1);
    expect(checkedMir.terminalGraph.certificateId).toBeGreaterThanOrEqual(0);
    expect(String(checkedMir.terminalGraph.terminalKey)).toContain("image:");
    expect(checkedMir.facts.origins.length).toBeGreaterThan(0);
  });

  test("builds a checked OptIR handoff with optional path certificates and inline policy evidence", () => {
    const handoff = checkedOptIrHandoffForTest({
      checkedMir: checkedMirProgramForOptIrTest({ functionCount: 1 }),
      includePathCertificates: true,
      includeSemanticInlinePolicies: true,
    });

    expect(handoff.checkedMir.checkedFunctions.size).toBe(1);
    expect(handoff.packetValidation.acceptedFunctionInstanceIds).toHaveLength(1);
    expect(handoff.pathCertificates).toHaveLength(1);
    expect(handoff.semanticInlinePolicies).toHaveLength(1);
    expect(handoff.handoffFingerprint.digestHex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("OptIR checked fact packet fixtures", () => {
  test("can build an entry for every checked packet kind with valid envelope fields", () => {
    const entries = CHECKED_PACKET_FACT_KINDS.map((kind, index) =>
      checkedFactPacketEntryForOptIrTest({ kind, ordinal: index }),
    );

    expect(entries.map((entry) => String(entry.kind))).toEqual([...CHECKED_PACKET_FACT_KINDS]);
    for (const entry of entries) {
      expect(entry.factId).toBeGreaterThanOrEqual(0);
      expect(entry.subject.kind.length).toBeGreaterThan(0);
      expect(entry.scope.kind.length).toBeGreaterThan(0);
      expect(entry.dependencies.length).toBeGreaterThan(0);
      expect(entry.invalidatedBy.length).toBeGreaterThan(0);
      expect(entry.origin.originKey).toContain(String(entry.kind));
    }
  });

  test("can build a checked fact packet containing every checked packet kind", () => {
    const packet = checkedFactPacketWithEveryKindForOptIrTest();

    expect(packet.ownership).toHaveLength(1);
    expect(packet.noalias).toHaveLength(1);
    expect(packet.fieldDisjointness).toHaveLength(1);
    expect(packet.erasures).toHaveLength(1);
    expect(packet.validatedBuffers).toHaveLength(1);
    expect(packet.packetSources).toHaveLength(1);
    expect(packet.privateState).toHaveLength(1);
    expect(packet.platformEffects).toHaveLength(1);
    expect(packet.capabilityFlow).toHaveLength(1);
    expect(packet.terminalClosure).toHaveLength(1);
    expect(packet.exitClosure).toHaveLength(1);
    expect(packet.layoutAbi).toHaveLength(1);
    expect(packet.origins).toHaveLength(1);
  });
});

describe("OptIR target optimization fakes", () => {
  test("exposes deterministic target effect requirements, vector features, policies, and intrinsics", () => {
    const target = targetOptimizationSurfaceForTest({
      vectorEnabled: true,
      platformEffects: [
        {
          targetKey: "get_memory_map",
          requirements: [
            effectRequirementForTest({
              mode: "observe",
              region: optIrAliasClassId(2),
            }),
          ],
        },
      ],
    });

    expect(target.vector.enabled).toBe(true);
    expect(target.vector.legalLaneCounts).toEqual([4, 8, 16]);
    expect(target.platformEffects.resolve("get_memory_map")).toEqual({
      effectKey: "get_memory_map",
      requirements: [{ mode: "observe", region: optIrAliasClassId(2) }],
      ordering: "unordered",
      observes: ["region:2"],
      mutates: [],
    });
    expect(target.runtimeEffects.resolve("runtime.copy")?.requirements).toEqual([
      { mode: "mutate", region: optIrAliasClassId(1) },
    ]);
    expect(target.runtimeEffects.resolve("runtime.bounds_check")?.ordering).toBe("readVersion");
    expect(target.atomicAndVolatile.atomicLoad).toBe("preserve");
    expect(target.atomicAndVolatile.volatileLoad).toBe("preserveOrdering");
    expect(target.intrinsicLowering.resolve("bswap32")).toEqual({
      kind: "targetInstruction",
      instruction: "bswap32",
    });
  });
});

describe("OptIR small program fixtures", () => {
  test("builds a minimal OptIR program through existing program helpers", () => {
    const program = smallOptIrProgramForTest({ programId: optIrProgramId(99) });

    expect(program.programId).toBe(optIrProgramId(99));
    expect(program.functions.entries()).toHaveLength(1);
    expect(program.regions.entries()).toHaveLength(1);
    expect(program.constants.entries()).toHaveLength(1);
  });
});
