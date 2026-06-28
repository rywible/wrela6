import type { MonoCheckedType, MonoParameter } from "../../mono/mono-hir";
import { typeIdFromMonoCheckedType } from "../../proof-mir/domains/validated-buffer-layout-lookup";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type { TypeId } from "../../semantic/ids";

export function validatedBufferTypeIdForParameter(parameter: MonoParameter): TypeId | undefined {
  const parameterType = parameter.type as MonoCheckedType;
  const directTypeId = typeIdFromMonoCheckedType(parameterType);
  if (directTypeId !== undefined) {
    return directTypeId;
  }
  if (parameterType.kind !== "applied") {
    return undefined;
  }
  for (const argument of parameterType.arguments) {
    const argumentTypeId = typeIdFromMonoCheckedType(argument as MonoCheckedType);
    if (argumentTypeId !== undefined) {
      return argumentTypeId;
    }
  }
  return undefined;
}

export function validatedBufferLayoutInstanceIdForParameter(input: {
  readonly mir: ProofMirProgram;
  readonly parameter: MonoParameter;
}): string | undefined {
  const parameterTypeId = validatedBufferTypeIdForParameter(input.parameter);
  if (parameterTypeId === undefined) {
    return undefined;
  }

  const expectedTypeKeyPrefix = `type:${String(parameterTypeId)}|`;
  const matches = input.mir.layout.validatedBuffers
    .entries()
    .filter((buffer) => String(buffer.typeKey.instanceId).startsWith(expectedTypeKeyPrefix));

  if (matches.length === 1) {
    return String(matches[0]!.instanceId);
  }

  return undefined;
}
