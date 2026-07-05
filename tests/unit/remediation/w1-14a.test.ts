import { describe, expect, test } from "bun:test";

import type { LayoutFactProgram } from "../../../src/layout/layout-program";
import {
  layoutAuthorityFingerprintForProofCheckInput,
  layoutFactProgramStableContentKey,
} from "../../../src/proof-check/validation/input-validator";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import {
  emptyDeterministicTable,
  placeRecordPayload,
  valueRecordPayload,
} from "../../../src/proof-mir/canonicalization/program-freeze-shared";

type PlaceRecord = Parameters<typeof placeRecordPayload>[0];
type ValueRecord = Parameters<typeof valueRecordPayload>[0];

function tableWithEntries<Entry>(entries: readonly Entry[]): {
  entries(): readonly Entry[];
  keyString(key: string): string;
} {
  return {
    entries: () => entries,
    keyString: (key) => key,
  };
}

function layoutWithTypeEntry(entry: object): LayoutFactProgram {
  return {
    target: { targetId: "stable-json-test-target", abi: { a: 1, b: 2 } },
    imageEntry: { entrySymbol: "main", metadata: { left: "x", right: "y" } },
    types: tableWithEntries([{ key: "type:0", payload: entry }]),
    fields: tableWithEntries([]),
    enums: tableWithEntries([]),
    validatedBuffers: tableWithEntries([]),
    imageDevices: tableWithEntries([]),
    functions: tableWithEntries([]),
    platformEdges: tableWithEntries([]),
  } as unknown as LayoutFactProgram;
}

describe("W1-14a stable JSON proof canonicalization", () => {
  test("layout authority content keys ignore object insertion order", () => {
    const first = layoutWithTypeEntry({ alpha: 1, beta: { gamma: 2, delta: 3 } });
    const second = layoutWithTypeEntry({ beta: { delta: 3, gamma: 2 }, alpha: 1 });

    expect(layoutFactProgramStableContentKey(first)).toBe(
      layoutFactProgramStableContentKey(second),
    );
    expect(layoutAuthorityFingerprintForProofCheckInput(first)).toEqual(
      layoutAuthorityFingerprintForProofCheckInput(second),
    );
  });

  test("proof MIR record payloads ignore object insertion order", () => {
    const leftType = { pointer: { nullable: false, addressSpace: "default" }, kind: "ptr" };
    const rightType = { kind: "ptr", pointer: { addressSpace: "default", nullable: false } };

    expect(
      placeRecordPayload({
        key: proofMirCanonicalKey("place:0"),
        monoPlaceCanonicalKey: "function:main/local:0",
        originKey: proofMirCanonicalKey("origin:0"),
        root: { owner: "local", id: 1 },
        projection: { offset: 0, field: "packet" },
        type: leftType,
      } as unknown as PlaceRecord),
    ).toBe(
      placeRecordPayload({
        key: proofMirCanonicalKey("place:0"),
        monoPlaceCanonicalKey: "function:main/local:0",
        originKey: proofMirCanonicalKey("origin:0"),
        root: { id: 1, owner: "local" },
        projection: { field: "packet", offset: 0 },
        type: rightType,
      } as unknown as PlaceRecord),
    );

    expect(
      valueRecordPayload({
        key: proofMirCanonicalKey("value:0"),
        role: "operand",
        originKey: proofMirCanonicalKey("origin:0"),
        type: leftType,
        representation: { source: "constant", bits: "01" },
      } as unknown as ValueRecord),
    ).toBe(
      valueRecordPayload({
        key: proofMirCanonicalKey("value:0"),
        role: "operand",
        originKey: proofMirCanonicalKey("origin:0"),
        type: rightType,
        representation: { bits: "01", source: "constant" },
      } as unknown as ValueRecord),
    );
  });

  test("empty deterministic table canonical keys ignore entry insertion order", () => {
    const table = emptyDeterministicTable<string, object>("stable-json-test");

    expect(table.keyOf({ alpha: 1, beta: 2 })).toBe(table.keyOf({ beta: 2, alpha: 1 }));
  });
});
