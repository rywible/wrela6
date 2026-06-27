import { describe, expect, test } from "bun:test";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import {
  assignProofMirDenseIds,
  buildProofMirCanonicalKeyLookup,
  requireProofMirCanonicalKeyReference,
} from "../../../src/proof-mir/canonicalization/id-assignment";
import {
  proofMirDiagnosticCode,
  type ProofMirDiagnostic,
} from "../../../src/proof-mir/diagnostics";
import { proofMirBlockId, proofMirFactId, proofMirOriginId } from "../../../src/proof-mir/ids";

describe("assignProofMirDenseIds", () => {
  test("assigns dense IDs from zero in canonical key order", () => {
    const assignment = assignProofMirDenseIds({
      entries: [
        { name: "c", key: proofMirCanonicalKey("block:c") },
        { name: "a", key: proofMirCanonicalKey("block:a") },
        { name: "b", key: proofMirCanonicalKey("block:b") },
      ],
      keyOf: (entry) => entry.key,
      idOf: proofMirBlockId,
      normalizePayload: (entry) => entry.name,
    });

    expect(assignment.kind).toBe("ok");
    if (assignment.kind !== "ok") return;

    expect(assignment.entries.map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    expect(assignment.lookup.resolve(proofMirCanonicalKey("block:a"))).toBe(proofMirBlockId(0));
    expect(assignment.lookup.resolve(proofMirCanonicalKey("block:b"))).toBe(proofMirBlockId(1));
    expect(assignment.lookup.resolve(proofMirCanonicalKey("block:c"))).toBe(proofMirBlockId(2));
  });

  test("is stable across shuffled draft insertion order", () => {
    const first = assignProofMirDenseIds({
      entries: [
        { name: "b", key: proofMirCanonicalKey("block:b") },
        { name: "a", key: proofMirCanonicalKey("block:a") },
        { name: "c", key: proofMirCanonicalKey("block:c") },
      ],
      keyOf: (entry) => entry.key,
      idOf: proofMirBlockId,
      normalizePayload: (entry) => entry.name,
    });
    const second = assignProofMirDenseIds({
      entries: [
        { name: "c", key: proofMirCanonicalKey("block:c") },
        { name: "b", key: proofMirCanonicalKey("block:b") },
        { name: "a", key: proofMirCanonicalKey("block:a") },
      ],
      keyOf: (entry) => entry.key,
      idOf: proofMirBlockId,
      normalizePayload: (entry) => entry.name,
    });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    expect(first.lookup.entries().map((entry) => [entry.canonicalKey, entry.id] as const)).toEqual(
      second.lookup.entries().map((entry) => [entry.canonicalKey, entry.id] as const),
    );
  });

  test("rejects duplicate canonical keys with incompatible payloads", () => {
    const assignment = assignProofMirDenseIds({
      entries: [
        { name: "alpha", key: proofMirCanonicalKey("block:shared") },
        { name: "beta", key: proofMirCanonicalKey("block:shared") },
      ],
      keyOf: (entry) => entry.key,
      idOf: proofMirBlockId,
      normalizePayload: (entry) => entry.name,
      duplicateDetail: (key) => `duplicate:${key}`,
    });

    expect(assignment.kind).toBe("error");
    if (assignment.kind === "error") {
      expect(assignment.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_INVALID_TABLE_CANONICAL_KEY"),
      );
      expect(assignment.diagnostics[0]?.stableDetail).toBe("duplicate:block:shared");
    }
  });
});

describe("buildProofMirCanonicalKeyLookup", () => {
  test("scopes lookups to one table without comparing across owners", () => {
    const functionA = buildProofMirCanonicalKeyLookup({
      entries: [{ key: proofMirCanonicalKey("value:x"), index: 0 }],
      keyOf: (entry) => entry.key,
      idOf: proofMirOriginId,
    });
    const functionB = buildProofMirCanonicalKeyLookup({
      entries: [{ key: proofMirCanonicalKey("value:x"), index: 0 }],
      keyOf: (entry) => entry.key,
      idOf: proofMirOriginId,
    });

    expect(functionA.resolve(proofMirCanonicalKey("value:x"))).toBe(proofMirOriginId(0));
    expect(functionB.resolve(proofMirCanonicalKey("value:x"))).toBe(proofMirOriginId(0));
    expect(functionA.resolve(proofMirCanonicalKey("value:missing"))).toBeUndefined();
    expect(functionA.entries()).not.toBe(functionB.entries());
  });
});

describe("requireProofMirCanonicalKeyReference", () => {
  test("emits PROOF_MIR_INVALID_CANONICAL_ID_ASSIGNMENT for unresolved references", () => {
    const lookup = buildProofMirCanonicalKeyLookup({
      entries: [] as { readonly key: ReturnType<typeof proofMirCanonicalKey> }[],
      keyOf: (entry) => entry.key,
      idOf: proofMirFactId,
    });
    const diagnostics: ProofMirDiagnostic[] = [];
    const resolved = requireProofMirCanonicalKeyReference({
      lookup,
      key: proofMirCanonicalKey("fact:missing"),
      referenceKind: "originKey",
      ownerKey: "program",
      diagnostics,
    });

    expect(resolved).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe(
      proofMirDiagnosticCode("PROOF_MIR_INVALID_CANONICAL_ID_ASSIGNMENT"),
    );
    expect(diagnostics[0]?.stableDetail).toBe("originKey:fact:missing");
  });
});
