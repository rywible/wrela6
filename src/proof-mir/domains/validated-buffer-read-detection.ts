import type {
  LayoutFactProgram,
  LayoutValidatedBufferDerivedFact,
  LayoutValidatedBufferFact,
  LayoutValidatedBufferFieldFact,
} from "../../layout/layout-program";
import type {
  MonoPlaceRoot,
  MonoPlaceProjection,
  MonoResourcePlace,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import type { FieldId } from "../../semantic/ids";
import { fieldId } from "../../semantic/ids";
import { findLayoutValidatedBufferForPlace } from "./validated-buffer-layout-lookup";

/** Member field id for validated-buffer source-length access (not a layout wire field). */
export const VALIDATED_BUFFER_SOURCE_LENGTH_MEMBER_FIELD_ID = fieldId(0);

export type ValidatedBufferMemberReadKind =
  | { readonly kind: "layoutField"; readonly fieldId: FieldId }
  | { readonly kind: "derivedField"; readonly fieldId: FieldId }
  | { readonly kind: "sourceLength" };

export function findLayoutField(
  buffer: LayoutValidatedBufferFact,
  fieldIdValue: FieldId,
): LayoutValidatedBufferFieldFact | undefined {
  return buffer.layoutFields.find((field) => field.fieldId === fieldIdValue);
}

export function findDerivedField(
  buffer: LayoutValidatedBufferFact,
  fieldIdValue: FieldId,
): LayoutValidatedBufferDerivedFact | undefined {
  return buffer.derivedFields.find((field) => field.fieldId === fieldIdValue);
}

export function splitMemberPlace(memberPlace: MonoResourcePlace):
  | {
      readonly containerPlace: MonoResourcePlace;
      readonly fieldProjection: Extract<MonoPlaceProjection, { readonly kind: "field" }>;
    }
  | undefined {
  const lastProjection = memberPlace.projection[memberPlace.projection.length - 1];
  if (lastProjection?.kind !== "field") {
    return undefined;
  }
  const containerProjection = memberPlace.projection.slice(0, -1);
  return {
    containerPlace: {
      ...memberPlace,
      projection: containerProjection,
    },
    fieldProjection: lastProjection,
  };
}

function samePlaceRoot(left: MonoPlaceRoot, right: MonoPlaceRoot): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "receiver":
    case "parameter":
      return String(left.parameterId) === String((right as typeof left).parameterId);
    case "local":
      return (
        String(left.localId.instanceId) === String((right as typeof left).localId.instanceId) &&
        String(left.localId.hirId) === String((right as typeof left).localId.hirId)
      );
    case "temporary":
      return left.ordinal === (right as typeof left).ordinal;
    case "imageDevice":
      return (
        String(left.imageId) === String((right as typeof left).imageId) &&
        String(left.fieldId) === String((right as typeof left).fieldId)
      );
    case "validationPayload":
      return (
        String(left.validationId.instanceId) ===
          String((right as typeof left).validationId.instanceId) &&
        String(left.validationId.hirId) === String((right as typeof left).validationId.hirId)
      );
    case "error":
      return true;
  }
}

function sameProjection(
  left: readonly MonoPlaceProjection[],
  right: readonly MonoPlaceProjection[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((leftProjection, index) => {
    const rightProjection = right[index];
    if (rightProjection === undefined || leftProjection.kind !== rightProjection.kind) {
      return false;
    }
    switch (leftProjection.kind) {
      case "field":
        return leftProjection.fieldId === (rightProjection as typeof leftProjection).fieldId;
      case "deref":
        return true;
      case "variant":
        return leftProjection.name === (rightProjection as typeof leftProjection).name;
    }
  });
}

export function containerPlaceForMemberPlace(input: {
  readonly program: MonomorphizedHirProgram;
  readonly memberPlace: MonoResourcePlace;
}): MonoResourcePlace | undefined {
  const split = splitMemberPlace(input.memberPlace);
  if (split === undefined) return undefined;
  return (
    input.program.proofMetadata.resourcePlaces
      .entries()
      .find(
        (place) =>
          samePlaceRoot(place.root, split.containerPlace.root) &&
          sameProjection(place.projection, split.containerPlace.projection),
      ) ?? split.containerPlace
  );
}

export function classifyValidatedBufferMemberRead(input: {
  readonly layoutBuffer: LayoutValidatedBufferFact;
  readonly fieldId: FieldId;
}): ValidatedBufferMemberReadKind | undefined {
  if (input.fieldId === VALIDATED_BUFFER_SOURCE_LENGTH_MEMBER_FIELD_ID) {
    return { kind: "sourceLength" };
  }
  if (findLayoutField(input.layoutBuffer, input.fieldId) !== undefined) {
    return { kind: "layoutField", fieldId: input.fieldId };
  }
  if (findDerivedField(input.layoutBuffer, input.fieldId) !== undefined) {
    return { kind: "derivedField", fieldId: input.fieldId };
  }
  return undefined;
}

export function shouldLowerMemberAsValidatedBufferRead(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly memberPlace: MonoResourcePlace;
}): boolean {
  const split = splitMemberPlace(input.memberPlace);
  if (split === undefined) {
    return false;
  }
  const containerPlace = containerPlaceForMemberPlace({
    program: input.program,
    memberPlace: input.memberPlace,
  });
  if (containerPlace === undefined) return false;
  const layoutBuffer = findLayoutValidatedBufferForPlace({
    program: input.program,
    layout: input.layout,
    place: containerPlace,
  });
  if (layoutBuffer === undefined) {
    return false;
  }
  return (
    classifyValidatedBufferMemberRead({
      layoutBuffer,
      fieldId: split.fieldProjection.fieldId,
    }) !== undefined
  );
}
