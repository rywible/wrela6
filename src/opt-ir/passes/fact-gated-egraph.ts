import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "../diagnostics";
import type { OptIrEGraphExtractionDiagnostic, OptIrExtractionResult } from "../egraph/extraction";
import type { OptIrTranslationValidationResult } from "../egraph/translation-validation";

export type OptIrFactGatedEGraphValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface OptIrFactGatedEGraphValidators<OptIr> {
  readonly structural: (optIr: OptIr) => OptIrFactGatedEGraphValidationResult;
  readonly effect: (optIr: OptIr) => OptIrFactGatedEGraphValidationResult;
  readonly dominance: (optIr: OptIr) => OptIrFactGatedEGraphValidationResult;
  readonly fact: (optIr: OptIr) => OptIrFactGatedEGraphValidationResult;
  readonly rewriteLegality: (optIr: OptIr) => OptIrFactGatedEGraphValidationResult;
}

export type OptIrFactGatedEGraphPassResult<Original, Extracted> =
  | {
      readonly kind: "changed";
      readonly optIr: Extracted;
      readonly translationValidation: OptIrTranslationValidationResult;
      readonly diagnostics: readonly OptIrEGraphExtractionDiagnostic[];
    }
  | {
      readonly kind: "unchanged";
      readonly optIr: Original;
      readonly diagnostics: readonly OptIrEGraphExtractionDiagnostic[];
    };

export function runFactGatedEGraphPass<Original, Extracted>(input: {
  readonly original: Original;
  readonly extraction: OptIrExtractionResult<Original, Extracted>;
  readonly validateTranslation: (extracted: Extracted) => OptIrTranslationValidationResult;
  readonly validators: OptIrFactGatedEGraphValidators<Extracted>;
  readonly tracingEnabled: boolean;
}): OptIrFactGatedEGraphPassResult<Original, Extracted> {
  if (input.extraction.kind !== "ok") {
    return {
      kind: "unchanged",
      optIr: input.original,
      diagnostics: diagnosticsWhenTracing(input.extraction.diagnostics, input.tracingEnabled),
    };
  }

  const translationValidation = input.validateTranslation(input.extraction.extracted);
  if (translationValidation.kind === "failed") {
    return {
      kind: "unchanged",
      optIr: input.original,
      diagnostics: diagnosticsWhenTracing(
        [
          factGatedEGraphDiagnostic(
            `translation-validation:${translationValidation.reason}`,
            "OptIR e-graph translation validation rejected the extracted replacement.",
          ),
        ],
        input.tracingEnabled,
      ),
    };
  }

  const validationDiagnostics = runPostReplacementValidators(
    input.extraction.extracted,
    input.validators,
  );
  if (validationDiagnostics.length > 0) {
    return {
      kind: "unchanged",
      optIr: input.original,
      diagnostics: diagnosticsWhenTracing(validationDiagnostics, input.tracingEnabled),
    };
  }

  return {
    kind: "changed",
    optIr: input.extraction.extracted,
    translationValidation,
    diagnostics:
      translationValidation.kind === "notApplicable"
        ? diagnosticsWhenTracing(
            translationValidation.reasons.map((reason) =>
              factGatedEGraphDiagnostic(
                `translationValidation:notApplicable:${reason}`,
                "OptIR e-graph translation validation was not applicable for a catalog-approved reason.",
              ),
            ),
            input.tracingEnabled,
          )
        : [],
  };
}

function runPostReplacementValidators<OptIr>(
  optIr: OptIr,
  validators: OptIrFactGatedEGraphValidators<OptIr>,
): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  for (const validate of [
    validators.structural,
    validators.effect,
    validators.dominance,
    validators.fact,
    validators.rewriteLegality,
  ]) {
    const result = validate(optIr);
    if (result.kind === "error") {
      diagnostics.push(...result.diagnostics);
    }
  }
  return Object.freeze(diagnostics);
}

function diagnosticsWhenTracing(
  diagnostics: readonly OptIrEGraphExtractionDiagnostic[],
  tracingEnabled: boolean,
): readonly OptIrEGraphExtractionDiagnostic[] {
  return Object.freeze(tracingEnabled ? diagnostics.slice() : []);
}

function factGatedEGraphDiagnostic(
  reason: string,
  messageTemplate: string,
): OptIrEGraphExtractionDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_REWRITE_LEGALITY_INVALID");
  const stableDetail = `fact-gated-egraph:${reason}`;
  return {
    severity: "debug",
    code,
    messageTemplate,
    arguments: { reason },
    ownerKey: "fact-gated-egraph",
    rootCauseKey: reason,
    stableDetail,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code,
      ownerKey: "fact-gated-egraph",
      rootCauseKey: reason,
      stableDetail,
    }),
  };
}
