import type { ParsedModuleGraph } from "../../frontend";
import { SourceSpan } from "../../frontend";
import type { ItemIndex } from "../item-index";
import type { ResolvedPlatformBindings, ResolvedReferences } from "../names";
import { buildMemberNamespace } from "../names/member-namespace";
import type { CoreTypeCatalog } from "../names/core-types";
import type { SemanticTargetSurface } from "./platform-surface";
import { buildSurfaceReferenceLookup } from "./reference-lookup";
import { checkTypeReference } from "./type-reference-checker";
import { CheckedProgramBuilder } from "./checked-program";
import type { CheckedSemanticProgram } from "./checked-program";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { sortSemanticSurfaceDiagnostics } from "./diagnostics";
import { checkAllFunctionSignatures } from "./signature-checker";
import { checkGenericSignature } from "./generic-checker";
import { emptyKindContext, resourceKindForType } from "./resource-kind-checker";
import {
  completeDeferredMembers,
  deriveTypedOwnersFromSignatures,
} from "./deferred-member-completer";
import { checkImageDevices } from "./image-device-checker";
import type { CheckedImageDevice } from "./image-device-checker";
import { checkImageEntry } from "./image-entry-checker";
import { selectImageRoot } from "./image-root-selection";
import type { ImageRootSelection } from "./image-root-selection";
import { certifyPlatformBindings } from "./platform-certifier";
import { checkedProofSurface, requirementSurface, terminalSurface } from "./proof-surface";
import type { CheckedRequirementSurface, CheckedTerminalSurface } from "./proof-surface";
import { errorCheckedType } from "./type-model";
import type { ImageId, ImageProfileId, FunctionId } from "../ids";

export interface CheckSemanticSurfaceInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly imageRoot?: ImageRootSelection;
}

export interface CheckedImageSeed {
  readonly imageId: ImageId;
  readonly profileId: ImageProfileId;
  readonly entryFunctionId: FunctionId | undefined;
  readonly devices: readonly CheckedImageDevice[];
  readonly sourceSpan: SourceSpan;
}

export interface CheckSemanticSurfaceResult {
  readonly program: CheckedSemanticProgram;
  readonly image: CheckedImageSeed | undefined;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

export function checkSemanticSurface(input: CheckSemanticSurfaceInput): CheckSemanticSurfaceResult {
  const builder = new CheckedProgramBuilder();
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const referenceLookup = buildSurfaceReferenceLookup(input.references);
  const kindContext = emptyKindContext(input.coreTypes);

  const signaturesResult = checkAllFunctionSignatures({
    index: input.index,
    referenceLookup,
    coreTypes: input.coreTypes,
    kindContext,
  });
  diagnostics.push(...signaturesResult.diagnostics);

  for (const signature of signaturesResult.signatures.entries()) {
    builder.addFunctionSignature(signature);
  }

  for (const typeRecord of input.index.types()) {
    builder.addType({
      typeId: typeRecord.id,
      itemId: typeRecord.itemId,
      type: { kind: "source", itemId: typeRecord.itemId, typeId: typeRecord.id },
    });
    const genericResult = checkGenericSignature({
      owner: { kind: "item", itemId: typeRecord.itemId },
      index: input.index,
      referenceLookup,
      coreTypes: input.coreTypes,
    });
    diagnostics.push(...genericResult.diagnostics);
    for (const param of genericResult.signature.parameters) {
      builder.addGenericParameter({
        key: param.key,
        name: param.name,
        owner: genericResult.signature.owner,
        span: param.span,
      });
    }
  }

  for (const item of input.index.items()) {
    const fields = input.index.fieldsForItem(item.id);
    for (const fieldRecord of fields) {
      const fieldTypeResult = fieldRecord.type
        ? checkTypeReference({
            moduleId: item.moduleId,
            view: fieldRecord.type,
            index: input.index,
            referenceLookup,
            coreTypes: input.coreTypes,
          })
        : { type: errorCheckedType(), diagnostics: [] as readonly SemanticSurfaceDiagnostic[] };
      diagnostics.push(...fieldTypeResult.diagnostics);
      builder.addField({
        fieldId: fieldRecord.id,
        itemId: item.id,
        name: fieldRecord.name,
        type: fieldTypeResult.type,
        resourceKind: resourceKindForType({ type: fieldTypeResult.type, context: kindContext }),
        sourceSpan: fieldRecord.span,
      });
    }
  }

  for (const signature of signaturesResult.signatures.entries()) {
    if (signature.genericSignature !== undefined) {
      for (const param of signature.genericSignature.parameters) {
        builder.addGenericParameter({
          key: param.key,
          name: param.name,
          owner: signature.genericSignature.owner,
          span: param.span,
        });
      }
    }
  }

  const typedOwners = deriveTypedOwnersFromSignatures({
    signatures: signaturesResult.signatures,
    references: input.references,
  });

  const deferredResult = completeDeferredMembers({
    index: input.index,
    references: input.references,
    memberNamespace: buildMemberNamespace(input.index),
    typedOwners,
  });
  diagnostics.push(...deferredResult.diagnostics);

  for (const completed of deferredResult.completed.entries()) {
    builder.addCompletedMember(completed);
  }

  for (const failed of deferredResult.failedDeferred) {
    diagnostics.push({
      code: "SURFACE_UNRESOLVED_DEFERRED_MEMBER" as const,
      message: `Unresolved deferred member '${failed.memberName}'.`,
      severity: "error" as const,
      span: failed.memberSpan,
      order: {
        moduleId: failed.key.moduleId,
        span: failed.memberSpan,
        codeTieBreaker: "deferred",
      },
    });
  }

  const imageRootResult = selectImageRoot({
    index: input.index,
    targetSurface: input.targetSurface,
    imageRoot: input.imageRoot,
  });
  diagnostics.push(...imageRootResult.diagnostics);

  const requirements: CheckedRequirementSurface[] = [];
  const terminalSurfaces: CheckedTerminalSurface[] = [];
  for (const signature of signaturesResult.signatures.entries()) {
    const item = input.index.item(signature.itemId);
    if (item === undefined) continue;
    const declaration = item.declaration;
    if (declaration === undefined) continue;
    const requiresSections = (declaration as any).requiresSections?.() ?? [];
    for (const section of requiresSections) {
      for (const requirement of section.requirements()) {
        const reqExpr = requirement.expression();
        if (reqExpr === undefined) continue;
        const exprSource = reqExpr.source;
        const exprSpan = reqExpr.span;
        const exprText = exprSource.text.slice(exprSpan.start, exprSpan.end);
        requirements.push(
          requirementSurface({
            ownerFunctionId: signature.functionId,
            expression: {
              kind: "opaque",
              text: exprText,
            },
            span: exprSpan,
          }),
        );
      }
    }
    if (signature.modifiers.isTerminal) {
      terminalSurfaces.push(
        terminalSurface({
          functionId: signature.functionId,
          span: signature.sourceSpan,
        }),
      );
    }
  }
  builder.setProofSurfaceSeeds({ requirements, terminalSurfaces });
  const proofSurface = checkedProofSurface({ requirements, terminalSurfaces });

  const certAvailability =
    imageRootResult.selection !== undefined
      ? imageRootResult.selection.availability
      : {
          targetId: input.targetSurface.targetId,
          profileId: "" as ImageProfileId,
          features: [] as readonly string[],
        };

  const certResult = certifyPlatformBindings({
    index: input.index,
    platformBindings: input.platformBindings,
    signatures: signaturesResult.signatures,
    proofSurface,
    targetSurface: input.targetSurface,
    availability: certAvailability,
  });
  diagnostics.push(...certResult.diagnostics);

  for (const binding of certResult.bindings.entries()) {
    builder.addCertifiedPlatformBinding(binding);
  }

  let devices: readonly CheckedImageDevice[] = [];
  if (imageRootResult.selection !== undefined) {
    const deviceResult = checkImageDevices({
      selection: imageRootResult.selection,
      index: input.index,
      referenceLookup,
      coreTypes: input.coreTypes,
      targetSurface: input.targetSurface,
      kindContext,
    });
    devices = [...deviceResult.devices].sort(
      (left, right) => (left.fieldId as number) - (right.fieldId as number),
    );
    diagnostics.push(...deviceResult.diagnostics);
  }

  let entryFunctionId: FunctionId | undefined;
  if (imageRootResult.selection !== undefined) {
    const entryResult = checkImageEntry({
      selection: imageRootResult.selection,
      index: input.index,
      signatures: signaturesResult.signatures,
    });
    entryFunctionId = entryResult.entryFunctionId;
    diagnostics.push(...entryResult.diagnostics);
  }

  const program = builder.build();

  const imageRecord =
    imageRootResult.selection !== undefined
      ? input.index.image(imageRootResult.selection.imageId)
      : undefined;
  const imageSpan =
    imageRecord !== undefined
      ? (input.index.item(imageRecord.itemId)?.span ?? SourceSpan.from(0, 0))
      : SourceSpan.from(0, 0);

  const image: CheckedImageSeed | undefined =
    imageRootResult.selection !== undefined
      ? {
          imageId: imageRootResult.selection.imageId,
          profileId: imageRootResult.selection.profileId,
          entryFunctionId,
          devices,
          sourceSpan: imageSpan,
        }
      : undefined;

  return {
    program,
    image,
    diagnostics: sortSemanticSurfaceDiagnostics(diagnostics),
  };
}
