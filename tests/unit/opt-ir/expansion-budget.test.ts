import { describe, expect, test } from "bun:test";

import { optIrFunctionId } from "../../../src/opt-ir/ids";
import {
  createOptIrExpansionBudgetLedger,
  optIrCodeSizeBudget,
  optIrCodeSizeDelta,
  optIrExpansionFuel,
  reserveInlineExpansionBudget,
  type OptIrBudgetReservation,
} from "../../../src/opt-ir/policy/expansion-budget";
import {
  appendOptIrDecisionLogEntry,
  optIrDecisionLogEntry,
} from "../../../src/opt-ir/policy/decision-log";
import { policyFeatureVectorForTest } from "../../../src/opt-ir/policy/local-policy";
import { reserveSpecializationExpansionBudget } from "../../../src/opt-ir/policy/specialization-policy";

describe("OptIR scope-expansion budget ledger", () => {
  test("reserves and commits one candidate against function, SCC, image, and fuel caps", () => {
    const ledger = createOptIrExpansionBudgetLedger({
      perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", 20),
      perSccGrowth: optIrCodeSizeBudget("normalizedOperation", 30),
      perImageGrowth: optIrCodeSizeBudget("normalizedOperation", 100),
      fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", 2),
      sccMembership: [{ sccKey: "scc:1-2", functionIds: [optIrFunctionId(1), optIrFunctionId(2)] }],
    });

    const reservation = ledger.reserve(
      { kind: "function", functionId: optIrFunctionId(2) },
      optIrCodeSizeDelta("normalizedOperation", 12),
    );

    expect(reservation).not.toBe("denied");
    ledger.commit(reservation as OptIrBudgetReservation);
    expect(ledger.remaining({ kind: "function", functionId: optIrFunctionId(2) })).toEqual(
      optIrCodeSizeBudget("normalizedOperation", 8),
    );
    expect(ledger.remaining({ kind: "scc", sccKey: "scc:1-2" })).toEqual(
      optIrCodeSizeBudget("normalizedOperation", 18),
    );
    expect(ledger.remaining({ kind: "image" })).toEqual(
      optIrCodeSizeBudget("normalizedOperation", 88),
    );
    expect(ledger.remainingFuel().amount).toBe(1);
  });

  test("releases abandoned reservations without consuming shared budget or fixpoint fuel", () => {
    const ledger = createOptIrExpansionBudgetLedger({
      perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", 10),
      perSccGrowth: optIrCodeSizeBudget("normalizedOperation", 10),
      perImageGrowth: optIrCodeSizeBudget("normalizedOperation", 10),
      fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", 1),
    });

    const reservation = ledger.reserve(
      { kind: "function", functionId: optIrFunctionId(4) },
      optIrCodeSizeDelta("normalizedOperation", 7),
    );

    expect(reservation).not.toBe("denied");
    ledger.release(reservation as OptIrBudgetReservation);
    expect(ledger.remaining({ kind: "function", functionId: optIrFunctionId(4) }).amount).toBe(10);
    expect(ledger.remaining({ kind: "image" }).amount).toBe(10);
    expect(ledger.remainingFuel().amount).toBe(1);
  });

  test("denies candidates that exceed per-function, per-SCC, per-image, unit, or fuel limits", () => {
    const ledger = createOptIrExpansionBudgetLedger({
      perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", 10),
      perSccGrowth: optIrCodeSizeBudget("normalizedOperation", 14),
      perImageGrowth: optIrCodeSizeBudget("normalizedOperation", 18),
      fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", 1),
      sccMembership: [
        { sccKey: "recursive:5", functionIds: [optIrFunctionId(5)], allowExpansion: false },
      ],
    });

    expect(
      ledger.reserve(
        { kind: "function", functionId: optIrFunctionId(1) },
        optIrCodeSizeDelta("normalizedOperation", 11),
      ),
    ).toBe("denied");
    expect(
      ledger.reserve(
        { kind: "function", functionId: optIrFunctionId(2), sccKey: "scc:2-3" },
        optIrCodeSizeDelta("normalizedOperation", 15),
      ),
    ).toBe("denied");
    expect(
      ledger.reserve(
        { kind: "function", functionId: optIrFunctionId(5), sccKey: "recursive:5" },
        optIrCodeSizeDelta("normalizedOperation", 1),
      ),
    ).toBe("denied");
    expect(
      ledger.reserve(
        { kind: "function", functionId: optIrFunctionId(3) },
        optIrCodeSizeDelta("eNode", 1),
      ),
    ).toBe("denied");

    const admitted = ledger.reserve(
      { kind: "function", functionId: optIrFunctionId(6) },
      optIrCodeSizeDelta("normalizedOperation", 9),
    );
    expect(admitted).not.toBe("denied");
    ledger.commit(admitted as OptIrBudgetReservation);
    expect(
      ledger.reserve(
        { kind: "function", functionId: optIrFunctionId(7) },
        optIrCodeSizeDelta("normalizedOperation", 1),
      ),
    ).toBe("denied");
  });

  test("inline and specialization reservations debit the same ledger", () => {
    const ledger = createOptIrExpansionBudgetLedger({
      perFunctionGrowth: optIrCodeSizeBudget("normalizedOperation", 20),
      perSccGrowth: optIrCodeSizeBudget("normalizedOperation", 20),
      perImageGrowth: optIrCodeSizeBudget("normalizedOperation", 20),
      fixpointFuel: optIrExpansionFuel("scopeExpansionIteration", 3),
    });

    const inlineReservation = reserveInlineExpansionBudget(ledger, {
      callerFunctionId: optIrFunctionId(8),
      estimatedGrowth: optIrCodeSizeDelta("normalizedOperation", 12),
    });
    expect(inlineReservation.kind).toBe("reserved");
    if (inlineReservation.kind === "reserved") {
      ledger.commit(inlineReservation.reservation);
    }

    const specializationReservation = reserveSpecializationExpansionBudget(ledger, {
      sourceFunctionId: optIrFunctionId(8),
      variantKey: "fn8/static-arg=3",
      estimatedGrowth: optIrCodeSizeDelta("normalizedOperation", 9),
    });

    expect(specializationReservation.kind).toBe("denied");
    expect(ledger.remaining({ kind: "image" }).amount).toBe(8);
  });
});

describe("OptIR local policy features and decision logs", () => {
  test("accepts deterministic static policy features and rejects wall-clock measurements", () => {
    expect(
      policyFeatureVectorForTest({
        operationCount: 12,
        estimatedByteSize: 48,
        loopDepth: 2,
        knownColdStructuralContext: false,
        effectBoundaryKind: "pure",
        availableTargetFeatures: ["simd128", "unaligned-load"],
      }),
    ).toEqual({
      operationCount: 12,
      estimatedByteSize: 48,
      loopDepth: 2,
      knownColdStructuralContext: false,
      effectBoundaryKind: "pure",
      availableTargetFeatures: ["simd128", "unaligned-load"],
    });

    expect(() => policyFeatureVectorForTest({ wallClockMs: 4 })).toThrow(
      "wall-clock time is not an OptIR policy feature",
    );
    expect(() => policyFeatureVectorForTest({ sourceName: "parser.wrela" })).toThrow(
      "sourceName is not an OptIR policy feature",
    );
    expect(() => policyFeatureVectorForTest({ speculativeHostScore: 0.8 })).toThrow(
      "speculativeHostScore is not a recognized OptIR policy feature",
    );
    expect(() =>
      policyFeatureVectorForTest({
        factAnswers: [{ factKey: "bounds:v3", answer: "known", uncertainty: "maybe" }],
      }),
    ).toThrow("factAnswers must be a deterministic fact-answer list");
  });

  test("records deterministic decision log entries with facts, uncertainty, and stable reasons", () => {
    const entry = optIrDecisionLogEntry({
      candidateKey: "inline:caller=8:callee=9:site=2",
      policyResult: "accepted",
      factsUsed: [
        { factKey: "bounds:v3", answer: "known", uncertainty: "none" },
        { factKey: "alias:v4", answer: "unknown", uncertainty: "conservative" },
      ],
      uncertainty: "conservative",
      stableReason: "accepted:budget-reserved:benefit-above-threshold",
    });

    const log = appendOptIrDecisionLogEntry(undefined, entry);

    expect(log.entries()).toEqual([entry]);
    expect(Object.isFrozen(entry.factsUsed)).toBe(true);
    expect(() =>
      optIrDecisionLogEntry({
        candidateKey: "inline:caller=8:callee=9:site=3",
        policyResult: "accepted",
        factsUsed: [],
        uncertainty: "none",
        stableReason: "accepted after trying fast host",
      }),
    ).toThrow("stable reason must be a deterministic policy reason key");
  });
});
