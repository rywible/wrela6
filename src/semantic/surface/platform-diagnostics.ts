import type { SourceSpan, SourceText } from "../../frontend";
import type { SemanticSurfaceDiagnostic, SemanticSurfaceDiagnosticOrder } from "./diagnostics";

export interface PlatformPrimitiveSignatureMismatchInput {
  readonly source: SourceText | undefined;
  readonly span: SourceSpan;
  readonly order: SemanticSurfaceDiagnosticOrder;
  readonly functionName: string;
  readonly reason: string;
}

export function platformPrimitiveSignatureMismatch(
  input: PlatformPrimitiveSignatureMismatchInput,
): SemanticSurfaceDiagnostic {
  return {
    code: "SURFACE_PLATFORM_SIGNATURE_MISMATCH",
    message: `Platform primitive signature mismatch for '${input.functionName}': ${input.reason}.`,
    severity: "error",
    source: input.source,
    span: input.span,
    order: input.order,
  };
}
