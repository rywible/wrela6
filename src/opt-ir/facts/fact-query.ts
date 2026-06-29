import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { OptIrFactId } from "../ids";
import type { OptIrFactSet } from "./fact-index";
import type { OptIrFactImportTypedAnswer } from "./fact-import-schema";
import {
  createOptIrAliasFactQuery,
  type OptIrAliasFactQuery,
  type OptIrFieldDisjointnessSubject,
  type OptIrNoaliasSubject,
  type OptIrOwnershipSubject,
} from "./alias-facts";
import { createOptIrAbiFactQuery, type OptIrAbiFactQuery } from "./abi-facts";
import {
  createOptIrBoundsFactQuery,
  type OptIrBoundsFactQuery,
  type OptIrBoundsSubject,
} from "./bounds-facts";
import {
  createOptIrCapabilityFactQuery,
  type OptIrCapabilityFactQuery,
  type OptIrCapabilityFlowSubject,
} from "./capability-facts";
import {
  createOptIrEffectFactQuery,
  type OptIrEffectFactQuery,
  type OptIrEffectSubject,
  type OptIrImpossibleSubject,
  type OptIrTerminalBehaviorSubject,
} from "./effect-facts";
import {
  createOptIrLayoutFactQuery,
  type OptIrEndianOfLayoutAccessInput,
  type OptIrLayoutFactQuery,
} from "./layout-facts";
import {
  createOptIrPrivateStateFactQuery,
  type OptIrErasureSubject,
  type OptIrPrivateStateFactQuery,
  type OptIrPrivateStateGenerationSubject,
} from "./private-state-facts";

export type OptIrFactAnswerKind = "yes" | "no" | "unknown";
export type OptIrFactQueryTypedAnswer = OptIrFactImportTypedAnswer;

export interface OptIrFactAnswerBase {
  readonly kind: OptIrFactAnswerKind;
  readonly factsUsed: readonly OptIrFactId[];
  readonly explanation: readonly string[];
}

export type OptIrFactBooleanAnswer =
  | (OptIrFactAnswerBase & { readonly kind: "yes" })
  | (OptIrFactAnswerBase & { readonly kind: "no" })
  | (OptIrFactAnswerBase & { readonly kind: "unknown" });

export type OptIrFactValueAnswer<Value> =
  | (OptIrFactAnswerBase & { readonly kind: "yes"; readonly value: Value })
  | (OptIrFactAnswerBase & { readonly kind: "no" })
  | (OptIrFactAnswerBase & { readonly kind: "unknown" });

export interface OptIrFactQuery
  extends
    OptIrAliasFactQuery,
    OptIrBoundsFactQuery,
    OptIrLayoutFactQuery,
    OptIrAbiFactQuery,
    OptIrEffectFactQuery,
    OptIrCapabilityFactQuery,
    OptIrPrivateStateFactQuery {}

export function createOptIrFactQuery(factSet: OptIrFactSet): OptIrFactQuery {
  const alias = createOptIrAliasFactQuery(factSet);
  const bounds = createOptIrBoundsFactQuery(factSet);
  const layout = createOptIrLayoutFactQuery(factSet);
  const abi = createOptIrAbiFactQuery(factSet);
  const effect = createOptIrEffectFactQuery(factSet);
  const capability = createOptIrCapabilityFactQuery(factSet);
  const privateState = createOptIrPrivateStateFactQuery(factSet);
  return Object.freeze({
    owns(subject: OptIrOwnershipSubject) {
      return alias.owns(subject);
    },
    mustNotAlias(subject: OptIrNoaliasSubject) {
      return alias.mustNotAlias(subject);
    },
    fieldsDisjoint(subject: OptIrFieldDisjointnessSubject) {
      return alias.fieldsDisjoint(subject);
    },
    provesInBounds(subject: OptIrBoundsSubject) {
      return bounds.provesInBounds(subject);
    },
    layoutOf(layoutKey: LayoutFactKey) {
      return layout.layoutOf(layoutKey);
    },
    endianOfLayoutAccess(input: OptIrEndianOfLayoutAccessInput) {
      return layout.endianOfLayoutAccess(input);
    },
    abiShape(layoutKey: LayoutFactKey) {
      return abi.abiShape(layoutKey);
    },
    volatilityOf(subject: OptIrEffectSubject) {
      return effect.volatilityOf(subject);
    },
    callEffects(subject: OptIrEffectSubject) {
      return effect.callEffects(subject);
    },
    terminalBehavior(subject: OptIrTerminalBehaviorSubject) {
      return effect.terminalBehavior(subject);
    },
    capabilityFlow(subject: OptIrCapabilityFlowSubject) {
      return capability.capabilityFlow(subject);
    },
    provesImpossible(subject: OptIrImpossibleSubject) {
      return effect.provesImpossible(subject);
    },
    privateStateGeneration(subject: OptIrPrivateStateGenerationSubject) {
      return privateState.privateStateGeneration(subject);
    },
    erasureOf(subject: OptIrErasureSubject) {
      return privateState.erasureOf(subject);
    },
  });
}
