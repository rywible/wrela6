import { SourceSpan } from "../../frontend";
import type { ImageId, ImageProfileId, ItemId, ModuleId, TargetId } from "../ids";
import { moduleId } from "../ids";
import type { ImageRecord } from "../item-index";
import type { ItemIndex } from "../item-index";
import type { ImageProfileSpec, SemanticTargetSurface } from "./platform-surface";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import {
  ambiguousImageRoot,
  invalidImageEntryShape,
  invalidImageRootSelection,
  missingImageRoot,
} from "./diagnostics";

export type ImageRootSelection =
  | { readonly kind: "byImageId"; readonly imageId: ImageId }
  | { readonly kind: "byQualifiedName"; readonly modulePath: string; readonly imageName: string };

export interface TargetAvailabilityContext {
  readonly targetId: TargetId;
  readonly profileId: ImageProfileId;
  readonly features: readonly string[];
}

export interface CheckedImageRootSelection {
  readonly imageId: ImageId;
  readonly itemId: ItemId;
  readonly profileId: ImageProfileId;
  readonly availability: TargetAvailabilityContext;
  readonly image: ImageRecord;
  readonly profile: ImageProfileSpec;
}

export interface SelectImageRootInput {
  readonly index: ItemIndex;
  readonly targetSurface: SemanticTargetSurface;
  readonly imageRoot?: ImageRootSelection;
}

export interface SelectImageRootResult {
  readonly selection: CheckedImageRootSelection | undefined;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function zeroOrder(): { moduleId: ModuleId; span: SourceSpan; codeTieBreaker: string } {
  return { moduleId: moduleId(0), span: SourceSpan.from(0, 0), codeTieBreaker: "image" };
}

export function selectImageRoot(input: SelectImageRootInput): SelectImageRootResult {
  const images = input.index.images();

  if (images.length === 0) {
    return {
      selection: undefined,
      diagnostics: [missingImageRoot(undefined, undefined, zeroOrder())],
    };
  }

  if (input.imageRoot !== undefined) {
    return resolveExplicitSelection(input, images);
  }

  if (images.length === 1) {
    return resolveSingleImage(input, images[0]!);
  }

  const names = images.map((img) => img.name);
  return {
    selection: undefined,
    diagnostics: [ambiguousImageRoot(names, undefined, undefined, zeroOrder())],
  };
}

function resolveSingleImage(
  input: SelectImageRootInput,
  image: ImageRecord,
): SelectImageRootResult {
  const profile = input.targetSurface.imageProfiles.find((prof) => prof.declarationKind === "uefi");

  if (profile === undefined) {
    return {
      selection: undefined,
      diagnostics: [
        invalidImageEntryShape(
          "No UEFI image profile found in target surface",
          undefined,
          undefined,
          zeroOrder(),
        ),
      ],
    };
  }

  return {
    selection: {
      imageId: image.id,
      itemId: image.itemId,
      profileId: profile.profileId,
      availability: {
        targetId: input.targetSurface.targetId,
        profileId: profile.profileId,
        features: [],
      },
      image,
      profile,
    },
    diagnostics: [],
  };
}

function resolveExplicitSelection(
  input: SelectImageRootInput,
  images: readonly ImageRecord[],
): SelectImageRootResult {
  const root = input.imageRoot!;
  let selectedImage: ImageRecord | undefined;

  if (root.kind === "byImageId") {
    selectedImage = images.find((img) => img.id === root.imageId);
  } else {
    const module = input.index.moduleByPath(root.modulePath);
    if (module !== undefined) {
      selectedImage = images.find(
        (img) => img.moduleId === module.id && img.name === root.imageName,
      );
    }
  }

  if (selectedImage === undefined) {
    return {
      selection: undefined,
      diagnostics: [
        invalidImageRootSelection("Selected image not found", undefined, undefined, zeroOrder()),
      ],
    };
  }

  return resolveSingleImage(input, selectedImage);
}
