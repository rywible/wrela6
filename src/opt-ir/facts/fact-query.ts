import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { OptIrFactId } from "../ids";
import type { OptIrFactSet } from "./fact-index";
import type { OptIrFactImportTypedAnswer } from "./fact-import-schema";
import { createOptIrAbiFactQuery, type OptIrAbiFactQuery } from "./abi-facts";
import {
  createOptIrBoundsFactQuery,
  type OptIrBoundsFactQuery,
  type OptIrBoundsSubject,
} from "./bounds-facts";
import {
  createOptIrLayoutFactQuery,
  type OptIrEndianOfLayoutAccessInput,
  type OptIrLayoutFactQuery,
} from "./layout-facts";

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
  extends OptIrBoundsFactQuery, OptIrLayoutFactQuery, OptIrAbiFactQuery {}

export function createOptIrFactQuery(factSet: OptIrFactSet): OptIrFactQuery {
  const bounds = createOptIrBoundsFactQuery(factSet);
  const layout = createOptIrLayoutFactQuery(factSet);
  const abi = createOptIrAbiFactQuery(factSet);
  return Object.freeze({
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
  });
}
