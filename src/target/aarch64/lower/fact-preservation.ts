import type { OptIrFactRecord, OptIrFactSet } from "../../../opt-ir/facts/fact-index";
import type { OptIrFactId } from "../../../opt-ir/ids";
import { aarch64MachineFactId, type AArch64MachineInstructionId } from "../machine-ir/ids";
import type { AArch64MachineInstruction } from "../machine-ir/machine-instruction";
import {
  aarch64MachineFactRecord,
  aarch64PreservedFactSet,
  type AArch64PreservedFactSet,
} from "../machine-ir/fact-set";
import type { AArch64MachineProgram } from "../machine-ir/machine-program";
import { dependencyEdgeKey, type AArch64DependencyEdge } from "../plan/required-constraints";
import type { AArch64FactPreservationMapping, AArch64LoweringState } from "./pipeline-stages";

const AARCH64_CANONICAL_TARGET_DECLARATION = "wrela-uefi-aarch64-rpi5-v1";
const AARCH64_MEMORY_ORDER_TARGET_DECLARATION = "target.memory-order";

export function preserveAArch64Facts(input: {
  readonly optIrFacts: OptIrFactSet;
  readonly selectionRecords: readonly {
    readonly patternId: string;
    readonly inputFacts: readonly number[];
    readonly machineInstructions: readonly AArch64MachineInstructionId[];
    readonly factPreservationMappings?: readonly AArch64FactPreservationMapping[];
  }[];
}): AArch64PreservedFactSet {
  const records = [];
  let nextFactId = 0;
  for (const record of input.selectionRecords) {
    const mappings =
      record.factPreservationMappings ??
      legacyInstructionMappings({
        patternId: record.patternId,
        inputFacts: record.inputFacts,
        machineInstructions: record.machineInstructions,
      });
    for (const mapping of mappings) {
      const implicitBackendFact = backendFactDescriptorForMapping(mapping, input.optIrFacts);
      records.push(
        aarch64MachineFactRecord({
          factId: aarch64MachineFactId(nextFactId),
          extensionKey:
            mapping.extensionKey ?? implicitBackendFact?.extensionKey ?? "legacy.machine-fact",
          subject: mapping.subject,
          payload: mapping.payload ??
            implicitBackendFact?.payload ?? { patternId: record.patternId },
          lineage: {
            optIrFactIds: optIrFactIdsFromNumbers(mapping.optIrFactIds),
            targetDeclarationKeys: mapping.targetDeclarationKeys ?? [
              AARCH64_CANONICAL_TARGET_DECLARATION,
            ],
          },
          ...((mapping.upstreamVerifierKey ?? implicitBackendFact?.upstreamVerifierKey) ===
          undefined
            ? {}
            : {
                upstreamVerifierKey:
                  mapping.upstreamVerifierKey ?? implicitBackendFact?.upstreamVerifierKey,
              }),
          targetDeclarationKeys: mapping.targetDeclarationKeys ??
            implicitBackendFact?.targetDeclarationKeys ?? [AARCH64_CANONICAL_TARGET_DECLARATION],
          manifestGate: mapping.manifestGate ?? record.patternId,
        }),
      );
      nextFactId += 1;
    }
  }
  const used = new Set(
    input.selectionRecords.flatMap((record) =>
      (
        record.factPreservationMappings ??
        legacyInstructionMappings({
          patternId: record.patternId,
          inputFacts: record.inputFacts,
          machineInstructions: record.machineInstructions,
        })
      ).flatMap((mapping) => mapping.optIrFactIds),
    ),
  );
  const droppedFacts = input.optIrFacts.records
    .filter((record) => !used.has(Number(record.factId)))
    .map((record) => ({ optIrFactId: record.factId, reason: "no-surviving-machine-subject" }));
  return aarch64PreservedFactSet({
    records,
    droppedFacts,
    targetDeclarations: [
      AARCH64_CANONICAL_TARGET_DECLARATION,
      ...records.flatMap((record) => record.targetDeclarationKeys),
    ],
  });
}

export function preserveAArch64MachineFactsStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  const selectionRecords = state.selectionRecords
    .map((record) => ({
      patternId: record.patternId,
      inputFacts: record.factsUsed,
      machineInstructions: record.emittedInstructionIds ?? [],
      factPreservationMappings:
        record.factPreservationMappings ??
        deriveFactPreservationMappings({
          record,
          facts: state.facts,
          machineProgram: state.machineProgram,
          dependencyEdges: state.dependencyEdges,
          requiredEdges: state.requiredEdges,
        }),
    }))
    .filter(
      (record) =>
        record.inputFacts.length > 0 || (record.factPreservationMappings?.length ?? 0) > 0,
    );
  return Object.freeze({
    ...state,
    preservedFacts: preserveAArch64Facts({ optIrFacts: state.facts, selectionRecords }),
  });
}

function legacyInstructionMappings(input: {
  readonly patternId: string;
  readonly inputFacts: readonly number[];
  readonly machineInstructions: readonly AArch64MachineInstructionId[];
}): readonly AArch64FactPreservationMapping[] {
  if (input.inputFacts.length === 0) {
    return [];
  }
  return input.machineInstructions.map((machineInstruction) => ({
    optIrFactIds: input.inputFacts,
    extensionKey: "legacy.machine-fact",
    subject: {
      kind: "machineInstruction",
      instructionId: Number(machineInstruction),
    },
    payload: { patternId: input.patternId, preservation: "legacy-instruction-subject" },
    targetDeclarationKeys: [AARCH64_CANONICAL_TARGET_DECLARATION],
    manifestGate: input.patternId,
  }));
}

function deriveFactPreservationMappings(input: {
  readonly record: AArch64LoweringState["selectionRecords"][number];
  readonly facts: OptIrFactSet;
  readonly machineProgram: AArch64MachineProgram | undefined;
  readonly dependencyEdges: readonly AArch64DependencyEdge[];
  readonly requiredEdges: readonly AArch64DependencyEdge[];
}): readonly AArch64FactPreservationMapping[] {
  if (input.machineProgram === undefined || input.record.factsUsed.length === 0) {
    return [];
  }
  const instructions = instructionMap(input.machineProgram);
  const emitted = (input.record.emittedInstructionIds ?? [])
    .map((instructionId) => instructions.get(Number(instructionId)))
    .filter((instruction): instruction is AArch64MachineInstruction => instruction !== undefined);
  const mappings: AArch64FactPreservationMapping[] = [];
  for (const factId of input.record.factsUsed) {
    const fact = input.facts.indexes.byId[factId];
    if (fact === undefined) {
      continue;
    }
    mappings.push(
      ...mappingForFact({
        fact,
        record: input.record,
        emitted,
        dependencyEdges: input.dependencyEdges,
        requiredEdges: input.requiredEdges,
      }),
    );
  }
  return Object.freeze(mappings);
}

function mappingForFact(input: {
  readonly fact: OptIrFactRecord;
  readonly record: AArch64LoweringState["selectionRecords"][number];
  readonly emitted: readonly AArch64MachineInstruction[];
  readonly dependencyEdges: readonly AArch64DependencyEdge[];
  readonly requiredEdges: readonly AArch64DependencyEdge[];
}): readonly AArch64FactPreservationMapping[] {
  const backendFact = backendFactDescriptorForOptIrFact(input.fact);
  const base = {
    optIrFactIds: [Number(input.fact.factId)],
    extensionKey: backendFact.extensionKey,
    payload: backendFact.payload ?? {
      extensionKey: input.fact.extensionKey ?? input.fact.packetKind,
      packetKind: input.fact.extensionPacketKind ?? input.fact.packetKind,
      patternId: input.record.patternId,
    },
    ...(backendFact.upstreamVerifierKey === undefined
      ? {}
      : { upstreamVerifierKey: backendFact.upstreamVerifierKey }),
    targetDeclarationKeys: backendFact.targetDeclarationKeys ?? [
      AARCH64_CANONICAL_TARGET_DECLARATION,
    ],
    manifestGate: input.record.patternId,
  } satisfies Omit<AArch64FactPreservationMapping, "subject">;

  const subject = input.fact.subject;
  if (subject.kind === "value") {
    return [{ ...base, subject: { kind: "virtualRegister", vreg: Number(subject.valueId) } }];
  }
  if (subject.kind === "optIrRegion") {
    return [{ ...base, subject: { kind: "region", regionKey: String(subject.regionId) } }];
  }
  if (subject.kind === "optIrCall") {
    return [{ ...base, subject: { kind: "callSite", callKey: `call:${String(subject.callId)}` } }];
  }

  const memoryOperands = input.emitted.flatMap(memoryOperandMappings);
  if (
    input.fact.extensionKey === "footprint" ||
    input.fact.extensionPacketKind === "memory-order" ||
    input.fact.extensionPacketKind === "barrier-domain"
  ) {
    const edge = dependencyEdgeForEmittedInstructions({
      emitted: input.emitted,
      dependencyEdges: input.dependencyEdges,
      requiredEdges: input.requiredEdges,
    });
    return Object.freeze([
      ...memoryOperands.map((mapping) => ({ ...base, subject: mapping })),
      ...(edge === undefined
        ? []
        : [
            {
              ...base,
              subject: { kind: "machineEdge" as const, edgeKey: dependencyEdgeKey(edge) },
            },
          ]),
    ]);
  }

  if (input.fact.extensionKey === "security") {
    return Object.freeze(
      input.emitted.map((instruction) => ({
        ...base,
        subject: {
          kind: "machineInstruction" as const,
          instructionId: Number(instruction.instructionId),
        },
      })),
    );
  }

  const first = input.emitted[0];
  return first === undefined
    ? []
    : [
        {
          ...base,
          subject: {
            kind: "machineInstruction",
            instructionId: Number(first.instructionId),
          },
        },
      ];
}

function backendFactDescriptorForOptIrFact(fact: OptIrFactRecord): {
  readonly extensionKey: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly upstreamVerifierKey?: string;
  readonly targetDeclarationKeys?: readonly string[];
} {
  if (fact.extensionKey !== "memory-order") {
    return { extensionKey: fact.extensionKey ?? fact.packetKind };
  }
  const payload = optIrFactPayload(fact);
  return {
    extensionKey: "memory-order-and-region-type",
    payload: {
      region: backendMemoryRegionKey(fact),
      order: backendMemoryOrder(payload.order, fact.extensionPacketKind),
      regionType: backendRegionMemoryType(payload.memoryType),
    },
    upstreamVerifierKey: "proof.memory-order",
    targetDeclarationKeys: [AARCH64_MEMORY_ORDER_TARGET_DECLARATION],
  };
}

function backendFactDescriptorForMapping(
  mapping: AArch64FactPreservationMapping,
  optIrFacts: OptIrFactSet,
): ReturnType<typeof backendFactDescriptorForOptIrFact> | undefined {
  if (mapping.extensionKey !== undefined || mapping.optIrFactIds.length !== 1) {
    return undefined;
  }
  const factId = mapping.optIrFactIds[0];
  if (factId === undefined) {
    return undefined;
  }
  const fact = optIrFacts.indexes.byId[factId];
  return fact === undefined ? undefined : backendFactDescriptorForOptIrFact(fact);
}

function optIrFactPayload(fact: OptIrFactRecord): Readonly<Record<string, unknown>> {
  return fact.extensionPayload !== undefined &&
    typeof fact.extensionPayload === "object" &&
    fact.extensionPayload !== null
    ? (fact.extensionPayload as Readonly<Record<string, unknown>>)
    : {};
}

function backendMemoryRegionKey(fact: OptIrFactRecord): string {
  if (fact.subject.kind === "optIrRegion") {
    return `region:${String(fact.subject.regionId)}`;
  }
  if (fact.subject.kind === "operation") {
    return `operation:${String(fact.subject.operationId)}`;
  }
  return fact.subjectKey;
}

function backendMemoryOrder(value: unknown, packetKind: string | undefined): string {
  if (value === undefined) {
    return packetKind === "barrier-domain" ? "seq_cst" : "relaxed";
  }
  switch (value) {
    case "relaxed":
      return "relaxed";
    case "acquire":
      return "acquire";
    case "release":
      return "release";
    case "acquireRelease":
      return "acq_rel";
    case "sequentiallyConsistent":
    case "deviceOrdered":
      return "seq_cst";
    case "compilerOnlyOrdered":
      return "relaxed";
    default:
      return `unsupported:${String(value)}`;
  }
}

function backendRegionMemoryType(value: unknown): string {
  if (value === undefined) {
    return "normal";
  }
  switch (value) {
    case "normalCacheable":
    case "packetSource":
    case "validatedPayload":
      return "normal";
    case "deviceMmio":
      return "mmio";
    case "firmwareTable":
    case "runtimeOwned":
    case "externalConservative":
      return "volatile";
    default:
      return `unsupported:${String(value)}`;
  }
}

function memoryOperandMappings(
  instruction: AArch64MachineInstruction,
): readonly AArch64FactPreservationMapping["subject"][] {
  return instruction.operands.flatMap((operand, operandIndex) =>
    operand.role === "memoryBase" || operand.role === "memoryIndex"
      ? [
          {
            kind: "memoryOperand" as const,
            instructionId: Number(instruction.instructionId),
            operandIndex,
          },
        ]
      : [],
  );
}

function dependencyEdgeForEmittedInstructions(input: {
  readonly emitted: readonly AArch64MachineInstruction[];
  readonly dependencyEdges: readonly AArch64DependencyEdge[];
  readonly requiredEdges: readonly AArch64DependencyEdge[];
}): AArch64DependencyEdge | undefined {
  const emittedIds = new Set(input.emitted.map((instruction) => Number(instruction.instructionId)));
  return [...input.dependencyEdges, ...input.requiredEdges].find(
    (edge) => emittedIds.has(edge.fromInstruction) || emittedIds.has(edge.toInstruction),
  );
}

function instructionMap(
  machineProgram: AArch64MachineProgram,
): ReadonlyMap<number, AArch64MachineInstruction> {
  return new Map(
    machineProgram.functions
      .entries()
      .flatMap((func) =>
        func.blocks.flatMap((block) => [
          ...block.instructions,
          ...(block.terminator === undefined ? [] : [block.terminator]),
        ]),
      )
      .map((instruction) => [Number(instruction.instructionId), instruction] as const),
  );
}

function optIrFactIdsFromNumbers(factIds: readonly number[]): readonly OptIrFactId[] {
  return factIds.map((factId) => factId as OptIrFactId);
}
