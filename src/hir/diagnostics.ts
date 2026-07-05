import { compareCodeUnitStrings } from "./deterministic-sort";
import type { FunctionId, ItemId, ModuleId } from "../semantic/ids";
import type { SourceSpan } from "../shared/source-span";
import type { SourceText } from "../frontend";
import type { HirOriginId } from "./ids";

export const HIR_DIAGNOSTIC_CODES = [
  "HIR_BODYLESS_RECOVERY",
  "HIR_LOCAL_NAME_SHADOWS",
  "HIR_UNSUPPORTED_PATTERN",
  "HIR_INTEGER_LITERAL_OUT_OF_RANGE",
  "HIR_IMAGE_NAME_NOT_A_VALUE",
  "HIR_NAME_REFERENCE_MISSING",
  "HIR_MEMBER_REFERENCE_MISSING",
  "HIR_MEMBER_REFERENCE_MISMATCH",
  "HIR_UNSUPPORTED_EXPRESSION",
  "HIR_EXPRESSION_TYPE_MISMATCH",
  "HIR_BINARY_OPERAND_TYPE_MISMATCH",
  "HIR_ARITHMETIC_REQUIRES_INTEGER",
  "HIR_OBJECT_LITERAL_TYPE_REQUIRED",
  "HIR_OBJECT_FIELD_TYPE_MISMATCH",
  "HIR_NON_PLACE_ASSIGNMENT_TARGET",
  "HIR_CONDITION_NOT_BOOL",
  "HIR_RETURN_TYPE_MISMATCH",
  "HIR_YIELD_TYPE_MISMATCH",
  "HIR_FEATURE_NOT_AVAILABLE_ON_TARGET",
  "HIR_CALL_CALLEE_NOT_FUNCTION",
  "HIR_CALL_ARGUMENT_MISMATCH",
  "HIR_EXPLICIT_TYPE_ARGUMENT_NOT_TYPE",
  "HIR_WRONG_GENERIC_ARGUMENT_COUNT",
  "HIR_UNRESOLVED_GENERIC_ARGUMENT",
  "HIR_CONFLICTING_GENERIC_ARGUMENT",
  "HIR_GENERIC_BOUND_NOT_SATISFIED",
  "HIR_FORGED_SEALED_CONSTRUCTION",
  "HIR_UNLOWERABLE_REQUIREMENT",
  "HIR_UNSUPPORTED_REQUIREMENT_FORM",
  "HIR_REQUIREMENT_REFERENCE_MISMATCH",
  "HIR_UNCLASSIFIED_TAKE",
  "HIR_TAKE_ONLY_CALL_REQUIRED",
  "HIR_UNLINKED_VALIDATION_MATCH",
  "HIR_AMBIGUOUS_VALIDATION_MATCH",
  "HIR_UNLINKED_ATTEMPT_CONTRACT",
  "HIR_ATTEMPT_INPUT_NOT_PLACE",
  "HIR_PROOF_RELEVANT_KIND_NOT_CONCRETE",
  "HIR_PLATFORM_ENSURE_NOT_CERTIFIED",
  "HIR_MATCH_REFINEMENT_UNSUPPORTED",
  "HIR_INPUT_SURFACE_DISAGREEMENT",
  "HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING",
  "HIR_VALIDATED_BUFFER_REQUIREMENT_FAILED",
  "HIR_UNSUPPORTED_LAYOUT_EXPRESSION",
  "HIR_IMAGE_DEVICE_SURFACE_MISSING",
  "HIR_IMAGE_ENTRY_SURFACE_MISSING",
] as const;

export type HirDiagnosticCode = (typeof HIR_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "HirDiagnosticCode";
};

const HIR_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(HIR_DIAGNOSTIC_CODES);

export function hirDiagnosticCode(code: string): HirDiagnosticCode {
  if (!HIR_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown HIR diagnostic code: ${code}.`);
  }
  return code as HirDiagnosticCode;
}

export const HIR_DIAGNOSTIC_FIRST_EMITTER = {
  HIR_BODYLESS_RECOVERY: "Task 11",
  HIR_LOCAL_NAME_SHADOWS: "Task 13",
  HIR_UNSUPPORTED_PATTERN: "Task 18",
  HIR_INTEGER_LITERAL_OUT_OF_RANGE: "Task 15",
  HIR_IMAGE_NAME_NOT_A_VALUE: "Task 15",
  HIR_NAME_REFERENCE_MISSING: "Task 15",
  HIR_MEMBER_REFERENCE_MISSING: "Task 15",
  HIR_MEMBER_REFERENCE_MISMATCH: "Task 15",
  HIR_UNSUPPORTED_EXPRESSION: "Task 15",
  HIR_EXPRESSION_TYPE_MISMATCH: "Task 15",
  HIR_BINARY_OPERAND_TYPE_MISMATCH: "Task 15",
  HIR_ARITHMETIC_REQUIRES_INTEGER: "Task 15",
  HIR_OBJECT_LITERAL_TYPE_REQUIRED: "Task 15",
  HIR_OBJECT_FIELD_TYPE_MISMATCH: "Task 15",
  HIR_NON_PLACE_ASSIGNMENT_TARGET: "Task 18",
  HIR_CONDITION_NOT_BOOL: "Task 18",
  HIR_RETURN_TYPE_MISMATCH: "Task 18",
  HIR_YIELD_TYPE_MISMATCH: "Task 18",
  HIR_FEATURE_NOT_AVAILABLE_ON_TARGET: "Task 18",
  HIR_CALL_CALLEE_NOT_FUNCTION: "Task 17",
  HIR_CALL_ARGUMENT_MISMATCH: "Task 17",
  HIR_EXPLICIT_TYPE_ARGUMENT_NOT_TYPE: "Task 16",
  HIR_WRONG_GENERIC_ARGUMENT_COUNT: "Task 16",
  HIR_UNRESOLVED_GENERIC_ARGUMENT: "Task 16",
  HIR_CONFLICTING_GENERIC_ARGUMENT: "Task 16",
  HIR_GENERIC_BOUND_NOT_SATISFIED: "Task 16",
  HIR_FORGED_SEALED_CONSTRUCTION: "Task 16",
  HIR_UNLOWERABLE_REQUIREMENT: "Task 21",
  HIR_UNSUPPORTED_REQUIREMENT_FORM: "Task 21",
  HIR_REQUIREMENT_REFERENCE_MISMATCH: "Task 21",
  HIR_UNCLASSIFIED_TAKE: "Task 22",
  HIR_TAKE_ONLY_CALL_REQUIRED: "Task 22",
  HIR_UNLINKED_VALIDATION_MATCH: "Task 23",
  HIR_AMBIGUOUS_VALIDATION_MATCH: "Task 23",
  HIR_UNLINKED_ATTEMPT_CONTRACT: "Task 23",
  HIR_ATTEMPT_INPUT_NOT_PLACE: "Task 23",
  HIR_PROOF_RELEVANT_KIND_NOT_CONCRETE: "Task 22",
  HIR_PLATFORM_ENSURE_NOT_CERTIFIED: "Task 24",
  HIR_MATCH_REFINEMENT_UNSUPPORTED: "Task 24",
  HIR_INPUT_SURFACE_DISAGREEMENT: "Task 11",
  HIR_VALIDATED_BUFFER_FIELD_SURFACE_MISSING: "Task 19",
  HIR_VALIDATED_BUFFER_REQUIREMENT_FAILED: "Task 19",
  HIR_UNSUPPORTED_LAYOUT_EXPRESSION: "Task 4",
  HIR_IMAGE_DEVICE_SURFACE_MISSING: "Task 20",
  HIR_IMAGE_ENTRY_SURFACE_MISSING: "Task 20",
} satisfies Record<(typeof HIR_DIAGNOSTIC_CODES)[number], string>;

export interface HirDiagnosticRelatedInformation {
  readonly message: string;
  readonly span?: SourceSpan;
  readonly originId?: HirOriginId;
}

export interface HirDiagnostic {
  readonly code: HirDiagnosticCode;
  readonly message: string;
  readonly stableDetail: string;
  readonly span?: SourceSpan;
  readonly source?: SourceText;
  readonly moduleId?: ModuleId;
  readonly ownerItemId?: ItemId;
  readonly ownerFunctionId?: FunctionId;
  readonly originId?: HirOriginId;
  readonly relatedInformation?: readonly HirDiagnosticRelatedInformation[];
  readonly order: HirDiagnosticOrder;
}

export interface HirDiagnosticOrder {
  readonly moduleId: ModuleId;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly ownerKey: string;
  readonly originKey: string;
  readonly code: HirDiagnosticCode;
  readonly originId?: HirOriginId;
  readonly tieBreaker: string;
}

export function hirDiagnosticTieBreaker(input: {
  readonly ownerKey: string;
  readonly originKey: string;
  readonly code: HirDiagnosticCode;
  readonly stableDetail: string;
}): string {
  return `owner:${input.ownerKey}/origin:${input.originKey}/code:${input.code}/detail:${input.stableDetail}`;
}

export function sortHirDiagnostics(diagnostics: readonly HirDiagnostic[]): HirDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const moduleCmp = (left.order.moduleId as number) - (right.order.moduleId as number);
    if (moduleCmp !== 0) return moduleCmp;

    const spanStartCmp = left.order.spanStart - right.order.spanStart;
    if (spanStartCmp !== 0) return spanStartCmp;

    const spanEndCmp = left.order.spanEnd - right.order.spanEnd;
    if (spanEndCmp !== 0) return spanEndCmp;

    const codeCmp = compareCodeUnitStrings(left.code, right.code);
    if (codeCmp !== 0) return codeCmp;

    const leftOrigin = left.order.originId;
    const rightOrigin = right.order.originId;
    if (leftOrigin !== undefined && rightOrigin !== undefined) {
      const originCmp = (leftOrigin as number) - (rightOrigin as number);
      if (originCmp !== 0) return originCmp;
    } else if (leftOrigin !== undefined) {
      return -1;
    } else if (rightOrigin !== undefined) {
      return 1;
    }

    return compareCodeUnitStrings(left.order.tieBreaker, right.order.tieBreaker);
  });
}

export class HirDiagnosticSink {
  private readonly collected: HirDiagnostic[] = [];

  constructor(
    private readonly originLookup?: (
      originId: HirOriginId,
    ) => { readonly moduleId: ModuleId; readonly span: SourceSpan } | undefined,
  ) {}

  report(diagnostic: HirDiagnostic): void {
    this.collected.push(this.withOriginSourceOrder(diagnostic));
  }

  entries(): readonly HirDiagnostic[] {
    return this.collected.slice();
  }

  sorted(): HirDiagnostic[] {
    return sortHirDiagnostics(this.collected);
  }

  private withOriginSourceOrder(diagnostic: HirDiagnostic): HirDiagnostic {
    const originId = diagnostic.originId ?? diagnostic.order.originId;
    if (originId === undefined || this.originLookup === undefined) return diagnostic;
    const origin = this.originLookup(originId);
    if (origin === undefined) return diagnostic;
    return {
      ...diagnostic,
      moduleId: origin.moduleId,
      span: origin.span,
      order: {
        ...diagnostic.order,
        moduleId: origin.moduleId,
        spanStart: origin.span.start,
        spanEnd: origin.span.end,
      },
    };
  }
}
