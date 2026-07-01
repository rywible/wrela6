import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type {
  AArch64BackendFactIndex,
  AArch64ImportedBackendFact,
} from "../facts/backend-fact-query";
import type { AArch64RematerializationAuthority } from "../allocation/spill-remat";

export function rematerializationAuthoritiesFromFacts(
  factIndex: AArch64BackendFactIndex,
): readonly AArch64RematerializationAuthority[] {
  return Object.freeze(
    factIndex
      .factsForFamily("rematerialization-authority")
      .flatMap(authorityFromFact)
      .sort(compareRematerializationAuthorities),
  );
}

function authorityFromFact(
  fact: AArch64ImportedBackendFact,
): readonly AArch64RematerializationAuthority[] {
  if (fact.subject.kind !== "virtualRegister") return Object.freeze([]);
  const legalAtUseSiteKeys = legalUseSiteKeys(fact.payload, fact.subject.vreg);
  if (fact.payload.kind === "constant-remat") {
    const value = rematConstantValue(fact.payload.value);
    if (value === undefined) return Object.freeze([]);
    const securityLabel = stringField(fact.payload.securityLabel);
    return [
      Object.freeze({
        vreg: fact.subject.vreg,
        kind: "constant" as const,
        legalAtUseSiteKeys,
        constantValue: value,
        ...(securityLabel === undefined ? {} : { securityLabel }),
      }),
    ];
  }
  if (fact.payload.kind === "page-remat") {
    const relocationPairKey = stringField(fact.payload.relocationPairKey);
    return [
      Object.freeze({
        vreg: fact.subject.vreg,
        kind: "page-base" as const,
        legalAtUseSiteKeys,
        ...(relocationPairKey === undefined ? {} : { relocationPairKey }),
      }),
    ];
  }
  if (fact.payload.kind === "literal-remat" || fact.payload.kind === "symbol-remat") {
    return [
      Object.freeze({
        vreg: fact.subject.vreg,
        kind: "literal" as const,
        legalAtUseSiteKeys,
      }),
    ];
  }
  return Object.freeze([]);
}

function legalUseSiteKeys(
  payload: Readonly<Record<string, unknown>>,
  vreg: number,
): readonly string[] {
  if (Array.isArray(payload.legalAtUseSiteKeys)) {
    const keys = payload.legalAtUseSiteKeys
      .filter((key): key is string => typeof key === "string" && key.length > 0)
      .sort(compareCodeUnitStrings);
    if (keys.length > 0) return Object.freeze([...new Set(keys)]);
  }
  return Object.freeze([`live-range:vreg:${vreg}`]);
}

function rematConstantValue(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return undefined;
  return BigInt(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compareRematerializationAuthorities(
  left: AArch64RematerializationAuthority,
  right: AArch64RematerializationAuthority,
): number {
  return (
    left.vreg - right.vreg ||
    compareCodeUnitStrings(left.kind, right.kind) ||
    compareCodeUnitStrings(left.legalAtUseSiteKeys.join(","), right.legalAtUseSiteKeys.join(","))
  );
}
