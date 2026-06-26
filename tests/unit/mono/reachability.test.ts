import { describe, expect, test } from "bun:test";
import {
  type MonoRootWorkItem,
  type SelectMonoImageRootResult,
  monomorphizeWholeImage,
  seedMonoRootWork,
  selectMonoImageRoot,
} from "../../../src/mono/monomorphizer";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import { hirOriginId } from "../../../src/hir/ids";
import type {
  HirFunction,
  HirImage,
  HirSourceTypeKindRecord,
  HirTypeRecord,
  TypedHirProgram,
} from "../../../src/hir/hir";
import { hirTable } from "../../../src/hir/hir-table";
import { coreTypeId, functionId, imageId, itemId } from "../../../src/semantic/ids";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import {
  minimalClosedProgramForMonoTest,
  minimalSelectedImageProgramForMonoTest,
  functionSignatureSourceTypeClosureProgramForMonoTest,
  imageDeviceProgramForMonoTest,
  mutualFunctionRecursionProgramForMonoTest,
  ownerMethodInstantiationProgramForMonoTest,
  twoCallSitesSameGenericInstanceProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";
import { typeId } from "../../../src/semantic/ids";
import {
  coreCheckedType,
  errorCheckedType,
  sourceCheckedType,
} from "../../../src/semantic/surface/type-model";
import { concreteKind, type TypeParameterKey } from "../../../src/semantic/surface/resource-kind";

function imageWithoutEntry(): HirImage {
  return {
    imageId: imageId(1),
    itemId: itemId(0),
    devices: [],
    sourceOrigin: hirOriginId(0),
  };
}

function genericImageEntryRootProgramForMonoTest(): TypedHirProgram {
  const base = minimalClosedProgramForMonoTest();
  const image = base.images.entries()[0];
  const entryFunctionId = image?.entryFunctionId;
  if (entryFunctionId === undefined) throw new Error("expected image entry");
  const entryFunction = base.functions.get(entryFunctionId);
  if (entryFunction === undefined) throw new Error("expected entry function");
  const parameter: TypeParameterKey = {
    owner: { kind: "function", itemId: entryFunction.itemId, functionId: entryFunction.functionId },
    index: 0,
  };
  const genericEntryFunction: HirFunction = {
    ...entryFunction,
    declaredTypeParameters: [parameter],
  };
  return {
    ...base,
    functions: hirTable({
      entries: base.functions
        .entries()
        .map((entry) =>
          entry.functionId === genericEntryFunction.functionId ? genericEntryFunction : entry,
        ),
      keyOf: (entry: HirFunction) => String(entry.functionId).padStart(12, "0"),
      lookupKeyOf: (id: HirFunction["functionId"]) => String(id).padStart(12, "0"),
    }),
    monoClosure: {
      ...base.monoClosure,
      externalEntryRoots: [
        ...base.monoClosure.externalEntryRoots.filter(
          (root) => !(root.reason === "imageEntry" && root.functionId === entryFunctionId),
        ),
        {
          functionId: entryFunctionId,
          ownerTypeArguments: [],
          functionTypeArguments: [coreCheckedType(coreTypeId("u8"))],
          reason: "imageEntry" as const,
          sourceOrigin: entryFunction.sourceOrigin,
        },
      ],
    },
  };
}

function invalidUnusedRootArgumentProgramForMonoTest(): TypedHirProgram {
  const base = genericImageEntryRootProgramForMonoTest();
  const image = base.images.entries()[0];
  const entryFunctionId = image?.entryFunctionId;
  if (entryFunctionId === undefined) throw new Error("expected image entry");
  const missingConstructorType: HirTypeRecord = {
    typeId: typeId(404),
    itemId: itemId(404),
    sourceKind: "class",
    declaredTypeParameters: [],
    fieldIds: [],
    enumCases: [],
    resourceKind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
  };
  const missingConstructorKind: HirSourceTypeKindRecord = {
    typeId: missingConstructorType.typeId,
    kind: concreteKind("Copy"),
    sourceOrigin: hirOriginId(0),
  };
  return {
    ...base,
    types: hirTable({
      entries: [...base.types.entries(), missingConstructorType],
      keyOf: (entry: HirTypeRecord) => String(entry.typeId).padStart(12, "0"),
      lookupKeyOf: (id: HirTypeRecord["typeId"]) => String(id).padStart(12, "0"),
    }),
    monoClosure: {
      ...base.monoClosure,
      sourceTypeKinds: hirTable({
        entries: [...base.monoClosure.sourceTypeKinds.entries(), missingConstructorKind],
        keyOf: (entry: HirSourceTypeKindRecord) => String(entry.typeId).padStart(12, "0"),
        lookupKeyOf: (id: HirSourceTypeKindRecord["typeId"]) => String(id).padStart(12, "0"),
      }),
      externalEntryRoots: base.monoClosure.externalEntryRoots.map((root) =>
        root.reason === "imageEntry" && root.functionId === entryFunctionId
          ? {
              ...root,
              functionTypeArguments: [
                sourceCheckedType({
                  itemId: missingConstructorType.itemId,
                  typeId: missingConstructorType.typeId,
                }),
              ],
            }
          : root,
      ),
    },
  };
}

function reversedCallSiteOrderProgramForMonoTest(): TypedHirProgram {
  const source = [
    "fn id[U](value: U) -> U:",
    "    return value",
    "uefi image Boot:",
    "    fn main() -> u32:",
    "        id[u32](0)",
    "        return id[u32](1)",
  ].join("\n");
  const result = lowerTypedHirForTest([["main.wr", source]]);
  const program = result.program;
  const image = program.images.entries()[0];
  const entryFunctionId = image?.entryFunctionId;
  if (entryFunctionId === undefined) throw new Error("expected image entry");
  const entryFunction = program.functions.get(entryFunctionId);
  if (entryFunction?.body === undefined) throw new Error("expected entry function body");
  const reversedEntryFunction: HirFunction = {
    ...entryFunction,
    body: {
      ...entryFunction.body,
      statements: [...entryFunction.body.statements].reverse(),
    },
  };

  return {
    ...program,
    functions: hirTable({
      entries: program.functions
        .entries()
        .map((entry) =>
          entry.functionId === reversedEntryFunction.functionId ? reversedEntryFunction : entry,
        ),
      keyOf: (entry: HirFunction) => String(entry.functionId).padStart(12, "0"),
      lookupKeyOf: (id: HirFunction["functionId"]) => String(id).padStart(12, "0"),
    }),
  };
}

describe("selectMonoImageRoot", () => {
  test("returns missing-selected-image when program has no images", () => {
    const program = minimalSelectedImageProgramForMonoTest({ images: [] });
    const result: SelectMonoImageRootResult = selectMonoImageRoot({ program });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        monoDiagnosticCode("MONO_MISSING_SELECTED_IMAGE"),
      ]);
    }
  });

  test("returns ambiguous-selected-image when program has more than one image", () => {
    const first = minimalSelectedImageProgramForMonoTest().images.entries()[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const second: HirImage = { ...first, imageId: imageId(99) };
    const program = minimalSelectedImageProgramForMonoTest({ images: [first, second] });
    const result = selectMonoImageRoot({ program });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        monoDiagnosticCode("MONO_AMBIGUOUS_SELECTED_IMAGE"),
      ]);
    }
  });

  test("returns selected-image-not-found when imageId is requested but absent", () => {
    const program = minimalSelectedImageProgramForMonoTest();
    const result = selectMonoImageRoot({ program, imageId: imageId(404) });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        monoDiagnosticCode("MONO_SELECTED_IMAGE_NOT_FOUND"),
      ]);
    }
  });

  test("returns selected-image-entry-missing when the image has no entry function", () => {
    const program = minimalSelectedImageProgramForMonoTest({
      images: [imageWithoutEntry()],
    });
    const result = selectMonoImageRoot({ program });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        monoDiagnosticCode("MONO_SELECTED_IMAGE_ENTRY_MISSING"),
      ]);
      expect(result.diagnostics[0]?.sourceOrigin).toBe(String(hirOriginId(0)));
    }
  });

  test("returns ok for the unique image when imageId is omitted", () => {
    const program = minimalSelectedImageProgramForMonoTest();
    const result = selectMonoImageRoot({ program });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.image.entryFunctionId).toBeDefined();
    }
  });

  test("returns ok for the requested image when imageId matches", () => {
    const program = minimalSelectedImageProgramForMonoTest();
    const result = selectMonoImageRoot({ program, imageId: imageId(0) });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.image.imageId).toBe(imageId(0));
    }
  });

  test("does not start graph work and returns sorted diagnostics on error", () => {
    const program = minimalSelectedImageProgramForMonoTest({ images: [] });
    const result = monomorphizeWholeImage({ program });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  test("explicit imageId is honored when multiple images are present", () => {
    const first = minimalClosedProgramForMonoTest().images.entries()[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const second: HirImage = { ...first, imageId: imageId(99), itemId: itemId(99) };
    const base = minimalClosedProgramForMonoTest();
    const program = {
      ...base,
      images: hirTable({
        entries: [first, second],
        keyOf: (image) => `${image.imageId}`,
        lookupKeyOf: (id) => `${id}`,
      }),
    };
    const result = monomorphizeWholeImage({ program, imageId: second.imageId });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.program.image.imageId).toBe(second.imageId);
    }
  });
});

describe("seedMonoRootWork", () => {
  test("emits imageProofMetadata and function work items for the entry function", () => {
    const program = minimalSelectedImageProgramForMonoTest();
    const selected = selectMonoImageRoot({ program });
    expect(selected.kind).toBe("ok");
    if (selected.kind !== "ok") return;

    const items: readonly MonoRootWorkItem[] = seedMonoRootWork({
      program,
      image: selected.image,
    });
    expect(items.map((item) => item.kind)).toEqual(["imageProofMetadata", "function"]);
    const functionItem = items[1];
    expect(functionItem).toBeDefined();
    if (functionItem?.kind === "function") {
      expect(functionItem.ownerTypeId).toBeUndefined();
      expect(functionItem.ownerTypeArguments).toEqual([]);
      expect(functionItem.functionTypeArguments).toEqual([]);
    }
  });

  test("produces deterministic ordering across multiple invocations", () => {
    const program = minimalSelectedImageProgramForMonoTest();
    const selected = selectMonoImageRoot({ program });
    expect(selected.kind).toBe("ok");
    if (selected.kind !== "ok") return;

    const first = seedMonoRootWork({ program, image: selected.image });
    const second = seedMonoRootWork({ program, image: selected.image });
    expect(first).toEqual(second);
  });
});

describe("monomorphizeWholeImage reachability", () => {
  test("minimal non-generic image closes before proof and platform phases", () => {
    const program = minimalClosedProgramForMonoTest();
    const result = monomorphizeWholeImage({ program });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.program.functions.entries().length).toBeGreaterThan(0);
      expect(result.program.types.entries()).toEqual([]);
      expect(result.program.proofMetadata.obligations.entries()).toEqual([]);
      expect(result.reachablePlatformPrimitiveIds).toEqual([]);
      expect(result.program.origins.originRecords()).toEqual(program.origins.originRecords());
    }
  });

  test("image device metadata is retained in the mono image", () => {
    const program = imageDeviceProgramForMonoTest();
    const result = monomorphizeWholeImage({ program });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const device = result.program.image.devices[0];
      expect(device).toBeDefined();
      expect(result.program.image.devices).toHaveLength(1);
      if (device === undefined) return;
      expect(device.place.root).toMatchObject({
        kind: "imageDevice",
        imageId: result.program.image.imageId,
      });
      expect(device.place.resourceKind).toBe("UniqueEdgeRoot");
      expect(device.rootPlaces).toHaveLength(2);
      expect(device.rootPlaces.map((place) => place.resourceKind)).toEqual([
        "UniqueEdgeRoot",
        "UniqueEdgeRoot",
      ]);
      expect(device.brandIds).toHaveLength(2);
      expect(result.program.proofMetadata.imageOrigins.entries()).toHaveLength(
        program.proofMetadata.imageOrigins.entries().length,
      );
      expect(
        result.program.proofMetadata.imageOrigins
          .entries()
          .map((origin) => origin.imageOriginId.owner),
      ).toEqual(
        Array.from({ length: program.proofMetadata.imageOrigins.entries().length }, () => ({
          kind: "image",
          instanceId: result.program.image.instanceId,
        })),
      );
    }
  });

  test("function signatures and type fields close over source types", () => {
    const result = monomorphizeWholeImage({
      program: functionSignatureSourceTypeClosureProgramForMonoTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.program.types.entries().map((entry) => entry.sourceTypeId)).toEqual([
        typeId(40),
        typeId(41),
      ]);
      expect(
        result.program.instantiationGraph.edges
          .filter((edge) => edge.targetKind === "type")
          .map((edge) => String(edge.source.kind)),
      ).toEqual(["function", "type"]);
    }
  });

  test("two call sites dedupe to one generic function instance and retain two graph edges", () => {
    const result = monomorphizeWholeImage({
      program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const identityInstances = result.program.functions
        .entries()
        .filter((entry) => entry.sourceFunctionId === functionId(9));
      const incomingEdges = result.program.instantiationGraph.edges.filter(
        (edge) => edge.targetInstanceId === identityInstances[0]?.instanceId,
      );

      expect(identityInstances).toHaveLength(1);
      expect(incomingEdges).toHaveLength(2);
    }
  });

  test("call-site graph edges use a canonical tie breaker for identical source and target instances", () => {
    const result = monomorphizeWholeImage({
      program: reversedCallSiteOrderProgramForMonoTest(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const callExpressionIds: number[] = [];
      for (const edge of result.program.instantiationGraph.edges) {
        if (edge.source.kind === "function" && edge.source.callExpressionId !== undefined) {
          callExpressionIds.push(Number(edge.source.callExpressionId.hirId));
        }
      }
      expect(callExpressionIds).toHaveLength(2);
      expect(callExpressionIds).toEqual([...callExpressionIds].sort((left, right) => left - right));
    }
  });

  test("mutual function recursion is rejected", () => {
    const result = monomorphizeWholeImage({ program: mutualFunctionRecursionProgramForMonoTest() });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_RECURSIVE_FUNCTION_CYCLE"),
    );
  });

  test("invalid external root type arguments produce closure diagnostics", () => {
    const base = ownerMethodInstantiationProgramForMonoTest();
    const program = {
      ...base,
      monoClosure: {
        ...base.monoClosure,
        externalEntryRoots: base.monoClosure.externalEntryRoots.map((root) =>
          root.reason === "targetRequired"
            ? { ...root, ownerTypeArguments: [errorCheckedType()] }
            : root,
        ),
      },
    };

    const result = monomorphizeWholeImage({ program });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_RESOURCE_KIND"),
    );
  });

  test("invalid unused root argument normalization emits closure diagnostics", () => {
    const result = monomorphizeWholeImage({
      program: invalidUnusedRootArgumentProgramForMonoTest(),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_MISSING_CONSTRUCTOR_KIND_RULE"),
    );
  });

  test("generic image entry records the concrete entry function instance id", () => {
    const result = monomorphizeWholeImage({ program: genericImageEntryRootProgramForMonoTest() });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const entryFunctionInstanceId = result.program.image.entryFunctionInstanceId;
      expect(entryFunctionInstanceId).toBeDefined();
      expect(
        result.program.functions
          .entries()
          .some((entry) => entry.instanceId === entryFunctionInstanceId),
      ).toBe(true);
    }
  });
});
