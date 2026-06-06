import { coreTypeId } from "../ids";
import type { ItemIndex } from "../item-index";
import type { FunctionRecord, ParameterRecord } from "../item-index/item-records";
import { checkTypeReference } from "./type-reference-checker";
import { checkGenericSignature } from "./generic-checker";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import type { CoreTypeCatalog } from "../names/core-types";
import type { CheckedType } from "./type-model";
import { coreCheckedType, checkedTypeFingerprint } from "./type-model";
import { resourceKindFingerprint } from "./resource-kind";
import { resourceKindForType } from "./resource-kind-checker";
import type { ResourceKindContext } from "./resource-kind-checker";
import type {
  CheckedFunctionSignature,
  CheckedParameter,
  CheckedFunctionModifiers,
  CheckedFunctionSignatureTable,
} from "./checked-program";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { illegalFunctionModifiers, invalidReturnType } from "./diagnostics";
import type { TargetFunctionSignature } from "./platform-surface";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { SourceSpan } from "../../frontend";
import type { SourceText, TypeReferenceView } from "../../frontend";

export interface CheckFunctionSignatureInput {
  readonly functionRecord: FunctionRecord;
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
  readonly kindContext: ResourceKindContext;
}

export interface CheckFunctionSignatureResult {
  readonly signature: CheckedFunctionSignature;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

export interface CheckAllFunctionSignaturesInput {
  readonly index: ItemIndex;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly coreTypes: CoreTypeCatalog;
  readonly kindContext: ResourceKindContext;
}

export interface CheckAllFunctionSignaturesResult {
  readonly signatures: CheckedFunctionSignatureTable;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function getFunctionItemRecord(input: CheckFunctionSignatureInput) {
  return input.index.item(input.functionRecord.itemId);
}

function getModuleSource(input: CheckFunctionSignatureInput): SourceText | undefined {
  const moduleRecord = input.index.module(input.functionRecord.moduleId);
  return moduleRecord?.source;
}

function checkedFunctionModifiersFromInput(
  input: CheckFunctionSignatureInput,
): CheckedFunctionModifiers {
  const itemRecord = getFunctionItemRecord(input);
  const mods = itemRecord?.modifiers ?? [];
  const modSet = new Set<string>(mods as readonly string[]);
  return {
    isPlatform: modSet.has("platform"),
    isTerminal: modSet.has("terminal"),
    isPredicate: modSet.has("predicate"),
    isConstructor: modSet.has("constructor"),
    isPrivate: modSet.has("private"),
  };
}

function getReturnTypeView(input: CheckFunctionSignatureInput): TypeReferenceView | undefined {
  const itemRecord = getFunctionItemRecord(input);
  if (itemRecord === undefined) return undefined;
  const decl = itemRecord.declaration as any;
  if (typeof decl?.returnType === "function") {
    return decl.returnType();
  }
  return undefined;
}

function validateModifiers(
  input: CheckFunctionSignatureInput,
  modifiers: CheckedFunctionModifiers,
  source: SourceText | undefined,
  span: SourceSpan,
  diagnostics: SemanticSurfaceDiagnostic[],
): void {
  if (modifiers.isPlatform && modifiers.isConstructor) {
    diagnostics.push(
      illegalFunctionModifiers("platform and constructor cannot be combined", span, source as any, {
        moduleId: input.functionRecord.moduleId,
        span,
        codeTieBreaker: "mod",
      }),
    );
  }

  if (modifiers.isTerminal && modifiers.isPredicate) {
    diagnostics.push(
      illegalFunctionModifiers("terminal and predicate cannot be combined", span, source as any, {
        moduleId: input.functionRecord.moduleId,
        span,
        codeTieBreaker: "mod",
      }),
    );
  }

  if (modifiers.isPredicate && modifiers.isConstructor) {
    diagnostics.push(
      illegalFunctionModifiers(
        "predicate and constructor cannot be combined",
        span,
        source as any,
        {
          moduleId: input.functionRecord.moduleId,
          span,
          codeTieBreaker: "mod",
        },
      ),
    );
  }
}

function checkedParameterFromRecord(
  input: CheckFunctionSignatureInput,
  paramRecord: ParameterRecord,
  diagnostics: SemanticSurfaceDiagnostic[],
): CheckedParameter {
  const typeResult = checkTypeReference({
    moduleId: input.functionRecord.moduleId,
    view: paramRecord.type,
    index: input.index,
    referenceLookup: input.referenceLookup,
    coreTypes: input.coreTypes,
  });
  diagnostics.push(...typeResult.diagnostics);

  const resourceKind = resourceKindForType({
    type: typeResult.type,
    context: input.kindContext,
  });

  return {
    parameterId: paramRecord.id,
    name: paramRecord.name,
    type: typeResult.type,
    mode: paramRecord.isConsumed ? "consume" : "observe",
    resourceKind,
    sourceSpan: paramRecord.span,
  };
}

function determineReturnType(
  input: CheckFunctionSignatureInput,
  _modifiers: CheckedFunctionModifiers,
  _span: SourceSpan,
): { returnType: CheckedType; diagnostics: readonly SemanticSurfaceDiagnostic[] } {
  const returnTypeView = getReturnTypeView(input);

  if (returnTypeView !== undefined) {
    const result = checkTypeReference({
      moduleId: input.functionRecord.moduleId,
      view: returnTypeView,
      index: input.index,
      referenceLookup: input.referenceLookup,
      coreTypes: input.coreTypes,
    });
    return { returnType: result.type, diagnostics: result.diagnostics };
  }

  return {
    returnType: coreCheckedType(coreTypeId("Never")),
    diagnostics: [],
  };
}

export function checkFunctionSignature(
  input: CheckFunctionSignatureInput,
): CheckFunctionSignatureResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const source = getModuleSource(input);
  const itemRecord = getFunctionItemRecord(input);
  const span = itemRecord?.span ?? SourceSpan.from(0, 0);

  const modifiers = checkedFunctionModifiersFromInput(input);
  validateModifiers(input, modifiers, source, span, diagnostics);

  const parameters = input.index
    .parametersForFunction(input.functionRecord.id)
    .map((paramRecord) => checkedParameterFromRecord(input, paramRecord, diagnostics));

  const { returnType, diagnostics: returnDiagnostics } = determineReturnType(
    input,
    modifiers,
    span,
  );
  diagnostics.push(...returnDiagnostics);

  if (modifiers.isPredicate) {
    const boolId = coreTypeId("bool");
    if (returnType.kind !== "core" || returnType.coreTypeId !== boolId) {
      diagnostics.push(
        invalidReturnType("predicate functions must return bool", span, source as any, {
          moduleId: input.functionRecord.moduleId,
          span,
          codeTieBreaker: "return",
        }),
      );
    }
  }

  if (!modifiers.isTerminal && !modifiers.isPredicate && returnType.kind === "error") {
    diagnostics.push(
      invalidReturnType("function has no valid return type", span, source as any, {
        moduleId: input.functionRecord.moduleId,
        span,
        codeTieBreaker: "return",
      }),
    );
  }

  const returnKind = resourceKindForType({
    type: returnType,
    context: input.kindContext,
  });

  const genericResult = checkGenericSignature({
    owner: {
      kind: "function",
      functionId: input.functionRecord.id,
      itemId: input.functionRecord.itemId,
    },
    index: input.index,
    referenceLookup: input.referenceLookup,
    coreTypes: input.coreTypes,
  });
  diagnostics.push(...genericResult.diagnostics);

  const signature: CheckedFunctionSignature = {
    functionId: input.functionRecord.id,
    itemId: input.functionRecord.itemId,
    ownerItemId: input.functionRecord.parentItemId,
    genericSignature:
      genericResult.signature.parameters.length > 0 ? genericResult.signature : undefined,
    parameters,
    returnType,
    returnKind,
    modifiers,
    sourceSpan: span,
  };

  return { signature, diagnostics };
}

export function checkedFunctionSignatureFingerprint(signature: CheckedFunctionSignature): string {
  const parts: string[] = [];
  parts.push(`genericArity:${signature.genericSignature?.parameters.length ?? 0}`);
  parts.push(`hasReceiver:${signature.receiver !== undefined ? "1" : "0"}`);
  if (signature.receiver !== undefined) {
    parts.push(`receiverMode:${signature.receiver.mode}`);
  }
  parts.push(`params:${signature.parameters.length}`);
  for (const param of signature.parameters) {
    parts.push(`mode:${param.mode}`);
    parts.push(`type:${checkedTypeFingerprint(param.type)}`);
    parts.push(`kind:${resourceKindFingerprint(param.resourceKind)}`);
  }
  parts.push(`return:${checkedTypeFingerprint(signature.returnType)}`);
  parts.push(`returnKind:${resourceKindFingerprint(signature.returnKind)}`);
  const mods: string[] = [];
  if (signature.modifiers.isPlatform) mods.push("platform");
  if (signature.modifiers.isTerminal) mods.push("terminal");
  if (signature.modifiers.isPredicate) mods.push("predicate");
  if (signature.modifiers.isConstructor) mods.push("constructor");
  if (signature.modifiers.isPrivate) mods.push("private");
  mods.sort((left, right) => compareCodeUnitStrings(left, right));
  parts.push(`mods:${mods.join(",")}`);
  return parts.join("|");
}

function sourceModifierList(signature: CheckedFunctionSignature): readonly string[] {
  const mods: string[] = [];
  if (signature.modifiers.isPlatform) mods.push("platform");
  if (signature.modifiers.isTerminal) mods.push("terminal");
  if (signature.modifiers.isPredicate) mods.push("predicate");
  if (signature.modifiers.isConstructor) mods.push("constructor");
  if (signature.modifiers.isPrivate) mods.push("private");
  return mods;
}

export function targetSignatureExactlyMatches(
  source: CheckedFunctionSignature | undefined,
  target: TargetFunctionSignature,
): boolean {
  if (source === undefined) return false;
  if (checkedFunctionSignatureFingerprint(source) !== targetFunctionSignatureFingerprint(target))
    return false;
  const sourceMods = sourceModifierList(source);
  for (const forbidden of target.forbiddenModifiers) {
    if (sourceMods.includes(forbidden)) return false;
  }
  return true;
}

function targetFunctionSignatureFingerprint(target: TargetFunctionSignature): string {
  const parts: string[] = [];
  parts.push(`genericArity:${target.genericArity}`);
  parts.push(`hasReceiver:${target.receiver !== undefined ? "1" : "0"}`);
  if (target.receiver !== undefined) {
    parts.push(`receiverMode:${target.receiver.mode}`);
  }
  parts.push(`params:${target.parameters.length}`);
  for (const param of target.parameters) {
    parts.push(`mode:${param.mode}`);
    parts.push(`type:${checkedTypeFingerprint(param.type)}`);
    parts.push(`kind:${resourceKindFingerprint(param.resourceKind)}`);
  }
  parts.push(`return:${checkedTypeFingerprint(target.returnType)}`);
  parts.push(`returnKind:${resourceKindFingerprint(target.returnKind)}`);
  const requiredMods = [...target.requiredModifiers].sort((left, right) =>
    compareCodeUnitStrings(left, right),
  );
  parts.push(`mods:${requiredMods.join(",")}`);
  return parts.join("|");
}

export function checkAllFunctionSignatures(
  input: CheckAllFunctionSignaturesInput,
): CheckAllFunctionSignaturesResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const signatures: CheckedFunctionSignature[] = [];

  for (const funcRecord of input.index.functions()) {
    const result = checkFunctionSignature({
      functionRecord: funcRecord,
      index: input.index,
      referenceLookup: input.referenceLookup,
      coreTypes: input.coreTypes,
      kindContext: input.kindContext,
    });
    signatures.push(result.signature);
    diagnostics.push(...result.diagnostics);
  }

  const sorted = [...signatures].sort(
    (left, right) => (left.functionId as number) - (right.functionId as number),
  );
  const byId = new Map(sorted.map((record) => [record.functionId, record]));

  const signatureTable: CheckedFunctionSignatureTable = {
    get: (functionId) => byId.get(functionId),
    entries: () => [...sorted],
  };

  return { signatures: signatureTable, diagnostics };
}
