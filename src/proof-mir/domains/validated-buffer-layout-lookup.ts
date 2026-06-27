import type { LayoutFactProgram, LayoutValidatedBufferFact } from "../../layout/layout-program";
import type {
  MonoCheckedType,
  MonoResourcePlace,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import type { TypeId } from "../../semantic/ids";

export function typeIdFromMonoCheckedType(type: MonoCheckedType): TypeId | undefined {
  if (type.kind === "source") {
    return type.typeId;
  }
  if (type.kind === "applied" && type.constructor.kind === "source") {
    return type.constructor.typeId;
  }
  return undefined;
}

export function validatedBufferTypeIdFromPlace(place: MonoResourcePlace): TypeId | undefined {
  return typeIdFromMonoCheckedType(place.type);
}

function rootResourcePlaceTypeId(input: {
  readonly program: MonomorphizedHirProgram;
  readonly place: MonoResourcePlace;
}): TypeId | undefined {
  const functionInstance = input.program.functions.get(input.place.placeId.instanceId);
  if (functionInstance === undefined) {
    return undefined;
  }

  switch (input.place.root.kind) {
    case "parameter":
    case "receiver": {
      const parameterId = input.place.root.parameterId;
      const parameter = functionInstance.signature.parameters.find(
        (entry) => entry.parameterId === parameterId,
      );
      return parameter === undefined ? undefined : typeIdFromMonoCheckedType(parameter.type);
    }
    case "local": {
      const local = functionInstance.locals.get(input.place.root.localId);
      return local === undefined ? undefined : typeIdFromMonoCheckedType(local.type);
    }
    case "temporary":
    case "imageDevice":
    case "validationPayload":
    case "error":
      return undefined;
    default: {
      const unreachable: never = input.place.root;
      return unreachable;
    }
  }
}

function validatedBufferTypeIdFromResourcePlace(input: {
  readonly program: MonomorphizedHirProgram;
  readonly place: MonoResourcePlace;
}): TypeId | undefined {
  if (input.place.projection.length === 0) {
    return (
      rootResourcePlaceTypeId(input) ?? validatedBufferTypeIdFromPlace(input.place) ?? undefined
    );
  }
  return validatedBufferTypeIdFromPlace(input.place);
}

export function findLayoutValidatedBufferForPlace(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly place: MonoResourcePlace;
}): LayoutValidatedBufferFact | undefined {
  const typeId = validatedBufferTypeIdFromResourcePlace({
    program: input.program,
    place: input.place,
  });
  if (typeId === undefined) {
    return undefined;
  }
  const matches: LayoutValidatedBufferFact[] = [];
  for (const buffer of input.layout.validatedBuffers.entries()) {
    const monoBuffer = input.program.validatedBuffers.get(buffer.instanceId);
    if (monoBuffer === undefined) {
      continue;
    }
    if (monoBuffer.typeId === typeId) {
      matches.push(buffer);
    }
  }
  if (matches.length === 1) {
    return matches[0];
  }
  return undefined;
}
