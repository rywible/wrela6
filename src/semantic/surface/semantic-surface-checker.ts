import type { ParsedModuleGraph } from "../../frontend";
import { SourceSpan } from "../../frontend";
import type { ItemIndex } from "../item-index";
import type { ResolvedPlatformBindings, ResolvedReferences } from "../names";
import type { CoreTypeCatalog } from "../names/core-types";
import type { SemanticTargetSurface } from "./platform-surface";
import { buildSurfaceReferenceLookup } from "./reference-lookup";
import { CheckedProgramBuilder } from "./checked-program";
import { buildValidatedBufferFieldModels } from "./validated-buffer-field-model";
import type { CheckedSemanticProgram } from "./checked-program";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { sortSemanticSurfaceDiagnostics } from "./diagnostics";
import { checkAllFunctionSignatures } from "./signature-checker";
import { checkGenericSignature } from "./generic-checker";
import { resourceKindForType } from "./resource-kind-checker";
import { checkImageDevices } from "./image-device-checker";
import type { CheckedImageDevice } from "./image-device-checker";
import { checkImageEntry } from "./image-entry-checker";
import { selectImageRoot } from "./image-root-selection";
import type { ImageRootSelection } from "./image-root-selection";
import { certifyPlatformBindings } from "./platform-certifier";
import { checkedProofSurface } from "./proof-surface";
import {
  CheckedConstructibilitySurfaceTableBuilder,
  CheckedTakeModeSurfaceTableBuilder,
  CheckedValidationContractSurfaceTableBuilder,
  CheckedAttemptContractSurfaceTableBuilder,
  CheckedPrivateTransitionSurfaceTableBuilder,
  CheckedPlatformEnsuredFactSurfaceTableBuilder,
  populateConstructibilitySurfaces,
  populateTakeModeSurfaces,
  populateValidationContractSurfaces,
  populateAttemptContractSurfaces,
  populatePrivateTransitionSurfaces,
  populatePlatformEnsuredFactSurfaces,
} from "./proof-contracts";
import { checkedTypeFingerprint } from "./type-model";
import { buildSemanticMonoClosureFacts } from "./mono-closure-builder";
import type { ImageId, ImageProfileId, FunctionId } from "../ids";
import { collectCompilerIntrinsicCalls } from "./compiler-intrinsic-collector";
import { collectProofSurfaces } from "./proof-surface-collector";
import { checkDataclassResources } from "./dataclass-resource-checker";
import { recursionCycleDiagnostics } from "./recursion-cycle-diagnostics";
import {
  constructibilityConstructorAuthorities,
  constructibilityDeclarationAuthorities,
  constructibilityImageAuthorities,
  constructibilityPlatformAuthorities,
  privateTransitionsFromSignatures,
  resolveCanonicalStdlibContractTypeIds,
  sourceAttemptContractsFromSignatures,
  sourceValidationContractsFromSignatures,
} from "./contract-type-identity";

export interface CheckSemanticSurfaceInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly imageRoot?: ImageRootSelection;
  readonly enabledFeatures?: readonly string[];
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

function validatedBufferDeclarations(input: CheckSemanticSurfaceInput) {
  return input.index
    .items()
    .filter((item) => item.kind === "validatedBuffer" && item.typeId !== undefined)
    .map((item) => ({
      typeId: item.typeId!,
      validatedBufferTypeId: item.typeId!,
      span: item.span,
    }));
}

export function checkSemanticSurface(input: CheckSemanticSurfaceInput): CheckSemanticSurfaceResult {
  const builder = new CheckedProgramBuilder();
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const referenceLookup = buildSurfaceReferenceLookup(input.references);
  const contractTypeIds = resolveCanonicalStdlibContractTypeIds(input.index);

  // Phase 1: type declarations, generic parameters, and field types
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
        bounds: param.bounds,
        span: param.span,
      });
    }
  }

  // Phase 2: field type checking + resource-kind fixpoint
  const kindContext = checkDataclassResources({
    index: input.index,
    referenceLookup,
    coreTypes: input.coreTypes,
    targetSurface: input.targetSurface,
    builder,
    diagnostics,
  });
  builder.setValidatedBufferFieldModels(buildValidatedBufferFieldModels(input.index).entries());

  // Phase 3: function signature checking with populated kind context
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

  for (const signature of signaturesResult.signatures.entries()) {
    if (signature.genericSignature !== undefined) {
      for (const param of signature.genericSignature.parameters) {
        builder.addGenericParameter({
          key: param.key,
          name: param.name,
          owner: signature.genericSignature.owner,
          bounds: param.bounds,
          span: param.span,
        });
      }
    }
  }
  const declarationProofSurface = collectProofSurfaces({
    surfaceInput: input,
    builder,
    signatures: signaturesResult.signatures,
    referenceLookup,
    diagnostics,
  });
  builder.setProofSurface(declarationProofSurface);

  const imageRootResult = selectImageRoot({
    index: input.index,
    targetSurface: input.targetSurface,
    imageRoot: input.imageRoot,
    enabledFeatures: input.enabledFeatures,
  });
  diagnostics.push(...imageRootResult.diagnostics);

  // Platform certification always runs for shape/name/catalog/contract checks.
  // Target/profile/feature availability is conditional on image-root selection (already handled inside certifier).
  const certResult = certifyPlatformBindings({
    index: input.index,
    platformBindings: input.platformBindings,
    signatures: signaturesResult.signatures,
    proofSurface: declarationProofSurface,
    targetSurface: input.targetSurface,
    availability: imageRootResult.selection?.availability,
    availablePlatformFamilies: imageRootResult.selection?.profile.availablePlatformFamilies,
  });
  diagnostics.push(...certResult.diagnostics);
  for (const binding of certResult.bindings.entries()) {
    builder.addCertifiedPlatformBinding(binding);
  }

  collectCompilerIntrinsicCalls(input, referenceLookup, builder, diagnostics);

  let devices: readonly CheckedImageDevice[] = [];
  const checkedProgramBeforeProof = builder.build();
  diagnostics.push(
    ...recursionCycleDiagnostics({
      index: input.index,
      references: input.references,
      program: checkedProgramBeforeProof,
    }),
  );
  const checkedFields = checkedProgramBeforeProof.fields;
  if (imageRootResult.selection !== undefined) {
    const deviceResult = checkImageDevices({
      selection: imageRootResult.selection,
      index: input.index,
      checkedFields,
      targetSurface: input.targetSurface,
      kindContext,
    });
    devices = deviceResult.devices;
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

  const imageRecord =
    imageRootResult.selection !== undefined
      ? input.index.image(imageRootResult.selection.imageId)
      : undefined;
  const imageSpan =
    imageRecord !== undefined
      ? (input.index.item(imageRecord.itemId)?.span ?? SourceSpan.from(0, 0))
      : SourceSpan.from(0, 0);

  const image: CheckedImageSeed | undefined =
    imageRootResult.selection !== undefined && entryFunctionId !== undefined
      ? {
          imageId: imageRootResult.selection.imageId,
          profileId: imageRootResult.selection.profileId,
          entryFunctionId,
          devices,
          sourceSpan: imageSpan,
        }
      : undefined;

  const typeResourceKindSurfaces = checkedProgramBeforeProof.types.entries().map((typeRecord) => ({
    fingerprint: checkedTypeFingerprint(typeRecord.type),
    resourceKind: resourceKindForType({ type: typeRecord.type, context: kindContext }),
    span: input.index.item(typeRecord.itemId)?.span,
  }));
  const fieldResourceKindSurfaces = checkedFields.entries().map((field) => ({
    fingerprint: checkedTypeFingerprint(field.type),
    resourceKind: field.resourceKind,
    span: field.sourceSpan,
  }));
  const privateStateSurfaces = input.index
    .items()
    .filter((item) => item.kind === "class" && item.modifiers.includes("private"))
    .map((item) => ({ span: item.span }));

  const validatedBuffers = validatedBufferDeclarations(input);
  const constructibilitySourceTypes = checkedProgramBeforeProof.types
    .entries()
    .flatMap((typeRecord) => {
      const item = input.index.item(typeRecord.itemId);
      if (item === undefined) return [];
      return [
        {
          typeId: typeRecord.typeId,
          resourceKind: resourceKindForType({ type: typeRecord.type, context: kindContext }),
          span: item.span,
        },
      ];
    });
  const constructibilityBuilder = new CheckedConstructibilitySurfaceTableBuilder();
  populateConstructibilitySurfaces(constructibilityBuilder, {
    sourceTypes: constructibilitySourceTypes,
    constructors: constructibilityConstructorAuthorities({
      signatures: signaturesResult.signatures,
    }),
    validatedBuffers,
    explicitSpecialAuthorities: [
      ...constructibilityDeclarationAuthorities({ sourceTypes: constructibilitySourceTypes }),
      ...constructibilityImageAuthorities(devices),
      ...constructibilityPlatformAuthorities({ program: checkedProgramBeforeProof }),
    ],
  });

  const takeModeBuilder = new CheckedTakeModeSurfaceTableBuilder();
  const certifiedTakeModeSurfaces = certResult.bindings
    .entries()
    .flatMap((binding) => binding.takeModeSurfaces ?? []);
  populateTakeModeSurfaces(takeModeBuilder, {
    streamProducers: certifiedTakeModeSurfaces.flatMap((surface) =>
      surface.kind === "stream"
        ? [
            {
              producerFunctionId: surface.producerFunctionId,
              itemType: surface.itemType,
              itemResourceKind: surface.itemResourceKind,
              takeOnlyStream: true,
              span: surface.span,
            },
          ]
        : [],
    ),
    bufferSources: certifiedTakeModeSurfaces.flatMap((surface) =>
      surface.kind === "buffer"
        ? [
            {
              sourceTypeId: surface.sourceTypeId,
              bufferResourceKind: surface.bufferResourceKind,
              bufferObligation: true,
              span: surface.span,
            },
          ]
        : [],
    ),
    validatedBuffers,
  });

  const validationContractBuilder = new CheckedValidationContractSurfaceTableBuilder();
  populateValidationContractSurfaces(validationContractBuilder, {
    contracts: [
      ...sourceValidationContractsFromSignatures({
        signatures: signaturesResult.signatures,
        index: input.index,
        contractTypeIds,
      }),
      ...certResult.bindings.entries().flatMap((binding) => binding.validationContracts ?? []),
    ],
  });

  const attemptContractBuilder = new CheckedAttemptContractSurfaceTableBuilder();
  populateAttemptContractSurfaces(attemptContractBuilder, {
    contracts: [
      ...sourceAttemptContractsFromSignatures({
        signatures: signaturesResult.signatures,
        index: input.index,
        contractTypeIds,
      }),
      ...certResult.bindings.entries().flatMap((binding) => binding.attemptContracts ?? []),
    ],
  });

  const privateTransitionBuilder = new CheckedPrivateTransitionSurfaceTableBuilder();
  populatePrivateTransitionSurfaces(privateTransitionBuilder, {
    transitions: privateTransitionsFromSignatures({ signatures: signaturesResult.signatures }),
  });

  const platformEnsuredFactBuilder = new CheckedPlatformEnsuredFactSurfaceTableBuilder();
  populatePlatformEnsuredFactSurfaces(platformEnsuredFactBuilder, {
    certifiedBindings: certResult.bindings.entries().map((binding) => ({
      sourceFunctionId: binding.functionId,
      primitiveId: binding.primitiveId,
      contractId: binding.contractId,
      targetId: binding.targetId,
      ensuredFacts: binding.ensuredFacts ?? [],
    })),
  });

  const proofSurface = checkedProofSurface({
    resourceKindByType: [...typeResourceKindSurfaces, ...fieldResourceKindSurfaces],
    signatureModes: signaturesResult.signatures.entries().map((signature) => ({
      functionId: signature.functionId,
      signature,
    })),
    requirements: declarationProofSurface.requirementSurfaces.entries(),
    predicateFactSurfaces: declarationProofSurface.predicateFactSurfaces.entries(),
    terminalSurfaces: declarationProofSurface.terminalSurfaces.entries(),
    privateStateSurfaces,
    imageSurfaces: devices.map((device) => ({ device })),
    platformContracts: certResult.bindings,
    constructibilitySurfaces: constructibilityBuilder.build(),
    takeModeSurfaces: takeModeBuilder.build(),
    validationContracts: validationContractBuilder.build(),
    attemptContracts: attemptContractBuilder.build(),
    privateTransitions: privateTransitionBuilder.build(),
    platformEnsuredFacts: platformEnsuredFactBuilder.build(),
    matchRefinements: declarationProofSurface.matchRefinements,
  });
  builder.setProofSurface(proofSurface);
  builder.build();

  const monoClosureFacts = buildSemanticMonoClosureFacts({
    index: input.index,
    kindContext,
    targetSurface: input.targetSurface,
    image,
    program: checkedProgramBeforeProof,
  });
  builder.setMonoClosureFacts(monoClosureFacts);
  const programWithMonoClosure = builder.build();

  return {
    program: programWithMonoClosure,
    image,
    diagnostics: sortSemanticSurfaceDiagnostics(diagnostics),
  };
}
