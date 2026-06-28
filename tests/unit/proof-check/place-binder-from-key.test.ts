import { describe, expect, test } from "bun:test";
import { parameterId } from "../../../src/semantic/ids";
import {
  proofCheckPlaceBinderFromKey,
  proofCheckPlaceBinderKey,
  proofCheckValueBinderFromKey,
  proofCheckValueBinderKey,
  syntheticBinderId,
} from "../../../src/proof-check/model/fact-language";
import { proofMirPlaceId, proofMirValueId } from "../../../src/proof-mir/ids";

describe("proofCheckPlaceBinderFromKey", () => {
  test("round-trips structured place binders", () => {
    const binders = [
      { kind: "receiver" as const },
      { kind: "result" as const },
      { kind: "subject" as const },
      { kind: "parameter" as const, index: 2 },
      { kind: "parameter" as const, index: 1, parameterId: parameterId(9) },
      { kind: "argument" as const, index: 0 },
      { kind: "argument" as const, index: 3, parameterId: parameterId(4) },
      { kind: "proofMirPlace" as const, placeId: proofMirPlaceId(21) },
      { kind: "synthetic" as const, id: syntheticBinderId("cell") },
    ];

    for (const binder of binders) {
      const key = proofCheckPlaceBinderKey(binder);
      expect(proofCheckPlaceBinderFromKey(key)).toEqual(binder);
    }
  });

  test("returns undefined for malformed structured keys", () => {
    expect(proofCheckPlaceBinderFromKey("parameter:")).toBeUndefined();
    expect(proofCheckPlaceBinderFromKey("parameter:abc")).toBeUndefined();
    expect(proofCheckPlaceBinderFromKey("argument:")).toBeUndefined();
    expect(proofCheckPlaceBinderFromKey("proofMirPlace:")).toBeUndefined();
    expect(proofCheckPlaceBinderFromKey("proofMirPlace:abc")).toBeUndefined();
    expect(proofCheckPlaceBinderFromKey("")).toBeUndefined();
  });
});

describe("proofCheckValueBinderFromKey", () => {
  test("round-trips structured value binders", () => {
    const binders = [
      { kind: "resultValue" as const },
      { kind: "proofMirValue" as const, valueId: proofMirValueId(7) },
      { kind: "synthetic" as const, id: syntheticBinderId("payload-end") },
    ];

    for (const binder of binders) {
      const key = proofCheckValueBinderKey(binder);
      expect(proofCheckValueBinderFromKey(key)).toEqual(binder);
    }
  });

  test("returns undefined for malformed structured keys", () => {
    expect(proofCheckValueBinderFromKey("proofMirValue:")).toBeUndefined();
    expect(proofCheckValueBinderFromKey("proofMirValue:abc")).toBeUndefined();
    expect(proofCheckValueBinderFromKey("")).toBeUndefined();
  });
});
