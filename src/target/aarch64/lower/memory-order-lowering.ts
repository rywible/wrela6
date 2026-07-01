import type { AArch64MemoryOrder, AArch64RegionMemoryType } from "../machine-ir/memory-order";
import { appendAArch64SelectionRecord, type AArch64LoweringState } from "./pipeline-stages";
import { recordAArch64StagePlanning } from "./stage-helpers";

export function lowerAArch64MemoryOrder(input: {
  readonly accessKind: "load" | "store" | "readModifyWrite" | "fence";
  readonly order?: AArch64MemoryOrder;
  readonly regionMemoryType: AArch64RegionMemoryType;
  readonly publicationShape?: string;
}):
  | { readonly kind: "ok"; readonly instructions: readonly string[] }
  | { readonly kind: "error"; readonly reason: string } {
  const order = input.order;
  if (
    (input.regionMemoryType === "deviceMmio" || input.publicationShape?.includes("virtio")) &&
    order === undefined
  ) {
    return { kind: "error", reason: "memory-order:missing-required-fact" };
  }
  if (input.accessKind === "readModifyWrite") {
    return {
      kind: "ok",
      instructions: Object.freeze([lseReadModifyWriteOpcode(order)]),
    };
  }
  if (input.accessKind === "load" && (order === "acquire" || order === "sequentiallyConsistent")) {
    return {
      kind: "ok",
      instructions: Object.freeze(order === "sequentiallyConsistent" ? ["dmb", "ldar"] : ["ldar"]),
    };
  }
  if (input.accessKind === "store" && (order === "release" || order === "sequentiallyConsistent")) {
    const instructions =
      order === "sequentiallyConsistent" || input.publicationShape?.includes("virtio")
        ? ["stlr", "dmb"]
        : ["stlr"];
    return { kind: "ok", instructions: Object.freeze(instructions) };
  }
  if (input.accessKind === "fence") {
    return { kind: "ok", instructions: Object.freeze([order === "deviceOrdered" ? "dsb" : "dmb"]) };
  }
  return { kind: "ok", instructions: Object.freeze([]) };
}

export function lowerAArch64MemoryOrderStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  const emittedOpcodes = emittedMemoryOrderOpcodes(state);
  const planned = recordAArch64StagePlanning(
    state,
    "lower-memory-order",
    "memory-order-sequences-recorded",
  );
  return appendAArch64SelectionRecord(planned, {
    stageKey: "lower-memory-order",
    subjectKey: "program",
    patternId: "memory-order.public-materialized",
    tier: "planning",
    factsUsed: state.facts.records
      .filter((record) => record.extensionKey === "memory-order")
      .map((record) => Number(record.factId)),
    emittedOpcodes,
    explanation:
      emittedOpcodes.length === 0
        ? ["lower-memory-order:no-ordered-machine-opcodes"]
        : [`lower-memory-order:emitted:${emittedOpcodes.join(",")}`],
  });
}

function emittedMemoryOrderOpcodes(state: AArch64LoweringState): readonly string[] {
  const ordered = new Set(["dmb", "dsb", "ldar", "stlr", "ldadd", "ldadda", "ldaddl", "ldaddal"]);
  return Object.freeze(machineOpcodes(state).filter((opcode) => ordered.has(opcode)));
}

function lseReadModifyWriteOpcode(
  order: AArch64MemoryOrder | undefined,
): "ldadd" | "ldadda" | "ldaddl" | "ldaddal" {
  switch (order) {
    case "acquire":
      return "ldadda";
    case "release":
      return "ldaddl";
    case "acquireRelease":
    case "sequentiallyConsistent":
      return "ldaddal";
    case "relaxed":
    case "deviceOrdered":
    case "compilerOnlyOrdered":
    case undefined:
      return "ldadd";
  }
}

function machineOpcodes(state: AArch64LoweringState): readonly string[] {
  return (
    state.machineProgram?.functions
      .entries()
      .flatMap((func) =>
        func.blocks.flatMap((block) => [
          ...block.instructions,
          ...(block.terminator === undefined ? [] : [block.terminator]),
        ]),
      )
      .map((instruction) => String(instruction.opcode)) ?? []
  );
}
