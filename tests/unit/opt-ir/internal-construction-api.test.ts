import { describe, expect, test } from "bun:test";

import {
  type InternalConstructOptIrInput,
  type OptimizeOptIrInput,
} from "../../../src/opt-ir/internal-construction-api";
import { optIrProgramId } from "../../../src/opt-ir/ids";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
} from "../../../src/opt-ir/program";
import { defaultOptIrOptimizationPolicy } from "../../../src/opt-ir/policy/optimization-profile";
import type { OptIrTargetSurface } from "../../../src/opt-ir/target-surface";
import { targetId } from "../../../src/semantic/ids";
import {
  authenticatedLayoutFactsForTest,
  constructOptIrInputForTest,
  optIrFactSetForInternalConstructionTest,
  targetSurfaceForInternalConstructionTest,
} from "../../support/opt-ir/internal-construction-fixtures";

describe("internal OptIR construction API", () => {
  test("construct input carries one checked handoff, authenticated layout facts, target, and options", () => {
    const input: InternalConstructOptIrInput = constructOptIrInputForTest({
      options: { deterministicIds: true, recordConstructionTrace: true },
    });

    expect(input.handoff.handoffFingerprint.digestHex).toHaveLength(64);
    expect(input.layoutFacts.fingerprint.authorityKind).toBe("layout");
    expect(input.target.targetId).toBe(targetId("opt-ir-internal-test"));
    expect(input.options?.deterministicIds).toBe(true);
    expect("checkedMir" in input).toBe(false);
    expect("evidence" in input).toBe(false);
  });

  test("construct input rejects separate checked MIR and evidence fields at compile time", () => {
    const base = constructOptIrInputForTest();

    const _checkedMirInput: InternalConstructOptIrInput = {
      handoff: base.handoff,
      layoutFacts: base.layoutFacts,
      target: base.target,
      options: base.options,
      // @ts-expect-error checked MIR must arrive through the unified handoff only.
      checkedMir: base.handoff.checkedMir,
    };

    const _evidenceInput: InternalConstructOptIrInput = {
      handoff: base.handoff,
      layoutFacts: base.layoutFacts,
      target: base.target,
      options: base.options,
      // @ts-expect-error evidence tables must arrive through the unified handoff only.
      evidence: base.handoff.certificates,
    };

    expect(base.handoff.checkedMir.checkedFunctions.size).toBeGreaterThan(0);
  });

  test("optimization input accepts only program, facts, target, and policy", () => {
    const program = optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("opt-ir-internal-test"),
      functions: optIrFunctionTable([]),
      regions: optIrRegionTable([]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: [] },
    });

    const input: OptimizeOptIrInput = {
      program,
      facts: optIrFactSetForInternalConstructionTest(),
      target: targetSurfaceForInternalConstructionTest(),
      policy: defaultOptIrOptimizationPolicy(),
    };

    expect(input.program.programId).toBe(optIrProgramId(1));
    expect(input.facts.entries()).toEqual([]);
    expect(input.policy.pipeline).toEqual([]);

    const _withProvenanceMap: OptimizeOptIrInput = {
      program,
      facts: input.facts,
      target: input.target,
      policy: input.policy,
      // @ts-expect-error optimization provenance must stay on the program, not a side map.
      provenanceMap: new Map(),
    };

    const _withOperationSidecar: OptimizeOptIrInput = {
      program,
      facts: input.facts,
      target: input.target,
      policy: input.policy,
      // @ts-expect-error optimization operations must stay on the constructed program artifact.
      operations: [],
    };
  });

  test("target surface models every construction and optimization target concern", () => {
    const target: OptIrTargetSurface = targetSurfaceForInternalConstructionTest();

    expect(target.dataModel.endian).toBe("little");
    expect(target.dataModel.pointerWidthBits).toBe(64);
    expect(target.abi.defaultCallingConvention).toBe("wrela-internal");
    expect(target.platformEffects.resolve("terminal.write")?.ordering).toBe("ordered");
    expect(target.runtimeEffects.resolve("buffer.copy")?.mutates).toEqual(["heap"]);
    expect(target.vector.enabled).toBe(true);
    expect(target.vector.legalLaneCounts).toContain(16);
    expect(target.atomicAndVolatile.atomicReadModifyWrite).toBe("lowerToRuntimeCall");
    expect(target.intrinsicLowering.resolve("bswap.u32")?.kind).toBe("targetInstruction");
  });

  test("no public construction or optimization entrypoints are exposed by task 11 modules", () => {
    const constructionModule = require("../../../src/opt-ir/internal-construction-api");

    expect("constructOptIr" in constructionModule).toBe(false);
    expect("optimizeOptIr" in constructionModule).toBe(false);
    expect("buildOptimizedOptIr" in constructionModule).toBe(false);
  });

  test("authenticated layout facts pair layout facts with a layout authority fingerprint", () => {
    const layoutFacts = authenticatedLayoutFactsForTest();

    expect(layoutFacts.fingerprint.authorityKind).toBe("layout");
    expect(layoutFacts.fingerprint.digestHex).toHaveLength(64);
    expect(layoutFacts.facts.target.pointerSizeBytes).toBe(8n);
  });
});
