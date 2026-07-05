import type { SourceSpan, SourceText } from "../../frontend";
import { SourceSpan as SourceSpanValue } from "../../frontend";
import { FunctionDeclarationView } from "../../frontend/ast/function-views";
import { RedNode } from "../../frontend/syntax";
import type { FunctionId, ItemId, TypeId } from "../ids";
import type { ItemIndex, SourceItemKind } from "../item-index";
import type { ResolvedReferences } from "../names";
import type { CheckedSemanticProgram } from "./checked-program";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { compareCodeUnitStrings } from "./deterministic-sort";
import type { CheckedType } from "./type-model";

interface NamedNode<NodeId> {
  readonly nodeId: NodeId;
  readonly name: string;
  readonly span: SourceSpan;
  readonly source: SourceText | undefined;
  readonly moduleId: import("../ids").ModuleId;
}

interface Cycle<NodeId> {
  readonly nodes: readonly NodeId[];
}

export function recursionCycleDiagnostics(input: {
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly program: CheckedSemanticProgram;
}): readonly SemanticSurfaceDiagnostic[] {
  return [
    ...functionRecursionDiagnostics(input.index, input.references),
    ...typeRecursionDiagnostics(input.index, input.program),
  ];
}

function functionRecursionDiagnostics(
  index: ItemIndex,
  references: ResolvedReferences,
): readonly SemanticSurfaceDiagnostic[] {
  const functions = new Map<FunctionId, NamedNode<FunctionId>>();
  for (const functionRecord of index.functions()) {
    const item = index.item(functionRecord.itemId);
    if (item === undefined) continue;
    functions.set(functionRecord.id, {
      nodeId: functionRecord.id,
      name: functionRecord.name,
      span: item.nameSpan,
      source: index.module(functionRecord.moduleId)?.source,
      moduleId: functionRecord.moduleId,
    });
  }

  const edges = new Map<FunctionId, Set<FunctionId>>();
  for (const functionRecord of index.functions()) {
    const item = index.item(functionRecord.itemId);
    if (item === undefined) continue;
    const bodySpan = functionBodySpan(item.declaration);
    if (bodySpan === undefined) {
      edges.set(functionRecord.id, new Set());
      continue;
    }
    const callees = new Set<FunctionId>();
    for (const entry of references.entries()) {
      if (entry.reference.kind !== "function") continue;
      if (spansEqual(entry.key.span, item.nameSpan)) continue;
      if (!spanContains(bodySpan, entry.key.span)) continue;
      callees.add(entry.reference.functionId);
    }
    edges.set(functionRecord.id, callees);
  }

  return cycleDiagnostics({
    nodes: functions,
    edges,
    codeTieBreakerPrefix: "recursive-function",
    diagnostic: recursiveFunctionCycle,
  });
}

function functionBodySpan(declaration: object): SourceSpan | undefined {
  const node = "node" in declaration ? declaration.node : declaration;
  if (!(node instanceof RedNode)) return undefined;
  const bodyItems = FunctionDeclarationView.from(node)?.body()?.items() ?? [];
  const first = bodyItems[0];
  const last = bodyItems[bodyItems.length - 1];
  if (first === undefined || last === undefined) return undefined;
  return SourceSpanValue.from(first.span.start, last.span.end);
}

function typeRecursionDiagnostics(
  index: ItemIndex,
  program: CheckedSemanticProgram,
): readonly SemanticSurfaceDiagnostic[] {
  const byValueKinds = new Set<SourceItemKind>(["class", "dataclass"]);
  const typeItemIds = new Map<TypeId, ItemId>();
  const types = new Map<TypeId, NamedNode<TypeId>>();
  for (const typeRecord of index.types()) {
    const item = index.item(typeRecord.itemId);
    if (item === undefined || !byValueKinds.has(item.kind)) continue;
    typeItemIds.set(typeRecord.id, typeRecord.itemId);
    types.set(typeRecord.id, {
      nodeId: typeRecord.id,
      name: typeRecord.name,
      span: item.nameSpan,
      source: index.module(typeRecord.moduleId)?.source,
      moduleId: typeRecord.moduleId,
    });
  }

  const typeIdsByItem = new Map<ItemId, TypeId>();
  for (const [typeId, itemId] of typeItemIds.entries()) {
    typeIdsByItem.set(itemId, typeId);
  }

  const edges = new Map<TypeId, Set<TypeId>>();
  for (const typeId of types.keys()) {
    edges.set(typeId, new Set());
  }
  for (const field of program.fields.entries()) {
    const ownerTypeId = typeIdsByItem.get(field.itemId);
    if (ownerTypeId === undefined) continue;
    for (const targetTypeId of sourceTypeIds(field.type)) {
      if (types.has(targetTypeId)) {
        edges.get(ownerTypeId)?.add(targetTypeId);
      }
    }
  }

  return cycleDiagnostics({
    nodes: types,
    edges,
    codeTieBreakerPrefix: "recursive-type",
    diagnostic: recursiveTypeCycle,
  });
}

function recursiveFunctionCycle(input: {
  readonly path: readonly string[];
  readonly span: SourceSpan;
  readonly source: SourceText | undefined;
  readonly order: SemanticSurfaceDiagnostic["order"];
}): SemanticSurfaceDiagnostic {
  const path = input.path.join("->");
  return {
    code: "SURFACE_RECURSIVE_FUNCTION_CYCLE",
    message: `Recursive function cycle is not allowed: ${path}.`,
    severity: "error",
    source: input.source,
    span: input.span,
    stableDetail: `path:${path}`,
    order: input.order,
  };
}

function recursiveTypeCycle(input: {
  readonly path: readonly string[];
  readonly span: SourceSpan;
  readonly source: SourceText | undefined;
  readonly order: SemanticSurfaceDiagnostic["order"];
}): SemanticSurfaceDiagnostic {
  const path = input.path.join("->");
  return {
    code: "SURFACE_RECURSIVE_TYPE_CYCLE",
    message: `Recursive by-value type cycle is not allowed: ${path}.`,
    severity: "error",
    source: input.source,
    span: input.span,
    stableDetail: `path:${path}`,
    order: input.order,
  };
}

function sourceTypeIds(type: CheckedType): readonly TypeId[] {
  switch (type.kind) {
    case "source":
      return [type.typeId];
    case "applied":
      return [
        ...(type.constructor.kind === "source" ? [type.constructor.typeId] : []),
        ...type.arguments.flatMap(sourceTypeIds),
      ];
    case "core":
    case "genericParameter":
    case "target":
    case "error":
      return [];
  }
}

function cycleDiagnostics<NodeId extends FunctionId | TypeId>(input: {
  readonly nodes: ReadonlyMap<NodeId, NamedNode<NodeId>>;
  readonly edges: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  readonly codeTieBreakerPrefix: string;
  readonly diagnostic: (input: {
    readonly path: readonly string[];
    readonly span: SourceSpan;
    readonly source: SourceText | undefined;
    readonly order: {
      readonly moduleId: import("../ids").ModuleId;
      readonly span: SourceSpan;
      readonly codeTieBreaker: string;
    };
  }) => SemanticSurfaceDiagnostic;
}): readonly SemanticSurfaceDiagnostic[] {
  const cycles = findCycles(input.nodes, input.edges);
  return cycles.map((cycle) => {
    const first = input.nodes.get(cycle.nodes[0]!);
    if (first === undefined) {
      throw new Error("Cycle references missing node.");
    }
    const names = cycle.nodes.map(
      (candidateId) => input.nodes.get(candidateId)?.name ?? String(candidateId),
    );
    return input.diagnostic({
      path: names,
      span: first.span,
      source: first.source,
      order: {
        moduleId: first.moduleId,
        span: first.span,
        codeTieBreaker: `${input.codeTieBreakerPrefix}:${names.join("->")}`,
      },
    });
  });
}

function findCycles<NodeId extends FunctionId | TypeId>(
  nodes: ReadonlyMap<NodeId, NamedNode<NodeId>>,
  edges: ReadonlyMap<NodeId, ReadonlySet<NodeId>>,
): readonly Cycle<NodeId>[] {
  const result: Cycle<NodeId>[] = [];
  const seen = new Set<string>();
  const sortedIds = [...nodes.keys()].sort((left, right) =>
    compareNamedNodes(nodes.get(left), nodes.get(right)),
  );
  for (const start of sortedIds) {
    visitCycle({ start, current: start, nodes, edges, path: [], seen, result });
  }
  return result;
}

function visitCycle<NodeId extends FunctionId | TypeId>(input: {
  readonly start: NodeId;
  readonly current: NodeId;
  readonly nodes: ReadonlyMap<NodeId, NamedNode<NodeId>>;
  readonly edges: ReadonlyMap<NodeId, ReadonlySet<NodeId>>;
  readonly path: readonly NodeId[];
  readonly seen: Set<string>;
  readonly result: Cycle<NodeId>[];
}): void {
  const nextPath = [...input.path, input.current];
  const nextIds = [...(input.edges.get(input.current) ?? [])]
    .filter((candidateId) => input.nodes.has(candidateId))
    .sort((left, right) => compareNamedNodes(input.nodes.get(left), input.nodes.get(right)));

  for (const next of nextIds) {
    if (next === input.start) {
      const cycle = [...nextPath, input.start];
      const key = canonicalCycleKey(cycle, input.nodes);
      if (!input.seen.has(key)) {
        input.seen.add(key);
        input.result.push({ nodes: cycle });
      }
      continue;
    }
    if (nextPath.includes(next)) continue;
    visitCycle({ ...input, current: next, path: nextPath });
  }
}

function canonicalCycleKey<NodeId extends FunctionId | TypeId>(
  cycle: readonly NodeId[],
  nodes: ReadonlyMap<NodeId, NamedNode<NodeId>>,
): string {
  const openCycle = cycle.slice(0, -1);
  const names = openCycle.map((candidateId) => nodes.get(candidateId)?.name ?? String(candidateId));
  const rotations: string[] = [];
  for (let index = 0; index < names.length; index++) {
    rotations.push([...names.slice(index), ...names.slice(0, index)].join("->"));
  }
  return rotations.sort(compareCodeUnitStrings)[0] ?? "";
}

function compareNamedNodes<NodeId>(
  left: NamedNode<NodeId> | undefined,
  right: NamedNode<NodeId> | undefined,
): number {
  const nameCmp = compareCodeUnitStrings(left?.name ?? "", right?.name ?? "");
  if (nameCmp !== 0) return nameCmp;
  return (left?.span.start ?? 0) - (right?.span.start ?? 0);
}

function spanContains(outer: SourceSpan, inner: SourceSpan): boolean {
  return inner.start >= outer.start && inner.end <= outer.end;
}

function spansEqual(left: SourceSpan, right: SourceSpan): boolean {
  return left.start === right.start && left.end === right.end;
}
