import { compareCodeUnitStrings } from "./deterministic-sort";
import {
  type OptIrCanonicalFormId,
  type OptIrInterpreterRuleId,
  type OptIrSemanticsRuleId,
} from "./ids";
import { OPT_IR_OPERATION_KINDS, type OptIrOperationKind } from "./operation-kinds";
import {
  OPT_IR_CORE_OPERATION_SCHEMAS,
  type OptIrLoweringRequirement,
  type OptIrOperationSchema,
} from "./operation-schema-core";
import {
  EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
  type EffectfulOptIrOperationSchema,
  type OptIrCanonicalFormName,
  type OptIrLoweringRequirementName,
} from "./operation-schema-effectful";

export type OptIrOperationStableKey = OptIrOperationKind;

export type OptIrOperationLoweringRequirement =
  | OptIrLoweringRequirement
  | OptIrLoweringRequirementName;

export type OptIrOperationCanonicalForm = OptIrCanonicalFormId | OptIrCanonicalFormName;

export interface OptIrOperationSemanticsMetadata {
  readonly operationKind: OptIrOperationKind;
  readonly stableKey: OptIrOperationStableKey;
  readonly semanticsRule: OptIrSemanticsRuleId;
  readonly interpreterRule: OptIrInterpreterRuleId;
  readonly canonicalForm: OptIrOperationCanonicalForm;
  readonly loweringRequirement: OptIrOperationLoweringRequirement;
}

export interface OptIrOperationSemanticsDerivationInput {
  readonly coreSchemas?: readonly OptIrOperationSchema[];
  readonly effectfulSchemas?: readonly EffectfulOptIrOperationSchema[];
}

const OPERATION_KIND_ORDER = new Map<OptIrOperationKind, number>(
  OPT_IR_OPERATION_KINDS.map((operationKind, index) => [operationKind, index]),
);

function operationKindOrder(operationKind: OptIrOperationKind): number {
  const order = OPERATION_KIND_ORDER.get(operationKind);
  if (order === undefined) {
    throw new RangeError(`Unknown OptIR operation kind ${operationKind}.`);
  }
  return order;
}

function compareOperationKinds(left: OptIrOperationKind, right: OptIrOperationKind): number {
  const orderDelta = operationKindOrder(left) - operationKindOrder(right);
  if (orderDelta !== 0) {
    return orderDelta;
  }
  return compareCodeUnitStrings(left, right);
}

function freezeSemanticsMetadata(
  metadata: OptIrOperationSemanticsMetadata,
): OptIrOperationSemanticsMetadata {
  return Object.freeze(metadata);
}

function deriveCoreSemanticsMetadata(
  schema: OptIrOperationSchema,
): OptIrOperationSemanticsMetadata {
  return freezeSemanticsMetadata({
    operationKind: schema.operationKind,
    stableKey: schema.operationKind,
    semanticsRule: schema.semanticsRule,
    interpreterRule: schema.interpreterRule,
    canonicalForm: schema.canonicalForm,
    loweringRequirement: schema.loweringRequirement,
  });
}

function deriveEffectfulSemanticsMetadata(
  schema: EffectfulOptIrOperationSchema,
): OptIrOperationSemanticsMetadata {
  return freezeSemanticsMetadata({
    operationKind: schema.kind,
    stableKey: schema.kind,
    semanticsRule: schema.semanticsRule,
    interpreterRule: schema.interpreterRule,
    canonicalForm: schema.canonicalForm,
    loweringRequirement: schema.loweringRequirement,
  });
}

export function deriveOptIrOperationSemanticsMetadata(
  input: OptIrOperationSemanticsDerivationInput = {},
): readonly OptIrOperationSemanticsMetadata[] {
  const coreSchemas = input.coreSchemas ?? OPT_IR_CORE_OPERATION_SCHEMAS;
  const effectfulSchemas = input.effectfulSchemas ?? EFFECTFUL_OPT_IR_OPERATION_SCHEMAS;
  const metadataByKind = new Map<OptIrOperationKind, OptIrOperationSemanticsMetadata>();

  for (const metadata of [
    ...coreSchemas.map(deriveCoreSemanticsMetadata),
    ...effectfulSchemas.map(deriveEffectfulSemanticsMetadata),
  ]) {
    if (metadataByKind.has(metadata.operationKind)) {
      throw new RangeError(`Duplicate OptIR semantics metadata for ${metadata.operationKind}.`);
    }
    metadataByKind.set(metadata.operationKind, metadata);
  }

  for (const operationKind of OPT_IR_OPERATION_KINDS) {
    if (!metadataByKind.has(operationKind)) {
      throw new RangeError(`Missing OptIR semantics metadata for ${operationKind}.`);
    }
  }

  return Object.freeze(
    Array.from(metadataByKind.values()).sort((left, right) =>
      compareOperationKinds(left.operationKind, right.operationKind),
    ),
  );
}

export const OPT_IR_OPERATION_SEMANTICS_METADATA = deriveOptIrOperationSemanticsMetadata();

const OPERATION_SEMANTICS_METADATA_BY_KIND = new Map<
  OptIrOperationKind,
  OptIrOperationSemanticsMetadata
>(OPT_IR_OPERATION_SEMANTICS_METADATA.map((metadata) => [metadata.operationKind, metadata]));

export function optIrOperationSemanticsMetadataForKind(
  operationKind: OptIrOperationKind,
): OptIrOperationSemanticsMetadata {
  const metadata = OPERATION_SEMANTICS_METADATA_BY_KIND.get(operationKind);
  if (metadata === undefined) {
    throw new RangeError(`Missing OptIR semantics metadata for ${operationKind}.`);
  }
  return metadata;
}
