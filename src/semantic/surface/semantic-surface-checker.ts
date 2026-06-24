import type { ParsedModuleGraph } from "../../frontend";
import { SourceSpan, presentTokenSpan } from "../../frontend";
import type { FieldRecord, ItemRecord } from "../item-index";
import type { ItemIndex } from "../item-index";
import type { ResolvedPlatformBindings, ResolvedReferences } from "../names";
import { buildMemberNamespace } from "../names/member-namespace";
import type { CoreTypeCatalog } from "../names/core-types";
import type { SemanticTargetSurface } from "./platform-surface";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import { buildSurfaceReferenceLookup, syntaxReferenceKeyToString } from "./reference-lookup";
import { checkTypeReference } from "./type-reference-checker";
import { CheckedProgramBuilder } from "./checked-program";
import type {
  CheckedFunctionSignatureTable,
  CheckedSemanticProgram,
  CompletedMemberReference,
} from "./checked-program";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { sortSemanticSurfaceDiagnostics, unresolvedDeferredMember } from "./diagnostics";
import { checkAllFunctionSignatures } from "./signature-checker";
import { checkGenericSignature } from "./generic-checker";
import { emptyKindContext, resourceKindForType } from "./resource-kind-checker";
import type { ResourceKindContext } from "./resource-kind-checker";
import type { CheckedResourceKind } from "./resource-kind";
import { joinResourceKinds, resourceKindFingerprint } from "./resource-kind";
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
import type {
  CheckedProofSurface,
  CheckedRequirementSurface,
  CheckedTerminalSurface,
  CheckedRequirementReference,
  CheckedRequirementExpression,
} from "./proof-surface";
import {
  CheckedConstructibilitySurfaceTableBuilder,
  CheckedTakeModeSurfaceTableBuilder,
  CheckedValidationContractSurfaceTableBuilder,
  CheckedAttemptContractSurfaceTableBuilder,
  CheckedPrivateTransitionSurfaceTableBuilder,
  CheckedPlatformEnsuredFactSurfaceTableBuilder,
  CheckedMatchRefinementSurfaceTableBuilder,
} from "./proof-contracts";
import type { CheckedType } from "./type-model";
import { checkedTypeFingerprint, errorCheckedType } from "./type-model";
import type { ImageId, ImageProfileId, FunctionId, ItemId, ModuleId, ParameterId } from "../ids";
import { FunctionDeclarationView } from "../../frontend/ast/function-views";
import type { ExpressionView } from "../../frontend/ast/expression-views";
import {
  MemberAccessExpressionView,
  expressionViewFrom,
} from "../../frontend/ast/expression-views";
import { RedNode } from "../../frontend/syntax";

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

// ── Helper: check field types and derive resource-kind context via fixpoint ──

function checkFieldTypesAndBuildKinds(
  input: CheckSemanticSurfaceInput,
  builder: CheckedProgramBuilder,
  referenceLookup: SurfaceReferenceLookup,
  diagnostics: SemanticSurfaceDiagnostic[],
): ResourceKindContext {
  interface FieldEntry {
    readonly field: FieldRecord;
    readonly item: ItemRecord;
    readonly type: CheckedType;
  }
  const fieldEntries: FieldEntry[] = [];
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
      fieldEntries.push({ field: fieldRecord, item, type: fieldTypeResult.type });
    }
  }

  let sourceTypeKinds = new Map<import("../ids").TypeId, CheckedResourceKind>();
  let prevFingerprint = "";
  const emptyCtx = emptyKindContext(input.coreTypes, input.index);
  const maxIters = Math.max(1, input.index.types().length + 1);
  for (let iter = 0; iter < maxIters; iter++) {
    const kindsByType = new Map<import("../ids").TypeId, CheckedResourceKind[]>();
    for (const { item, type } of fieldEntries) {
      const fieldKind = resourceKindForType({
        type,
        context: {
          ...emptyCtx,
          targetTypeKinds: new Map(),
          sourceTypeKinds,
        },
      });
      if (item.typeId !== undefined) {
        const list = kindsByType.get(item.typeId) ?? [];
        list.push(fieldKind);
        kindsByType.set(item.typeId, list);
      }
    }
    const newKinds = new Map<import("../ids").TypeId, CheckedResourceKind>();
    for (const [typeId, kinds] of kindsByType) {
      newKinds.set(typeId, joinResourceKinds(kinds));
    }
    const fingerprint = [...newKinds.entries()]
      .sort(([leftId], [rightId]) => leftId - rightId)
      .map(([typeId, kind]) => `${typeId}:${resourceKindFingerprint(kind)}`)
      .join("|");
    if (fingerprint === prevFingerprint) break;
    prevFingerprint = fingerprint;
    sourceTypeKinds = newKinds;
  }

  const kindContext: ResourceKindContext = {
    coreTypes: input.coreTypes,
    index: input.index,
    sourceTypeKinds,
    targetTypeKinds: new Map(),
  };

  for (const { field, item, type } of fieldEntries) {
    const finalKind = resourceKindForType({ type, context: kindContext });
    builder.addField({
      fieldId: field.id,
      itemId: item.id,
      name: field.name,
      type,
      resourceKind: finalKind,
      sourceSpan: field.span,
    });
  }
  return kindContext;
}

// ── Helper: collect proof surfaces from requires sections and deferred members ──

function requirementMemberKey(moduleId: ModuleId, span: SourceSpan): string {
  return `${moduleId}:${span.start}:${span.end}`;
}

function collectMemberAccessExpressions(expression: ExpressionView): MemberAccessExpressionView[] {
  const members: MemberAccessExpressionView[] = [];
  const visit = (view: ExpressionView): void => {
    if (view instanceof MemberAccessExpressionView) {
      members.push(view);
    }
    for (const child of view.node.children()) {
      if (child instanceof RedNode) {
        const childView = expressionViewFrom(child);
        if (childView !== undefined) visit(childView);
      }
    }
  };
  visit(expression);
  return members;
}

function reportUntrackedRequirementMembers(input: {
  readonly expression: ExpressionView;
  readonly moduleId: ModuleId;
  readonly knownMemberKeys: ReadonlySet<string>;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
}): void {
  for (const memberExpression of collectMemberAccessExpressions(input.expression)) {
    const memberToken = memberExpression.memberToken();
    const memberName = memberExpression.memberName();
    const memberSpan = memberToken !== undefined ? presentTokenSpan(memberToken) : undefined;
    if (memberName === undefined || memberSpan === undefined) continue;
    if (input.knownMemberKeys.has(requirementMemberKey(input.moduleId, memberSpan))) continue;
    input.diagnostics.push(
      unresolvedDeferredMember(memberName, memberSpan, memberExpression.source, {
        moduleId: input.moduleId,
        span: memberSpan,
        codeTieBreaker: "deferred",
      }),
    );
  }
}

interface RequirementProofScope {
  readonly ownerFunctionId: FunctionId;
  readonly moduleId: ModuleId;
  readonly expression: CheckedRequirementExpression;
  readonly span: SourceSpan;
  readonly references: readonly CheckedRequirementReference[];
  readonly deferredMemberKeys: readonly string[];
}

function referencesContainedByRequirement(input: {
  readonly references: ResolvedReferences;
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
}): CheckedRequirementReference[] {
  const references: CheckedRequirementReference[] = [];
  for (const entry of input.references.entries()) {
    if (entry.key.moduleId !== input.moduleId) continue;
    if (entry.key.span.start < input.span.start || entry.key.span.end > input.span.end) continue;
    references.push({ key: entry.key, reference: entry.reference });
  }
  return references;
}

function deferredKeysContainedByRequirement(input: {
  readonly references: ResolvedReferences;
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
}): string[] {
  const keys: string[] = [];
  for (const deferredMember of input.references.deferredMembers()) {
    const ownerKey = deferredMember.receiverExpressionKey ?? deferredMember.key;
    if (ownerKey.moduleId !== input.moduleId) continue;
    if (ownerKey.span.start < input.span.start || ownerKey.span.end > input.span.end) continue;
    keys.push(syntaxReferenceKeyToString(deferredMember.key));
  }
  return keys;
}

function collectRequirementProofScopes(input: {
  readonly surfaceInput: CheckSemanticSurfaceInput;
  readonly signatures: CheckedFunctionSignatureTable;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
}): RequirementProofScope[] {
  const knownRequirementMemberKeys = new Set<string>();
  for (const entry of input.surfaceInput.references.entries()) {
    if (
      entry.key.kind === "memberName" ||
      entry.key.kind === "fieldName" ||
      entry.key.kind === "functionName" ||
      entry.key.kind === "enumCase"
    ) {
      knownRequirementMemberKeys.add(requirementMemberKey(entry.key.moduleId, entry.key.span));
    }
  }
  for (const deferredMember of input.surfaceInput.references.deferredMembers()) {
    knownRequirementMemberKeys.add(
      requirementMemberKey(deferredMember.key.moduleId, deferredMember.key.span),
    );
  }

  const scopes: RequirementProofScope[] = [];
  for (const signature of input.signatures.entries()) {
    const funcRecord = input.surfaceInput.index.function(signature.functionId);
    const moduleId = funcRecord?.moduleId ?? (0 as ModuleId);
    const item = input.surfaceInput.index.item(signature.itemId);
    const declaration = item?.declaration;
    const requiresSections =
      declaration instanceof FunctionDeclarationView ? declaration.requiresSections() : [];
    for (const section of requiresSections) {
      for (const req of section.requirements()) {
        const reqExpr = req.expression();
        if (reqExpr === undefined) continue;
        const exprSpan = reqExpr.span;
        const exprText = reqExpr.source.text.slice(exprSpan.start, exprSpan.end);
        reportUntrackedRequirementMembers({
          expression: reqExpr,
          moduleId,
          knownMemberKeys: knownRequirementMemberKeys,
          diagnostics: input.diagnostics,
        });
        scopes.push({
          ownerFunctionId: signature.functionId,
          moduleId,
          expression: { kind: "opaque", text: exprText },
          span: exprSpan,
          references: referencesContainedByRequirement({
            references: input.surfaceInput.references,
            moduleId,
            span: exprSpan,
          }),
          deferredMemberKeys: deferredKeysContainedByRequirement({
            references: input.surfaceInput.references,
            moduleId,
            span: exprSpan,
          }),
        });
      }
    }
  }
  return scopes;
}

function collectProofSurfaces(
  input: CheckSemanticSurfaceInput,
  builder: CheckedProgramBuilder,
  signaturesResult: { readonly signatures: CheckedFunctionSignatureTable },
  typedOwners: ReadonlyMap<string, ItemId>,
  parameterOwners: ReadonlyMap<ParameterId, ItemId>,
  diagnostics: SemanticSurfaceDiagnostic[],
): CheckedProofSurface {
  const terminalSurfaces: CheckedTerminalSurface[] = [];
  const requirementScopes = collectRequirementProofScopes({
    surfaceInput: input,
    signatures: signaturesResult.signatures,
    diagnostics,
  });
  for (const signature of signaturesResult.signatures.entries()) {
    if (signature.modifiers.isTerminal) {
      terminalSurfaces.push(
        terminalSurface({ functionId: signature.functionId, span: signature.sourceSpan }),
      );
    }
  }

  const declarationKeys = new Set<string>();
  for (const scope of requirementScopes) {
    for (const key of scope.deferredMemberKeys) {
      declarationKeys.add(key);
    }
  }

  const deferredResult = completeDeferredMembers({
    index: input.index,
    references: input.references,
    memberNamespace: buildMemberNamespace(input.index),
    typedOwners,
    parameterOwners,
    declarationKeys,
  });
  diagnostics.push(...deferredResult.diagnostics);

  for (const completed of deferredResult.completed.entries()) {
    builder.addCompletedMember(completed);
  }

  const completedByModule = new Map<ModuleId, CompletedMemberReference[]>();
  for (const completedEntry of deferredResult.completed.entries()) {
    const list = completedByModule.get(completedEntry.key.moduleId) ?? [];
    list.push(completedEntry);
    completedByModule.set(completedEntry.key.moduleId, list);
  }
  const builtRequirements: CheckedRequirementSurface[] = [];
  for (const req of requirementScopes) {
    const completedMembers: CheckedRequirementReference[] = [];
    for (const completedEntry of completedByModule.get(req.moduleId) ?? []) {
      if (
        completedEntry.key.span.start >= req.span.start &&
        completedEntry.key.span.end <= req.span.end
      ) {
        completedMembers.push({ key: completedEntry.key, reference: completedEntry.reference });
      }
    }
    const expression: CheckedRequirementExpression =
      req.references.length > 0 || completedMembers.length > 0
        ? {
            kind: "checked",
            text: req.expression.text,
            references: req.references,
            completedMembers,
          }
        : req.expression;
    builtRequirements.push(
      requirementSurface({ ownerFunctionId: req.ownerFunctionId, expression, span: req.span }),
    );
  }

  for (const failed of deferredResult.failedDeferred) {
    diagnostics.push(
      unresolvedDeferredMember(failed.memberName, failed.memberSpan, undefined, {
        moduleId: failed.key.moduleId,
        span: failed.memberSpan,
        codeTieBreaker: "deferred",
      }),
    );
  }

  const constructibilityBuilder = new CheckedConstructibilitySurfaceTableBuilder();
  const takeModeBuilder = new CheckedTakeModeSurfaceTableBuilder();
  const validationContractBuilder = new CheckedValidationContractSurfaceTableBuilder();
  const attemptContractBuilder = new CheckedAttemptContractSurfaceTableBuilder();
  const privateTransitionBuilder = new CheckedPrivateTransitionSurfaceTableBuilder();
  const platformEnsuredFactBuilder = new CheckedPlatformEnsuredFactSurfaceTableBuilder();
  const matchRefinementBuilder = new CheckedMatchRefinementSurfaceTableBuilder();

  return checkedProofSurface({
    requirements: builtRequirements,
    terminalSurfaces,
    constructibilitySurfaces: constructibilityBuilder.build(),
    takeModeSurfaces: takeModeBuilder.build(),
    validationContracts: validationContractBuilder.build(),
    attemptContracts: attemptContractBuilder.build(),
    privateTransitions: privateTransitionBuilder.build(),
    platformEnsuredFacts: platformEnsuredFactBuilder.build(),
    matchRefinements: matchRefinementBuilder.build(),
  });
}

export function checkSemanticSurface(input: CheckSemanticSurfaceInput): CheckSemanticSurfaceResult {
  const builder = new CheckedProgramBuilder();
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const referenceLookup = buildSurfaceReferenceLookup(input.references);

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
  const kindContext = checkFieldTypesAndBuildKinds(input, builder, referenceLookup, diagnostics);

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
  const { byKey: typedOwners, byParameterId: parameterOwners } = deriveTypedOwnersFromSignatures({
    signatures: signaturesResult.signatures,
    references: input.references,
    index: input.index,
  });

  const declarationProofSurface = collectProofSurfaces(
    input,
    builder,
    signaturesResult,
    typedOwners,
    parameterOwners,
    diagnostics,
  );
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

  let devices: readonly CheckedImageDevice[] = [];
  const checkedProgramBeforeProof = builder.build();
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

  const proofSurface = checkedProofSurface({
    resourceKindByType: [...typeResourceKindSurfaces, ...fieldResourceKindSurfaces],
    signatureModes: signaturesResult.signatures.entries().map((signature) => ({
      functionId: signature.functionId,
      signature,
    })),
    requirements: declarationProofSurface.requirementSurfaces.entries(),
    terminalSurfaces: declarationProofSurface.terminalSurfaces.entries(),
    privateStateSurfaces,
    imageSurfaces: devices.map((device) => ({ device })),
    platformContracts: certResult.bindings,
    constructibilitySurfaces: declarationProofSurface.constructibilitySurfaces,
    takeModeSurfaces: declarationProofSurface.takeModeSurfaces,
    validationContracts: declarationProofSurface.validationContracts,
    attemptContracts: declarationProofSurface.attemptContracts,
    privateTransitions: declarationProofSurface.privateTransitions,
    platformEnsuredFacts: declarationProofSurface.platformEnsuredFacts,
    matchRefinements: declarationProofSurface.matchRefinements,
  });
  builder.setProofSurface(proofSurface);
  const program = builder.build();

  return {
    program,
    image,
    diagnostics: sortSemanticSurfaceDiagnostics(diagnostics),
  };
}
