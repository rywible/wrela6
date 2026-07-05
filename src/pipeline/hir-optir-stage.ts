import { lowerTypedHir, type LowerTypedHirInput, type LowerTypedHirResult } from "../hir";
import { constructOptIr, type ConstructOptIrInput, type ConstructOptIrResult } from "../opt-ir";
import type { OptIrDiagnostic } from "../opt-ir/diagnostics";
import {
  optimizeOptIr,
  type OptimizeOptIrInput,
  type OptimizeOptIrResult,
} from "../opt-ir/passes/pipeline";
import type { HirDiagnostic } from "../hir/diagnostics";
import {
  createCompilerStageMetadata,
  createCompilerStageResult,
  type CompilerStageMetadata,
  type CompilerStageResult,
} from "./index";

export interface RunHirStageInput {
  readonly input: LowerTypedHirInput;
  readonly lowerHir?: (input: LowerTypedHirInput) => LowerTypedHirResult;
  readonly hasErrorDiagnostic?: (diagnostic: HirDiagnostic) => boolean;
}

export interface RunOptIrConstructionStageInput {
  readonly hir: CompilerStageResult<"hir", LowerTypedHirResult, HirDiagnostic>;
  readonly input: ConstructOptIrInput;
  readonly construct?: (input: ConstructOptIrInput) => ConstructOptIrResult;
}

export interface RunOptIrOptimizationStageInput {
  readonly construction: CompilerStageResult<
    "opt-ir",
    ConstructOptIrResult & { readonly kind: "ok" },
    OptIrDiagnostic
  >;
  readonly input: OptimizeOptIrInput;
  readonly optimize?: (input: OptimizeOptIrInput) => OptimizeOptIrResult;
}

export function runHirStage(
  input: RunHirStageInput,
): CompilerStageResult<"hir", LowerTypedHirResult, HirDiagnostic> {
  const lowerHir = input.lowerHir ?? lowerTypedHir;
  const result = lowerHir(input.input);
  if (result.diagnostics.some(input.hasErrorDiagnostic ?? hasDiagnosticSeverityError)) {
    return createCompilerStageResult({
      stage: "hir",
      diagnostics: result.diagnostics,
      error: true,
    });
  }
  return createCompilerStageResult({
    stage: "hir",
    value: result,
    diagnostics: result.diagnostics,
  });
}

export function runOptIrConstructionStage(
  input: RunOptIrConstructionStageInput,
): CompilerStageResult<
  "opt-ir",
  ConstructOptIrResult & { readonly kind: "ok" },
  HirDiagnostic | OptIrDiagnostic
> {
  if (input.hir.kind === "error") {
    return createCompilerStageResult({
      stage: "opt-ir",
      diagnostics: input.hir.diagnostics,
      metadata: input.hir.metadata,
      error: true,
    });
  }

  const construct = input.construct ?? constructOptIr;
  const result = construct(input.input);
  if (result.kind === "error") {
    return createCompilerStageResult({
      stage: "opt-ir",
      diagnostics: result.diagnostics,
      error: true,
    });
  }
  return createCompilerStageResult({
    stage: "opt-ir",
    value: result,
    diagnostics: result.diagnostics,
  });
}

export function runOptIrOptimizationStage(
  input: RunOptIrOptimizationStageInput,
): CompilerStageResult<"opt-ir", OptimizeOptIrResult & { readonly kind: "ok" }, OptIrDiagnostic> {
  if (input.construction.kind === "error") {
    return createCompilerStageResult({
      stage: "opt-ir",
      diagnostics: input.construction.diagnostics,
      metadata: input.construction.metadata,
      error: true,
    });
  }

  const optimize = input.optimize ?? optimizeOptIr;
  const result = optimize(input.input);
  if (result.kind === "error") {
    return createCompilerStageResult({
      stage: "opt-ir",
      diagnostics: result.diagnostics,
      error: true,
    });
  }
  return createCompilerStageResult({
    stage: "opt-ir",
    value: result,
    diagnostics: result.diagnostics,
    metadata: result.metadata ?? emptyMetadata(),
  });
}

function emptyMetadata(): CompilerStageMetadata {
  return createCompilerStageMetadata();
}

function hasDiagnosticSeverityError(diagnostic: unknown): boolean {
  return (
    typeof diagnostic === "object" &&
    diagnostic !== null &&
    "severity" in diagnostic &&
    diagnostic.severity === "error"
  );
}
