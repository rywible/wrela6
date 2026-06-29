import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";

import { policyFeatureVectorForTest } from "../../../src/opt-ir/policy/local-policy";
import {
  buildOptimizedOptIrForTest,
  inputFromProgramForTest,
  optIrProgramStableKeyForTest,
  optIrResultStableKeyForTest,
  shuffleTablesForTest,
  smallCheckedMirProgramArbitrary,
} from "../../support/opt-ir/property-generators";
import { validConstructOptIrInputForTest } from "../../support/opt-ir/construction-fixtures";

describe("OptIR deterministic stable keys", () => {
  test("program stable keys ignore checked MIR table insertion order", () => {
    fastCheck.assert(
      fastCheck.property(smallCheckedMirProgramArbitrary(), (program) => {
        expect(optIrProgramStableKeyForTest(program)).toBe(
          optIrProgramStableKeyForTest(shuffleTablesForTest(program)),
        );
      }),
      { numRuns: 8 },
    );
  });

  test("result stable keys include program, facts, provenance, decision logs, and diagnostics", () => {
    const base = buildOptimizedOptIrForTest(
      inputFromProgramForTest(validConstructOptIrInputForTest().handoff.checkedMir),
    );
    expect(base.kind).toBe("ok");
    if (base.kind !== "ok") {
      throw new Error("Expected optimized fixture to succeed.");
    }

    const baseKey = optIrResultStableKeyForTest(base);

    expect(
      optIrResultStableKeyForTest({
        ...base,
        program: { ...base.program, programId: 999 } as never,
      }),
    ).not.toBe(baseKey);
    expect(
      optIrResultStableKeyForTest({
        ...base,
        facts: { ...base.facts, records: [{ factId: 999 }] },
      } as never),
    ).not.toBe(baseKey);
    expect(
      optIrResultStableKeyForTest({
        ...base,
        provenance: {
          ...base.provenance,
          fingerprint: { ...base.provenance.fingerprint, digestHex: "b".repeat(64) },
        },
      } as never),
    ).not.toBe(baseKey);
    expect(
      optIrResultStableKeyForTest({
        ...base,
        decisionLog: {
          entries: () => [
            ...base.decisionLog.entries(),
            {
              candidateKey: "pipeline:99:test",
              policyResult: "accepted",
              factsUsed: [],
              uncertainty: "none",
              stableReason: "test:changed",
            },
          ],
        },
      } as never),
    ).not.toBe(baseKey);
    expect(
      optIrResultStableKeyForTest({
        ...base,
        diagnostics: [...base.diagnostics, { stableDetail: "other" }],
      } as never),
    ).not.toBe(baseKey);
  });
});

describe("OptIR production policy authority", () => {
  test.each([
    ["scorecard baselines", { scorecardBaseline: "baseline-a" }],
    ["benchmark data", { benchmarkLabel: "microbench-a" }],
    ["host runtime timing", { wallClockMs: 12 }],
    ["source names", { sourceName: "packet.wrela" }],
    ["previous successful compilation choices", { previousSuccessfulCompilationChoice: "inline" }],
  ])("rejects %s as optimization authority", (_label, featureInput) => {
    expect(() => policyFeatureVectorForTest(featureInput)).toThrow(
      /not an OptIR policy feature|wall-clock time is not an OptIR policy feature/,
    );
  });
});

describe("OptIR optimized output determinism", () => {
  test("equivalent checked MIR inputs produce the same optimized OptIR key", () => {
    fastCheck.assert(
      fastCheck.property(smallCheckedMirProgramArbitrary(), (program) => {
        const first = inputFromProgramForTest(program);
        const second = inputFromProgramForTest(shuffleTablesForTest(program));

        expect(optIrResultStableKeyForTest(buildOptimizedOptIrForTest(first))).toBe(
          optIrResultStableKeyForTest(buildOptimizedOptIrForTest(second)),
        );
      }),
      { numRuns: 8 },
    );
  });
});
