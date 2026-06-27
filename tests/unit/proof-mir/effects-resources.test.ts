import { describe, expect, test } from "bun:test";
import { hirLocalId, resourcePlaceId, validationId } from "../../../src/hir/ids";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";
import type {
  MonoInstantiatedProofId,
  MonoLocalId,
  MonoResourcePlace,
} from "../../../src/mono/mono-hir";
import { proofMetadataIdKey } from "../../../src/mono/proof-metadata-tables";
import { compareProofMirCanonicalKeys } from "../../../src/proof-mir/canonicalization/canonical-order";
import {
  classifyProofMirLocalStorage,
  createProofMirDraftScopeTree,
  createProofMirEffectsResources,
  crossedScopesForDraftEdge,
  draftEdgeEffectKey,
  normalizeDraftEdgeEffect,
  proofMirScopeTreeForTest,
  sortDraftResourceBoundarySet,
  type DraftProofMirEdgeEffect,
  type ProofMirLocalStoragePreScanFact,
} from "../../../src/proof-mir/domains/effects-resources";
import {
  draftOriginKey,
  draftPlaceKey,
  draftScopeKey,
  draftValueKey,
} from "../../../src/proof-mir/draft/draft-keys";
import { fieldId, parameterId } from "../../../src/semantic/ids";

const functionInstanceId = monoInstanceId("fn:main");

function originKey(note: string) {
  return draftOriginKey({
    owner: { kind: "function", functionInstanceId },
    note,
  });
}

function monoLocalPlaceFake(input: {
  readonly canonicalKey: string;
  readonly localId: MonoLocalId;
  readonly projection?: MonoResourcePlace["projection"];
}): MonoResourcePlace {
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(1),
      instanceId: functionInstanceId,
    },
    canonicalKey: input.canonicalKey,
    root: { kind: "local", localId: input.localId },
    projection: input.projection ?? [],
    type: { kind: "primitive", name: "u8" } as never,
    resourceKind: "Copy",
    sourceOrigin: "source:1",
    kind: "local",
    localId: input.localId,
  };
}

function validationProofId(
  value: number,
): MonoInstantiatedProofId<ReturnType<typeof validationId>> {
  return {
    owner: { kind: "function", instanceId: functionInstanceId },
    hirId: validationId(value),
    instanceId: functionInstanceId,
  };
}

function scalarCopyFact(
  overrides: Partial<ProofMirLocalStoragePreScanFact> = {},
): ProofMirLocalStoragePreScanFact {
  return {
    isCopyScalar: true,
    addressTaken: false,
    borrowed: false,
    projected: false,
    consumed: false,
    validatedBuffer: false,
    sessionBound: false,
    privateState: false,
    capability: false,
    aggregate: false,
    ...overrides,
  };
}

describe("ProofMirEffectsResources scope crossing", () => {
  test("crossed scopes are innermost to outermost until shared ancestor", () => {
    const tree = proofMirScopeTreeForTest([
      { key: "function" },
      { key: "loop", parent: "function" },
      { key: "body", parent: "loop" },
      { key: "after", parent: "function" },
    ]);

    expect(crossedScopesForDraftEdge(tree, { from: "body", targetRole: "after" })).toEqual([
      "body",
      "loop",
    ]);
  });

  test("scope stacks are deterministic for nested roles", () => {
    const tree = createProofMirDraftScopeTree({
      functionInstanceId,
      entries: [
        { role: "function" },
        { role: "loop", parentRole: "function" },
        { role: "body", parentRole: "loop" },
      ],
    });

    expect(tree.scopeStack("body")).toEqual(["body", "loop", "function"]);
    expect(tree.scopeKey("body")).toBe(
      draftScopeKey({
        functionInstanceId,
        role: "body",
        parentScopeKey: draftScopeKey({
          functionInstanceId,
          role: "loop",
          parentScopeKey: draftScopeKey({ functionInstanceId, role: "function" }),
        }),
      }),
    );
  });
});

describe("ProofMirEffectsResources local storage classification", () => {
  test("copy scalar locals without place uses classify as scalarSsa", () => {
    expect(classifyProofMirLocalStorage(scalarCopyFact())).toBe("scalarSsa");
  });

  test("borrowed locals classify as placeBacked", () => {
    expect(classifyProofMirLocalStorage(scalarCopyFact({ borrowed: true }))).toBe("placeBacked");
  });

  test("address-taken and resource-bearing locals classify as placeBacked", () => {
    expect(classifyProofMirLocalStorage(scalarCopyFact({ addressTaken: true }))).toBe(
      "placeBacked",
    );
    expect(classifyProofMirLocalStorage(scalarCopyFact({ validatedBuffer: true }))).toBe(
      "placeBacked",
    );
    expect(classifyProofMirLocalStorage(scalarCopyFact({ isCopyScalar: false }))).toBe(
      "placeBacked",
    );
  });

  test("classification prefers placeBacked when multiple facts conflict", () => {
    const storage = classifyProofMirLocalStorage(
      scalarCopyFact({
        borrowed: true,
        addressTaken: false,
      }),
    );
    expect(storage).toBe("placeBacked");
  });
});

describe("ProofMirEffectsResources structured places", () => {
  test("mono structured places preserve root and projection", () => {
    const domain = createProofMirEffectsResources({ functionInstanceId });
    const monoLocalId = instantiatedHirId(functionInstanceId, hirLocalId(2));
    const monoPlace = monoLocalPlaceFake({
      canonicalKey: "function:main/root:local:2/projection:/field:payload",
      localId: monoLocalId,
      projection: [{ kind: "field", fieldId: fieldId(3) }],
    });

    const placeKey = domain.placeFromMono({
      monoPlace,
      originKey: originKey("place.mono"),
    });
    const record = domain.draftPlace(placeKey);

    expect(record.root).toEqual({ kind: "local", localId: monoLocalId });
    expect(record.projection).toEqual([{ kind: "field", fieldId: fieldId(3) }]);
    expect(record.monoPlaceCanonicalKey).toBe(monoPlace.canonicalKey);
    expect(placeKey).toBe(
      draftPlaceKey({
        functionInstanceId,
        monoPlaceCanonicalKey: monoPlace.canonicalKey,
      }),
    );
  });

  test("block-parameter and runtime-temporary roots are preserved", () => {
    const domain = createProofMirEffectsResources({ functionInstanceId });
    const valueKey = draftValueKey({ functionInstanceId, role: "join:x" });
    const blockParameterKey = domain.placeFromBlockParameter({
      valueKey,
      originKey: originKey("place.blockParameter"),
    });
    const runtimeTemporaryKey = domain.placeFromRuntimeTemporary({
      valueKey,
      originKey: originKey("place.runtimeTemporary"),
    });

    expect(domain.draftPlace(blockParameterKey).root).toEqual({
      kind: "blockParameter",
      valueKey,
    });
    expect(domain.draftPlace(runtimeTemporaryKey).root).toEqual({
      kind: "runtimeTemporary",
      valueKey,
    });
  });

  test("validation packet payload and image-device projections are preserved", () => {
    const domain = createProofMirEffectsResources({ functionInstanceId });
    const monoPlace = monoLocalPlaceFake({
      canonicalKey: "function:main/root:local:4",
      localId: instantiatedHirId(functionInstanceId, hirLocalId(4)),
    });
    const basePlaceKey = domain.placeFromMono({
      monoPlace,
      originKey: originKey("place.packet"),
    });
    const validationId = validationProofId(7);
    const payloadPlaceKey = domain.projectPlace({
      basePlaceKey,
      projection: { kind: "validatedPacketPayload", validationId },
      originKey: originKey("place.payload"),
    });
    const imageDevicePlaceKey = domain.projectPlace({
      basePlaceKey,
      projection: { kind: "imageDevice", fieldId: fieldId(9) },
      originKey: originKey("place.imageDevice"),
    });

    expect(domain.draftPlace(payloadPlaceKey).projection).toEqual([
      { kind: "validatedPacketPayload", validationId },
    ]);
    expect(domain.draftPlace(imageDevicePlaceKey).projection).toEqual([
      { kind: "imageDevice", fieldId: fieldId(9) },
    ]);
  });

  test("equivalent mono places intern to one draft place key", () => {
    const domain = createProofMirEffectsResources({ functionInstanceId });
    const monoPlace: MonoResourcePlace = {
      ...monoLocalPlaceFake({
        canonicalKey: "function:main/root:parameter:0",
        localId: instantiatedHirId(functionInstanceId, hirLocalId(0)),
      }),
      root: { kind: "parameter", parameterId: parameterId(0) },
      kind: "parameter",
      parameterId: parameterId(0),
    };

    const first = domain.placeFromMono({ monoPlace, originKey: originKey("place.param") });
    const second = domain.placeFromMono({ monoPlace, originKey: originKey("place.param") });

    expect(first).toBe(second);
    expect(domain.placeEntries()).toHaveLength(1);
  });
});

describe("ProofMirEffectsResources loans and edge effects", () => {
  test("borrow operations allocate stable loans with scope and origins", () => {
    const domain = createProofMirEffectsResources({ functionInstanceId });
    const scopeTree = createProofMirDraftScopeTree({
      functionInstanceId,
      entries: [{ role: "function" }, { role: "body", parentRole: "function" }],
    });
    const monoPlace = monoLocalPlaceFake({
      canonicalKey: "function:main/root:local:1",
      localId: instantiatedHirId(functionInstanceId, hirLocalId(1)),
    });
    const placeKey = domain.placeFromMono({
      monoPlace,
      originKey: originKey("place.borrow"),
    });
    const startOriginKey = originKey("borrow.start");
    const endOriginKey = originKey("borrow.end");

    const loanKey = domain.startLoan({
      mode: "shared",
      placeKey,
      scopeKey: scopeTree.scopeKey("body"),
      startOriginKey,
    });
    domain.endLoan({ loanKey, endOriginKey });

    const loan = domain.draftLoan(loanKey);
    expect(loan.mode).toBe("shared");
    expect(loan.placeKey).toBe(placeKey);
    expect(loan.scopeKey).toBe(scopeTree.scopeKey("body"));
    expect(loan.startOriginKey).toBe(startOriginKey);
    expect(loan.endOriginKey).toBe(endOriginKey);
    expect(
      domain.startLoan({
        mode: "shared",
        placeKey,
        scopeKey: scopeTree.scopeKey("body"),
        startOriginKey,
      }),
    ).toBe(loanKey);
  });

  test("edge effects normalize with canonical keys and intern duplicates", () => {
    const domain = createProofMirEffectsResources({ functionInstanceId });
    const placeKey = domain.placeFromMono({
      monoPlace: monoLocalPlaceFake({
        canonicalKey: "function:main/root:local:5",
        localId: instantiatedHirId(functionInstanceId, hirLocalId(5)),
      }),
      originKey: originKey("place.consume"),
    });
    const consumeEffect: DraftProofMirEdgeEffect = {
      kind: "consumePlace",
      placeKey,
    };
    const normalized = normalizeDraftEdgeEffect(consumeEffect);

    expect(normalized).toEqual(consumeEffect);
    expect(draftEdgeEffectKey(normalized)).toBe(draftEdgeEffectKey(consumeEffect));

    const first = domain.recordEdgeEffect(consumeEffect);
    const second = domain.recordEdgeEffect(consumeEffect);
    expect(first).toBe(second);
    expect(domain.edgeEffectEntries()).toHaveLength(1);
  });

  test("obligation session and private-state edge effects use canonical keys", () => {
    const domain = createProofMirEffectsResources({ functionInstanceId });
    const placeKey = domain.placeFromMono({
      monoPlace: monoLocalPlaceFake({
        canonicalKey: "function:main/root:local:6",
        localId: instantiatedHirId(functionInstanceId, hirLocalId(6)),
      }),
      originKey: originKey("place.private"),
    });
    const generationKey = domain.privateStateGenerationKey({
      placeKey,
      generationOrdinal: 0,
      originKey: originKey("private.from"),
    });
    const nextGenerationKey = domain.privateStateGenerationKey({
      placeKey,
      generationOrdinal: 1,
      originKey: originKey("private.to"),
    });
    const obligationProofKey = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(2),
      instanceId: functionInstanceId,
    });
    const sessionProofKey = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(3),
      instanceId: functionInstanceId,
    });
    const brandProofKey = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(4),
      instanceId: functionInstanceId,
    });
    const transitionProofKey = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(8),
      instanceId: functionInstanceId,
    });

    const obligationEffect = domain.recordEdgeEffect({
      kind: "openObligation",
      obligationProofKey,
      originKey: originKey("obligation.open"),
    });
    const sessionEffect = domain.recordEdgeEffect({
      kind: "openSessionMember",
      sessionProofKey,
      brandProofKey,
      originKey: originKey("session.open"),
    });
    const privateStateEffect = domain.recordEdgeEffect({
      kind: "advancePrivateState",
      fromGenerationKey: generationKey,
      toGenerationKey: nextGenerationKey,
    });
    const transitionKey = domain.recordPrivateStateTransition({
      transitionProofKey,
      originKey: originKey("private.transition"),
    });

    expect(obligationEffect).toBe(
      draftEdgeEffectKey({
        kind: "openObligation",
        obligationProofKey,
        originKey: originKey("obligation.open"),
      }),
    );
    expect(sessionEffect).toBe(
      draftEdgeEffectKey({
        kind: "openSessionMember",
        sessionProofKey,
        brandProofKey,
        originKey: originKey("session.open"),
      }),
    );
    expect(privateStateEffect).toBe(
      draftEdgeEffectKey({
        kind: "advancePrivateState",
        fromGenerationKey: generationKey,
        toGenerationKey: nextGenerationKey,
      }),
    );
    expect(transitionKey).toBeTruthy();
    expect(domain.privateStateTransitionEntries()).toHaveLength(1);
  });
});

describe("ProofMirEffectsResources resource boundary sets", () => {
  test("loop boundary sets sort resources by canonical key", () => {
    const domain = createProofMirEffectsResources({ functionInstanceId });
    const placeB = domain.placeFromMono({
      monoPlace: monoLocalPlaceFake({
        canonicalKey: "function:main/root:local:20",
        localId: instantiatedHirId(functionInstanceId, hirLocalId(20)),
      }),
      originKey: originKey("boundary.place.b"),
    });
    const placeA = domain.placeFromMono({
      monoPlace: monoLocalPlaceFake({
        canonicalKey: "function:main/root:local:10",
        localId: instantiatedHirId(functionInstanceId, hirLocalId(10)),
      }),
      originKey: originKey("boundary.place.a"),
    });
    const scopeTree = createProofMirDraftScopeTree({
      functionInstanceId,
      entries: [{ role: "loop" }],
    });
    const loanB = domain.startLoan({
      mode: "exclusive",
      placeKey: placeB,
      scopeKey: scopeTree.scopeKey("loop"),
      startOriginKey: originKey("boundary.loan.b"),
    });
    const loanA = domain.startLoan({
      mode: "shared",
      placeKey: placeA,
      scopeKey: scopeTree.scopeKey("loop"),
      startOriginKey: originKey("boundary.loan.a"),
    });
    const generationB = domain.privateStateGenerationKey({
      placeKey: placeB,
      generationOrdinal: 1,
      originKey: originKey("boundary.generation.b"),
    });
    const generationA = domain.privateStateGenerationKey({
      placeKey: placeA,
      generationOrdinal: 0,
      originKey: originKey("boundary.generation.a"),
    });
    const obligationProofKeyB = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(20),
      instanceId: functionInstanceId,
    });
    const obligationProofKeyA = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(10),
      instanceId: functionInstanceId,
    });
    const sessionProofKeyB = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(30),
      instanceId: functionInstanceId,
    });
    const sessionProofKeyA = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(11),
      instanceId: functionInstanceId,
    });
    const brandProofKey = proofMetadataIdKey({
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: validationId(12),
      instanceId: functionInstanceId,
    });

    const boundary = sortDraftResourceBoundarySet({
      places: [placeB, placeA],
      loans: [loanB, loanA],
      obligations: [
        { obligationProofKey: obligationProofKeyB, originKey: originKey("boundary.obligation.b") },
        { obligationProofKey: obligationProofKeyA, originKey: originKey("boundary.obligation.a") },
      ],
      sessionMembers: [
        {
          sessionProofKey: sessionProofKeyB,
          brandProofKey,
          originKey: originKey("boundary.session.b"),
        },
        {
          sessionProofKey: sessionProofKeyA,
          brandProofKey,
          originKey: originKey("boundary.session.a"),
        },
      ],
      privateStateGenerations: [
        { generationKey: generationB, placeKey: placeB, originKey: originKey("boundary.gen.b") },
        { generationKey: generationA, placeKey: placeA, originKey: originKey("boundary.gen.a") },
      ],
    });

    const sortedPlaces = [...boundary.places].sort(compareProofMirCanonicalKeys);
    const sortedLoans = [...boundary.loans].sort(compareProofMirCanonicalKeys);
    expect(boundary.places).toEqual(sortedPlaces);
    expect(boundary.loans).toEqual(sortedLoans);
    expect(boundary.places[0]).toBe(placeA);
    expect(boundary.loans[0]).toBe(loanA);
    expect(boundary.obligations[0]?.obligationProofKey).toBe(obligationProofKeyA);
    expect(boundary.sessionMembers[0]?.sessionProofKey).toBe(sessionProofKeyA);
    expect(boundary.privateStateGenerations[0]?.generationKey).toBe(generationA);
  });
});
