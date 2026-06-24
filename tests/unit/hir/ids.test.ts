import { describe, expect, test } from "bun:test";
import {
  attemptId,
  brandId,
  callSiteRequirementId,
  factOriginId,
  hirExpressionId,
  hirImageOriginId,
  hirLocalId,
  hirOriginId,
  hirPlatformContractEdgeId,
  hirProofExpressionId,
  hirRequirementId,
  hirStatementId,
  hirTerminalCallId,
  obligationId,
  ownedId,
  ownedIdKey,
  ownedObligationId,
  privateStateTransitionId,
  resourcePlaceId,
  sessionId,
  validationId,
} from "../../../src/hir/ids";
import { functionId, imageId, typeId } from "../../../src/semantic/ids";
import { hirTable } from "../../../src/hir/hir-table";
import { compareCodeUnitStrings } from "../../../src/hir/deterministic-sort";

describe("HIR IDs", () => {
  test("numeric constructors preserve dense values", () => {
    expect(hirOriginId(0)).toBe(hirOriginId(0));
    expect(hirExpressionId(1)).toBe(hirExpressionId(1));
    expect(hirProofExpressionId(2)).toBe(hirProofExpressionId(2));
    expect(hirStatementId(3)).toBe(hirStatementId(3));
    expect(hirLocalId(4)).toBe(hirLocalId(4));
    expect(hirTerminalCallId(5)).toBe(hirTerminalCallId(5));
    expect(obligationId(7)).toBe(obligationId(7));
    expect(sessionId(8)).toBe(sessionId(8));
    expect(brandId(10)).toBe(brandId(10));
    expect(resourcePlaceId(11)).toBe(resourcePlaceId(11));
    expect(hirRequirementId(12)).toBe(hirRequirementId(12));
    expect(callSiteRequirementId(13)).toBe(callSiteRequirementId(13));
    expect(validationId(14)).toBe(validationId(14));
    expect(attemptId(15)).toBe(attemptId(15));
    expect(privateStateTransitionId(16)).toBe(privateStateTransitionId(16));
    expect(factOriginId(17)).toBe(factOriginId(17));
    expect(hirPlatformContractEdgeId(18)).toBe(hirPlatformContractEdgeId(18));
    expect(hirImageOriginId(19)).toBe(hirImageOriginId(19));
  });

  test("numeric constructors reject negative or non-integer values", () => {
    const constructors = [
      hirOriginId,
      hirExpressionId,
      hirProofExpressionId,
      hirStatementId,
      hirLocalId,
      hirTerminalCallId,
      obligationId,
      sessionId,
      brandId,
      resourcePlaceId,
      hirRequirementId,
      callSiteRequirementId,
      validationId,
      attemptId,
      privateStateTransitionId,
      factOriginId,
      hirPlatformContractEdgeId,
      hirImageOriginId,
    ];

    for (const build of constructors) {
      expect(() => build(-1)).toThrow("non-negative integer");
      expect(() => build(1.5)).toThrow("non-negative integer");
      expect(() => build(NaN)).toThrow("non-negative integer");
      expect(() => build(Infinity)).toThrow("non-negative integer");
    }
  });

  test("owned proof id keys include owner and id family", () => {
    const id = ownedId(
      { kind: "function", functionId: functionId(12) },
      obligationId(3),
      "obligation",
    );

    expect(ownedIdKey(id, "obligation")).toBe("function:12/obligation:3");
  });

  test("ownedIdKey renders each owner kind", () => {
    expect(
      ownedIdKey(
        ownedId({ kind: "image", imageId: imageId(4) }, sessionId(2), "session"),
        "session",
      ),
    ).toBe("image:4/session:2");
    expect(
      ownedIdKey(ownedId({ kind: "type", typeId: typeId(7) }, brandId(9), "brand"), "brand"),
    ).toBe("type:7/brand:9");
  });

  test("ownedObligationId builds a function-owned obligation id", () => {
    const id = ownedObligationId(functionId(3), 5);
    expect(ownedIdKey(id, "obligation")).toBe("function:3/obligation:5");
  });
});

describe("HIR deterministic sort re-export", () => {
  test("compareCodeUnitStrings orders deterministically", () => {
    expect(compareCodeUnitStrings("a", "b")).toBe(-1);
    expect(compareCodeUnitStrings("b", "a")).toBe(1);
    expect(compareCodeUnitStrings("a", "a")).toBe(0);
  });
});

describe("hirTable", () => {
  interface TestEntry {
    readonly key: string;
    readonly text: string;
  }

  test("hir tables return immutable deterministic entries", () => {
    const entryA: TestEntry = { key: "a", text: "alpha" };
    const entryB: TestEntry = { key: "b", text: "beta" };
    const table = hirTable<string, TestEntry>({
      entries: [entryB, entryA],
      keyOf: (entry) => entry.key,
      lookupKeyOf: (key) => key,
    });

    expect(table.entries().map((entry) => entry.key)).toEqual(["a", "b"]);
    expect(table.entries()).not.toBe(table.entries());
  });

  test("get returns undefined for missing ids", () => {
    const table = hirTable<string, TestEntry>({
      entries: [{ key: "a", text: "alpha" }],
      keyOf: (entry) => entry.key,
      lookupKeyOf: (key) => key,
    });

    expect(table.get("a")?.text).toBe("alpha");
    expect(table.get("missing")).toBeUndefined();
  });

  test("get uses lookupKeyOf and not storage key identity", () => {
    const stored = ownedObligationId(functionId(12), 3);
    const table = hirTable<
      ReturnType<typeof ownedObligationId>,
      { obligationId: ReturnType<typeof ownedObligationId>; text: string }
    >({
      entries: [{ obligationId: stored, text: "ready" }],
      keyOf: (entry) => ownedIdKey(entry.obligationId, "obligation"),
      lookupKeyOf: (id) => ownedIdKey(id, "obligation"),
    });

    expect(table.get(ownedObligationId(functionId(12), 3))?.text).toBe("ready");
    expect(table.get(ownedObligationId(functionId(12), 4))).toBeUndefined();
  });

  test("keyOf and lookupKeyOf are distinct hooks", () => {
    let keyOfCalls = 0;
    let lookupKeyOfCalls = 0;
    const table = hirTable<string, { storage: string; value: number }>({
      entries: [{ storage: "s2", value: 2 }],
      keyOf: (entry) => {
        keyOfCalls += 1;
        return entry.storage;
      },
      lookupKeyOf: (id) => {
        lookupKeyOfCalls += 1;
        return id;
      },
    });

    table.get("s2");
    table.entries();
    expect(keyOfCalls).toBe(1);
    expect(lookupKeyOfCalls).toBe(1);
  });

  test("tables do not depend on insertion order at read time", () => {
    const entries: TestEntry[] = [];
    for (let index = 99; index >= 0; index -= 1) {
      const key = `key:${index.toString().padStart(3, "0")}`;
      entries.push({ key, text: key });
    }
    const table = hirTable<string, TestEntry>({
      entries,
      keyOf: (entry) => entry.key,
      lookupKeyOf: (key) => key,
    });

    const sorted = [...entries]
      .sort((left, right) => compareCodeUnitStrings(left.key, right.key))
      .map((entry) => entry.key);
    expect(table.entries().map((entry) => entry.key)).toEqual(sorted);
    expect(table.get(entries[0]!.key)).toBe(entries[0]);
  });
});
