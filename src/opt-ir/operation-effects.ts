import { type OptIrEffectRuleId } from "./ids";
import { type OptIrOperationKind, OPT_IR_OPERATION_KINDS } from "./operation-kinds";
import { OPT_IR_CORE_OPERATION_SCHEMAS, type OptIrOperationSchema } from "./operation-schema-core";
import {
  EFFECTFUL_OPT_IR_OPERATION_SCHEMAS,
  type EffectfulOptIrOperationSchema,
} from "./operation-schema-effectful";
import {
  type OptIrOperationStableKey,
  deriveOptIrOperationSemanticsMetadata,
} from "./operation-semantics";

export type OptIrOperationRuntimeEffect =
  | "none"
  | "readRegionVersion"
  | "writeRegionVersion"
  | "orderedRegionTokens"
  | "callSummaryEffects"
  | "terminalEffects";

export interface OptIrOperationEffectMetadata {
  readonly operationKind: OptIrOperationKind;
  readonly stableKey: OptIrOperationStableKey;
  readonly effectRule: OptIrEffectRuleId;
  readonly runtimeEffect: OptIrOperationRuntimeEffect;
  readonly isRuntimePure: boolean;
  readonly readsRegionVersion: boolean;
  readonly writesRegionVersion: boolean;
  readonly usesOrderedRegionTokens: boolean;
  readonly usesCallSummary: boolean;
  readonly hasTerminalEffects: boolean;
}

export interface OptIrOperationEffectDerivationInput {
  readonly coreSchemas?: readonly OptIrOperationSchema[];
  readonly effectfulSchemas?: readonly EffectfulOptIrOperationSchema[];
}

function runtimeEffectFromEffectRule(effectRule: OptIrEffectRuleId): OptIrOperationRuntimeEffect {
  switch (effectRule) {
    case "pure":
    case "proof-erased-no-effect":
      return "none";
    case "read-region-version":
      return "readRegionVersion";
    case "write-region-version":
      return "writeRegionVersion";
    case "ordered-region-tokens":
      return "orderedRegionTokens";
    case "call-summary-effects":
      return "callSummaryEffects";
    case "terminal-effects":
      return "terminalEffects";
    default:
      throw new RangeError(`Unsupported OptIR effect rule ${effectRule}.`);
  }
}

function freezeEffectMetadata(
  metadata: OptIrOperationEffectMetadata,
): OptIrOperationEffectMetadata {
  return Object.freeze(metadata);
}

function effectMetadataFor(
  operationKind: OptIrOperationKind,
  stableKey: OptIrOperationStableKey,
  effectRule: OptIrEffectRuleId,
): OptIrOperationEffectMetadata {
  const runtimeEffect = runtimeEffectFromEffectRule(effectRule);
  return freezeEffectMetadata({
    operationKind,
    stableKey,
    effectRule,
    runtimeEffect,
    isRuntimePure: runtimeEffect === "none",
    readsRegionVersion: runtimeEffect === "readRegionVersion",
    writesRegionVersion: runtimeEffect === "writeRegionVersion",
    usesOrderedRegionTokens: runtimeEffect === "orderedRegionTokens",
    usesCallSummary: runtimeEffect === "callSummaryEffects",
    hasTerminalEffects: runtimeEffect === "terminalEffects",
  });
}

export function deriveOptIrOperationEffectMetadata(
  input: OptIrOperationEffectDerivationInput = {},
): readonly OptIrOperationEffectMetadata[] {
  const coreSchemas = input.coreSchemas ?? OPT_IR_CORE_OPERATION_SCHEMAS;
  const effectfulSchemas = input.effectfulSchemas ?? EFFECTFUL_OPT_IR_OPERATION_SCHEMAS;
  const semanticsMetadata = deriveOptIrOperationSemanticsMetadata({
    coreSchemas,
    effectfulSchemas,
  });
  const coreEffectsByKind = new Map<OptIrOperationKind, OptIrEffectRuleId>(
    coreSchemas.map((schema) => [schema.operationKind, schema.effectRule]),
  );
  const effectfulEffectsByKind = new Map<OptIrOperationKind, OptIrEffectRuleId>(
    effectfulSchemas.map((schema) => [schema.kind, schema.effectRule]),
  );

  return Object.freeze(
    semanticsMetadata.map((metadata) => {
      const effectRule =
        coreEffectsByKind.get(metadata.operationKind) ??
        effectfulEffectsByKind.get(metadata.operationKind);
      if (effectRule === undefined) {
        throw new RangeError(`Missing OptIR effect metadata for ${metadata.operationKind}.`);
      }
      return effectMetadataFor(metadata.operationKind, metadata.stableKey, effectRule);
    }),
  );
}

export const OPT_IR_OPERATION_EFFECT_METADATA = deriveOptIrOperationEffectMetadata();

const OPERATION_EFFECT_METADATA_BY_KIND = new Map<OptIrOperationKind, OptIrOperationEffectMetadata>(
  OPT_IR_OPERATION_EFFECT_METADATA.map((metadata) => [metadata.operationKind, metadata]),
);

for (const operationKind of OPT_IR_OPERATION_KINDS) {
  if (!OPERATION_EFFECT_METADATA_BY_KIND.has(operationKind)) {
    throw new RangeError(`Missing OptIR effect metadata for ${operationKind}.`);
  }
}

export function optIrOperationEffectMetadataForKind(
  operationKind: OptIrOperationKind,
): OptIrOperationEffectMetadata {
  const metadata = OPERATION_EFFECT_METADATA_BY_KIND.get(operationKind);
  if (metadata === undefined) {
    throw new RangeError(`Missing OptIR effect metadata for ${operationKind}.`);
  }
  return metadata;
}
