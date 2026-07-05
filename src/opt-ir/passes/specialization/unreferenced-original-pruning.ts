import type { OptIrOperation } from "../../operations";
import { optIrFunctionTable, type OptIrFunction, type OptIrProgram } from "../../program";

export function removeUnreferencedSpecializedOriginals(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly specializedCalleeKeys: ReadonlySet<string>;
}): { readonly program: OptIrProgram; readonly operations: readonly OptIrOperation[] } {
  if (input.specializedCalleeKeys.size === 0) {
    return { program: input.program, operations: input.operations };
  }
  const referencedCalleeKeys = referencedSourceCalleeKeys(input.operations);
  const removedFunctions = input.program.functions.entries().filter((function_) =>
    shouldRemoveSpecializedOriginal({
      function_,
      referencedCalleeKeys,
      specializedCalleeKeys: input.specializedCalleeKeys,
    }),
  );
  if (removedFunctions.length === 0) {
    return { program: input.program, operations: input.operations };
  }
  const removedFunctionIds = new Set(removedFunctions.map((function_) => function_.functionId));
  const removedOperationIds = new Set(
    removedFunctions.flatMap((function_) => function_.blocks.flatMap((block) => block.operations)),
  );
  return {
    program: Object.freeze({
      ...input.program,
      functions: optIrFunctionTable(
        input.program.functions
          .entries()
          .filter((function_) => !removedFunctionIds.has(function_.functionId)),
      ),
    }),
    operations: Object.freeze(
      input.operations.filter((operation) => !removedOperationIds.has(operation.operationId)),
    ),
  };
}

function referencedSourceCalleeKeys(operations: readonly OptIrOperation[]): ReadonlySet<string> {
  return new Set(
    operations
      .filter(isSourceCallOperation)
      .map((operation) => String(operation.target.functionInstanceId)),
  );
}

function shouldRemoveSpecializedOriginal(input: {
  readonly function_: OptIrFunction;
  readonly referencedCalleeKeys: ReadonlySet<string>;
  readonly specializedCalleeKeys: ReadonlySet<string>;
}): boolean {
  return (
    input.function_.externalRoot === undefined &&
    input.specializedCalleeKeys.has(String(input.function_.monoInstanceId)) &&
    !input.referencedCalleeKeys.has(String(input.function_.monoInstanceId))
  );
}

function isSourceCallOperation(operation: OptIrOperation): operation is OptIrOperation & {
  readonly kind: "sourceCall";
  readonly target: { readonly kind: "source" };
} {
  return operation.kind === "sourceCall" && operation.target.kind === "source";
}
