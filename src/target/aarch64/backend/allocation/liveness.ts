import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type { AArch64MachineFunction } from "../../machine-ir/machine-function";
import type { AArch64MachineInstruction } from "../../machine-ir/machine-instruction";
import type { AArch64RegisterClass } from "../../machine-ir/machine-types";

export interface AArch64LiveSegment {
  readonly startOrder: number;
  readonly endOrder: number;
  readonly reason: string;
}

export interface AArch64LiveInterval {
  readonly liveRangeKey: string;
  readonly vreg: number;
  readonly registerClass: AArch64RegisterClass;
  readonly segments: readonly AArch64LiveSegment[];
  readonly cutPoints: readonly number[];
  readonly noSpill: boolean;
  readonly clobberedPhysicalRegisters: readonly string[];
}

export interface AArch64LivenessInput {
  readonly func: AArch64MachineFunction;
  readonly ownershipDeaths?: readonly { readonly vreg: number; readonly instructionId: number }[];
  readonly callBoundaries?: readonly {
    readonly instructionId: number;
    readonly clobberedPhysicalRegisters?: readonly string[];
  }[];
  readonly noSpillVregs?: readonly number[];
}

export interface AArch64LivenessResult {
  readonly intervals: readonly AArch64LiveInterval[];
  readonly byVreg: (vreg: number) => AArch64LiveInterval | undefined;
}

interface InstructionPoint {
  readonly blockId: number;
  readonly order: number;
  readonly instruction: AArch64MachineInstruction;
}

interface BlockRecord {
  readonly blockId: number;
  readonly startOrder: number;
  readonly endOrder: number;
  readonly points: readonly InstructionPoint[];
  readonly successors: readonly number[];
  readonly use: ReadonlySet<number>;
  readonly def: ReadonlySet<number>;
}

interface VregRecord {
  readonly registerClass: AArch64RegisterClass;
  readonly defs: number[];
  readonly uses: number[];
}

export function buildAArch64LiveIntervals(input: AArch64LivenessInput): AArch64LivenessResult {
  const points = orderedInstructions(input.func);
  const useDef = collectUseDef(points);
  const blockRecords = buildBlockRecords(input.func, points);
  const dataflow = solveBlockLiveness(blockRecords);
  const deathByVreg = new Map(
    (input.ownershipDeaths ?? []).map((death) => [
      death.vreg,
      orderForInstruction(points, death.instructionId),
    ]),
  );
  const callCuts = new Set([
    ...points
      .filter(
        (point) =>
          String(point.instruction.opcode) === "bl" || String(point.instruction.opcode) === "blr",
      )
      .map((point) => point.order),
    ...(input.callBoundaries ?? []).map((boundary) =>
      orderForInstruction(points, boundary.instructionId),
    ),
  ]);
  const noSpill = new Set(input.noSpillVregs ?? []);
  const fallbackCallClobbers = sortedCallClobbers(input.func);
  const callClobbersByOrder = mergeCallClobbersByOrder(
    callClobbersByOrderFromFunction(input.func, points),
    callClobbersByOrderFromInput(input.callBoundaries ?? [], points),
  );
  const intervals = Object.freeze(
    [...useDef.entries()]
      .map(([vreg, record]) => {
        const segments = segmentsForVreg({
          vreg,
          record,
          blockRecords,
          dataflow,
          deathOrder: deathByVreg.get(vreg),
          callCuts,
        });
        const cuts = cutPointsForSegments(segments, callCuts);
        return Object.freeze({
          liveRangeKey: `live-range:vreg:${vreg}`,
          vreg,
          registerClass: record.registerClass,
          segments,
          cutPoints: cuts,
          noSpill: noSpill.has(vreg),
          clobberedPhysicalRegisters: clobbersForCuts(
            cuts,
            segments,
            callClobbersByOrder,
            fallbackCallClobbers,
          ),
        });
      })
      .filter((interval) => interval.segments.length > 0)
      .sort((left, right) => left.vreg - right.vreg),
  );
  return Object.freeze({
    intervals,
    byVreg(vreg: number) {
      return intervals.find((interval) => interval.vreg === vreg);
    },
  });
}

function orderedInstructions(func: AArch64MachineFunction): readonly InstructionPoint[] {
  const output: InstructionPoint[] = [];
  for (const block of [...func.blocks].sort(
    (left, right) => Number(left.blockId) - Number(right.blockId),
  )) {
    for (const instruction of block.instructions) {
      output.push({ blockId: Number(block.blockId), order: output.length, instruction });
    }
    if (block.terminator !== undefined) {
      output.push({
        blockId: Number(block.blockId),
        order: output.length,
        instruction: block.terminator,
      });
    }
  }
  return Object.freeze(output);
}

function collectUseDef(points: readonly InstructionPoint[]) {
  const records = new Map<number, VregRecord>();
  for (const point of points) {
    for (const operand of point.instruction.operands) {
      if (operand.operand.kind !== "vreg") continue;
      const vreg = Number(operand.operand.register.vreg);
      const record = records.get(vreg) ?? {
        defs: [],
        uses: [],
        registerClass: operand.operand.register.registerClass,
      };
      if (operand.role === "def" || operand.role === "tiedDefUse") {
        record.defs.push(point.order);
      }
      if (isUseRole(operand.role)) {
        record.uses.push(point.order);
      }
      records.set(vreg, record);
    }
  }
  return records;
}

function buildBlockRecords(
  func: AArch64MachineFunction,
  points: readonly InstructionPoint[],
): readonly BlockRecord[] {
  const sortedBlocks = [...func.blocks].sort(
    (left, right) => Number(left.blockId) - Number(right.blockId),
  );
  return Object.freeze(
    sortedBlocks.map((block, index) => {
      const blockId = Number(block.blockId);
      const blockPoints = points.filter((point) => point.blockId === blockId);
      const startOrder = blockPoints[0]?.order ?? points.length;
      const endOrder =
        blockPoints.at(-1) === undefined ? startOrder : blockPoints.at(-1)!.order + 1;
      const use = new Set<number>();
      const def = new Set<number>();
      for (const point of blockPoints) {
        for (const operand of point.instruction.operands) {
          if (operand.operand.kind !== "vreg") continue;
          const vreg = Number(operand.operand.register.vreg);
          if (isUseRole(operand.role) && !def.has(vreg)) {
            use.add(vreg);
          }
          if (operand.role === "def" || operand.role === "tiedDefUse") {
            def.add(vreg);
          }
        }
      }
      return Object.freeze({
        blockId,
        startOrder,
        endOrder,
        points: Object.freeze(blockPoints),
        successors: successorsForBlock(sortedBlocks, index),
        use,
        def,
      });
    }),
  );
}

function isUseRole(role: AArch64MachineInstruction["operands"][number]["role"]): boolean {
  return role === "use" || role === "tiedDefUse" || role === "memoryBase" || role === "memoryIndex";
}

function successorsForBlock(
  sortedBlocks: readonly AArch64MachineFunction["blocks"][number][],
  index: number,
): readonly number[] {
  const block = sortedBlocks[index];
  if (block === undefined) return Object.freeze([]);
  const nextBlockId = sortedBlocks[index + 1]?.blockId;
  const terminator = block.terminator;
  if (terminator === undefined) {
    return nextBlockId === undefined ? Object.freeze([]) : Object.freeze([Number(nextBlockId)]);
  }
  const branchTargets = terminator.operands.flatMap((operand) =>
    operand.role === "branchTarget" && operand.operand.kind === "block"
      ? [Number(operand.operand.block)]
      : [],
  );
  const opcode = String(terminator.opcode);
  if (opcode === "ret" || opcode === "trap" || opcode === "br" || opcode === "b") {
    return Object.freeze([...new Set(branchTargets)].sort((left, right) => left - right));
  }
  const fallthrough = nextBlockId === undefined ? [] : [Number(nextBlockId)];
  return Object.freeze(
    [...new Set([...branchTargets, ...fallthrough])].sort((left, right) => left - right),
  );
}

function solveBlockLiveness(blocks: readonly BlockRecord[]): {
  readonly liveIn: ReadonlyMap<number, ReadonlySet<number>>;
  readonly liveOut: ReadonlyMap<number, ReadonlySet<number>>;
} {
  const liveIn = new Map<number, Set<number>>();
  const liveOut = new Map<number, Set<number>>();
  for (const block of blocks) {
    liveIn.set(block.blockId, new Set());
    liveOut.set(block.blockId, new Set());
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const block of [...blocks].reverse()) {
      const nextOut = new Set<number>();
      for (const successor of block.successors) {
        for (const vreg of liveIn.get(successor) ?? []) nextOut.add(vreg);
      }
      const nextIn = new Set(block.use);
      for (const vreg of nextOut) {
        if (!block.def.has(vreg)) nextIn.add(vreg);
      }
      if (!sameSet(nextOut, liveOut.get(block.blockId) ?? new Set())) {
        liveOut.set(block.blockId, nextOut);
        changed = true;
      }
      if (!sameSet(nextIn, liveIn.get(block.blockId) ?? new Set())) {
        liveIn.set(block.blockId, nextIn);
        changed = true;
      }
    }
  }

  return Object.freeze({ liveIn, liveOut });
}

function segmentsForVreg(input: {
  readonly vreg: number;
  readonly record: VregRecord;
  readonly blockRecords: readonly BlockRecord[];
  readonly dataflow: {
    readonly liveIn: ReadonlyMap<number, ReadonlySet<number>>;
    readonly liveOut: ReadonlyMap<number, ReadonlySet<number>>;
  };
  readonly deathOrder: number | undefined;
  readonly callCuts: ReadonlySet<number>;
}): readonly AArch64LiveSegment[] {
  const segments: AArch64LiveSegment[] = [];
  const relevantOrders = new Set([...input.record.defs, ...input.record.uses]);
  for (const block of input.blockRecords) {
    const blockOrders = block.points
      .map((point) => point.order)
      .filter((order) => relevantOrders.has(order));
    const liveIn = input.dataflow.liveIn.get(block.blockId)?.has(input.vreg) === true;
    const liveOut = input.dataflow.liveOut.get(block.blockId)?.has(input.vreg) === true;
    if (!liveIn && !liveOut && blockOrders.length === 0) continue;
    const rawStart = liveIn ? block.startOrder : Math.min(...blockOrders);
    const rawEnd = liveOut ? block.endOrder : Math.max(...blockOrders) + 1;
    const startOrder = rawStart;
    const endOrder = Math.min(input.deathOrder ?? rawEnd, rawEnd);
    if (startOrder < endOrder) {
      segments.push(...splitSegment(startOrder, endOrder, [...input.callCuts]));
    }
  }
  return Object.freeze(coalesceSegments(segments));
}

function cutPointsForSegments(
  segments: readonly AArch64LiveSegment[],
  callCuts: ReadonlySet<number>,
): readonly number[] {
  return Object.freeze(
    [...callCuts]
      .filter((cut) => segmentsContainCut(segments, cut))
      .sort((leftOrder, rightOrder) => leftOrder - rightOrder),
  );
}

function segmentsContainCut(segments: readonly AArch64LiveSegment[], cut: number): boolean {
  return (
    segments.some((segment) => cut > segment.startOrder && cut < segment.endOrder) ||
    (segments.some((segment) => segment.endOrder === cut) &&
      segments.some((segment) => segment.startOrder === cut))
  );
}

function splitSegment(
  startOrder: number,
  endOrder: number,
  cuts: readonly number[],
): readonly AArch64LiveSegment[] {
  const relevantCuts = cuts
    .filter((order) => order > startOrder && order < endOrder)
    .sort((leftOrder, rightOrder) => leftOrder - rightOrder);
  if (relevantCuts.length === 0) {
    return Object.freeze([{ startOrder, endOrder, reason: "live" }]);
  }
  const segments: AArch64LiveSegment[] = [];
  let start = startOrder;
  for (const cut of relevantCuts) {
    segments.push({ startOrder: start, endOrder: cut, reason: "pre-call" });
    start = cut;
  }
  segments.push({ startOrder: start, endOrder, reason: "post-call" });
  return Object.freeze(segments);
}

function coalesceSegments(segments: readonly AArch64LiveSegment[]): readonly AArch64LiveSegment[] {
  const sorted = [...segments].sort(
    (left, right) => left.startOrder - right.startOrder || left.endOrder - right.endOrder,
  );
  const coalesced: AArch64LiveSegment[] = [];
  for (const segment of sorted) {
    const previous = coalesced.at(-1);
    if (
      previous !== undefined &&
      (previous.endOrder > segment.startOrder ||
        (previous.endOrder === segment.startOrder && previous.reason === segment.reason))
    ) {
      coalesced[coalesced.length - 1] = {
        startOrder: previous.startOrder,
        endOrder: Math.max(previous.endOrder, segment.endOrder),
        reason: previous.reason === segment.reason ? previous.reason : "live",
      };
      continue;
    }
    coalesced.push(segment);
  }
  return Object.freeze(coalesced);
}

function sortedCallClobbers(func: AArch64MachineFunction): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        func.callClobbers.flatMap((record) => [
          ...record.registers.gpr,
          ...record.registers.vector,
        ]),
      ),
    ].sort(compareCodeUnitStrings),
  );
}

function callClobbersByOrderFromInput(
  callBoundaries: readonly {
    readonly instructionId: number;
    readonly clobberedPhysicalRegisters?: readonly string[];
  }[],
  points: readonly InstructionPoint[],
): ReadonlyMap<number, readonly string[]> {
  return new Map(
    callBoundaries.map((boundary) => [
      orderForInstruction(points, boundary.instructionId),
      sortedUniqueRegisters(boundary.clobberedPhysicalRegisters ?? []),
    ]),
  );
}

function callClobbersByOrderFromFunction(
  func: AArch64MachineFunction,
  points: readonly InstructionPoint[],
): ReadonlyMap<number, readonly string[]> {
  const entries = func.callClobbers.flatMap((record): readonly [number, readonly string[]][] => {
    const instructionId = instructionIdFromCallKey(record.callKey);
    if (instructionId === undefined) return [];
    return [
      [
        orderForInstruction(points, instructionId),
        sortedUniqueRegisters([...record.registers.gpr, ...record.registers.vector]),
      ],
    ];
  });
  return new Map(entries);
}

function mergeCallClobbersByOrder(
  left: ReadonlyMap<number, readonly string[]>,
  right: ReadonlyMap<number, readonly string[]>,
): ReadonlyMap<number, readonly string[]> {
  const merged = new Map<number, readonly string[]>(left);
  for (const [order, registers] of right) {
    merged.set(order, sortedUniqueRegisters([...(merged.get(order) ?? []), ...registers]));
  }
  return merged;
}

function clobbersForCuts(
  cuts: readonly number[],
  segments: readonly AArch64LiveSegment[],
  callClobbersByOrder: ReadonlyMap<number, readonly string[]>,
  fallbackCallClobbers: readonly string[],
): readonly string[] {
  if (cuts.length === 0) return Object.freeze([]);
  const registers = cuts
    .filter((cut) => isLiveAfterCallInstruction(segments, cut))
    .flatMap((cut) => callClobbersByOrder.get(cut) ?? fallbackCallClobbers);
  return sortedUniqueRegisters(registers);
}

function isLiveAfterCallInstruction(
  segments: readonly AArch64LiveSegment[],
  callOrder: number,
): boolean {
  const orderAfterCall = callOrder + 1;
  return segments.some(
    (segment) => segment.startOrder <= callOrder && segment.endOrder > orderAfterCall,
  );
}

function instructionIdFromCallKey(callKey: string): number | undefined {
  const match = /:insn:(\d+)$/.exec(callKey);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function sortedUniqueRegisters(registers: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(registers)].sort(compareCodeUnitStrings));
}

function orderForInstruction(points: readonly InstructionPoint[], instructionId: number): number {
  return (
    points.find((point) => Number(point.instruction.instructionId) === instructionId)?.order ??
    instructionId
  );
}

function sameSet(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}
