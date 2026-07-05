import type { SourceSpan, SourceText } from "../../frontend";
import type { SemanticSurfaceDiagnostic, SemanticSurfaceDiagnosticOrder } from "./diagnostics";

export function dataclassAffineField(
  fieldName: string,
  span: SourceSpan,
  source: SourceText | undefined,
  order: SemanticSurfaceDiagnosticOrder,
): SemanticSurfaceDiagnostic {
  return {
    code: "SEMANTIC_DATACLASS_AFFINE_FIELD",
    message: `Ordinary dataclass field '${fieldName}' cannot have an affine or proof-relevant resource kind.`,
    severity: "error",
    source,
    span,
    order,
  };
}
