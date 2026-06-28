import { proofMirPlaceId, type ProofMirPlaceId } from "../../proof-mir/ids";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import type { CheckedActiveFact } from "../kernel/state";
import {
  proofCheckPlaceBinderKey,
  type ProofCheckFactTerm,
  type ProofCheckOperandTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function proofMirPlaceKeyTokenPattern(placeKey: string): RegExp | undefined {
  if (!placeKey.startsWith("proofMirPlace:")) {
    return undefined;
  }
  const suffix = placeKey.slice("proofMirPlace:".length);
  return new RegExp(`${escapeRegExp("proofMirPlace:")}${escapeRegExp(suffix)}(?::|@|$)`);
}

export function textReferencesPlaceKey(text: string, placeKey: string): boolean {
  if (text === placeKey) {
    return true;
  }
  if (text.startsWith(`${placeKey}:`)) {
    return true;
  }
  if (text.startsWith(`place:${placeKey}:`) || text.startsWith(`place:${placeKey}@`)) {
    return true;
  }

  const proofMirPattern = proofMirPlaceKeyTokenPattern(placeKey);
  if (proofMirPattern !== undefined) {
    return proofMirPattern.test(text);
  }

  if (placeKey.startsWith("parameter:")) {
    const index = placeKey.slice("parameter:".length);
    return (
      text.includes(`:parameter:${index}:`) ||
      text.includes(`:parameter:${index}@`) ||
      text.endsWith(`:parameter:${index}`)
    );
  }

  if (placeKey === "receiver") {
    return text.includes(":receiver:") || text.endsWith(":receiver");
  }

  if (placeKey === "result") {
    return text.includes(":result:") || text.endsWith(":result");
  }

  return text.includes(`:${placeKey}:`) || text.includes(`:${placeKey}@`);
}

export function factReferencesPlaceKey(fact: CheckedActiveFact, placeKey: string): boolean {
  if (textReferencesPlaceKey(fact.factKey, placeKey)) {
    return true;
  }
  return textReferencesPlaceKey(fact.termKey, placeKey);
}

function placeBinderForPlaceKey(
  placeKey: string,
  functionGraph?: ProofMirFunction,
): ProofCheckPlaceBinder | undefined {
  if (placeKey === "receiver") {
    return { kind: "receiver" };
  }
  if (placeKey === "result") {
    return { kind: "result" };
  }
  const parameterMatch = /^parameter:(\d+)$/.exec(placeKey);
  if (parameterMatch !== null) {
    const index = Number(parameterMatch[1]);
    const parameter = functionGraph?.signature.parameters[index];
    return {
      kind: "parameter",
      index,
      ...(parameter === undefined ? {} : { parameterId: parameter.parameterId }),
    };
  }
  const proofMirMatch = /^proofMirPlace:(\d+)/.exec(placeKey);
  if (proofMirMatch !== null) {
    return { kind: "proofMirPlace", placeId: proofMirPlaceId(Number(proofMirMatch[1])) };
  }
  return undefined;
}

function operandReferencesPlaceBinder(
  operand: ProofCheckOperandTerm,
  binder: ProofCheckPlaceBinder,
): boolean {
  if (operand.kind !== "place") {
    return false;
  }
  return proofCheckPlaceBinderKey(operand.place) === proofCheckPlaceBinderKey(binder);
}

function termReferencesPlaceBinder(
  term: ProofCheckFactTerm | ProofCheckRequirementTerm,
  binder: ProofCheckPlaceBinder,
): boolean {
  switch (term.kind) {
    case "comparison":
      return (
        operandReferencesPlaceBinder(term.left, binder) ||
        operandReferencesPlaceBinder(term.right, binder)
      );
    case "packetSource":
      return (
        proofCheckPlaceBinderKey(term.packet) === proofCheckPlaceBinderKey(binder) ||
        proofCheckPlaceBinderKey(term.source) === proofCheckPlaceBinderKey(binder)
      );
    case "capability":
      return proofCheckPlaceBinderKey(term.capability) === proofCheckPlaceBinderKey(binder);
    case "layoutFits":
    case "payloadEnd":
    case "fieldAvailable":
      return proofCheckPlaceBinderKey(term.source) === proofCheckPlaceBinderKey(binder);
    default:
      return false;
  }
}

export function requirementTermReferencesPlaceKey(
  term: ProofCheckRequirementTerm,
  placeKey: string,
  functionGraph?: ProofMirFunction,
): boolean {
  const binder = placeBinderForPlaceKey(placeKey, functionGraph);
  if (binder === undefined) {
    return false;
  }
  return termReferencesPlaceBinder(term, binder);
}

export function proofMirPlaceIdFromPlaceKey(placeKey: string): ProofMirPlaceId | undefined {
  const proofMirMatch = /^proofMirPlace:(\d+)/.exec(placeKey);
  if (proofMirMatch === null) {
    return undefined;
  }
  return proofMirPlaceId(Number(proofMirMatch[1]));
}
