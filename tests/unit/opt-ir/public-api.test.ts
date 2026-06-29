import { describe, expect, test } from "bun:test";

import { constructOptIr } from "../../../src/opt-ir/public-api";
import {
  stableOptIrConstructionKey,
  validConstructOptIrInputForTest,
} from "../../support/opt-ir/construction-fixtures";

describe("OptIR public construction API", () => {
  test("constructOptIr returns a program, imported facts, provenance snapshot, and diagnostics", () => {
    const result = constructOptIr(validConstructOptIrInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected construction to succeed.");
    }

    expect(result.program.functions.entries()).toHaveLength(1);
    expect(result.facts.records).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "construction-cleanup",
    ]);
    expect(result.provenance.originIds).toEqual(result.program.provenance.originIds);
    expect(result.provenance.fingerprint.digestHex).toHaveLength(64);
    expect(result.provenance.fingerprint).toEqual(result.program.provenance.fingerprint);
  });

  test("construction output is stable across repeated public API calls", () => {
    const first = constructOptIr(validConstructOptIrInputForTest());
    const second = constructOptIr(validConstructOptIrInputForTest());

    expect(stableOptIrConstructionKey(first)).toBe(stableOptIrConstructionKey(second));
  });
});
