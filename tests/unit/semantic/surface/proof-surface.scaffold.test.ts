import { expect, test } from "bun:test";
import {
  functionId,
  parameterId,
  typeId,
  platformPrimitiveId,
  platformContractId,
  targetId,
  coreTypeId,
} from "../../../../src/semantic/ids";
import { SourceText } from "../../../../src/frontend";
import {
  checkedProofSurface,
  checkedProofSurfaceEmpty,
  requirementSurface,
  terminalSurface,
} from "../../../../src/semantic/surface/proof-surface";
import {
  CheckedConstructibilitySurfaceTableBuilder,
  CheckedTakeModeSurfaceTableBuilder,
  CheckedAttemptContractSurfaceTableBuilder,
  CheckedValidationContractSurfaceTableBuilder,
  CheckedPrivateTransitionSurfaceTableBuilder,
  CheckedPlatformEnsuredFactSurfaceTableBuilder,
  CheckedMatchRefinementSurfaceTableBuilder,
  emptyCheckedConstructibilitySurfaceTable,
  emptyCheckedTakeModeSurfaceTable,
  emptyCheckedAttemptContractSurfaceTable,
  emptyCheckedValidationContractSurfaceTable,
  emptyCheckedPrivateTransitionSurfaceTable,
  emptyCheckedPlatformEnsuredFactSurfaceTable,
  emptyCheckedMatchRefinementSurfaceTable,
} from "../../../../src/semantic/surface/proof-contracts";
import type {
  CheckedConstructibilitySurface,
  CheckedTakeModeSurface,
  CheckedAttemptContractSurface,
  CheckedValidationContractSurface,
  CheckedPrivateTransitionSurface,
  CheckedPlatformEnsuredFactSurface,
  CheckedMatchRefinementSurface,
} from "../../../../src/semantic/surface/proof-contracts";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";

const source = SourceText.from("test.wr", "fn test(): requires x.valid\n");
const span = source.span(10, 18);
const expression = { kind: "opaque" as const, text: "x.valid" };

test("proof surface scaffold preserves existing requirement and terminal tables", () => {
  const surface = checkedProofSurface({
    requirements: [requirementSurface({ ownerFunctionId: functionId(1), expression, span })],
    terminalSurfaces: [terminalSurface({ functionId: functionId(1), span })],
  });

  expect(surface.requirementSurfaces.get(functionId(1))).toHaveLength(1);
  expect(surface.terminalSurfaces.get(functionId(1))).toBeDefined();
  expect(surface.constructibilitySurfaces.entries()).toEqual([]);
});

test("checkedProofSurface exposes all new scaffold tables empty by default", () => {
  const surface = checkedProofSurface({});

  expect(surface.constructibilitySurfaces.entries()).toEqual([]);
  expect(surface.takeModeSurfaces.entries()).toEqual([]);
  expect(surface.validationContracts.entries()).toEqual([]);
  expect(surface.attemptContracts.entries()).toEqual([]);
  expect(surface.privateTransitions.entries()).toEqual([]);
  expect(surface.platformEnsuredFacts.entries()).toEqual([]);
  expect(surface.matchRefinements.entries()).toEqual([]);
});

test("checkedProofSurfaceEmpty exposes all new scaffold tables empty by default", () => {
  const surface = checkedProofSurfaceEmpty();

  expect(surface.constructibilitySurfaces.entries()).toEqual([]);
  expect(surface.takeModeSurfaces.entries()).toEqual([]);
  expect(surface.validationContracts.entries()).toEqual([]);
  expect(surface.attemptContracts.entries()).toEqual([]);
  expect(surface.privateTransitions.entries()).toEqual([]);
  expect(surface.platformEnsuredFacts.entries()).toEqual([]);
  expect(surface.matchRefinements.entries()).toEqual([]);
});

test("empty table factories return empty results", () => {
  expect(emptyCheckedConstructibilitySurfaceTable().get(typeId(0))).toEqual([]);
  expect(emptyCheckedConstructibilitySurfaceTable().entries()).toEqual([]);
  expect(emptyCheckedTakeModeSurfaceTable().entries()).toEqual([]);
  expect(emptyCheckedAttemptContractSurfaceTable().get(functionId(0))).toEqual([]);
  expect(emptyCheckedAttemptContractSurfaceTable().entries()).toEqual([]);
  expect(emptyCheckedValidationContractSurfaceTable().entries()).toEqual([]);
  expect(emptyCheckedPrivateTransitionSurfaceTable().get(functionId(0))).toEqual([]);
  expect(emptyCheckedPrivateTransitionSurfaceTable().entries()).toEqual([]);
  expect(emptyCheckedPlatformEnsuredFactSurfaceTable().entries()).toEqual([]);
  expect(emptyCheckedMatchRefinementSurfaceTable().entries()).toEqual([]);
});

test("constructibility builder sorts by typeId then constructorFunctionId then sourceOrigin", () => {
  const laterType: CheckedConstructibilitySurface = {
    typeId: typeId(2),
    constructorFunctionId: functionId(5),
    authorization: "ordinary",
    sourceOrigin: span,
  };
  const earlierType: CheckedConstructibilitySurface = {
    typeId: typeId(1),
    constructorFunctionId: functionId(10),
    authorization: "privateStateMint",
    sourceOrigin: span,
  };
  const sameTypeUndefinedCtor: CheckedConstructibilitySurface = {
    typeId: typeId(1),
    authorization: "streamMint",
    sourceOrigin: span,
  };

  const builder = new CheckedConstructibilitySurfaceTableBuilder();
  builder.add(laterType);
  builder.add(sameTypeUndefinedCtor);
  builder.add(earlierType);
  const table = builder.build();

  const entries = table.entries();
  expect(entries.map((entry) => entry.typeId)).toEqual([typeId(1), typeId(1), typeId(2)]);
  expect(entries[0]!.constructorFunctionId).toBeUndefined();
  expect(entries[1]!.constructorFunctionId).toBe(functionId(10));
  expect(table.get(typeId(1))).toHaveLength(2);
  expect(table.get(typeId(2))).toHaveLength(1);
  expect(table.get(typeId(99))).toEqual([]);
});

test("take mode builder sorts by kind then id then span", () => {
  const validated: CheckedTakeModeSurface = {
    kind: "validatedBuffer",
    validatedBufferTypeId: typeId(3),
    span,
  };
  const stream: CheckedTakeModeSurface = {
    kind: "stream",
    producerFunctionId: functionId(1),
    itemType: coreCheckedType(coreTypeId("u32")),
    itemResourceKind: concreteKind("Stream"),
    span,
  };
  const buffer: CheckedTakeModeSurface = {
    kind: "buffer",
    sourceTypeId: typeId(0),
    bufferResourceKind: concreteKind("ValidatedBuffer"),
    span,
  };

  const builder = new CheckedTakeModeSurfaceTableBuilder();
  builder.add(validated);
  builder.add(stream);
  builder.add(buffer);
  const table = builder.build();

  expect(table.entries().map((entry) => entry.kind)).toEqual([
    "buffer",
    "stream",
    "validatedBuffer",
  ]);
});

test("attempt contract builder sorts by fallibleFunctionId and keys lookups", () => {
  const later: CheckedAttemptContractSurface = {
    fallibleFunctionId: functionId(2),
    resultType: coreCheckedType(coreTypeId("u32")),
    okType: coreCheckedType(coreTypeId("u32")),
    errType: coreCheckedType(coreTypeId("u32")),
    inputs: [{ kind: "receiver" }],
    span,
  };
  const earlier: CheckedAttemptContractSurface = {
    fallibleFunctionId: functionId(1),
    resultType: coreCheckedType(coreTypeId("u32")),
    okType: coreCheckedType(coreTypeId("u32")),
    errType: coreCheckedType(coreTypeId("u32")),
    inputs: [{ kind: "parameter", parameterId: parameterId(0) }],
    span,
  };

  const builder = new CheckedAttemptContractSurfaceTableBuilder();
  builder.add(later);
  builder.add(earlier);
  const table = builder.build();

  expect(table.entries().map((entry) => entry.fallibleFunctionId)).toEqual([
    functionId(1),
    functionId(2),
  ]);
  expect(table.get(functionId(1))).toHaveLength(1);
  expect(table.get(functionId(2))).toHaveLength(1);
  expect(table.get(functionId(99))).toEqual([]);
});

test("validation contract builder sorts by validatedBufferTypeId then sourceParameterId", () => {
  const withParam: CheckedValidationContractSurface = {
    validatedBufferTypeId: typeId(1),
    resultType: coreCheckedType(coreTypeId("u32")),
    sourceType: coreCheckedType(coreTypeId("u32")),
    okPayloadType: coreCheckedType(coreTypeId("u32")),
    errPayloadType: coreCheckedType(coreTypeId("u32")),
    sourceParameterId: parameterId(4),
    span,
  };
  const withoutParam: CheckedValidationContractSurface = {
    validatedBufferTypeId: typeId(1),
    resultType: coreCheckedType(coreTypeId("u32")),
    sourceType: coreCheckedType(coreTypeId("u32")),
    okPayloadType: coreCheckedType(coreTypeId("u32")),
    errPayloadType: coreCheckedType(coreTypeId("u32")),
    span,
  };

  const builder = new CheckedValidationContractSurfaceTableBuilder();
  builder.add(withParam);
  builder.add(withoutParam);
  const table = builder.build();

  const entries = table.entries();
  expect(entries.map((entry) => entry.sourceParameterId)).toEqual([undefined, parameterId(4)]);
});

test("private transition builder sorts by functionId then kind and keys lookups", () => {
  const advance: CheckedPrivateTransitionSurface = {
    functionId: functionId(1),
    kind: "advance",
    span,
  };
  const predicate: CheckedPrivateTransitionSurface = {
    functionId: functionId(1),
    kind: "predicate",
    span,
  };

  const builder = new CheckedPrivateTransitionSurfaceTableBuilder();
  builder.add(advance);
  builder.add(predicate);
  const table = builder.build();

  expect(table.entries().map((entry) => entry.kind)).toEqual(["advance", "predicate"]);
  expect(table.get(functionId(1))).toHaveLength(2);
  expect(table.get(functionId(99))).toEqual([]);
});

test("platform ensured fact builder sorts by sourceFunctionId then primitiveId", () => {
  const bFact: CheckedPlatformEnsuredFactSurface = {
    sourceFunctionId: functionId(1),
    primitiveId: platformPrimitiveId("primitive_b"),
    contractId: platformContractId("contract_b"),
    targetId: targetId("target_b"),
    fingerprint: "fp_b",
    fact: { kind: "state", stateKind: "closed", argumentBindings: [] },
  };
  const aFact: CheckedPlatformEnsuredFactSurface = {
    sourceFunctionId: functionId(1),
    primitiveId: platformPrimitiveId("primitive_a"),
    contractId: platformContractId("contract_a"),
    targetId: targetId("target_a"),
    fingerprint: "fp_a",
    fact: { kind: "state", stateKind: "advanced", argumentBindings: [] },
  };

  const builder = new CheckedPlatformEnsuredFactSurfaceTableBuilder();
  builder.add(bFact);
  builder.add(aFact);
  const table = builder.build();

  expect(table.entries().map((entry) => entry.primitiveId)).toEqual([
    platformPrimitiveId("primitive_a"),
    platformPrimitiveId("primitive_b"),
  ]);
});

test("match refinement builder sorts by matchStatementKey then scrutineeKey", () => {
  const later: CheckedMatchRefinementSurface = {
    matchStatementKey: "match:b",
    scrutineeKey: "scrut:b",
    variantReferenceKey: "variant:b",
    fieldBindingKeys: [],
    span,
  };
  const earlier: CheckedMatchRefinementSurface = {
    matchStatementKey: "match:a",
    scrutineeKey: "scrut:a",
    variantReferenceKey: "variant:a",
    fieldBindingKeys: [],
    span,
  };

  const builder = new CheckedMatchRefinementSurfaceTableBuilder();
  builder.add(later);
  builder.add(earlier);
  const table = builder.build();

  expect(table.entries().map((entry) => entry.matchStatementKey)).toEqual(["match:a", "match:b"]);
});
