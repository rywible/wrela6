import type {
  MonoCheckedType,
  MonoEnumCaseRecord,
  MonoMatchArm,
  MonoMatchStatement,
} from "../../mono/mono-hir";
import type { MonomorphizedHirProgram } from "../../mono/mono-hir";
import type { ProofMirLoweringContext } from "./lowering-context";

export function isWildcardPattern(patternText: string): boolean {
  const trimmed = patternText.trim();
  return trimmed === "_" || trimmed.endsWith("._");
}

export function caseLabelFromPattern(patternText: string): string {
  const segments = patternText.split(".");
  return segments[segments.length - 1] ?? patternText;
}

export function armOwnsScope(arm: MonoMatchArm): boolean {
  return arm.bindingLocals.length > 0;
}

function enumCasesForScrutineeType(
  program: MonomorphizedHirProgram,
  scrutineeType: MonoCheckedType,
): readonly MonoEnumCaseRecord[] | undefined {
  if (scrutineeType.kind !== "source") return undefined;
  for (const typeInstance of program.types.entries()) {
    if (
      typeInstance.sourceTypeId === scrutineeType.typeId &&
      typeInstance.sourceItemId === scrutineeType.itemId &&
      typeInstance.enumCases.length > 0
    ) {
      return typeInstance.enumCases;
    }
  }
  return undefined;
}

function resultLikeConstructorName(
  program: MonomorphizedHirProgram,
  scrutineeType: MonoCheckedType,
): string | undefined {
  if (scrutineeType.kind !== "applied") return undefined;
  const constructor = scrutineeType.constructor;
  if (constructor.kind !== "source") return undefined;
  if (scrutineeType.arguments.length < 2) return undefined;
  return program.types
    .entries()
    .find((typeInstance) => typeInstance.sourceTypeId === constructor.typeId)?.sourceName;
}

function hasResultLikeExhaustivenessEvidence(input: {
  readonly context: ProofMirLoweringContext;
  readonly matchStatement: MonoMatchStatement;
}): boolean {
  const constructorName = resultLikeConstructorName(
    input.context.program,
    input.matchStatement.scrutinee.type,
  );
  if (constructorName !== "Result" && constructorName !== "Validation") return false;
  const labels = input.matchStatement.arms
    .filter((arm) => !isWildcardPattern(arm.patternText))
    .map((arm) => caseLabelFromPattern(arm.patternText));
  if (labels.length !== 2) return false;
  const covered = new Set(labels);
  return covered.size === 2 && covered.has("Ok") && covered.has("Err");
}

export function hasMonoSwitchExhaustivenessEvidence(input: {
  readonly context: ProofMirLoweringContext;
  readonly matchStatement: MonoMatchStatement;
  readonly monoExhaustiveOverride?: boolean;
}): boolean {
  if (input.monoExhaustiveOverride !== undefined) return input.monoExhaustiveOverride;
  if (input.matchStatement.arms.some((arm) => isWildcardPattern(arm.patternText))) return true;
  if (hasResultLikeExhaustivenessEvidence(input)) return true;
  const enumCases = enumCasesForScrutineeType(
    input.context.program,
    input.matchStatement.scrutinee.type,
  );
  if (enumCases === undefined) return false;
  const coveredPatterns = new Set(
    input.matchStatement.arms
      .filter((arm) => !isWildcardPattern(arm.patternText))
      .map((arm) => caseLabelFromPattern(arm.patternText)),
  );
  return enumCases.every((enumCase) => coveredPatterns.has(enumCase.name));
}
