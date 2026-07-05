import { loadFrontendModuleGraph, type LoadFrontendModuleGraphInput } from "../frontend";
import type { ParsedModuleGraph } from "../frontend/module-graph-parser";
import type { Diagnostic } from "../shared/diagnostics";
import {
  createCompilerStageMetadata,
  createCompilerStageResult,
  frontendModuleGraphMetadata,
  type CompilerStageResult,
} from "./index";

export interface RunFrontendStageInput extends LoadFrontendModuleGraphInput {
  readonly loader?: (input: LoadFrontendModuleGraphInput) => Promise<ParsedModuleGraph>;
}

export interface SemanticStageRunnerInput {
  readonly frontend: CompilerStageResult<"frontend", ParsedModuleGraph, Diagnostic>;
}

export interface SemanticStageRunnerOutput<Value, SemanticDiagnostic> {
  readonly value: Value;
  readonly diagnostics?: readonly SemanticDiagnostic[];
}

export interface RunSemanticStageInput<Value, SemanticDiagnostic = Diagnostic> {
  readonly frontend: CompilerStageResult<"frontend", ParsedModuleGraph, Diagnostic>;
  readonly checkSemantic: (
    input: SemanticStageRunnerInput,
  ) => SemanticStageRunnerOutput<Value, SemanticDiagnostic>;
  readonly hasErrorDiagnostic?: (diagnostic: SemanticDiagnostic) => boolean;
}

export async function runFrontendStage(
  input: RunFrontendStageInput,
): Promise<CompilerStageResult<"frontend", ParsedModuleGraph, Diagnostic>> {
  const { loader = loadFrontendModuleGraph, ...loaderInput } = input;
  const graph = await loader(loaderInput);
  const metadata = createCompilerStageMetadata([
    frontendModuleGraphMetadata({
      moduleKeys: graph.modules.map((module) => module.path.key),
      edgeCount: graph.modules.reduce((count, module) => count + module.imports.length, 0),
    }),
  ]);

  if (graph.diagnostics.some(isErrorDiagnostic)) {
    return createCompilerStageResult({
      stage: "frontend",
      diagnostics: graph.diagnostics,
      metadata,
      error: true,
    });
  }

  return createCompilerStageResult({
    stage: "frontend",
    value: graph,
    diagnostics: graph.diagnostics,
    metadata,
  });
}

export function runSemanticStage<Value, SemanticDiagnostic = Diagnostic>(
  input: RunSemanticStageInput<Value, SemanticDiagnostic>,
): CompilerStageResult<"semantic", Value, Diagnostic | SemanticDiagnostic> {
  if (input.frontend.kind === "error") {
    return createCompilerStageResult({
      stage: "semantic",
      diagnostics: input.frontend.diagnostics,
      metadata: input.frontend.metadata,
      error: true,
    });
  }

  const semantic = input.checkSemantic({ frontend: input.frontend });
  const diagnostics = semantic.diagnostics ?? [];
  if (diagnostics.some(input.hasErrorDiagnostic ?? isErrorDiagnosticLike)) {
    return createCompilerStageResult({
      stage: "semantic",
      diagnostics,
      metadata: input.frontend.metadata,
      error: true,
    });
  }

  return createCompilerStageResult({
    stage: "semantic",
    value: semantic.value,
    diagnostics,
    metadata: input.frontend.metadata,
  });
}

function isErrorDiagnostic(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === "error";
}

function isErrorDiagnosticLike(diagnostic: unknown): boolean {
  return (
    typeof diagnostic === "object" &&
    diagnostic !== null &&
    "severity" in diagnostic &&
    diagnostic.severity === "error"
  );
}
