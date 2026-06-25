import type {
  FieldId,
  FunctionId,
  ImageId,
  PlatformContractId,
  PlatformPrimitiveId,
  TargetId,
  UniqueEdgeRootKey,
} from "../semantic/ids";
import type { HirBrand, HirBrandCanonicalKey, HirBrandOrigin } from "./hir";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { ownedBrandId } from "./ids";

interface ReservedBrand {
  readonly canonicalKey: HirBrandCanonicalKey;
  readonly origin: HirBrandOrigin;
}

function functionIdFromOrigin(origin: HirBrandOrigin): FunctionId | undefined {
  switch (origin.kind) {
    case "platformToken":
      return origin.sourceFunctionId;
    case "functionSession":
    case "functionValidation":
    case "functionTake":
      return origin.functionId;
    case "imageDevice":
      return undefined;
  }
}

function imageIdFromOrigin(origin: HirBrandOrigin): ImageId | undefined {
  return origin.kind === "imageDevice" ? origin.imageId : undefined;
}

export class HirBrandRegistry {
  private readonly reserved = new Map<HirBrandCanonicalKey, ReservedBrand>();

  reserveImageFieldRootBrand(input: {
    readonly imageId: ImageId;
    readonly fieldId: FieldId;
    readonly uniqueEdgeRootKey: UniqueEdgeRootKey;
  }): HirBrandCanonicalKey {
    return this.reserve({
      canonicalKey: `image:${input.imageId}:field:${input.fieldId}:root:${input.uniqueEdgeRootKey}`,
      origin: {
        kind: "imageDevice",
        imageId: input.imageId,
        fieldId: input.fieldId,
        uniqueEdgeRootKey: input.uniqueEdgeRootKey,
      },
    });
  }

  reservePlatformContractBrand(input: {
    readonly sourceFunctionId: FunctionId;
    readonly primitiveId: PlatformPrimitiveId;
    readonly contractId: PlatformContractId;
    readonly targetId: TargetId;
  }): HirBrandCanonicalKey {
    return this.reserve({
      canonicalKey: `platform:${input.sourceFunctionId}:primitive:${input.primitiveId}:contract:${input.contractId}:target:${input.targetId}`,
      origin: {
        kind: "platformToken",
        sourceFunctionId: input.sourceFunctionId,
        primitiveId: input.primitiveId,
        contractId: input.contractId,
        targetId: input.targetId,
      },
    });
  }

  reserveFunctionSessionBrand(input: {
    readonly functionId: FunctionId;
    readonly ordinal: number;
  }): HirBrandCanonicalKey {
    return this.reserve({
      canonicalKey: `function:${input.functionId}:session:${input.ordinal}`,
      origin: {
        kind: "functionSession",
        functionId: input.functionId,
        ordinal: input.ordinal,
      },
    });
  }

  reserveFunctionValidationBrand(input: {
    readonly functionId: FunctionId;
    readonly ordinal: number;
  }): HirBrandCanonicalKey {
    return this.reserve({
      canonicalKey: `function:${input.functionId}:validation:${input.ordinal}`,
      origin: {
        kind: "functionValidation",
        functionId: input.functionId,
        ordinal: input.ordinal,
      },
    });
  }

  reserveFunctionTakeBrand(input: {
    readonly functionId: FunctionId;
    readonly statementOrdinal: number;
  }): HirBrandCanonicalKey {
    return this.reserve({
      canonicalKey: `function:${input.functionId}:take:${input.statementOrdinal}`,
      origin: {
        kind: "functionTake",
        functionId: input.functionId,
        statementOrdinal: input.statementOrdinal,
      },
    });
  }

  allocateBrands(): readonly HirBrand[] {
    const reserved = [...this.reserved.values()];
    const ordinalsByOwner = new Map<string, number>();
    const imageBrands = reserved
      .filter((brand) => brand.origin.kind === "imageDevice")
      .sort(compareReservedBrands);
    const platformBrands = reserved
      .filter((brand) => brand.origin.kind === "platformToken")
      .sort(compareReservedBrands);
    const functionBrands = reserved
      .filter((brand) => brand.origin.kind.startsWith("function"))
      .sort(compareReservedBrands);

    return [
      ...this.allocateGroup(imageBrands, ordinalsByOwner),
      ...this.allocateGroup(platformBrands, ordinalsByOwner),
      ...this.allocateGroup(functionBrands, ordinalsByOwner),
    ];
  }

  private reserve(brand: ReservedBrand): HirBrandCanonicalKey {
    const existing = this.reserved.get(brand.canonicalKey);
    if (existing === undefined) {
      this.reserved.set(brand.canonicalKey, brand);
    }
    return brand.canonicalKey;
  }

  private allocateGroup(
    brands: readonly ReservedBrand[],
    ordinalsByOwner: Map<string, number>,
  ): HirBrand[] {
    return brands.map((brand) => {
      const functionId = functionIdFromOrigin(brand.origin);
      const imageId = imageIdFromOrigin(brand.origin);
      const owner =
        imageId !== undefined
          ? ({ kind: "image", imageId } as const)
          : ({ kind: "function", functionId: functionId! } as const);
      const ownerKey =
        owner.kind === "image" ? `image:${owner.imageId}` : `function:${owner.functionId}`;
      const ordinal = ordinalsByOwner.get(ownerKey) ?? 0;
      ordinalsByOwner.set(ownerKey, ordinal + 1);
      return {
        brandId: ownedBrandId(owner, ordinal),
        canonicalKey: brand.canonicalKey,
        origin: brand.origin,
      };
    });
  }
}

function compareReservedBrands(left: ReservedBrand, right: ReservedBrand): number {
  return compareCodeUnitStrings(left.canonicalKey, right.canonicalKey);
}
