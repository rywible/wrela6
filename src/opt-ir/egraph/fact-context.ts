import type { CheckedPacketFactKind } from "../../proof-check/model/fact-packet";
import type { OptIrFactSet } from "../facts/fact-index";
import { optIrFactId } from "../ids";
import {
  evaluateOptIrFactGate,
  factKindsForGate,
  type OptIrFactGate,
  type OptIrFactGateEvaluationContext,
} from "./fact-gated-rule";
import { layoutSubjectKey } from "../facts/layout-facts";
import { layoutFactKey, type LayoutFactKey } from "../../proof-check/model/fact-packet";

const GATE_KIND_TO_PACKET_KINDS: Readonly<
  Record<
    Exclude<keyof OptIrFactGateEvaluationContext["answers"], never>,
    readonly CheckedPacketFactKind[]
  >
> = Object.freeze({
  bounds: ["validatedBuffer", "packetSource"],
  alias: ["ownership", "noalias", "fieldDisjointness"],
  layout: ["layoutAbi"],
  effect: ["platformEffect"],
  abi: ["layoutAbi"],
  terminal: ["terminalClosure", "exitClosure"],
  capabilityFlow: ["capabilityFlow"],
  privateState: ["privateState", "erasure"],
});

export function buildOptIrFactGateContextFromFacts(
  facts: OptIrFactSet,
): OptIrFactGateEvaluationContext {
  const factsByKind = new Map<CheckedPacketFactKind, OptIrFactRecord[]>();
  for (const record of facts.records) {
    const existing = factsByKind.get(record.packetKind) ?? [];
    existing.push(record);
    factsByKind.set(record.packetKind, existing);
  }

  const answerFor =
    (gateKind: keyof typeof GATE_KIND_TO_PACKET_KINDS) =>
    (subjectRole: string): ReturnType<OptIrFactGateEvaluationContext["answers"]["bounds"]> => {
      const acceptedKinds = GATE_KIND_TO_PACKET_KINDS[gateKind];
      const matched = acceptedKinds.flatMap((kind) => factsByKind.get(kind) ?? []);
      const roleMatched = matched.filter((record) =>
        factRecordMatchesSubjectRole(record, subjectRole),
      );
      const selected = roleMatched;
      return Object.freeze({
        kind: selected.length > 0 ? ("yes" as const) : ("unknown" as const),
        factsUsed: Object.freeze(selected.map((record) => record.factId)),
      });
    };

  return Object.freeze({
    answers: Object.freeze({
      bounds: answerFor("bounds"),
      alias: answerFor("alias"),
      layout: answerFor("layout"),
      effect: answerFor("effect"),
      abi: answerFor("abi"),
      terminal: answerFor("terminal"),
      capabilityFlow: answerFor("capabilityFlow"),
      privateState: answerFor("privateState"),
    }),
  });
}

type OptIrFactRecord = OptIrFactSet["records"][number];

function factRecordMatchesSubjectRole(record: OptIrFactRecord, subjectRole: string): boolean {
  if (subjectRole.length === 0) {
    return true;
  }
  if (record.subjectKey === subjectRole || record.scopeKey === subjectRole) {
    return true;
  }
  const layoutKey = layoutKeyFromSubjectRole(subjectRole);
  if (layoutKey !== undefined) {
    const layoutKeyString = layoutSubjectKey(layoutKey);
    return record.subjectKey === layoutKeyString || record.scopeKey === layoutKeyString;
  }
  return false;
}

function layoutKeyFromSubjectRole(subjectRole: string): LayoutFactKey | undefined {
  if (!subjectRole.startsWith("layout:")) {
    return undefined;
  }
  const key = subjectRole.slice("layout:".length);
  if (key.length === 0) {
    return undefined;
  }
  return layoutFactKey(key);
}

export function buildPermissiveOptIrFactGateContextForTest(): OptIrFactGateEvaluationContext {
  return Object.freeze({
    answers: Object.freeze({
      bounds: () => ({ kind: "yes" as const, factsUsed: [optIrFactId(1)] }),
      alias: () => ({ kind: "yes" as const, factsUsed: [optIrFactId(1)] }),
      layout: () => ({ kind: "yes" as const, factsUsed: [optIrFactId(1)] }),
      effect: () => ({ kind: "yes" as const, factsUsed: [optIrFactId(1)] }),
      abi: () => ({ kind: "yes" as const, factsUsed: [optIrFactId(1)] }),
      terminal: () => ({ kind: "yes" as const, factsUsed: [optIrFactId(1)] }),
      capabilityFlow: () => ({ kind: "yes" as const, factsUsed: [optIrFactId(1)] }),
      privateState: () => ({ kind: "yes" as const, factsUsed: [optIrFactId(1)] }),
    }),
  });
}

export function ruleGatePasses(
  gate: OptIrFactGate,
  context: OptIrFactGateEvaluationContext,
): boolean {
  return evaluateOptIrFactGate(gate, context).kind === "passed";
}

export function approvedNotApplicableReasonsForCatalogGates(
  gates: readonly OptIrFactGate[],
): readonly string[] {
  const reasons = new Set<string>();
  for (const gate of gates) {
    for (const factKind of factKindsForGate(gate)) {
      reasons.add(`unsupported-interpreter-rule:${factKind}`);
    }
  }
  return Object.freeze(
    [
      ...reasons,
      "unsupported-interpreter-rule:runtime-call",
      "unsupported-interpreter-rule:source-call",
    ].sort(),
  );
}
