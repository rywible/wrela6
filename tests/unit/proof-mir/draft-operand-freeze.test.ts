import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { proofMirCanonicalKey } from "../../../src/proof-mir/canonicalization/canonical-keys";
import { buildProofMirCanonicalKeyLookup } from "../../../src/proof-mir/canonicalization/id-assignment";
import { draftPlaceKey } from "../../../src/proof-mir/draft/draft-keys";
import {
  freezeDraftRuntimeCapabilityPlaceKeys,
  freezeDraftRuntimeEffect,
} from "../../../src/proof-mir/draft/draft-runtime-call";
import type { DraftProofMirFactOperandFreezeLookups } from "../../../src/proof-mir/draft/draft-fact-operands";
import {
  freezeDraftLayoutTermReference,
  type DraftProofMirLayoutTermReference,
} from "../../../src/proof-mir/draft/draft-layout-term-reference";
import {
  proofMirFactId,
  proofMirLayoutTermId,
  proofMirOwnedPlaceId,
  proofMirPlaceId,
} from "../../../src/proof-mir/ids";

function functionInstanceId() {
  return monoInstanceId("fn:draft-freeze");
}

function operandLookupsForTest(): DraftProofMirFactOperandFreezeLookups {
  const placeKey = draftPlaceKey({
    functionInstanceId: functionInstanceId(),
    monoPlaceCanonicalKey: "place:argument:0",
  });
  const placeRecords = [{ key: placeKey, functionInstanceId: functionInstanceId() }];
  const placeKeyLookup = buildProofMirCanonicalKeyLookup({
    entries: placeRecords,
    keyOf: (entry) => entry.key,
    idOf: () => ({ functionInstanceId: functionInstanceId(), placeId: proofMirPlaceId(3) }),
  });
  return {
    valueKeyLookup: buildProofMirCanonicalKeyLookup({
      entries: [],
      keyOf: (entry: { key: string }) => proofMirCanonicalKey(entry.key),
      idOf: () => ({ functionInstanceId: functionInstanceId(), valueId: 0 as never }),
    }),
    placeKeyLookup,
    layoutTermBindingKeyLookup: buildProofMirCanonicalKeyLookup({
      entries: [],
      keyOf: (entry: { key: string }) => proofMirCanonicalKey(entry.key),
      idOf: () => ({ functionInstanceId: functionInstanceId(), bindingId: 0 as never }),
    }),
    factKeyLookup: buildProofMirCanonicalKeyLookup({
      entries: [],
      keyOf: (key) => key,
      idOf: proofMirFactId,
    }),
    layoutTermKeyLookup: buildProofMirCanonicalKeyLookup({
      entries: [proofMirCanonicalKey("layoutTerm:test")],
      keyOf: (key) => key,
      idOf: proofMirLayoutTermId,
    }),
  };
}

describe("draft runtime call freeze", () => {
  test("remaps capability place keys to owned place ids", () => {
    const placeKey = draftPlaceKey({
      functionInstanceId: functionInstanceId(),
      monoPlaceCanonicalKey: "place:argument:0",
    });
    const lookups = operandLookupsForTest();
    const capabilities = freezeDraftRuntimeCapabilityPlaceKeys([placeKey, placeKey], lookups);

    expect(capabilities).toEqual([
      proofMirOwnedPlaceId(functionInstanceId(), proofMirPlaceId(3)),
      proofMirOwnedPlaceId(functionInstanceId(), proofMirPlaceId(3)),
    ]);
  });

  test("remaps memory effect place keys to owned place ids", () => {
    const placeKey = draftPlaceKey({
      functionInstanceId: functionInstanceId(),
      monoPlaceCanonicalKey: "place:argument:0",
    });
    const effect = freezeDraftRuntimeEffect(
      { kind: "writesMemory", placeKey },
      operandLookupsForTest(),
    );

    expect(effect).toEqual({
      kind: "writesMemory",
      place: proofMirOwnedPlaceId(functionInstanceId(), proofMirPlaceId(3)),
    });
  });
});

describe("draft layout term freeze", () => {
  test("remaps layout term keys to dense term ids", () => {
    const draftTerm: DraftProofMirLayoutTermReference = {
      termKey: proofMirCanonicalKey("layoutTerm:test"),
      unit: "byteOffset",
      path: {
        root: {
          kind: "validatedBufferFieldTerm",
          instanceId: functionInstanceId(),
          fieldId: "tag" as never,
          slot: "offset",
        },
        childPath: [],
      },
    };
    const lookups = operandLookupsForTest();
    const frozen = freezeDraftLayoutTermReference(draftTerm, lookups.layoutTermKeyLookup);

    expect(frozen).toEqual({
      termId: proofMirLayoutTermId(0),
      unit: "byteOffset",
      path: draftTerm.path,
    });
  });
});
