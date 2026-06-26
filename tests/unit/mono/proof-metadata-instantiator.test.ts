import { expect, test } from "bun:test";
import { coreTypeId, functionId, imageId, typeId } from "../../../src/semantic/ids";
import {
  hirImageOriginId,
  hirLocalId,
  hirOriginId,
  obligationId,
  ownedObligationId,
  ownedResourcePlaceId,
} from "../../../src/hir/ids";
import {
  genericFunctionWithObligationProgramForMonoTest,
  monoInstanceIdForTest,
  proofMetadataProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";
import {
  buildProofMetadataIndex,
  createMonoRemapIndex,
  instantiateImageOwnedRecord,
  instantiateMonoProofMetadata,
  lookupProofMetadataOwner,
} from "../../../src/mono/proof-metadata-instantiator";
import { HirProofMetadataBuilder } from "../../../src/hir/proof-metadata";
import type { HirImageOrigin, HirResourcePlace } from "../../../src/hir/hir";
import { coreCheckedType, errorCheckedType } from "../../../src/semantic/surface/type-model";
import { concreteKind, errorKind } from "../../../src/semantic/surface/resource-kind";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";

test("proof metadata index groups records by owner", () => {
  const program = proofMetadataProgramForMonoTest();
  const index = buildProofMetadataIndex(program.proofMetadata);
  const functionRecords = index.recordsForOwner({ kind: "function", functionId: functionId(3) });

  expect(functionRecords.resourcePlaces).toHaveLength(1);
  expect(functionRecords.obligations).toHaveLength(1);
});

test("proof metadata index reuses owner buckets for repeated lookups", () => {
  const program = proofMetadataProgramForMonoTest();
  const index = buildProofMetadataIndex(program.proofMetadata);
  const owner = { kind: "function" as const, functionId: functionId(3) };

  expect(index.recordsForOwner(owner)).toBe(index.recordsForOwner(owner));
});

test("proof metadata index excludes records owned by other functions", () => {
  const program = proofMetadataProgramForMonoTest();
  const index = buildProofMetadataIndex(program.proofMetadata);
  const otherFunctionRecords = index.recordsForOwner({
    kind: "function",
    functionId: functionId(4),
  });

  expect(otherFunctionRecords.resourcePlaces).toEqual([]);
  expect(otherFunctionRecords.obligations).toEqual([]);
});

test("remap pairs proof id with owner and mono instance id", () => {
  const remap = createMonoRemapIndex({ instanceId: monoInstanceIdForTest("fn:3|owner:<>|fn:<>") });
  const proofId = remap.proof(ownedObligationId(functionId(3), 0));

  expect(proofId.hirId).toBe(obligationId(0));
  expect(proofId.instanceId).toBe(monoInstanceIdForTest("fn:3|owner:<>|fn:<>"));
  expect(proofId.owner).toEqual({
    kind: "function",
    instanceId: monoInstanceIdForTest("fn:3|owner:<>|fn:<>"),
  });
});

test("remap preserves type-owned proof owner shape", () => {
  const instanceId = monoInstanceIdForTest("type:1|args:<>");
  const remap = createMonoRemapIndex({ instanceId });
  const proofId = remap.proof({
    owner: { kind: "type", typeId: typeId(1) },
    id: obligationId(0),
  });

  expect(proofId.owner).toEqual({ kind: "type", instanceId });
});

test("remap preserves image-owned proof owner shape", () => {
  const instanceId = monoInstanceIdForTest("image:1");
  const remap = createMonoRemapIndex({ instanceId });
  const proofId = remap.proof({
    owner: { kind: "image", imageId: imageId(1) },
    id: obligationId(0),
  });

  expect(proofId.owner).toEqual({ kind: "image", instanceId });
});

test("lookup returns missing diagnostic when owner record is absent", () => {
  const program = proofMetadataProgramForMonoTest();
  const result = lookupProofMetadataOwner(program.proofMetadata, {
    family: "obligation",
    id: {
      owner: { kind: "function", functionId: functionId(99) },
      id: obligationId(99),
    },
  });

  expect(result.kind).toBe("missing");
  if (result.kind === "missing") {
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "MONO_DANGLING_PROOF_METADATA",
    ]);
  }
});

test("lookup detects owner mismatch by structural proof id", () => {
  const program = proofMetadataProgramForMonoTest();
  const result = lookupProofMetadataOwner(program.proofMetadata, {
    family: "obligation",
    id: {
      owner: { kind: "function", functionId: functionId(99) },
      id: obligationId(0),
    },
  });

  expect(result.kind).toBe("dangling");
  if (result.kind === "dangling") {
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "MONO_DANGLING_PROOF_METADATA",
    ]);
  }
});

test("lookup uses proof id family when numeric ids collide", () => {
  const obligation = {
    obligationId: ownedObligationId(functionId(1), 0),
    kind: "callRequirement" as const,
    sourceOrigin: hirOriginId(0),
  };
  const place: HirResourcePlace = {
    placeId: ownedResourcePlaceId({ kind: "function", functionId: functionId(2) }, 0),
    canonicalKey: "function:2/root:local:0/projection:/type:core:u8/kind:Copy",
    root: { kind: "local", localId: hirLocalId(0) },
    projection: [],
    type: coreCheckedType(coreTypeId("u8")),
    resourceKind: concreteKind("Copy"),
    kind: "local",
    localId: hirLocalId(0),
    sourceOrigin: hirOriginId(0),
  };
  const metadata = new HirProofMetadataBuilder()
    .addObligation(obligation)
    .addResourcePlace(place)
    .build();

  const result = lookupProofMetadataOwner(metadata, {
    family: "resourcePlace",
    id: place.placeId,
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.owner).toEqual(place.placeId.owner);
  }
});

test("lookup prefers exact owner match when owner-scoped proof ids collide", () => {
  const firstObligation = {
    obligationId: ownedObligationId(functionId(1), 0),
    kind: "callRequirement" as const,
    sourceOrigin: hirOriginId(0),
  };
  const secondObligation = {
    obligationId: ownedObligationId(functionId(2), 0),
    kind: "callRequirement" as const,
    sourceOrigin: hirOriginId(0),
  };
  const metadata = new HirProofMetadataBuilder()
    .addObligation(firstObligation)
    .addObligation(secondObligation)
    .build();

  const result = lookupProofMetadataOwner(metadata, {
    family: "obligation",
    id: secondObligation.obligationId,
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.owner).toEqual(secondObligation.obligationId.owner);
  }
});

test("image-owned records can be instantiated once for the selected image instance key", () => {
  const place: HirResourcePlace = {
    placeId: ownedResourcePlaceId({ kind: "image", imageId: imageId(1) }, 0),
    canonicalKey: "image:1/root:local:0/projection:/type:error/kind:error",
    root: { kind: "local", localId: hirLocalId(0) },
    projection: [],
    type: errorCheckedType(),
    resourceKind: errorKind(),
    kind: "local",
    localId: hirLocalId(0),
    sourceOrigin: hirOriginId(0),
  };
  const metadata = new HirProofMetadataBuilder().addResourcePlace(place).build();
  const instantiations = new Set<string>();
  const first = instantiateImageOwnedRecord(
    { record: place, key: { imageId: imageId(1), instanceId: monoInstanceIdForTest("img:1") } },
    instantiations,
  );

  expect(first.kind).toBe("ok");
  expect(instantiations.size).toBe(1);

  const second = instantiateImageOwnedRecord(
    { record: place, key: { imageId: imageId(1), instanceId: monoInstanceIdForTest("img:1") } },
    instantiations,
  );
  expect(second.kind).toBe("duplicate");
  if (second.kind === "duplicate") {
    expect(second.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "MONO_DANGLING_PROOF_METADATA",
    ]);
  }

  expect(metadata.resourcePlaces.entries()).toHaveLength(1);
});

test("image-owned record with mismatched image id produces dangling diagnostic", () => {
  const imageOrigin: HirImageOrigin = {
    imageOriginId: {
      owner: { kind: "image", imageId: imageId(2) },
      id: hirImageOriginId(0),
    },
    imageId: imageId(2),
    sourceOrigin: hirOriginId(0),
  };
  const metadata = new HirProofMetadataBuilder().addImageOrigin(imageOrigin).build();
  const instantiations = new Set<string>();
  const result = instantiateImageOwnedRecord(
    {
      record: imageOrigin,
      key: { imageId: imageId(1), instanceId: monoInstanceIdForTest("img:1") },
    },
    instantiations,
  );

  expect(result.kind).toBe("duplicate");
  if (result.kind === "duplicate") {
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "MONO_DANGLING_PROOF_METADATA",
    ]);
  }

  expect(metadata.imageOrigins.entries()).toHaveLength(1);
});

test("proof metadata index groups image-owned records separately", () => {
  const imagePlace: HirResourcePlace = {
    placeId: ownedResourcePlaceId({ kind: "image", imageId: imageId(2) }, 0),
    canonicalKey: "image:2/root:local:0/projection:/type:error/kind:error",
    root: { kind: "local", localId: hirLocalId(0) },
    projection: [],
    type: errorCheckedType(),
    resourceKind: errorKind(),
    kind: "local",
    localId: hirLocalId(0),
    sourceOrigin: hirOriginId(0),
  };
  const metadata = new HirProofMetadataBuilder().addResourcePlace(imagePlace).build();
  const index = buildProofMetadataIndex(metadata);
  const imageRecords = index.recordsForOwner({ kind: "image", imageId: imageId(2) });
  const functionRecords = index.recordsForOwner({ kind: "function", functionId: functionId(0) });

  expect(imageRecords.resourcePlaces).toHaveLength(1);
  expect(functionRecords.resourcePlaces).toEqual([]);
});

test("proof metadata index groups type-owned records separately", () => {
  const program = proofMetadataProgramForMonoTest();
  const index = buildProofMetadataIndex(program.proofMetadata);
  const typeRecords = index.recordsForOwner({ kind: "type", typeId: typeId(0) });

  expect(typeRecords.resourcePlaces).toEqual([]);
  expect(typeRecords.obligations).toEqual([]);
});

test("instantiateMonoProofMetadata returns ok for empty proof metadata", () => {
  const program = proofMetadataProgramForMonoTest();
  const result = instantiateMonoProofMetadata({
    program,
    functionInstances: [],
    typeInstances: [],
    imageInstanceId: monoInstanceIdForTest("image:0"),
    canonicalInstanceKeys: new Map([[{ kind: "image", imageId: imageId(0) }, "image:0"]]),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.proofMetadata.obligations.entries()).toEqual([]);
    expect(result.proofMetadata.sessions.entries()).toEqual([]);
    expect(result.proofMetadata.brands.entries()).toEqual([]);
  }
});

test("instantiateMonoProofMetadata skips records whose owner is unreachable", () => {
  const program = proofMetadataProgramForMonoTest();
  const result = instantiateMonoProofMetadata({
    program,
    functionInstances: [],
    typeInstances: [],
    imageInstanceId: monoInstanceIdForTest("image:0"),
    canonicalInstanceKeys: new Map([[{ kind: "image", imageId: imageId(0) }, "image:0"]]),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.proofMetadata.obligations.entries()).toEqual([]);
    expect(result.proofMetadata.resourcePlaces.entries()).toEqual([]);
  }
});

test("instantiateMonoProofMetadata skips image-owned records for unselected images", () => {
  const imagePlace: HirResourcePlace = {
    placeId: ownedResourcePlaceId({ kind: "image", imageId: imageId(2) }, 0),
    canonicalKey: "image:2/root:local:0/projection:/type:core:u8/kind:Copy",
    root: { kind: "local", localId: hirLocalId(0) },
    projection: [],
    type: coreCheckedType(coreTypeId("u8")),
    resourceKind: concreteKind("Copy"),
    kind: "local",
    localId: hirLocalId(0),
    sourceOrigin: hirOriginId(0),
  };
  const metadata = new HirProofMetadataBuilder().addResourcePlace(imagePlace).build();
  const result = instantiateMonoProofMetadata({
    program: { ...proofMetadataProgramForMonoTest(), proofMetadata: metadata },
    functionInstances: [],
    typeInstances: [],
    imageInstanceId: monoInstanceIdForTest("image:1"),
    canonicalInstanceKeys: new Map([[{ kind: "image", imageId: imageId(1) }, "image:1"]]),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.proofMetadata.resourcePlaces.entries()).toEqual([]);
  }
});

test("function-owned proof metadata is cloned for every reachable generic instance", () => {
  const result = monomorphizeWholeImage({
    program: genericFunctionWithObligationProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const doStuffInstances = result.program.functions
      .entries()
      .filter((entry) => entry.sourceFunctionId === functionId(3));
    const resourcePlaces = result.program.proofMetadata.resourcePlaces
      .entries()
      .filter((entry) =>
        doStuffInstances.some((instance) => instance.instanceId === entry.placeId.instanceId),
      );
    const terminalCalls = result.program.proofMetadata.terminalCalls
      .entries()
      .filter((entry) =>
        doStuffInstances.some(
          (instance) => instance.instanceId === entry.terminalCallId.instanceId,
        ),
      );

    expect(doStuffInstances).toHaveLength(2);
    expect(resourcePlaces).toHaveLength(2);
    expect(terminalCalls).toHaveLength(2);
  }
});
