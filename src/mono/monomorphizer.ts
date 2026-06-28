import type { HirImage, TypedHirProgram } from "../hir/hir";
import type { HirOriginId } from "../hir/ids";
import type { FunctionId, ImageId, PlatformPrimitiveId, TypeId } from "../semantic/ids";
import type { CheckedType } from "../semantic/surface/type-model";
import { checkClosedMonoBoundary } from "./closed-boundary-checker";
import { monoDiagnostic, sortMonoDiagnostics, type MonoDiagnostic } from "./diagnostics";
import type {
  MonoCheckedType,
  MonoReachableFunctionReason,
  MonomorphizedHirProgram,
} from "./mono-hir";
import { runReachability } from "./reachability";
import { normalizeRootArguments } from "./mono-external-roots";

export {
  buildMonoExternalRoots,
  functionInstanceIdForExternalEntryRoot,
  normalizeRootArguments,
} from "./mono-external-roots";

export interface MonomorphizeWholeImageInput {
  readonly program: TypedHirProgram;
  readonly imageId?: ImageId;
}

export type MonomorphizeWholeImageResult =
  | {
      readonly kind: "ok";
      readonly program: MonomorphizedHirProgram;
      readonly diagnostics: readonly MonoDiagnostic[];
      readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export type SelectMonoImageRootResult =
  | { readonly kind: "ok"; readonly image: HirImage }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function monomorphizeWholeImage(
  input: MonomorphizeWholeImageInput,
): MonomorphizeWholeImageResult {
  const imageSelection = selectMonoImageRoot(input);
  if (imageSelection.kind === "error") {
    return {
      kind: "error",
      diagnostics: sortMonoDiagnostics(imageSelection.diagnostics),
    };
  }
  const reachResult = runReachability({
    program: input.program,
    image: imageSelection.image,
  });
  const errorDiagnostics = reachResult.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errorDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortMonoDiagnostics(reachResult.diagnostics),
    };
  }
  const boundary = checkClosedMonoBoundary({
    sourceProgram: input.program,
    program: reachResult.program,
    diagnostics: reachResult.diagnostics,
  });
  const boundaryErrors = boundary.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (boundaryErrors.length > 0) {
    return {
      kind: "error",
      diagnostics: sortMonoDiagnostics(boundary.diagnostics),
    };
  }
  return {
    kind: "ok",
    program: reachResult.program,
    diagnostics: sortMonoDiagnostics(boundary.diagnostics),
    reachablePlatformPrimitiveIds: reachResult.reachablePlatformPrimitiveIds,
  };
}

export function selectMonoImageRoot(input: MonomorphizeWholeImageInput): SelectMonoImageRootResult {
  if (input.imageId !== undefined) {
    return selectRequestedImage(input.program, input.imageId);
  }
  const images = input.program.images.entries();
  if (images.length === 0) {
    return {
      kind: "error",
      diagnostics: sortMonoDiagnostics([
        monoDiagnostic({
          severity: "error",
          code: "MONO_MISSING_SELECTED_IMAGE",
          message: "No images are present in the program; cannot select a monomorphization root.",
          ownerKey: "pre-image",
          rootCauseKey: "image-selection",
          stableDetail: "no-images",
        }),
      ]),
    };
  }
  if (images.length > 1) {
    return {
      kind: "error",
      diagnostics: sortMonoDiagnostics([
        monoDiagnostic({
          severity: "error",
          code: "MONO_AMBIGUOUS_SELECTED_IMAGE",
          message:
            "Program contains multiple images; an imageId must be provided to select a monomorphization root.",
          ownerKey: "pre-image",
          rootCauseKey: "image-selection",
          stableDetail: `count:${images.length}`,
        }),
      ]),
    };
  }
  const onlyImage = images[0];
  if (onlyImage === undefined) {
    return {
      kind: "error",
      diagnostics: sortMonoDiagnostics([
        monoDiagnostic({
          severity: "error",
          code: "MONO_MISSING_SELECTED_IMAGE",
          message: "Selected image is missing from the program.",
          ownerKey: "pre-image",
          rootCauseKey: "image-selection",
          stableDetail: "missing-only-image",
        }),
      ]),
    };
  }
  return validateSelectedImage(onlyImage);
}

function selectRequestedImage(
  program: TypedHirProgram,
  requestedImageId: ImageId,
): SelectMonoImageRootResult {
  const requested = program.images.get(requestedImageId);
  if (requested === undefined) {
    return {
      kind: "error",
      diagnostics: sortMonoDiagnostics([
        monoDiagnostic({
          severity: "error",
          code: "MONO_SELECTED_IMAGE_NOT_FOUND",
          message: `Requested image ${String(requestedImageId)} is not present in the program.`,
          ownerKey: `image:${requestedImageId}`,
          rootCauseKey: "image-selection",
          stableDetail: `not-found:${requestedImageId}`,
        }),
      ]),
    };
  }
  return validateSelectedImage(requested);
}

function validateSelectedImage(image: HirImage): SelectMonoImageRootResult {
  if (image.entryFunctionId === undefined) {
    return {
      kind: "error",
      diagnostics: sortMonoDiagnostics([
        monoDiagnostic({
          severity: "error",
          code: "MONO_SELECTED_IMAGE_ENTRY_MISSING",
          message: `Selected image ${String(image.imageId)} has no entry function.`,
          ownerKey: `image:${image.imageId}`,
          rootCauseKey: "image-entry",
          stableDetail: `no-entry:${image.imageId}`,
          sourceOrigin: String(image.sourceOrigin),
        }),
      ]),
    };
  }
  return { kind: "ok", image };
}

export type MonoRootWorkItem =
  | { readonly kind: "imageProofMetadata"; readonly imageId: ImageId }
  | {
      readonly kind: "function";
      readonly functionId: FunctionId;
      readonly ownerTypeId?: TypeId;
      readonly ownerTypeArguments: readonly MonoCheckedType[];
      readonly functionTypeArguments: readonly MonoCheckedType[];
    }
  | {
      readonly kind: "type";
      readonly typeId: TypeId;
      readonly typeArguments: readonly MonoCheckedType[];
    };

export interface SeedMonoRootWorkResult {
  readonly items: readonly MonoRootWorkItem[];
  readonly diagnostics: readonly MonoDiagnostic[];
}

export function seedMonoRootWork(input: {
  readonly program: TypedHirProgram;
  readonly image: HirImage;
}): readonly MonoRootWorkItem[] {
  return seedMonoRootWorkResult(input).items;
}

export function seedMonoRootWorkResult(input: {
  readonly program: TypedHirProgram;
  readonly image: HirImage;
}): SeedMonoRootWorkResult {
  const items: MonoRootWorkItem[] = [{ kind: "imageProofMetadata", imageId: input.image.imageId }];
  const diagnostics: MonoDiagnostic[] = [];
  if (input.image.entryFunctionId !== undefined) {
    const imageEntryRoot = input.program.monoClosure.externalEntryRoots.find(
      (root) => root.reason === "imageEntry" && root.functionId === input.image.entryFunctionId,
    );
    const sourceFunction = input.program.functions.get(input.image.entryFunctionId);
    const ownerTypeId = sourceFunction?.ownerTypeId;
    const ownerTypeArguments =
      imageEntryRoot !== undefined
        ? normalizeRootArguments({
            program: input.program,
            arguments: imageEntryRoot.ownerTypeArguments,
          })
        : { kind: "ok" as const, arguments: [] };
    const functionTypeArguments =
      imageEntryRoot !== undefined
        ? normalizeRootArguments({
            program: input.program,
            arguments: imageEntryRoot.functionTypeArguments,
          })
        : { kind: "ok" as const, arguments: [] };
    if (ownerTypeArguments.kind === "error") diagnostics.push(...ownerTypeArguments.diagnostics);
    if (functionTypeArguments.kind === "error") {
      diagnostics.push(...functionTypeArguments.diagnostics);
    }
    if (ownerTypeArguments.kind === "ok" && functionTypeArguments.kind === "ok") {
      items.push({
        kind: "function",
        functionId: input.image.entryFunctionId,
        ...(ownerTypeId !== undefined ? { ownerTypeId } : {}),
        ownerTypeArguments: ownerTypeArguments.arguments,
        functionTypeArguments: functionTypeArguments.arguments,
      });
    }
  }
  const deviceRoots = deviceTypeRootWorkItems(input);
  items.push(...deviceRoots.items);
  diagnostics.push(...deviceRoots.diagnostics);
  for (const root of input.program.monoClosure.externalEntryRoots) {
    if (root.reason === "imageEntry") continue;
    const ownerTypeArguments = normalizeRootArguments({
      program: input.program,
      arguments: root.ownerTypeArguments,
    });
    const functionTypeArguments = normalizeRootArguments({
      program: input.program,
      arguments: root.functionTypeArguments,
    });
    if (ownerTypeArguments.kind === "error") diagnostics.push(...ownerTypeArguments.diagnostics);
    if (functionTypeArguments.kind === "error") {
      diagnostics.push(...functionTypeArguments.diagnostics);
    }
    if (ownerTypeArguments.kind === "error" || functionTypeArguments.kind === "error") continue;
    const sourceFunction = input.program.functions.get(root.functionId);
    const ownerTypeId = sourceFunction?.ownerTypeId;
    items.push({
      kind: "function",
      functionId: root.functionId,
      ...(ownerTypeId !== undefined ? { ownerTypeId } : {}),
      ownerTypeArguments: ownerTypeArguments.arguments,
      functionTypeArguments: functionTypeArguments.arguments,
    });
  }
  return { items, diagnostics };
}

function deviceTypeRootWorkItems(input: {
  readonly program: TypedHirProgram;
  readonly image: HirImage;
}): SeedMonoRootWorkResult {
  const items: MonoRootWorkItem[] = [];
  const diagnostics: MonoDiagnostic[] = [];
  for (const device of input.image.devices) {
    const typeRoot = sourceTypeRootFromCheckedType({
      program: input.program,
      type: device.place.type,
    });
    if (typeRoot.kind === "ok") {
      items.push(typeRoot.item);
    } else if (typeRoot.kind === "error") {
      diagnostics.push(...typeRoot.diagnostics);
    }
  }
  return {
    items: items.sort((left, right) =>
      rootWorkItemKey(left) < rootWorkItemKey(right)
        ? -1
        : rootWorkItemKey(left) > rootWorkItemKey(right)
          ? 1
          : 0,
    ),
    diagnostics,
  };
}

type SourceTypeRootResult =
  | { readonly kind: "ok"; readonly item: MonoRootWorkItem }
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

function sourceTypeRootFromCheckedType(input: {
  readonly program: TypedHirProgram;
  readonly type: CheckedType;
}): SourceTypeRootResult {
  switch (input.type.kind) {
    case "source":
      return {
        kind: "ok",
        item: { kind: "type", typeId: input.type.typeId, typeArguments: [] },
      };
    case "applied":
      if (input.type.constructor.kind !== "source") return { kind: "none" };
      const normalizedArguments = normalizeRootArguments({
        program: input.program,
        arguments: input.type.arguments,
      });
      if (normalizedArguments.kind === "error") return normalizedArguments;
      return {
        kind: "ok",
        item: {
          kind: "type",
          typeId: input.type.constructor.typeId,
          typeArguments: normalizedArguments.arguments,
        },
      };
    default:
      return { kind: "none" };
  }
}

function rootWorkItemKey(item: MonoRootWorkItem): string {
  switch (item.kind) {
    case "imageProofMetadata":
      return `0:image:${item.imageId}`;
    case "function":
      return `1:function:${item.functionId}:${item.ownerTypeId ?? "none"}`;
    case "type":
      return `2:type:${item.typeId}`;
  }
}
