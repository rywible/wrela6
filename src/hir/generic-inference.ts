import type { SourceSpan } from "../shared/source-span";
import type { CheckedFunctionSignature } from "../semantic/surface/checked-program";
import type { CheckedType } from "../semantic/surface/type-model";
import { checkedTypeFingerprint, checkedTypesEqual } from "../semantic/surface/type-model";
import { moduleId, type ModuleId } from "../semantic/ids";
import type { HirDiagnostic } from "./diagnostics";
import { hirDiagnosticCode, hirDiagnosticTieBreaker } from "./diagnostics";

export interface GenericInferenceArgument {
  readonly type: CheckedType;
}

export interface InferCallTypeArgumentsResult {
  readonly typeArguments: readonly CheckedType[];
  readonly diagnostics: readonly HirDiagnostic[];
}

function genericParameterKey(type: CheckedType): string | undefined {
  if (type.kind !== "genericParameter") return undefined;
  const owner =
    type.parameter.owner.kind === "item"
      ? `item:${type.parameter.owner.itemId}`
      : `function:${type.parameter.owner.functionId}`;
  return `${owner}:${type.parameter.index}`;
}

function collectTypeConstraints(input: {
  readonly formal: CheckedType;
  readonly actual: CheckedType | undefined;
  readonly candidates: Map<string, CheckedType>;
  readonly diagnostics: HirDiagnostic[];
  readonly sourceSpan: SourceSpan;
  readonly moduleId: import("../semantic/ids").ModuleId;
}): void {
  if (input.actual === undefined) return;
  const key = genericParameterKey(input.formal);
  if (key !== undefined) {
    const current = input.candidates.get(key);
    if (current !== undefined && !checkedTypesEqual(current, input.actual)) {
      input.diagnostics.push(
        diagnostic(
          "HIR_CONFLICTING_GENERIC_ARGUMENT",
          input.sourceSpan,
          `${checkedTypeFingerprint(current)}:${checkedTypeFingerprint(input.actual)}`,
          input.moduleId,
        ),
      );
    } else {
      input.candidates.set(key, input.actual);
    }
    return;
  }

  if (input.formal.kind !== "applied" || input.actual.kind !== "applied") return;
  if (
    checkedTypeFingerprint({
      ...input.formal,
      arguments: [],
    }) !==
    checkedTypeFingerprint({
      ...input.actual,
      arguments: [],
    })
  ) {
    return;
  }
  const count = Math.min(input.formal.arguments.length, input.actual.arguments.length);
  for (let index = 0; index < count; index++) {
    collectTypeConstraints({
      ...input,
      formal: input.formal.arguments[index]!,
      actual: input.actual.arguments[index],
    });
  }
}

function genericKeyForParameter(
  parameter: NonNullable<CheckedFunctionSignature["genericSignature"]>["parameters"][number],
): string {
  const owner =
    parameter.key.owner.kind === "item"
      ? `item:${parameter.key.owner.itemId}`
      : `function:${parameter.key.owner.functionId}`;
  return `${owner}:${parameter.key.index}`;
}

function diagnostic(
  codeText: string,
  span: SourceSpan,
  detail: string,
  diagnosticModuleId: ModuleId,
): HirDiagnostic {
  const code = hirDiagnosticCode(codeText);
  return {
    code,
    message: detail,
    stableDetail: detail,
    span,
    order: {
      moduleId: diagnosticModuleId,
      spanStart: span.start,
      spanEnd: span.end,
      ownerKey: "generic",
      originKey: `${span.start}:${span.end}`,
      code,
      tieBreaker: hirDiagnosticTieBreaker({
        ownerKey: "generic",
        originKey: `${span.start}:${span.end}`,
        code,
        stableDetail: detail,
      }),
    },
  };
}

function diagnosticsForBounds(input: {
  readonly signature: CheckedFunctionSignature;
  readonly typeArguments: readonly CheckedType[];
  readonly sourceSpan: SourceSpan;
  readonly moduleId: ModuleId;
}): readonly HirDiagnostic[] {
  const diagnostics: HirDiagnostic[] = [];
  const parameters = input.signature.genericSignature?.parameters ?? [];
  for (let index = 0; index < parameters.length; index++) {
    const parameter = parameters[index]!;
    const argument = input.typeArguments[index];
    if (argument === undefined) continue;
    for (const bound of parameter.bounds) {
      if (checkedTypesEqual(argument, bound.interfaceType)) continue;
      diagnostics.push(
        diagnostic(
          "HIR_GENERIC_BOUND_NOT_SATISFIED",
          bound.span,
          `${checkedTypeFingerprint(argument)}:${checkedTypeFingerprint(bound.interfaceType)}`,
          input.moduleId,
        ),
      );
    }
  }
  return diagnostics;
}

export function inferCallTypeArguments(input: {
  readonly signature: CheckedFunctionSignature;
  readonly explicitTypeArguments?: readonly CheckedType[];
  readonly receiver?: GenericInferenceArgument;
  readonly arguments: readonly GenericInferenceArgument[];
  readonly expectedReturnType?: CheckedType;
  readonly sourceSpan: SourceSpan;
  readonly moduleId?: ModuleId;
}): InferCallTypeArgumentsResult {
  const parameters = input.signature.genericSignature?.parameters ?? [];
  const diagnostics: HirDiagnostic[] = [];
  const diagnosticModuleId = input.moduleId ?? moduleId(0);

  if (input.explicitTypeArguments !== undefined && input.explicitTypeArguments.length > 0) {
    if (input.explicitTypeArguments.length !== parameters.length) {
      diagnostics.push(
        diagnostic(
          "HIR_WRONG_GENERIC_ARGUMENT_COUNT",
          input.sourceSpan,
          `expected:${parameters.length}:got:${input.explicitTypeArguments.length}`,
          diagnosticModuleId,
        ),
      );
    }
    diagnostics.push(
      ...diagnosticsForBounds({
        signature: input.signature,
        typeArguments: input.explicitTypeArguments,
        sourceSpan: input.sourceSpan,
        moduleId: diagnosticModuleId,
      }),
    );
    return { typeArguments: input.explicitTypeArguments, diagnostics };
  }

  if (parameters.length === 0) return { typeArguments: [], diagnostics };

  const candidates = new Map<string, CheckedType>();
  if (input.signature.receiver !== undefined) {
    collectTypeConstraints({
      formal: input.signature.receiver.type,
      actual: input.receiver?.type,
      candidates,
      diagnostics,
      sourceSpan: input.sourceSpan,
      moduleId: diagnosticModuleId,
    });
  }
  const formalTypes = input.signature.parameters.map((parameter) => parameter.type);
  for (let index = 0; index < formalTypes.length; index++) {
    collectTypeConstraints({
      formal: formalTypes[index]!,
      actual: input.arguments[index]?.type,
      candidates,
      diagnostics,
      sourceSpan: input.sourceSpan,
      moduleId: diagnosticModuleId,
    });
  }
  if (input.expectedReturnType !== undefined) {
    collectTypeConstraints({
      formal: input.signature.returnType,
      actual: input.expectedReturnType,
      candidates,
      diagnostics,
      sourceSpan: input.sourceSpan,
      moduleId: diagnosticModuleId,
    });
  }

  const inferred: CheckedType[] = [];
  for (const parameter of parameters) {
    const key = genericKeyForParameter(parameter);
    const candidate = candidates.get(key);
    if (candidate === undefined) {
      diagnostics.push(
        diagnostic(
          "HIR_UNRESOLVED_GENERIC_ARGUMENT",
          input.sourceSpan,
          `generic:${key}`,
          diagnosticModuleId,
        ),
      );
    } else {
      inferred.push(candidate);
    }
  }
  diagnostics.push(
    ...diagnosticsForBounds({
      signature: input.signature,
      typeArguments: inferred,
      sourceSpan: input.sourceSpan,
      moduleId: diagnosticModuleId,
    }),
  );

  return { typeArguments: inferred, diagnostics };
}
