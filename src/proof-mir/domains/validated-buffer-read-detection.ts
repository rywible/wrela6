import type {
  LayoutFactProgram,
  LayoutValidatedBufferFact,
  LayoutValidatedBufferFieldFact,
} from "../../layout/layout-program";
import type {
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
  | { readonly kind: "sourceLength" };

export function findLayoutField(
  buffer: LayoutValidatedBufferFact,
  fieldIdValue: FieldId,
): LayoutValidatedBufferFieldFact | undefined {
  return buffer.layoutFields.find((field) => field.fieldId === fieldIdValue);
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
  const layoutBuffer = findLayoutValidatedBufferForPlace({
    program: input.program,
    layout: input.layout,
    place: split.containerPlace,
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
