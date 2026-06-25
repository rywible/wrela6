import { describe, expect, test } from "bun:test";
import {
  coreTypeId,
  fieldId,
  functionId,
  imageId,
  platformContractId,
  platformPrimitiveId,
  targetId,
  typeId,
  uniqueEdgeRootKey,
} from "../../../src/semantic/ids";
import { concreteKind } from "../../../src/semantic/surface/resource-kind";
import { coreCheckedType } from "../../../src/semantic/surface/type-model";
import {
  hirExpressionId,
  hirLocalId,
  hirOriginId,
  ownedBrandId,
  ownedFactOriginId,
  ownedHirPlatformContractEdgeId,
  ownedPrivateStateTransitionId,
  ownedResourcePlaceId,
  ownedValidationId,
  validationId,
} from "../../../src/hir/ids";
import { HirBrandRegistry } from "../../../src/hir/brand-registry";
import { HirProofMetadataBuilder, emptyHirProofMetadata } from "../../../src/hir/proof-metadata";
import type {
  HirBrand,
  HirFactOrigin,
  HirPlatformContractEdge,
  HirPrivateStateTransition,
  HirResourcePlace,
  HirValidation,
} from "../../../src/hir/hir";

const functionOwner = { kind: "function" as const, functionId: functionId(7) };
const imageOwner = { kind: "image" as const, imageId: imageId(3) };
const u32Type = coreCheckedType(coreTypeId("u32"));
const copyKind = concreteKind("Copy");

describe("HIR proof metadata", () => {
  test("empty proof metadata exposes all tables", () => {
    const metadata = emptyHirProofMetadata();

    expect(metadata.obligations.entries()).toEqual([]);
    expect(metadata.sessions.entries()).toEqual([]);
    expect(metadata.brands.entries()).toEqual([]);
    expect(metadata.resourcePlaces.entries()).toEqual([]);
    expect(metadata.callSiteRequirements.entries()).toEqual([]);
    expect(metadata.validations.entries()).toEqual([]);
    expect(metadata.attempts.entries()).toEqual([]);
    expect(metadata.terminalCalls.entries()).toEqual([]);
    expect(metadata.privateStateTransitions.entries()).toEqual([]);
    expect(metadata.factOrigins.entries()).toEqual([]);
    expect(metadata.platformContractEdges.entries()).toEqual([]);
    expect(metadata.imageOrigins.entries()).toEqual([]);
  });

  test("builder appends records, exposes staged tables, and builds metadata", () => {
    const place: HirResourcePlace = {
      placeId: ownedResourcePlaceId(functionOwner, 2),
      canonicalKey: "function:7/root:local:5/projection:/type:core:u32/kind:concrete:Copy",
      root: { kind: "local", localId: hirLocalId(5) },
      projection: [],
      type: u32Type,
      resourceKind: copyKind,
      kind: "local",
      localId: hirLocalId(5),
      sourceOrigin: hirOriginId(1),
    };
    const factOrigin: HirFactOrigin = {
      factOriginId: ownedFactOriginId(functionOwner, 1),
      content: { kind: "ensure", expressionId: hirExpressionId(4) },
      sourceOrigin: hirOriginId(2),
    };
    const edge: HirPlatformContractEdge = {
      edgeId: ownedHirPlatformContractEdgeId(imageOwner, 0),
      sourceFunctionId: functionId(9),
      primitiveId: platformPrimitiveId("spi"),
      contractId: platformContractId("write"),
      targetId: targetId("mcu"),
      ensuredFacts: [],
      sourceOrigin: hirOriginId(3),
    };

    const builder = new HirProofMetadataBuilder()
      .addResourcePlace(place)
      .addFactOrigin(factOrigin)
      .addPlatformContractEdge(edge);

    expect(builder.count("resourcePlace")).toBe(1);
    expect(builder.count("factOrigin")).toBe(1);
    expect(builder.count("platformContractEdge")).toBe(1);
    expect(builder.factOrigins.entries()).toEqual([factOrigin]);
    expect(builder.resourcePlaces.get(place.placeId)).toEqual(place);

    const metadata = builder.build();
    expect(metadata.resourcePlaces.entries()).toEqual([place]);
    expect(metadata.factOrigins.entries()).toEqual([factOrigin]);
    expect(metadata.platformContractEdges.entries()).toEqual([edge]);
  });

  test("metadata tables use deterministic key ordering", () => {
    const later: HirValidation = {
      validationId: ownedValidationId(functionOwner, 10),
      validationExpressionId: hirExpressionId(2),
      sourcePlace: {
        placeId: ownedResourcePlaceId(functionOwner, 10),
        canonicalKey: "function:7/root:temporary:0/projection:/type:core:u32/kind:concrete:Copy",
        root: { kind: "temporary", ordinal: 0 },
        projection: [],
        type: u32Type,
        resourceKind: copyKind,
        kind: "temporary",
        sourceOrigin: hirOriginId(1),
      },
      pendingResultPlace: {
        placeId: ownedResourcePlaceId(functionOwner, 11),
        canonicalKey: "function:7/root:temporary:1/projection:/type:core:u32/kind:concrete:Copy",
        root: { kind: "temporary", ordinal: 1 },
        projection: [],
        type: u32Type,
        resourceKind: copyKind,
        kind: "temporary",
        sourceOrigin: hirOriginId(1),
      },
      validatedBufferTypeId: typeId(1),
      okPayloadType: { kind: "core", coreTypeId: coreTypeId("u32") },
      errPayloadType: { kind: "core", coreTypeId: coreTypeId("u32") },
      sourceOrigin: hirOriginId(1),
    };
    const earlier: HirValidation = {
      ...later,
      validationId: ownedValidationId(functionOwner, 2),
      validationExpressionId: hirExpressionId(1),
    };

    const metadata = new HirProofMetadataBuilder()
      .addValidation(later)
      .addValidation(earlier)
      .build();

    expect(metadata.validations.entries().map((validation) => validation.validationId.id)).toEqual([
      validationId(2),
      validationId(10),
    ]);
  });

  test("builder exposes indexed counts and validation lookups without staged table reads", () => {
    const sourcePlace: HirResourcePlace = {
      placeId: ownedResourcePlaceId(functionOwner, 20),
      canonicalKey: "source-place",
      root: { kind: "temporary", ordinal: 0 },
      projection: [],
      type: u32Type,
      resourceKind: copyKind,
      kind: "temporary",
      sourceOrigin: hirOriginId(1),
    };
    const pendingResultPlace: HirResourcePlace = {
      placeId: ownedResourcePlaceId(functionOwner, 21),
      canonicalKey: "pending-place",
      root: { kind: "temporary", ordinal: 1 },
      projection: [],
      type: u32Type,
      resourceKind: copyKind,
      kind: "temporary",
      sourceOrigin: hirOriginId(1),
    };
    const validation: HirValidation = {
      validationId: ownedValidationId(functionOwner, 0),
      validationExpressionId: hirExpressionId(12),
      sourcePlace,
      pendingResultPlace,
      validatedBufferTypeId: typeId(1),
      okPayloadType: u32Type,
      errPayloadType: u32Type,
      sourceOrigin: hirOriginId(1),
    };
    const transition: HirPrivateStateTransition = {
      transitionId: ownedPrivateStateTransitionId(functionOwner, 0),
      functionId: functionId(4),
      kind: "advance",
      place: sourcePlace,
      transitionOrdinalForPlace: 0,
      sourceOrigin: hirOriginId(2),
    };

    const builder = new HirProofMetadataBuilder()
      .addBrand({
        brandId: ownedBrandId(functionOwner, 0),
        canonicalKey: "function:7:take:0",
        origin: { kind: "functionTake", functionId: functionId(7), statementOrdinal: 0 },
        sourceOrigin: hirOriginId(1),
      })
      .addValidation(validation)
      .addPrivateStateTransition(transition);

    expect(builder.countBrandsForFunction(functionId(7))).toBe(1);
    expect(builder.countBrandsForFunction(functionId(8))).toBe(0);
    expect(builder.countPrivateStateTransitionsForPlace("source-place")).toBe(1);
    expect(builder.countPrivateStateTransitionsForPlace("other-place")).toBe(0);
    expect(builder.findValidationByExpressionId(hirExpressionId(12))).toEqual(validation);
    expect(builder.findValidationByPendingResultPlaceKey("pending-place")).toEqual(validation);
    expect(builder.hasValidationPendingResultType(u32Type)).toBe(true);
    expect(builder.hasValidationPendingResultType(coreCheckedType(coreTypeId("bool")))).toBe(false);
  });

  test("brand registry deterministically allocates global and function brands", () => {
    const registry = new HirBrandRegistry();

    registry.reserveImageFieldRootBrand({
      imageId: imageId(2),
      fieldId: fieldId(3),
      uniqueEdgeRootKey: uniqueEdgeRootKey("root-b"),
    });
    registry.reserveFunctionTakeBrand({ functionId: functionId(5), statementOrdinal: 8 });
    registry.reservePlatformContractBrand({
      sourceFunctionId: functionId(1),
      primitiveId: platformPrimitiveId("gpio"),
      contractId: platformContractId("pin"),
      targetId: targetId("avr"),
    });
    registry.reserveFunctionSessionBrand({ functionId: functionId(5), ordinal: 1 });
    registry.reserveFunctionValidationBrand({ functionId: functionId(5), ordinal: 0 });

    const brands = registry.allocateBrands();

    expect(brands.map((brand) => brand.canonicalKey)).toEqual([
      "image:2:field:3:root:root-b",
      "platform:1:primitive:gpio:contract:pin:target:avr",
      "function:5:session:1",
      "function:5:take:8",
      "function:5:validation:0",
    ]);
    expect(brands.map((brand) => brand.brandId)).toEqual([
      ownedBrandId({ kind: "image", imageId: imageId(2) }, 0),
      ownedBrandId({ kind: "function", functionId: functionId(1) }, 0),
      ownedBrandId({ kind: "function", functionId: functionId(5) }, 0),
      ownedBrandId({ kind: "function", functionId: functionId(5) }, 1),
      ownedBrandId({ kind: "function", functionId: functionId(5) }, 2),
    ]);
  });

  test("brand registry gives platform and session brands distinct ids for the same function", () => {
    const registry = new HirBrandRegistry();

    registry.reservePlatformContractBrand({
      sourceFunctionId: functionId(5),
      primitiveId: platformPrimitiveId("gpio"),
      contractId: platformContractId("pin"),
      targetId: targetId("avr"),
    });
    registry.reserveFunctionSessionBrand({ functionId: functionId(5), ordinal: 0 });

    const brands = registry.allocateBrands();

    expect(brands.map((brand) => brand.brandId)).toEqual([
      ownedBrandId({ kind: "function", functionId: functionId(5) }, 0),
      ownedBrandId({ kind: "function", functionId: functionId(5) }, 1),
    ]);
  });

  test("brand registry preserves canonical keys for reusable metadata records", () => {
    const registry = new HirBrandRegistry();
    const key = registry.reserveImageFieldRootBrand({
      imageId: imageId(3),
      fieldId: fieldId(4),
      uniqueEdgeRootKey: uniqueEdgeRootKey("root-a"),
    });
    const duplicate = registry.reserveImageFieldRootBrand({
      imageId: imageId(3),
      fieldId: fieldId(4),
      uniqueEdgeRootKey: uniqueEdgeRootKey("root-a"),
    });

    const brands: readonly HirBrand[] = registry.allocateBrands();
    expect(key).toBe("image:3:field:4:root:root-a");
    expect(duplicate).toBe(key);
    expect(brands).toHaveLength(1);
    expect(brands[0]?.canonicalKey).toBe(key);
  });
});
