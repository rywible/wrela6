import type { SourceSpan } from "../shared/source-span";
import type { FunctionId, ModuleId } from "../semantic/ids";
import { moduleId } from "../semantic/ids";
import { isProofRelevantKind, type CheckedResourceKind } from "../semantic/surface/resource-kind";
import type { CheckedType } from "../semantic/surface/type-model";
import type { CheckedConstructibilitySurfaceTable } from "../semantic/surface/proof-contracts";
import type { HirDiagnostic } from "./diagnostics";
import { hirDiagnostic } from "./lowering-context";

export interface CheckConstructibilityResult {
  readonly allowed: boolean;
  readonly diagnostics: readonly HirDiagnostic[];
}

function targetTypeId(type: CheckedType) {
  if (type.kind === "source") return type.typeId;
  if (type.kind === "applied" && type.constructor.kind === "source") return type.constructor.typeId;
  return undefined;
}

function isSpecialKind(kind: CheckedResourceKind): boolean {
  return kind.kind === "concrete" && isProofRelevantKind(kind.value);
}

function forgedConstructionDiagnostic(
  span: SourceSpan,
  diagnosticModuleId: ModuleId,
): HirDiagnostic {
  return hirDiagnostic({
    code: "HIR_FORGED_SEALED_CONSTRUCTION",
    message: "Construction of a proof-relevant or sealed value lacks checked authority.",
    spanStart: span.start,
    spanEnd: span.end,
    moduleId: diagnosticModuleId,
    ownerKey: "constructibility",
    originKey: `${span.start}:${span.end}`,
    stableDetail: "forged",
  });
}

export function checkConstructibility(input: {
  readonly targetType: CheckedType;
  readonly targetKind: CheckedResourceKind;
  readonly constructorFunctionId: FunctionId | undefined;
  readonly surfaces: CheckedConstructibilitySurfaceTable;
  readonly sourceOrigin: SourceSpan;
  readonly moduleId?: ModuleId;
}): CheckConstructibilityResult {
  const typeId = targetTypeId(input.targetType);
  if (typeId === undefined) return { allowed: true, diagnostics: [] };

  const authorizations = input.surfaces.get(typeId);
  const matchingAuthorization = authorizations.find((surface) => {
    if (surface.constructorFunctionId !== undefined) {
      return surface.constructorFunctionId === input.constructorFunctionId;
    }
    return input.constructorFunctionId === undefined || surface.authorization === "ordinary";
  });

  if (matchingAuthorization !== undefined) return { allowed: true, diagnostics: [] };
  if (!isSpecialKind(input.targetKind)) return { allowed: true, diagnostics: [] };

  return {
    allowed: false,
    diagnostics: [forgedConstructionDiagnostic(input.sourceOrigin, input.moduleId ?? moduleId(0))],
  };
}
