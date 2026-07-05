import { SourceSpan } from "../../frontend";
import type { ItemIndex } from "../item-index";
import type { ParameterId, TypeId } from "../ids";
import type {
  CheckedFunctionSignature,
  CheckedFunctionSignatureTable,
  CheckedSemanticProgram,
} from "./checked-program";
import type { CheckedImageDevice } from "./image-device-checker";
import type {
  CheckedAttemptContractSurface,
  CheckedPrivateTransitionSurface,
  CheckedValidationContractSurface,
  ConstructibilityConstructorAuthority,
} from "./proof-contracts";
import type { CheckedResourceKind } from "./resource-kind";
import { isProofRelevantKind } from "./resource-kind";
import type { CheckedType } from "./type-model";
import { checkedTypesEqual } from "./type-model";
import { coreTypeId } from "../ids";

export interface ContractTypeIds {
  readonly resultTypeId?: TypeId;
  readonly validationTypeId?: TypeId;
  readonly attemptTypeId?: TypeId;
}

function canonicalCorePathRank(pathKey: string): number | undefined {
  const modulePath = pathKey.replace(/\.wr$/, "");
  if (modulePath === "wrela_std/core" || modulePath.startsWith("wrela_std/core/")) return 0;
  if (modulePath === "wrela_abi/core" || modulePath.startsWith("wrela_abi/core/")) return 1;
  return undefined;
}

function isCanonicalStdlibCorePath(pathKey: string): boolean {
  return canonicalCorePathRank(pathKey) !== undefined;
}

function canonicalStdlibTypeId(input: {
  readonly index: ItemIndex;
  readonly name: string;
}): TypeId | undefined {
  const candidates = input.index
    .types()
    .filter((typeRecord) => {
      if (typeRecord.name !== input.name) return false;
      const moduleRecord = input.index.module(typeRecord.moduleId);
      return moduleRecord !== undefined && isCanonicalStdlibCorePath(moduleRecord.pathKey);
    })
    .sort((left, right) => {
      const leftModule = input.index.module(left.moduleId)?.pathKey ?? "";
      const rightModule = input.index.module(right.moduleId)?.pathKey ?? "";
      const rankDelta =
        (canonicalCorePathRank(leftModule) ?? Number.MAX_SAFE_INTEGER) -
        (canonicalCorePathRank(rightModule) ?? Number.MAX_SAFE_INTEGER);
      if (rankDelta !== 0) return rankDelta;
      if (leftModule < rightModule) return -1;
      if (leftModule > rightModule) return 1;
      return (left.id as number) - (right.id as number);
    });

  return candidates[0]?.id;
}

export function resolveCanonicalStdlibContractTypeIds(index: ItemIndex): ContractTypeIds {
  return Object.freeze({
    resultTypeId: canonicalStdlibTypeId({ index, name: "Result" }),
    validationTypeId: canonicalStdlibTypeId({ index, name: "Validation" }),
    attemptTypeId: canonicalStdlibTypeId({ index, name: "Attempt" }),
  });
}

function isPrivateStateKind(kind: CheckedResourceKind): boolean {
  return kind.kind === "concrete" && kind.value === "PrivateState";
}

function isNeverReturn(signature: CheckedFunctionSignature): boolean {
  return (
    (signature.returnKind.kind === "concrete" && signature.returnKind.value === "Never") ||
    (signature.returnType.kind === "core" &&
      signature.returnType.coreTypeId === coreTypeId("Never"))
  );
}

function firstPrivateStateInput(signature: CheckedFunctionSignature):
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

export function privateTransitionsFromSignatures(input: {
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

function appliedSourceTypeWithConstructorId(input: {
  readonly type: CheckedType;
  readonly typeId: TypeId | undefined;
}): import("./type-model").AppliedCheckedType | undefined {
  if (input.typeId === undefined) return undefined;
  if (input.type.kind !== "applied" || input.type.constructor.kind !== "source") return undefined;
  return input.type.constructor.typeId === input.typeId ? input.type : undefined;
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

function isSourceResultAttemptShape(input: {
  readonly signature: CheckedFunctionSignature;
  readonly contractTypeIds: ContractTypeIds;
}):
  | {
      readonly resultType: CheckedType;
      readonly okType: CheckedType;
      readonly errType: CheckedType;
    }
  | undefined {
  const resultType = appliedSourceTypeWithConstructorId({
    type: input.signature.returnType,
    typeId: input.contractTypeIds.resultTypeId,
  });
  if (resultType === undefined || resultType.arguments.length !== 2) return undefined;
  return {
    resultType: input.signature.returnType,
    okType: resultType.arguments[0]!,
    errType: resultType.arguments[1]!,
  };
}

function isAttemptInputResourceKind(kind: CheckedResourceKind): boolean {
  switch (kind.kind) {
    case "concrete":
      return kind.value !== "Copy" && kind.value !== "Never";
    case "parametric":
    case "derived":
      return true;
    case "error":
      return false;
  }
}

function inferredResultAttemptInputs(
  signature: CheckedFunctionSignature,
): readonly CheckedAttemptContractSurface["inputs"][number][] {
  const inputs: CheckedAttemptContractSurface["inputs"][number][] = [];
  if (
    signature.receiver !== undefined &&
    (isAttemptInputResourceKind(signature.receiver.resourceKind) ||
      (signature.receiver.resourceKind.kind === "concrete" &&
        isProofRelevantKind(signature.receiver.resourceKind.value)))
  ) {
    inputs.push({ kind: "receiver" });
  }
  for (const parameter of signature.parameters) {
    if (
      parameter.mode === "consume" ||
      isAttemptInputResourceKind(parameter.resourceKind) ||
      (parameter.resourceKind.kind === "concrete" &&
        isProofRelevantKind(parameter.resourceKind.value))
    ) {
      inputs.push({ kind: "parameter", parameterId: parameter.parameterId });
    }
  }
  return inputs;
}

export function sourceValidationContractsFromSignatures(input: {
  readonly signatures: CheckedFunctionSignatureTable;
  readonly index: ItemIndex;
  readonly contractTypeIds: ContractTypeIds;
}): CheckedValidationContractSurface[] {
  const contracts: CheckedValidationContractSurface[] = [];
  for (const signature of input.signatures.entries()) {
    const resultType = appliedSourceTypeWithConstructorId({
      type: signature.returnType,
      typeId: input.contractTypeIds.validationTypeId,
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

export function sourceAttemptContractsFromSignatures(input: {
  readonly signatures: CheckedFunctionSignatureTable;
  readonly index: ItemIndex;
  readonly contractTypeIds: ContractTypeIds;
}): CheckedAttemptContractSurface[] {
  const contracts: CheckedAttemptContractSurface[] = [];
  for (const signature of input.signatures.entries()) {
    const explicitAttemptType = appliedSourceTypeWithConstructorId({
      type: signature.returnType,
      typeId: input.contractTypeIds.attemptTypeId,
    });
    if (explicitAttemptType !== undefined && explicitAttemptType.arguments.length >= 3) {
      const inputs: CheckedAttemptContractSurface["inputs"][number][] = [];
      let allInputsMapped = true;
      for (const inputType of explicitAttemptType.arguments.slice(2)) {
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
        okType: explicitAttemptType.arguments[0]!,
        errType: explicitAttemptType.arguments[1]!,
        inputs,
        span: signature.sourceSpan,
      });
      continue;
    }

    const resultAttempt = isSourceResultAttemptShape({
      signature,
      contractTypeIds: input.contractTypeIds,
    });
    if (resultAttempt === undefined) continue;

    const inputs = inferredResultAttemptInputs(signature);
    if (inputs.length === 0) continue;

    const uniqueInputKeys = new Set(inputs.map(attemptInputKey));
    if (uniqueInputKeys.size !== inputs.length) continue;

    contracts.push({
      fallibleFunctionId: signature.functionId,
      resultType: resultAttempt.resultType,
      okType: resultAttempt.okType,
      errType: resultAttempt.errType,
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

export function constructibilityDeclarationAuthorities(input: {
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

export function constructibilityConstructorAuthorities(input: {
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

export function constructibilityImageAuthorities(
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

export function constructibilityPlatformAuthorities(input: {
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
