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
  CheckedFunctionSignature,
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
import {
  checkedProofSurface,
  requirementSurface,
  terminalSurface,
  type CheckedPredicateFactSurface,
} from "./proof-surface";
import type {
  CheckedProofSurface,
  CheckedRequirementSurface,
  CheckedTerminalSurface,
  CheckedRequirementReference,
  CheckedRequirementExpression,
} from "./proof-surface";
import {
  CheckedConstructibilitySurfaceTableBuilder,
  CheckedMatchRefinementSurfaceTableBuilder,
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
  matchRefinementMatchKey,
  matchRefinementScrutineeKey,
} from "./proof-contracts";
import type {
  CheckedAttemptContractSurface,
  CheckedMatchRefinementSurface,
  CheckedPrivateTransitionSurface,
  CheckedValidationContractSurface,
  ConstructibilityConstructorAuthority,
} from "./proof-contracts";
import type { CheckedType } from "./type-model";
import { checkedTypeFingerprint, checkedTypesEqual, errorCheckedType } from "./type-model";
import { buildSemanticMonoClosureFacts, targetResourceKindContext } from "./mono-closure-builder";
import type {
  ImageId,
  ImageProfileId,
  FunctionId,
  ItemId,
  ModuleId,
  ParameterId,
  TypeId,
} from "../ids";
import { coreTypeId } from "../ids";
import { FunctionDeclarationView } from "../../frontend/ast/function-views";
import type { ExpressionView } from "../../frontend/ast/expression-views";
import {
  MemberAccessExpressionView,
  expressionViewFrom,
} from "../../frontend/ast/expression-views";
import { MatchStatementView } from "../../frontend/ast/statement-views";
import { descendants } from "../../frontend/ast/syntax-query";
import type { PatternView } from "../../frontend/ast/pattern-views";
import { RedNode, SyntaxKind } from "../../frontend/syntax";
import type { ResolvedReference } from "../names/reference";

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
  const targetTypeKindContext = targetResourceKindContext(input.targetSurface);
  const emptyCtx = emptyKindContext(input.coreTypes, input.index);
  const maxIters = Math.max(1, input.index.types().length + 1);
  for (let iter = 0; iter < maxIters; iter++) {
    const kindsByType = new Map<import("../ids").TypeId, CheckedResourceKind[]>();
    for (const { item, type } of fieldEntries) {
      const fieldKind = resourceKindForType({
        type,
        context: {
          ...emptyCtx,
          targetTypeKinds: targetTypeKindContext,
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
    targetTypeKinds: targetTypeKindContext,
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

function isEnumCaseReference(input: {
  readonly reference: ResolvedReference;
  readonly index: ItemIndex;
}): boolean {
  return (
    input.reference.kind === "item" && input.index.item(input.reference.itemId)?.kind === "enumCase"
  );
}

function enumCaseReferenceEntry(input: {
  readonly pattern: PatternView;
  readonly moduleId: ModuleId;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly index: ItemIndex;
}): CheckedRequirementReference | undefined {
  const segments = input.pattern.qualifiedName()?.segments() ?? [];
  const lastSegment = segments[segments.length - 1];
  const span = presentTokenSpan(lastSegment);
  if (span === undefined) return undefined;

  for (const kind of ["enumCase", "memberName"] as const) {
    const result = input.referenceLookup.findOne({
      moduleId: input.moduleId,
      span,
      kind,
    });
    if (
      result.kind === "found" &&
      isEnumCaseReference({ reference: result.entry.reference, index: input.index })
    ) {
      return { key: result.entry.key, reference: result.entry.reference };
    }
  }
  return undefined;
}

function bindingKeysForPattern(input: {
  readonly pattern: PatternView;
  readonly moduleId: ModuleId;
}): string[] {
  const keys: string[] = [];
  for (const nestedPattern of input.pattern.patternList()?.patterns() ?? []) {
    const name = nestedPattern.qualifiedName()?.text();
    if (name === undefined || name === "_") continue;
    const segments = nestedPattern.qualifiedName()?.segments() ?? [];
    const firstSpan = presentTokenSpan(segments[0]);
    const lastSpan = presentTokenSpan(segments[segments.length - 1]);
    if (firstSpan === undefined || lastSpan === undefined) continue;
    keys.push(`binding:${input.moduleId}:${firstSpan.start}:${lastSpan.end}`);
  }
  return keys;
}

function matchRefinementSurfacesForFunction(input: {
  readonly declaration: FunctionDeclarationView;
  readonly moduleId: ModuleId;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly index: ItemIndex;
}): CheckedMatchRefinementSurface[] {
  const surfaces: CheckedMatchRefinementSurface[] = [];
  for (const node of descendants(input.declaration.node, SyntaxKind.MatchStatement)) {
    const match = MatchStatementView.from(node);
    if (match === undefined) continue;
    const scrutinee = match.condition()?.expression() ?? match.expression();
    if (scrutinee === undefined) continue;
    for (const arm of match.arms()) {
      const pattern = arm.pattern();
      if (pattern === undefined) continue;
      const variant = enumCaseReferenceEntry({
        pattern,
        moduleId: input.moduleId,
        referenceLookup: input.referenceLookup,
        index: input.index,
      });
      if (variant === undefined) continue;
      surfaces.push({
        matchStatementKey: matchRefinementMatchKey({
          moduleId: input.moduleId,
          span: match.node.span,
        }),
        scrutineeKey: matchRefinementScrutineeKey({
          moduleId: input.moduleId,
          span: scrutinee.node.span,
        }),
        variantReferenceKey: syntaxReferenceKeyToString(variant.key),
        fieldBindingKeys: bindingKeysForPattern({ pattern, moduleId: input.moduleId }),
        span: match.node.span,
      });
    }
  }
  return surfaces;
}

function collectProofSurfaces(
  input: CheckSemanticSurfaceInput,
  builder: CheckedProgramBuilder,
  signaturesResult: { readonly signatures: CheckedFunctionSignatureTable },
  referenceLookup: SurfaceReferenceLookup,
  typedOwners: ReadonlyMap<string, ItemId>,
  parameterOwners: ReadonlyMap<ParameterId, ItemId>,
  diagnostics: SemanticSurfaceDiagnostic[],
): CheckedProofSurface {
  const terminalSurfaces: CheckedTerminalSurface[] = [];
  const predicateFactSurfaces: CheckedPredicateFactSurface[] = [];
  const matchRefinementBuilder = new CheckedMatchRefinementSurfaceTableBuilder();
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
    if (signature.modifiers.isPredicate) {
      predicateFactSurfaces.push({
        functionId: signature.functionId,
        span: signature.sourceSpan,
      });
    }
    const functionRecord = input.index.function(signature.functionId);
    const item = input.index.item(signature.itemId);
    if (functionRecord !== undefined && item?.declaration instanceof FunctionDeclarationView) {
      for (const surface of matchRefinementSurfacesForFunction({
        declaration: item.declaration,
        moduleId: functionRecord.moduleId,
        referenceLookup,
        index: input.index,
      })) {
        matchRefinementBuilder.add(surface);
      }
    }
  }

  const declarationKeys = new Set<string>();
  for (const scope of requirementScopes) {
    for (const key of scope.deferredMemberKeys) {
      declarationKeys.add(key);
    }
  }
  for (const deferredMember of input.references.deferredMembers()) {
    declarationKeys.add(syntaxReferenceKeyToString(deferredMember.key));
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

  return checkedProofSurface({
    requirements: builtRequirements,
    predicateFactSurfaces,
    terminalSurfaces,
    matchRefinements: matchRefinementBuilder.build(),
  });
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

function isPrivateStateKind(kind: CheckedResourceKind): boolean {
  return kind.kind === "concrete" && kind.value === "PrivateState";
}

function isNeverReturn(signature: import("./checked-program").CheckedFunctionSignature): boolean {
  return (
    (signature.returnKind.kind === "concrete" && signature.returnKind.value === "Never") ||
    (signature.returnType.kind === "core" &&
      signature.returnType.coreTypeId === coreTypeId("Never"))
  );
}

function firstPrivateStateInput(signature: import("./checked-program").CheckedFunctionSignature):
  | {
      readonly parameterId: ParameterId;
      readonly mode: "observe" | "consume";
      readonly isReceiver: boolean;
    }
  | undefined {
  if (signature.receiver !== undefined && isPrivateStateKind(signature.receiver.resourceKind)) {
    return {
      parameterId: signature.receiver.parameterId,
      mode: signature.receiver.mode,
      isReceiver: true,
    };
  }
  const parameter = signature.parameters.find((candidate) =>
    isPrivateStateKind(candidate.resourceKind),
  );
  return parameter !== undefined
    ? {
        parameterId: parameter.parameterId,
        mode: parameter.mode,
        isReceiver: false,
      }
    : undefined;
}

function privateTransitionsFromSignatures(input: {
  readonly signatures: CheckedFunctionSignatureTable;
}): CheckedPrivateTransitionSurface[] {
  const transitions: CheckedPrivateTransitionSurface[] = [];
  for (const signature of input.signatures.entries()) {
    const privateInput = firstPrivateStateInput(signature);
    if (privateInput === undefined) continue;
    const kind: CheckedPrivateTransitionSurface["kind"] = signature.modifiers.isPredicate
      ? "predicate"
      : isNeverReturn(signature)
        ? "close"
        : privateInput.mode === "consume" || isPrivateStateKind(signature.returnKind)
          ? "advance"
          : "unknown";
    transitions.push({
      functionId: signature.functionId,
      kind,
      receiverParameterId: privateInput.parameterId,
      span: signature.sourceSpan,
    });
  }
  return transitions;
}

function appliedSourceConstructorName(type: CheckedType, index: ItemIndex): string | undefined {
  if (type.kind !== "applied" || type.constructor.kind !== "source") return undefined;
  return index.type(type.constructor.typeId)?.name;
}

function appliedSourceTypeNamed(input: {
  readonly type: CheckedType;
  readonly index: ItemIndex;
  readonly name: string;
}): import("./type-model").AppliedCheckedType | undefined {
  if (input.type.kind !== "applied") return undefined;
  return appliedSourceConstructorName(input.type, input.index) === input.name
    ? input.type
    : undefined;
}

function sourceConstructorTypeId(type: CheckedType): TypeId | undefined {
  if (type.kind === "source") return type.typeId;
  if (type.kind === "applied" && type.constructor.kind === "source") {
    return type.constructor.typeId;
  }
  return undefined;
}

function validatedBufferTypeIdForPayload(input: {
  readonly type: CheckedType;
  readonly index: ItemIndex;
}): TypeId | undefined {
  const typeId = sourceConstructorTypeId(input.type);
  if (typeId === undefined) return undefined;
  const typeRecord = input.index.type(typeId);
  if (typeRecord === undefined) return undefined;
  const item = input.index.item(typeRecord.itemId);
  return item?.kind === "validatedBuffer" ? typeId : undefined;
}

function matchingSourceParameter(input: {
  readonly signature: CheckedFunctionSignature;
  readonly type: CheckedType;
}): ParameterId | undefined {
  const matching = input.signature.parameters.filter((parameter) =>
    checkedTypesEqual(parameter.type, input.type),
  );
  return matching.length === 1 ? matching[0]!.parameterId : undefined;
}

function matchingAttemptInput(input: {
  readonly signature: CheckedFunctionSignature;
  readonly type: CheckedType;
}): CheckedAttemptContractSurface["inputs"][number] | undefined {
  const matches: CheckedAttemptContractSurface["inputs"][number][] = [];
  if (
    input.signature.receiver !== undefined &&
    checkedTypesEqual(input.signature.receiver.type, input.type)
  ) {
    matches.push({ kind: "receiver" });
  }
  for (const parameter of input.signature.parameters) {
    if (checkedTypesEqual(parameter.type, input.type)) {
      matches.push({ kind: "parameter", parameterId: parameter.parameterId });
    }
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function attemptInputKey(input: CheckedAttemptContractSurface["inputs"][number]): string {
  return input.kind === "receiver" ? "receiver" : `parameter:${input.parameterId}`;
}

function sourceValidationContractsFromSignatures(input: {
  readonly signatures: CheckedFunctionSignatureTable;
  readonly index: ItemIndex;
}): CheckedValidationContractSurface[] {
  const contracts: CheckedValidationContractSurface[] = [];
  for (const signature of input.signatures.entries()) {
    const resultType = appliedSourceTypeNamed({
      type: signature.returnType,
      index: input.index,
      name: "Validation",
    });
    if (resultType === undefined || resultType.arguments.length < 3) continue;

    const okPayloadType = resultType.arguments[0]!;
    const errPayloadType = resultType.arguments[1]!;
    const sourceType = resultType.arguments[2]!;
    const validatedBufferTypeId = validatedBufferTypeIdForPayload({
      type: okPayloadType,
      index: input.index,
    });
    const sourceParameterId = matchingSourceParameter({ signature, type: sourceType });
    if (validatedBufferTypeId === undefined || sourceParameterId === undefined) continue;

    contracts.push({
      validatedBufferTypeId,
      resultType: signature.returnType,
      sourceType,
      okPayloadType,
      errPayloadType,
      sourceParameterId,
      span: signature.sourceSpan,
    });
  }
  return contracts;
}

function sourceAttemptContractsFromSignatures(input: {
  readonly signatures: CheckedFunctionSignatureTable;
  readonly index: ItemIndex;
}): CheckedAttemptContractSurface[] {
  const contracts: CheckedAttemptContractSurface[] = [];
  for (const signature of input.signatures.entries()) {
    const resultType = appliedSourceTypeNamed({
      type: signature.returnType,
      index: input.index,
      name: "Attempt",
    });
    if (resultType === undefined || resultType.arguments.length < 3) continue;

    const inputs: CheckedAttemptContractSurface["inputs"][number][] = [];
    let allInputsMapped = true;
    for (const inputType of resultType.arguments.slice(2)) {
      const position = matchingAttemptInput({ signature, type: inputType });
      if (position === undefined) {
        allInputsMapped = false;
        break;
      }
      inputs.push(position);
    }
    if (!allInputsMapped || inputs.length === 0) continue;

    const uniqueInputKeys = new Set(inputs.map(attemptInputKey));
    if (uniqueInputKeys.size !== inputs.length) continue;

    contracts.push({
      fallibleFunctionId: signature.functionId,
      resultType: signature.returnType,
      okType: resultType.arguments[0]!,
      errType: resultType.arguments[1]!,
      inputs,
      span: signature.sourceSpan,
    });
  }
  return contracts;
}

function sourceTypeId(type: CheckedType): TypeId | undefined {
  return type.kind === "source" ? type.typeId : undefined;
}

function constructibilityAuthorizationForKind(
  resourceKind: CheckedResourceKind,
): ConstructibilityConstructorAuthority["authorization"] | undefined {
  if (resourceKind.kind !== "concrete") return undefined;
  switch (resourceKind.value) {
    case "PrivateState":
      return "privateStateMint";
    case "Stream":
      return "streamMint";
    case "SealedPlatformToken":
      return "sealedPlatformTokenMint";
    case "UniqueEdgeRoot":
    case "EdgePath":
      return "edgeInternalTokenMint";
    case "ValidatedBuffer":
      return "validatedBufferMint";
    default:
      return undefined;
  }
}

function constructibilityDeclarationAuthorities(input: {
  readonly sourceTypes: readonly {
    readonly typeId: TypeId;
    readonly resourceKind: CheckedResourceKind;
    readonly span: SourceSpan;
  }[];
}): ConstructibilityConstructorAuthority[] {
  return input.sourceTypes.flatMap((sourceType) => {
    const authorization = constructibilityAuthorizationForKind(sourceType.resourceKind);
    if (authorization === undefined || authorization === "validatedBufferMint") return [];
    return [{ typeId: sourceType.typeId, authorization, span: sourceType.span }];
  });
}

function constructibilityConstructorAuthorities(input: {
  readonly signatures: CheckedFunctionSignatureTable;
}): ConstructibilityConstructorAuthority[] {
  return input.signatures.entries().flatMap((signature) => {
    if (!signature.modifiers.isConstructor) return [];
    const typeId = sourceTypeId(signature.returnType);
    const authorization = constructibilityAuthorizationForKind(signature.returnKind);
    if (typeId === undefined || authorization === undefined) return [];
    return [
      {
        typeId,
        constructorFunctionId: signature.functionId,
        authorization,
        span: signature.sourceSpan,
      },
    ];
  });
}

function constructibilityImageAuthorities(
  devices: readonly CheckedImageDevice[],
): ConstructibilityConstructorAuthority[] {
  return devices.flatMap((device) => {
    const typeId = sourceTypeId(device.type);
    if (typeId === undefined) return [];
    return [
      {
        typeId,
        authorization: "imageCapabilityMint",
        span: device.span,
      },
    ];
  });
}

function constructibilityPlatformAuthorities(input: {
  readonly program: CheckedSemanticProgram;
}): ConstructibilityConstructorAuthority[] {
  return input.program.certifiedPlatformBindings.entries().flatMap((binding) => {
    const signature = input.program.functions.get(binding.functionId);
    if (signature === undefined) return [];
    const typeId = sourceTypeId(signature.returnType);
    const authorization = constructibilityAuthorizationForKind(signature.returnKind);
    if (typeId === undefined || authorization !== "sealedPlatformTokenMint") return [];
    return [
      {
        typeId,
        constructorFunctionId: binding.functionId,
        authorization,
        span: signature.sourceSpan,
      },
    ];
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
    referenceLookup,
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
