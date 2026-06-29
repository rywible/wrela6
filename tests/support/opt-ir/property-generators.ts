import fastCheck from "fast-check";

import { checkedOptIrHandoffFingerprint, type CheckedOptIrHandoff } from "../../../src/proof-check";
import type { CheckedMirProgram } from "../../../src/proof-check/model/checked-mir";
import { buildOptimizedOptIr, type BuildOptimizedOptIrInput } from "../../../src/opt-ir/public-api";
import {
  stableOptimizedOptIrResultKey,
  type OptimizeOptIrResult,
} from "../../../src/opt-ir/passes/pipeline";
import { productionOptimizationPolicyForTest } from "../../../src/opt-ir/policy/optimization-profile";
import { proofMirCanonicalKey, type ProofMirCanonicalKey } from "../../../src/proof-mir";
import {
  validConstructOptIrInputForTest,
  validConstructOptIrInputWithReachableBlocksForTest,
} from "./construction-fixtures";

export function smallCheckedMirProgramArbitrary(): fastCheck.Arbitrary<CheckedMirProgram> {
  return fastCheck.constantFrom(
    validConstructOptIrInputForTest().handoff.checkedMir,
    validConstructOptIrInputWithReachableBlocksForTest().handoff.checkedMir,
  );
}

export function inputFromProgramForTest(program: CheckedMirProgram): BuildOptimizedOptIrInput {
  const input = validConstructOptIrInputForTest();
  return {
    ...input,
    handoff: withCheckedMir(input.handoff, program),
    policy: productionOptimizationPolicyForTest(),
  };
}

export function buildOptimizedOptIrForTest(input: BuildOptimizedOptIrInput): OptimizeOptIrResult {
  return buildOptimizedOptIr(input);
}

export function shuffleTablesForTest(program: CheckedMirProgram): CheckedMirProgram {
  return {
    ...program,
    checkedFunctions: reverseMap(program.checkedFunctions),
    summaries: reverseMap(program.summaries),
    originMap: reverseMap(program.originMap),
    mir: {
      ...program.mir,
      reachableFunctions: reverseTable(
        program.mir.reachableFunctions,
        (entry) => entry.functionInstanceId,
      ),
      functions: reverseTable(program.mir.functions, (function_) => function_.functionInstanceId),
      facts: reverseTable(program.mir.facts, (fact) => fact.factId),
      origins: reverseTable(program.mir.origins, (origin) => origin.originId),
      privateStateGenerations: reverseTable(
        program.mir.privateStateGenerations,
        (generation) => generation.generationId,
      ),
      runtimeCalls: reverseTable(program.mir.runtimeCalls, (call) => call.runtimeCallId),
    },
  };
}

export function optIrProgramStableKeyForTest(program: unknown): string {
  return stableJson(program);
}

export function optIrResultStableKeyForTest(result: OptimizeOptIrResult): string {
  return stableOptimizedOptIrResultKey(result);
}

function withCheckedMir(
  handoff: CheckedOptIrHandoff,
  checkedMir: CheckedMirProgram,
): CheckedOptIrHandoff {
  const withoutFingerprint = {
    ...handoff,
    checkedMir,
    packetValidation: {
      ...handoff.packetValidation,
      checkedFactPacketStableKey: stableJson(checkedMir.facts),
      acceptedFunctionInstanceIds: [...checkedMir.checkedFunctions.keys()].sort(),
      summaryCertificateIds: [...checkedMir.checkedFunctions.values()]
        .map((checkedFunction) => checkedFunction.summaryCertificate)
        .sort((left, right) => left - right),
      terminalGraphCertificateId: checkedMir.terminalGraph.certificateId,
      originMapStableKey: stableJson(checkedMir.originMap),
    },
  };
  return {
    ...withoutFingerprint,
    handoffFingerprint: checkedOptIrHandoffFingerprint(withoutFingerprint),
  };
}

function reverseMap<Key, Value>(map: ReadonlyMap<Key, Value>): ReadonlyMap<Key, Value> {
  return new Map([...map.entries()].reverse());
}

function reverseTable<LookupId, Entry>(
  table: {
    readonly get: (lookupId: LookupId) => Entry | undefined;
    readonly has: (lookupId: LookupId) => boolean;
    readonly keyOf: (entry: Entry) => ProofMirCanonicalKey;
    readonly lookupKeyOf: (lookupId: LookupId) => ProofMirCanonicalKey;
    readonly entries: () => readonly Entry[];
  },
  idOf: (entry: Entry) => LookupId,
): typeof table {
  const entries = table.entries().slice().reverse();
  const byId = new Map(entries.map((entry) => [idOf(entry), entry] as const));
  return {
    get: (lookupId) => byId.get(lookupId),
    has: (lookupId) => byId.has(lookupId),
    keyOf: (entry) => proofMirCanonicalKey(String(idOf(entry))),
    lookupKeyOf: (lookupId) => proofMirCanonicalKey(String(lookupId)),
    entries: () => entries.slice(),
  };
}

import { stableJson } from "../../../src/shared/stable-json";
