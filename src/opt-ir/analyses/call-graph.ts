import type { OptIrCallTarget } from "../calls";
import type { MonoInstanceId } from "../../mono/ids";
import type { OptIrFunctionId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";

export type OptIrCallGraphEdgeKind =
  | "source"
  | "runtime"
  | "platform"
  | "callback"
  | "externalRoot"
  | "unknownCall";

export interface OptIrCallGraphEdge {
  readonly kind: OptIrCallGraphEdgeKind;
  readonly caller: OptIrFunctionId | undefined;
  readonly callee: OptIrFunctionId | undefined;
  readonly source: string;
}

export interface OptIrCallGraphInput {
  readonly program: OptIrProgram;
  readonly operationForId: (
    operationId: OptIrOperation["operationId"],
  ) => OptIrOperation | undefined;
  readonly callbacks?: readonly OptIrCallGraphEdge[];
  readonly unknownCalls?: readonly OptIrCallGraphEdge[];
}

export interface OptIrCallGraph {
  readonly edges: () => readonly OptIrCallGraphEdge[];
}

export function computeOptIrCallGraph(input: OptIrCallGraphInput): OptIrCallGraph {
  const functionByInstance = new Map(
    input.program.functions.entries().map((func) => [func.monoInstanceId, func.functionId]),
  );
  const edges: OptIrCallGraphEdge[] = [];

  for (const func of input.program.functions.entries()) {
    if (func.externalRoot !== undefined) {
      edges.push({
        kind: "externalRoot",
        caller: undefined,
        callee: func.functionId,
        source: func.externalRoot.reason,
      });
    }
    for (const block of func.blocks) {
      for (const operationId of block.operations) {
        const operation = input.operationForId(operationId);
        if (operation === undefined || !isCallOperation(operation)) {
          continue;
        }
        edges.push(edgeForCall(func.functionId, operation.target, functionByInstance));
      }
    }
  }

  edges.push(...(input.callbacks ?? []));
  edges.push(...(input.unknownCalls ?? []));

  return Object.freeze({
    edges() {
      return edges.slice().sort(compareCallGraphEdges);
    },
  });
}

function isCallOperation(
  operation: OptIrOperation,
): operation is Extract<OptIrOperation, { readonly target: OptIrCallTarget }> {
  return (
    operation.kind === "sourceCall" ||
    operation.kind === "runtimeCall" ||
    operation.kind === "platformCall" ||
    operation.kind === "intrinsicCall"
  );
}

function edgeForCall(
  caller: OptIrFunctionId,
  target: OptIrCallTarget,
  functionByInstance: ReadonlyMap<MonoInstanceId, OptIrFunctionId>,
): OptIrCallGraphEdge {
  switch (target.kind) {
    case "source":
      return {
        kind: "source",
        caller,
        callee: functionByInstance.get(target.functionInstanceId),
        source: "direct-call",
      };
    case "runtime":
      return { kind: "runtime", caller, callee: undefined, source: `runtime:${target.runtimeKey}` };
    case "platform":
      return {
        kind: "platform",
        caller,
        callee: undefined,
        source: `platform:${target.platformKey}`,
      };
    case "externalUnknown":
      return { kind: "unknownCall", caller, callee: undefined, source: `extern:${target.symbol}` };
    case "intrinsic":
      return {
        kind: "runtime",
        caller,
        callee: undefined,
        source: `intrinsic:${target.intrinsicKey}`,
      };
  }
}

function compareCallGraphEdges(left: OptIrCallGraphEdge, right: OptIrCallGraphEdge): number {
  return (
    callerOrder(left.caller) - callerOrder(right.caller) ||
    kindOrder(left.kind) - kindOrder(right.kind) ||
    calleeOrder(left.callee) - calleeOrder(right.callee) ||
    compareStrings(left.source, right.source)
  );
}

function callerOrder(functionId: OptIrFunctionId | undefined): number {
  return functionId === undefined ? -1 : Number(functionId);
}

function calleeOrder(functionId: OptIrFunctionId | undefined): number {
  return functionId === undefined ? Number.MAX_SAFE_INTEGER : Number(functionId);
}

function kindOrder(kind: OptIrCallGraphEdgeKind): number {
  return ["externalRoot", "source", "runtime", "platform", "callback", "unknownCall"].indexOf(kind);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
