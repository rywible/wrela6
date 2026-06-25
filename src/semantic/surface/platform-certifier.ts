import type { FunctionId, ItemId, PlatformPrimitiveFamilyId, TargetId } from "../ids";
import type { ItemIndex } from "../item-index";
import type { ResolvedPlatformBindings, PlatformPrimitiveBinding } from "../names";
import type {
  CheckedFunctionSignatureTable,
  CheckedFunctionSignature,
  CertifiedPlatformBinding,
  CertifiedPlatformBindingTable,
} from "./checked-program";
import type {
  SemanticTargetSurface,
  PlatformPrimitiveSpec,
  TargetAvailability,
  TargetEnsuredFactSurface,
  TargetEnsuredFactArgument,
  TargetAttemptContractSurface,
  TargetTakeModeContractSurface,
  TargetValidationContractSurface,
} from "./platform-surface";
import {
  targetSignatureExactlyMatches,
  checkedFunctionSignatureFingerprint,
} from "./signature-checker";
import type { CheckedProofSurface } from "./proof-surface";
import type { CheckedRequirementSurface } from "./proof-surface";
import type { TargetAvailabilityContext } from "./image-root-selection";
import type { ModuleId } from "../ids";
import type { SemanticSurfaceDiagnostic, SemanticSurfaceDiagnosticOrder } from "./diagnostics";
import type { SourceSpan, SourceText } from "../../frontend";
import {
  missingPlatformBinding,
  platformPrimitiveCatalogEntryMissing,
  platformPrimitiveSignatureMismatch,
  illegalPlatformShape,
  targetUnavailablePlatformPrimitive,
} from "./diagnostics";
import { platformContractNotExact } from "./diagnostics";
import { sortSemanticSurfaceDiagnostics } from "./diagnostics";
import type {
  CheckedAttemptContractSurface,
  CheckedPlatformEnsuredFact,
  CheckedTakeModeSurface,
  CheckedValidationContractSurface,
} from "./proof-contracts";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { checkedTypeFingerprint, checkedTypesEqual } from "./type-model";

export interface CertifyPlatformBindingsInput {
  readonly index: ItemIndex;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly signatures: CheckedFunctionSignatureTable;
  readonly proofSurface: CheckedProofSurface;
  readonly targetSurface: SemanticTargetSurface;
  readonly availability?: TargetAvailabilityContext;
  readonly availablePlatformFamilies?: readonly PlatformPrimitiveFamilyId[];
}

export interface CertifyPlatformBindingsResult {
  readonly bindings: CertifiedPlatformBindingTable;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function diagnosticSourceAndModuleId(
  index: ItemIndex,
  functionId: FunctionId,
): { source: SourceText | undefined; moduleId: ModuleId } {
  const funcRecord = index.function(functionId);
  const moduleId: ModuleId = funcRecord?.moduleId ?? (0 as ModuleId);
  let source: SourceText | undefined;
  if (funcRecord !== undefined) {
    const moduleRecord = index.module(funcRecord.moduleId);
    source = moduleRecord?.source;
  }
  return { source, moduleId };
}

function diagnosticOrder(
  moduleId: ModuleId,
  span: SourceSpan,
  codeTieBreaker: string,
): SemanticSurfaceDiagnosticOrder {
  return { moduleId, span, codeTieBreaker };
}

function functionNameFrom(index: ItemIndex, signature: CheckedFunctionSignature): string {
  const record = index.function(signature.functionId);
  return record?.name ?? `function_${signature.functionId}`;
}

function checkPlatformShape(
  signature: CheckedFunctionSignature,
  diagnostics: SemanticSurfaceDiagnostic[],
  source: SourceText | undefined,
  moduleId: ModuleId,
): boolean {
  if (signature.ownerItemId !== undefined) {
    diagnostics.push(
      illegalPlatformShape(
        "Platform functions must be freestanding, not methods",
        signature.sourceSpan,
        source,
        diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
      ),
    );
    return false;
  }
  return true;
}

function certifiedBindingFor(
  targetId: TargetId,
  binding: PlatformPrimitiveBinding,
  primitive: PlatformPrimitiveSpec,
  functionId: FunctionId,
  itemId: ItemId,
  signatureFingerprint: string,
  proofContractFingerprint: string,
  ensuredFacts: readonly {
    readonly fingerprint: string;
    readonly fact: CheckedPlatformEnsuredFact;
  }[],
  takeModeSurfaces: readonly CheckedTakeModeSurface[],
  validationContracts: readonly CheckedValidationContractSurface[],
  attemptContracts: readonly CheckedAttemptContractSurface[],
): CertifiedPlatformBinding {
  return {
    itemId,
    functionId,
    primitiveId: binding.primitiveId,
    contractId: primitive.contractId,
    targetId,
    certificate: {
      kind: "exactCatalogMatch",
      signatureFingerprint,
      proofContractFingerprint,
    },
    ensuredFacts,
    takeModeSurfaces,
    validationContracts,
    attemptContracts,
  };
}

function targetAvailabilityAllows(
  availability: TargetAvailabilityContext,
  primitiveAvailability: TargetAvailability,
): boolean {
  if (primitiveAvailability.targetId !== availability.targetId) return false;
  if (!primitiveAvailability.profiles.includes(availability.profileId)) return false;
  for (const requiredFeature of primitiveAvailability.features) {
    if (!availability.features.includes(requiredFeature)) return false;
  }
  return true;
}

function canonicalProofFactText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function sourceRequirementFingerprint(requirement: CheckedRequirementSurface): string {
  return `text:${canonicalProofFactText(requirement.expression.text)}`;
}

function targetRequirementFingerprint(text: string): string {
  return `text:${canonicalProofFactText(text)}`;
}

function targetEnsuredFactFingerprint(
  fact: Exclude<TargetEnsuredFactSurface, { kind: "rawText" }>,
): string {
  return JSON.stringify(fact);
}

function reportEnsuredFactNotExact(input: {
  readonly functionName: string;
  readonly factIndex: number;
  readonly reason: string;
  readonly signature: CheckedFunctionSignature;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
  readonly source: SourceText | undefined;
  readonly moduleId: ModuleId;
}): void {
  input.diagnostics.push(
    platformContractNotExact(
      input.functionName,
      `ensuredFacts[${input.factIndex}] ${input.reason}`,
      input.signature.sourceSpan,
      input.source,
      diagnosticOrder(input.moduleId, input.signature.sourceSpan, "platform"),
    ),
  );
}

function supportsPlatformFactArgument(input: {
  readonly argument: TargetEnsuredFactArgument;
  readonly signature: CheckedFunctionSignature;
}): boolean {
  switch (input.argument.kind) {
    case "receiver":
      return input.signature.receiver !== undefined;
    case "parameter":
      return (
        input.argument.parameterId !== undefined &&
        input.signature.parameters.some(
          (parameter) => parameter.parameterId === input.argument.parameterId,
        )
      );
    case "constant":
      return input.argument.expressionText !== undefined || input.argument.placeKey !== undefined;
  }
}

function predicateInputCount(signature: CheckedFunctionSignature): number {
  return (signature.receiver === undefined ? 0 : 1) + signature.parameters.length;
}

function checkedEnsuredFact(input: {
  readonly functionName: string;
  readonly signature: CheckedFunctionSignature;
  readonly signatures: CheckedFunctionSignatureTable;
  readonly fact: TargetEnsuredFactSurface;
  readonly factIndex: number;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
  readonly source: SourceText | undefined;
  readonly moduleId: ModuleId;
}): { readonly fingerprint: string; readonly fact: CheckedPlatformEnsuredFact } | undefined {
  if (input.fact.kind === "rawText") {
    reportEnsuredFactNotExact({
      ...input,
      reason: "uses legacy raw proof text",
    });
    return undefined;
  }

  for (const [argumentIndex, argument] of input.fact.argumentBindings.entries()) {
    if (supportsPlatformFactArgument({ argument, signature: input.signature })) continue;
    reportEnsuredFactNotExact({
      ...input,
      reason: `argumentBindings[${argumentIndex}] is not supported by the source signature`,
    });
    return undefined;
  }

  const argumentBindings = input.fact.argumentBindings.map((argument) => ({ ...argument }));
  if (input.fact.kind === "predicate") {
    const predicateSignature = input.signatures.get(input.fact.predicateFunctionId);
    if (predicateSignature === undefined || !predicateSignature.modifiers.isPredicate) {
      reportEnsuredFactNotExact({
        ...input,
        reason: "predicate function is not a checked source predicate",
      });
      return undefined;
    }
    if (argumentBindings.length !== predicateInputCount(predicateSignature)) {
      reportEnsuredFactNotExact({
        ...input,
        reason: "predicate argument binding count does not match source predicate signature",
      });
      return undefined;
    }
    return {
      fingerprint: targetEnsuredFactFingerprint(input.fact),
      fact: {
        kind: "predicate",
        predicateFunctionId: input.fact.predicateFunctionId,
        argumentBindings,
      },
    };
  }
  return {
    fingerprint: targetEnsuredFactFingerprint(input.fact),
    fact: {
      kind: "state",
      stateKind: input.fact.stateKind,
      argumentBindings,
    },
  };
}

function targetValidationContractFingerprint(contract: TargetValidationContractSurface): string {
  return [
    "validation",
    `validated:${contract.validatedBufferTypeId}`,
    `sourceIndex:${contract.sourceParameterIndex}`,
    `result:${checkedTypeFingerprint(contract.resultType)}`,
    `source:${checkedTypeFingerprint(contract.sourceType)}`,
    `ok:${checkedTypeFingerprint(contract.okPayloadType)}`,
    `err:${checkedTypeFingerprint(contract.errPayloadType)}`,
  ].join(":");
}

function targetAttemptContractFingerprint(contract: TargetAttemptContractSurface): string {
  return [
    "attempt",
    `result:${checkedTypeFingerprint(contract.resultType)}`,
    `ok:${checkedTypeFingerprint(contract.okType)}`,
    `err:${checkedTypeFingerprint(contract.errType)}`,
    `inputs:${contract.inputs
      .map((input) =>
        input.kind === "receiver" ? "receiver" : `parameter:${input.parameterIndex}`,
      )
      .join("|")}`,
  ].join(":");
}

function targetTakeModeContractFingerprint(contract: TargetTakeModeContractSurface): string {
  if (contract.kind === "stream") {
    return [
      "take:stream",
      `item:${checkedTypeFingerprint(contract.itemType)}`,
      `kind:${JSON.stringify(contract.itemResourceKind)}`,
    ].join(":");
  }
  return [
    "take:buffer",
    `sourceType:${contract.sourceTypeId}`,
    `kind:${JSON.stringify(contract.bufferResourceKind)}`,
  ].join(":");
}

function checkedTakeModeSurfaces(input: {
  readonly functionName: string;
  readonly signature: CheckedFunctionSignature;
  readonly contracts: readonly TargetTakeModeContractSurface[];
  readonly diagnostics: SemanticSurfaceDiagnostic[];
  readonly source: SourceText | undefined;
  readonly moduleId: ModuleId;
}): { readonly surfaces: readonly CheckedTakeModeSurface[]; readonly exact: boolean } {
  const surfaces: CheckedTakeModeSurface[] = [];
  let exact = true;

  for (const [contractIndex, contract] of input.contracts.entries()) {
    if (contract.kind === "stream") {
      if (
        input.signature.returnKind.kind !== "concrete" ||
        input.signature.returnKind.value !== "Stream"
      ) {
        input.diagnostics.push(
          platformContractNotExact(
            input.functionName,
            `takeModeContracts[${contractIndex}] stream result kind mismatch`,
            input.signature.sourceSpan,
            input.source,
            diagnosticOrder(input.moduleId, input.signature.sourceSpan, "platform"),
          ),
        );
        exact = false;
        continue;
      }
      surfaces.push({
        kind: "stream",
        producerFunctionId: input.signature.functionId,
        itemType: contract.itemType,
        itemResourceKind: contract.itemResourceKind,
        span: input.signature.sourceSpan,
      });
      continue;
    }

    surfaces.push({
      kind: "buffer",
      sourceTypeId: contract.sourceTypeId,
      bufferResourceKind: contract.bufferResourceKind,
      span: input.signature.sourceSpan,
    });
  }

  return { surfaces, exact };
}

function checkedValidationContracts(input: {
  readonly functionName: string;
  readonly signature: CheckedFunctionSignature;
  readonly contracts: readonly TargetValidationContractSurface[];
  readonly diagnostics: SemanticSurfaceDiagnostic[];
  readonly source: SourceText | undefined;
  readonly moduleId: ModuleId;
}): { readonly contracts: readonly CheckedValidationContractSurface[]; readonly exact: boolean } {
  const checkedContracts: CheckedValidationContractSurface[] = [];
  let exact = true;

  for (const [contractIndex, contract] of input.contracts.entries()) {
    const sourceParameter = input.signature.parameters[contract.sourceParameterIndex];
    if (sourceParameter === undefined) {
      input.diagnostics.push(
        platformContractNotExact(
          input.functionName,
          `validationContracts[${contractIndex}] source parameter index missing`,
          input.signature.sourceSpan,
          input.source,
          diagnosticOrder(input.moduleId, input.signature.sourceSpan, "platform"),
        ),
      );
      exact = false;
      continue;
    }
    if (!checkedTypesEqual(input.signature.returnType, contract.resultType)) {
      input.diagnostics.push(
        platformContractNotExact(
          input.functionName,
          `validationContracts[${contractIndex}] result type mismatch`,
          input.signature.sourceSpan,
          input.source,
          diagnosticOrder(input.moduleId, input.signature.sourceSpan, "platform"),
        ),
      );
      exact = false;
      continue;
    }
    if (!checkedTypesEqual(sourceParameter.type, contract.sourceType)) {
      input.diagnostics.push(
        platformContractNotExact(
          input.functionName,
          `validationContracts[${contractIndex}] source type mismatch`,
          input.signature.sourceSpan,
          input.source,
          diagnosticOrder(input.moduleId, input.signature.sourceSpan, "platform"),
        ),
      );
      exact = false;
      continue;
    }
    checkedContracts.push({
      validatedBufferTypeId: contract.validatedBufferTypeId,
      resultType: contract.resultType,
      sourceType: contract.sourceType,
      okPayloadType: contract.okPayloadType,
      errPayloadType: contract.errPayloadType,
      sourceParameterId: sourceParameter.parameterId,
      span: input.signature.sourceSpan,
    });
  }

  return { contracts: checkedContracts, exact };
}

function checkedAttemptContracts(input: {
  readonly functionName: string;
  readonly signature: CheckedFunctionSignature;
  readonly contracts: readonly TargetAttemptContractSurface[];
  readonly diagnostics: SemanticSurfaceDiagnostic[];
  readonly source: SourceText | undefined;
  readonly moduleId: ModuleId;
}): { readonly contracts: readonly CheckedAttemptContractSurface[]; readonly exact: boolean } {
  const checkedContracts: CheckedAttemptContractSurface[] = [];
  let exact = true;

  for (const [contractIndex, contract] of input.contracts.entries()) {
    if (!checkedTypesEqual(input.signature.returnType, contract.resultType)) {
      input.diagnostics.push(
        platformContractNotExact(
          input.functionName,
          `attemptContracts[${contractIndex}] result type mismatch`,
          input.signature.sourceSpan,
          input.source,
          diagnosticOrder(input.moduleId, input.signature.sourceSpan, "platform"),
        ),
      );
      exact = false;
      continue;
    }

    const inputs: Array<CheckedAttemptContractSurface["inputs"][number]> = [];
    let contractExact = true;
    for (const [inputIndex, sourceInput] of contract.inputs.entries()) {
      if (sourceInput.kind === "receiver") {
        if (input.signature.receiver === undefined) {
          input.diagnostics.push(
            platformContractNotExact(
              input.functionName,
              `attemptContracts[${contractIndex}].inputs[${inputIndex}] receiver missing`,
              input.signature.sourceSpan,
              input.source,
              diagnosticOrder(input.moduleId, input.signature.sourceSpan, "platform"),
            ),
          );
          contractExact = false;
          continue;
        }
        inputs.push({ kind: "receiver" });
        continue;
      }

      const parameter = input.signature.parameters[sourceInput.parameterIndex];
      if (parameter === undefined) {
        input.diagnostics.push(
          platformContractNotExact(
            input.functionName,
            `attemptContracts[${contractIndex}].inputs[${inputIndex}] parameter missing`,
            input.signature.sourceSpan,
            input.source,
            diagnosticOrder(input.moduleId, input.signature.sourceSpan, "platform"),
          ),
        );
        contractExact = false;
        continue;
      }
      inputs.push({ kind: "parameter", parameterId: parameter.parameterId });
    }

    if (!contractExact) {
      exact = false;
      continue;
    }

    checkedContracts.push({
      fallibleFunctionId: input.signature.functionId,
      resultType: contract.resultType,
      okType: contract.okType,
      errType: contract.errType,
      inputs,
      span: input.signature.sourceSpan,
    });
  }

  return { contracts: checkedContracts, exact };
}

export function certifyPlatformBindings(
  input: CertifyPlatformBindingsInput,
): CertifyPlatformBindingsResult {
  const diagnostics: SemanticSurfaceDiagnostic[] = [];
  const bindings: CertifiedPlatformBinding[] = [];

  for (const signature of input.signatures.entries()) {
    if (!signature.modifiers.isPlatform) continue;

    const { source, moduleId } = diagnosticSourceAndModuleId(input.index, signature.functionId);
    const functionName = functionNameFrom(input.index, signature);

    if (!checkPlatformShape(signature, diagnostics, source, moduleId)) continue;

    const binding = input.platformBindings.get(signature.functionId);
    if (binding === undefined) {
      diagnostics.push(
        missingPlatformBinding(
          functionName,
          signature.sourceSpan,
          source,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      continue;
    }

    const primitive = input.targetSurface.platformPrimitives.get(binding.primitiveId);
    if (primitive === undefined) {
      diagnostics.push(
        platformPrimitiveCatalogEntryMissing(
          binding.primitiveId,
          functionName,
          signature.sourceSpan,
          source,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      continue;
    }

    if (
      input.availability !== undefined &&
      !targetAvailabilityAllows(input.availability, primitive.availability)
    ) {
      diagnostics.push(
        targetUnavailablePlatformPrimitive(
          functionName,
          binding.primitiveId,
          signature.sourceSpan,
          source,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      continue;
    }

    if (
      input.availablePlatformFamilies !== undefined &&
      input.availablePlatformFamilies.length > 0 &&
      primitive.primitiveFamilyId !== undefined &&
      !input.availablePlatformFamilies.includes(primitive.primitiveFamilyId)
    ) {
      diagnostics.push(
        targetUnavailablePlatformPrimitive(
          functionName,
          binding.primitiveId,
          signature.sourceSpan,
          source,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      continue;
    }

    if (!targetSignatureExactlyMatches(signature, primitive.signature)) {
      diagnostics.push(
        platformPrimitiveSignatureMismatch({
          source,
          span: signature.sourceSpan,
          order: diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
          functionName,
          reason: "Signature does not match target catalog",
        }),
      );
      continue;
    }

    const sourceRequires = input.proofSurface.requirementSurfaces.get(signature.functionId) ?? [];
    if (sourceRequires.length !== primitive.proofContract.requiredFacts.length) {
      diagnostics.push(
        platformContractNotExact(
          functionName,
          `expected ${primitive.proofContract.requiredFacts.length} requires, got ${sourceRequires.length}`,
          signature.sourceSpan,
          source,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      continue;
    }
    let contractExact = true;
    for (let requirementIndex = 0; requirementIndex < sourceRequires.length; requirementIndex++) {
      const sourceFingerprint = sourceRequirementFingerprint(sourceRequires[requirementIndex]!);
      const targetFingerprint = targetRequirementFingerprint(
        primitive.proofContract.requiredFacts[requirementIndex]!.text,
      );
      if (sourceFingerprint !== targetFingerprint) {
        diagnostics.push(
          platformContractNotExact(
            functionName,
            `requires[${requirementIndex}] fingerprint mismatch`,
            signature.sourceSpan,
            source,
            diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
          ),
        );
        contractExact = false;
      }
    }

    const checkedEnsuredFacts: {
      readonly fingerprint: string;
      readonly fact: CheckedPlatformEnsuredFact;
    }[] = [];
    for (const [factIndex, fact] of primitive.proofContract.ensuredFacts.entries()) {
      const checkedFact = checkedEnsuredFact({
        functionName,
        signature,
        signatures: input.signatures,
        fact,
        factIndex,
        diagnostics,
        source,
        moduleId,
      });
      if (checkedFact === undefined) {
        contractExact = false;
        continue;
      }
      checkedEnsuredFacts.push(checkedFact);
    }

    const takeModeResult = checkedTakeModeSurfaces({
      functionName,
      signature,
      contracts: primitive.proofContract.takeModeContracts ?? [],
      diagnostics,
      source,
      moduleId,
    });
    if (!takeModeResult.exact) contractExact = false;

    const validationContractResult = checkedValidationContracts({
      functionName,
      signature,
      contracts: primitive.proofContract.validationContracts ?? [],
      diagnostics,
      source,
      moduleId,
    });
    if (!validationContractResult.exact) contractExact = false;

    const attemptContractResult = checkedAttemptContracts({
      functionName,
      signature,
      contracts: primitive.proofContract.attemptContracts ?? [],
      diagnostics,
      source,
      moduleId,
    });
    if (!attemptContractResult.exact) contractExact = false;

    if (!contractExact) continue;

    const sigFingerprint = checkedFunctionSignatureFingerprint(signature);
    const sourceFacts = sourceRequires.map(sourceRequirementFingerprint).join(",");
    const targetFacts = primitive.proofContract.requiredFacts
      .map((fact) => targetRequirementFingerprint(fact.text))
      .join(",");
    const ensuredFacts = primitive.proofContract.ensuredFacts
      .map((fact) =>
        fact.kind === "rawText"
          ? targetRequirementFingerprint(fact.text)
          : targetEnsuredFactFingerprint(fact),
      )
      .sort(compareCodeUnitStrings)
      .join(",");
    const validationContracts = (primitive.proofContract.validationContracts ?? [])
      .map(targetValidationContractFingerprint)
      .sort(compareCodeUnitStrings)
      .join(",");
    const attemptContracts = (primitive.proofContract.attemptContracts ?? [])
      .map(targetAttemptContractFingerprint)
      .sort(compareCodeUnitStrings)
      .join(",");
    const takeModeContracts = (primitive.proofContract.takeModeContracts ?? [])
      .map(targetTakeModeContractFingerprint)
      .sort(compareCodeUnitStrings)
      .join(",");
    const proofContractFingerprint = [
      `source:${sourceFacts}`,
      `target:${targetFacts}`,
      `ensured:${ensuredFacts}`,
      `take:${takeModeContracts}`,
      `validation:${validationContracts}`,
      `attempt:${attemptContracts}`,
    ].join("|");

    bindings.push(
      certifiedBindingFor(
        input.targetSurface.targetId,
        binding,
        primitive,
        signature.functionId,
        signature.itemId,
        sigFingerprint,
        proofContractFingerprint,
        checkedEnsuredFacts.sort((left, right) =>
          compareCodeUnitStrings(left.fingerprint, right.fingerprint),
        ),
        takeModeResult.surfaces,
        validationContractResult.contracts,
        attemptContractResult.contracts,
      ),
    );
  }

  const sorted = [...bindings].sort(
    (left, right) => (left.functionId as number) - (right.functionId as number),
  );
  const byId = new Map(sorted.map((entry) => [entry.functionId, entry]));
  const bindingTable: CertifiedPlatformBindingTable = {
    get: (functionId) => byId.get(functionId),
    entries: () => [...sorted],
  };

  return {
    bindings: bindingTable,
    diagnostics: sortSemanticSurfaceDiagnostics(diagnostics),
  };
}
