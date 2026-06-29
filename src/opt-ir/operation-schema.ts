import type { OptIrOperationKind } from "./operation-kinds";
import {
  OPT_IR_CORE_OPERATION_SCHEMAS,
  type OptIrCoreOperationKind,
  type OptIrOperationSchema as OptIrCoreOperationSchema,
} from "./operation-schema-core";
import {
  EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
  type EffectfulOptIrOperationKind,
  type EffectfulOptIrOperationSchema,
} from "./operation-schema-effectful";

export {
  OPT_IR_CORE_OPERATION_SCHEMAS,
  optIrCoreOperationSchemaForKind,
  type OptIrCoreOperationKind,
  type OptIrOperationSchema as OptIrCoreOperationSchema,
} from "./operation-schema-core";
export {
  EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
  optIrEffectfulOperationSchemaByKind,
  type EffectfulOptIrOperationKind,
  type EffectfulOptIrOperationSchema,
} from "./operation-schema-effectful";

export type OptIrClosedOperationSchema =
  | { readonly family: "core"; readonly schema: OptIrCoreOperationSchema }
  | { readonly family: "effectful"; readonly schema: EffectfulOptIrOperationSchema };

export const OPT_IR_OPERATION_SCHEMAS = Object.freeze([
  ...OPT_IR_CORE_OPERATION_SCHEMAS.map((schema) => Object.freeze({ family: "core", schema })),
  ...EFFECTFUL_OPT_IR_OPERATION_SCHEMAS.map((schema) =>
    Object.freeze({ family: "effectful", schema }),
  ),
] satisfies readonly OptIrClosedOperationSchema[]);

const OPERATION_SCHEMA_BY_KIND = new Map<OptIrOperationKind, OptIrClosedOperationSchema>(
  OPT_IR_OPERATION_SCHEMAS.map((entry) => [
    entry.family === "core" ? entry.schema.operationKind : entry.schema.kind,
    entry,
  ]),
);

export function optIrOperationSchemaForKind(
  operationKind: OptIrCoreOperationKind,
): Extract<OptIrClosedOperationSchema, { readonly family: "core" }>;
export function optIrOperationSchemaForKind(
  operationKind: EffectfulOptIrOperationKind,
): Extract<OptIrClosedOperationSchema, { readonly family: "effectful" }>;
export function optIrOperationSchemaForKind(
  operationKind: OptIrOperationKind,
): OptIrClosedOperationSchema;
export function optIrOperationSchemaForKind(
  operationKind: OptIrOperationKind,
): OptIrClosedOperationSchema {
  const schema = OPERATION_SCHEMA_BY_KIND.get(operationKind);
  if (schema === undefined) {
    throw new RangeError(`Missing OptIR operation schema for ${operationKind}.`);
  }
  return schema;
}
