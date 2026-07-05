import type { HirExternalEntryRootRecord, TypedHirProgram } from "../hir/hir";
import type { CheckedType } from "../semantic/surface/type-model";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import type { MonoInstanceId } from "./ids";
import { canonicalFunctionInstanceId, normalizeMonoCheckedType } from "./instantiation-key";
import type { MonoCheckedType, MonoExternalRoot, MonoFunctionInstance } from "./mono-hir";
import { firstHirOriginId } from "./required-origin";

type NormalizeRootArgumentsResult =
  | { readonly kind: "ok"; readonly arguments: readonly MonoCheckedType[] }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function normalizeRootArguments(input: {
  readonly program: TypedHirProgram;
  readonly arguments: readonly CheckedType[];
}): NormalizeRootArgumentsResult {
  const normalized: MonoCheckedType[] = [];
  const diagnostics: MonoDiagnostic[] = [];
  for (const argument of input.arguments) {
    const result = normalizeMonoCheckedType(argument, {
      targetTypeKinds: input.program.monoClosure.targetTypeKinds,
      constructorKindRules: input.program.monoClosure.constructorKindRules,
      sourceOrigin: firstHirOriginId(input.program),
    });
    if (result.kind === "error") {
      diagnostics.push(...result.diagnostics);
    } else {
      normalized.push(result.type);
    }
  }
  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }
  return { kind: "ok", arguments: normalized };
}

export function externalEntryRootRecordKey(root: HirExternalEntryRootRecord): string {
  const reasonRank = root.reason === "imageEntry" ? "0" : "1";
  return `${reasonRank}:${String(root.functionId).padStart(12, "0")}:${root.reason}`;
}

export function functionInstanceIdForExternalEntryRoot(input: {
  readonly program: TypedHirProgram;
  readonly root: HirExternalEntryRootRecord;
  readonly functionTableLookup: ReadonlyMap<string, MonoFunctionInstance>;
  readonly diagnostics: MonoDiagnostic[];
}): MonoInstanceId | undefined {
  const ownerTypeArguments = normalizeRootArguments({
    program: input.program,
    arguments: input.root.ownerTypeArguments,
  });
  const functionTypeArguments = normalizeRootArguments({
    program: input.program,
    arguments: input.root.functionTypeArguments,
  });
  if (ownerTypeArguments.kind === "error") {
    input.diagnostics.push(...ownerTypeArguments.diagnostics);
    return undefined;
  }
  if (functionTypeArguments.kind === "error") {
    input.diagnostics.push(...functionTypeArguments.diagnostics);
    return undefined;
  }
  const sourceFunction = input.program.functions.get(input.root.functionId);
  const ownerTypeId = sourceFunction?.ownerTypeId;
  const key = canonicalFunctionInstanceId({
    functionId: input.root.functionId,
    ...(ownerTypeId !== undefined ? { ownerTypeId } : {}),
    ownerTypeArguments: ownerTypeArguments.arguments,
    functionTypeArguments: functionTypeArguments.arguments,
  });
  const instance = input.functionTableLookup.get(String(key));
  if (instance === undefined) {
    input.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_DROPPED_EXTERNAL_ROOT",
        message:
          "External entry root could not be resolved to a reachable monomorphized function instance.",
        ownerKey: `external-root:${input.root.reason}`,
        rootCauseKey: "external-root",
        stableDetail: `function:${input.root.functionId}:${input.root.reason}`,
        sourceOrigin: String(input.root.sourceOrigin),
      }),
    );
    return undefined;
  }
  return instance.instanceId;
}

export function buildMonoExternalRoots(input: {
  readonly program: TypedHirProgram;
  readonly functionTableLookup: ReadonlyMap<string, MonoFunctionInstance>;
  readonly diagnostics: MonoDiagnostic[];
}): readonly MonoExternalRoot[] {
  const roots: MonoExternalRoot[] = [];
  const sortedEntryRoots = [...input.program.monoClosure.externalEntryRoots].sort((left, right) =>
    externalEntryRootRecordKey(left) < externalEntryRootRecordKey(right)
      ? -1
      : externalEntryRootRecordKey(left) > externalEntryRootRecordKey(right)
        ? 1
        : 0,
  );
  for (const root of sortedEntryRoots) {
    const functionInstanceId = functionInstanceIdForExternalEntryRoot({
      program: input.program,
      root,
      functionTableLookup: input.functionTableLookup,
      diagnostics: input.diagnostics,
    });
    if (functionInstanceId === undefined) {
      continue;
    }
    roots.push({
      functionInstanceId,
      reason: root.reason,
      origin: root.sourceOrigin,
    });
  }
  return roots;
}
