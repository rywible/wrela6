import { coreTypeId } from "../ids";
import type { ItemIndex } from "../item-index";
import type { FunctionRecord, ParameterRecord } from "../item-index/item-records";
import { checkTypeReference } from "./type-reference-checker";
import { checkGenericSignature } from "./generic-checker";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import type { CoreTypeCatalog } from "../names/core-types";
import type { CheckedType } from "./type-model";
import { coreCheckedType, checkedTypeFingerprint, sourceCheckedType } from "./type-model";
import { resourceKindFingerprint } from "./resource-kind";
import { resourceKindForType } from "./resource-kind-checker";
import type { ResourceKindContext } from "./resource-kind-checker";
import type {
  CheckedFunctionSignature,
  CheckedParameter,
  CheckedReceiver,
  CheckedFunctionModifiers,
  CheckedFunctionSignatureTable,
} from "./checked-program";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { illegalFunctionModifiers, invalidReturnType, invalidReceiver } from "./diagnostics";
import type { TargetFunctionSignature } from "./platform-surface";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { SourceSpan } from "../../frontend";
import type { SourceText, TypeReferenceView } from "../../frontend";
import { FunctionDeclarationView } from "../../frontend/ast/function-views";

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
  const decl = itemRecord.declaration;
  if (decl instanceof FunctionDeclarationView) {
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
      illegalFunctionModifiers("platform and constructor cannot be combined", span, source, {
        moduleId: input.functionRecord.moduleId,
        span,
        codeTieBreaker: "mod",
      }),
    );
  }

  if (modifiers.isTerminal && modifiers.isPredicate) {
    diagnostics.push(
      illegalFunctionModifiers("terminal and predicate cannot be combined", span, source, {
        moduleId: input.functionRecord.moduleId,
        span,
        codeTieBreaker: "mod",
      }),
    );
  }

  if (modifiers.isPredicate && modifiers.isConstructor) {
    diagnostics.push(
      illegalFunctionModifiers("predicate and constructor cannot be combined", span, source, {
        moduleId: input.functionRecord.moduleId,
        span,
        codeTieBreaker: "mod",
      }),
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

  const paramRef = input.referenceLookup.findOne({
    moduleId: input.functionRecord.moduleId,
    span: paramRecord.nameSpan,
    kind: "parameter",
  });
  const referenceKey = paramRef.kind === "found" ? paramRef.entry.key : undefined;

  return {
    parameterId: paramRecord.id,
    name: paramRecord.name,
    type: typeResult.type,
    mode: paramRecord.isConsumed ? "consume" : "observe",
    resourceKind,
    referenceKey,
    sourceSpan: paramRecord.span,
  };
}

function determineReturnType(
  input: CheckFunctionSignatureInput,
  modifiers: CheckedFunctionModifiers,
  span: SourceSpan,
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

  if (!modifiers.isTerminal && !modifiers.isConstructor) {
    const source = getModuleSource(input);
    return {
      returnType: coreCheckedType(coreTypeId("Never")),
      diagnostics: [
        invalidReturnType(
          "function declarations must include an explicit return type",
          span,
          source,
          {
            moduleId: input.functionRecord.moduleId,
            span,
            codeTieBreaker: "return",
          },
        ),
      ],
    };
  }

  return {
    returnType: coreCheckedType(coreTypeId("Never")),
    diagnostics: [],
  };
}

function receiverTypeForSelf(
  input: CheckFunctionSignatureInput,
  checkedParam: CheckedParameter,
): CheckedType {
  if (checkedParam.type.kind !== "error") return checkedParam.type;
  const ownerItemId = input.functionRecord.parentItemId;
  if (ownerItemId === undefined) return checkedParam.type;
  const ownerItem = input.index.item(ownerItemId);
  if (ownerItem?.typeId === undefined) return checkedParam.type;
  return sourceCheckedType({ itemId: ownerItem.id, typeId: ownerItem.typeId });
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

  const allParamRecords = input.index.parametersForFunction(input.functionRecord.id);
  let receiver: CheckedReceiver | undefined;
  const parameters: CheckedParameter[] = [];

  let seenSelf = false;
  const isMethod = input.functionRecord.parentItemId !== undefined;
  for (let idx = 0; idx < allParamRecords.length; idx++) {
    const paramRecord = allParamRecords[idx]!;
    const checkedParam = checkedParameterFromRecord(input, paramRecord, diagnostics);

    if (paramRecord.name === "self") {
      if (seenSelf) {
        diagnostics.push(
          invalidReceiver("duplicate self parameter", paramRecord.span, source, {
            moduleId: input.functionRecord.moduleId,
            span: paramRecord.span,
            codeTieBreaker: "receiver",
          }),
        );
        parameters.push(checkedParam);
        continue;
      }
      seenSelf = true;

      if (!isMethod) {
        diagnostics.push(
          invalidReceiver(
            "self parameter only valid in method declarations",
            paramRecord.span,
            source,
            {
              moduleId: input.functionRecord.moduleId,
              span: paramRecord.span,
              codeTieBreaker: "receiver",
            },
          ),
        );
        parameters.push(checkedParam);
        continue;
      }

      if (idx !== 0) {
        diagnostics.push(
          invalidReceiver("self parameter must be the first parameter", paramRecord.span, source, {
            moduleId: input.functionRecord.moduleId,
            span: paramRecord.span,
            codeTieBreaker: "receiver",
          }),
        );
      }

      if (paramRecord.isConsumed) {
        diagnostics.push(
          invalidReceiver(
            "self parameter cannot be consumed; use observe mode",
            paramRecord.span,
            source,
            {
              moduleId: input.functionRecord.moduleId,
              span: paramRecord.span,
              codeTieBreaker: "receiver",
            },
          ),
        );
      }

      const receiverType = receiverTypeForSelf(input, checkedParam);
      receiver = {
        parameterId: paramRecord.id,
        ownerItemId: input.functionRecord.parentItemId!,
        type: receiverType,
        resourceKind: resourceKindForType({
          type: receiverType,
          context: input.kindContext,
        }),
        mode: "observe",
        referenceKey: checkedParam.referenceKey,
      };
    } else {
      parameters.push(checkedParam);
    }
  }

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
        invalidReturnType("predicate functions must return bool", span, source, {
          moduleId: input.functionRecord.moduleId,
          span,
          codeTieBreaker: "return",
        }),
      );
    }
  }

  if (!modifiers.isTerminal && !modifiers.isPredicate && returnType.kind === "error") {
    diagnostics.push(
      invalidReturnType("function has no valid return type", span, source, {
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

  const signature: CheckedFunctionSignature = {
    functionId: input.functionRecord.id,
    itemId: input.functionRecord.itemId,
    ownerItemId: input.functionRecord.parentItemId,
    receiver,
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
    parts.push(`receiverType:${checkedTypeFingerprint(signature.receiver.type)}`);
    parts.push(`receiverKind:${resourceKindFingerprint(signature.receiver.resourceKind)}`);
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

export function targetSignatureExactlyMatches(
  source: CheckedFunctionSignature | undefined,
  target: TargetFunctionSignature,
): boolean {
  if (source === undefined) return false;
  if (sourceSignatureShapeFingerprint(source) !== targetSignatureShapeFingerprint(target)) {
    return false;
  }
  return sourceModifiersSatisfyTarget(sourceModifiers(source), target);
}

function sourceSignatureShapeFingerprint(signature: CheckedFunctionSignature): string {
  const parts: string[] = [];
  parts.push(`genericArity:${signature.genericSignature?.parameters.length ?? 0}`);
  parts.push(`hasReceiver:${signature.receiver !== undefined ? "1" : "0"}`);
  if (signature.receiver !== undefined) {
    parts.push(`receiverMode:${signature.receiver.mode}`);
    parts.push(`receiverType:${checkedTypeFingerprint(signature.receiver.type)}`);
    parts.push(`receiverKind:${resourceKindFingerprint(signature.receiver.resourceKind)}`);
  }
  parts.push(`params:${signature.parameters.length}`);
  for (const param of signature.parameters) {
    parts.push(`mode:${param.mode}`);
    parts.push(`type:${checkedTypeFingerprint(param.type)}`);
    parts.push(`kind:${resourceKindFingerprint(param.resourceKind)}`);
  }
  parts.push(`return:${checkedTypeFingerprint(signature.returnType)}`);
  parts.push(`returnKind:${resourceKindFingerprint(signature.returnKind)}`);
  return parts.join("|");
}

function targetSignatureShapeFingerprint(target: TargetFunctionSignature): string {
  const parts: string[] = [];
  parts.push(`genericArity:${target.genericArity}`);
  parts.push(`hasReceiver:${target.receiver !== undefined ? "1" : "0"}`);
  if (target.receiver !== undefined) {
    parts.push(`receiverMode:${target.receiver.mode}`);
    parts.push(`receiverType:${checkedTypeFingerprint(target.receiver.type)}`);
    parts.push(`receiverKind:${resourceKindFingerprint(target.receiver.resourceKind)}`);
  }
  parts.push(`params:${target.parameters.length}`);
  for (const param of target.parameters) {
    parts.push(`mode:${param.mode}`);
    parts.push(`type:${checkedTypeFingerprint(param.type)}`);
    parts.push(`kind:${resourceKindFingerprint(param.resourceKind)}`);
  }
  parts.push(`return:${checkedTypeFingerprint(target.returnType)}`);
  parts.push(`returnKind:${resourceKindFingerprint(target.returnKind)}`);
  return parts.join("|");
}

function sourceModifiers(signature: CheckedFunctionSignature): readonly string[] {
  const modifiers: string[] = [];
  if (signature.modifiers.isPlatform) modifiers.push("platform");
  if (signature.modifiers.isTerminal) modifiers.push("terminal");
  if (signature.modifiers.isPredicate) modifiers.push("predicate");
  if (signature.modifiers.isConstructor) modifiers.push("constructor");
  if (signature.modifiers.isPrivate) modifiers.push("private");
  return modifiers;
}

function sourceModifiersSatisfyTarget(
  modifiers: readonly string[],
  target: TargetFunctionSignature,
): boolean {
  const sourceSet = new Set(modifiers);
  const requiredSet = new Set(target.requiredModifiers);
  for (const required of requiredSet) {
    if (!sourceSet.has(required)) return false;
  }
  for (const forbidden of target.forbiddenModifiers) {
    if (sourceSet.has(forbidden)) return false;
  }
  for (const modifier of sourceSet) {
    if (!requiredSet.has(modifier)) return false;
  }
  return true;
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
