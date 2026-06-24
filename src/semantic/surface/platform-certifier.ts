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

    if (primitive.proofContract.ensuredFacts.length > 0) {
      diagnostics.push(
        platformContractNotExact(
          functionName,
          `target has ${primitive.proofContract.ensuredFacts.length} ensured facts, source cannot declare them`,
          signature.sourceSpan,
          source,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      contractExact = false;
    }

    if (!contractExact) continue;

    const sigFingerprint = checkedFunctionSignatureFingerprint(signature);
    const sourceFacts = sourceRequires.map(sourceRequirementFingerprint).join(",");
    const targetFacts = primitive.proofContract.requiredFacts
      .map((fact) => targetRequirementFingerprint(fact.text))
      .join(",");
    const ensuredFacts = primitive.proofContract.ensuredFacts
      .map((fact) => targetRequirementFingerprint(fact.text))
      .join(",");
    const proofContractFingerprint = `source:${sourceFacts}|target:${targetFacts}|ensured:${ensuredFacts}`;

    bindings.push(
      certifiedBindingFor(
        input.targetSurface.targetId,
        binding,
        primitive,
        signature.functionId,
        signature.itemId,
        sigFingerprint,
        proofContractFingerprint,
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
