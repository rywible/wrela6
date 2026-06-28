import { describe, expect, test } from "bun:test";
import {
  factReferencesPlaceKey,
  textReferencesPlaceKey,
} from "../../../src/proof-check/domains/place-key-references";
import type { CheckedActiveFact } from "../../../src/proof-check/kernel/state";

function factForTest(factKey: string, termKey = factKey): CheckedActiveFact {
  return { factKey, termKey };
}

describe("place key references", () => {
  test("proofMirPlace keys do not prefix-match longer place ids", () => {
    expect(textReferencesPlaceKey("proofMirPlace:10:field", "proofMirPlace:1")).toBe(false);
    expect(textReferencesPlaceKey("proofMirPlace:1:field", "proofMirPlace:1")).toBe(true);
    expect(factReferencesPlaceKey(factForTest("proofMirPlace:10:field"), "proofMirPlace:1")).toBe(
      false,
    );
  });

  test("parameter keys match structured term segments", () => {
    expect(textReferencesPlaceKey("comparison:parameter:0@eq", "parameter:0")).toBe(true);
    expect(textReferencesPlaceKey("comparison:parameter:10@eq", "parameter:1")).toBe(false);
  });
});
