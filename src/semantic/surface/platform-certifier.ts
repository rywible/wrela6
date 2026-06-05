import type { FunctionId, ItemId, TargetId } from "../ids";
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
import type { TargetAvailabilityContext } from "./image-root-selection";
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
  readonly availability: TargetAvailabilityContext;
}

export interface CertifyPlatformBindingsResult {
  readonly bindings: CertifiedPlatformBindingTable;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

function diagnosticSourceAndModuleId(
  index: ItemIndex,
  functionId: FunctionId,
): { source: SourceText | undefined; moduleId: any } {
  const funcRecord = index.function(functionId);
  const moduleId = funcRecord?.moduleId ?? (0 as any);
  let source: SourceText | undefined;
  if (funcRecord !== undefined) {
    const moduleRecord = index.module(funcRecord.moduleId);
    source = moduleRecord?.source;
  }
  return { source, moduleId };
}

function diagnosticOrder(
  moduleId: any,
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
  moduleId: any,
): boolean {
  if (signature.ownerItemId !== undefined) {
    diagnostics.push(
      illegalPlatformShape(
        "Platform functions must be freestanding, not methods",
        signature.sourceSpan,
        source as any,
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
  return primitiveAvailability.profiles.includes(availability.profileId);
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
          source as any,
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
          source as any,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      continue;
    }

    if (!targetAvailabilityAllows(input.availability, primitive.availability)) {
      diagnostics.push(
        targetUnavailablePlatformPrimitive(
          functionName,
          binding.primitiveId,
          signature.sourceSpan,
          source as any,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      continue;
    }

    if (!targetSignatureExactlyMatches(signature, primitive.signature)) {
      diagnostics.push(
        platformPrimitiveSignatureMismatch({
          source: source as any,
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
          source as any,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      continue;
    }
    let contractExact = true;
    for (let requirementIndex = 0; requirementIndex < sourceRequires.length; requirementIndex++) {
      const sourceText = sourceRequires[requirementIndex]!.expression.text;
      const targetText = primitive.proofContract.requiredFacts[requirementIndex]!.text;
      if (sourceText !== targetText) {
        diagnostics.push(
          platformContractNotExact(
            functionName,
            `requires[${requirementIndex}] text mismatch: expected '${targetText}', got '${sourceText}'`,
            signature.sourceSpan,
            source as any,
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
          source as any,
          diagnosticOrder(moduleId, signature.sourceSpan, "platform"),
        ),
      );
      contractExact = false;
    }

    if (!contractExact) continue;

    const sigFingerprint = checkedFunctionSignatureFingerprint(signature);
    const sourceFacts = sourceRequires.map((req) => req.expression.text).join(",");
    const targetFacts = primitive.proofContract.requiredFacts.map((fact) => fact.text).join(",");
    const ensuredFacts = primitive.proofContract.ensuredFacts.map((fact) => fact.text).join(",");
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
    entries: () => sorted,
  };

  return {
    bindings: bindingTable,
    diagnostics: sortSemanticSurfaceDiagnostics(diagnostics),
  };
}
