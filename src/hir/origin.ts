import type { FunctionId, ItemId, ModuleId } from "../semantic/ids";
import type { HirOriginId } from "./ids";
import { hirOriginId } from "./ids";
import { SourceSpan } from "../shared/source-span";
import { SyntaxKind } from "../frontend/syntax/syntax-kind";
import type { RedNode } from "../frontend/syntax/red-node";

export interface HirOrigin {
  readonly originId: HirOriginId;
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly syntaxKind?: SyntaxKind;
  readonly ownerItemId?: ItemId;
  readonly ownerFunctionId?: FunctionId;
}

export interface HirOriginAllocator {
  forSyntax(input: {
    readonly moduleId: ModuleId;
    readonly node: RedNode;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId;
  forMissingSyntax(input: {
    readonly moduleId: ModuleId;
    readonly parent: RedNode;
    readonly expectedSlotIndex: number;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId;
  forSynthetic(input: {
    readonly moduleId: ModuleId;
    readonly span: SourceSpan;
    readonly stableDetail: string;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId;
}

export interface HirOriginTable {
  get(originId: HirOriginId): HirOrigin | undefined;
  originRecords(): readonly HirOrigin[];
}

export interface HirOriginAllocatorAndTable extends HirOriginAllocator, HirOriginTable {}

function syntaxKindName(kind: SyntaxKind): string {
  const name = SyntaxKind[kind];
  return typeof name === "string" ? name : String(kind);
}

function ownerSegment(
  ownerItemId: ItemId | undefined,
  ownerFunctionId: FunctionId | undefined,
): string {
  const itemSegment = ownerItemId === undefined ? "missing" : String(ownerItemId);
  const functionSegment = ownerFunctionId === undefined ? "missing" : String(ownerFunctionId);
  return `item:${itemSegment}|function:${functionSegment}`;
}

function sourceSegment(source: { readonly name?: string } | undefined): string {
  if (source?.name === undefined) return "source:missing";
  return `source:${source.name}`;
}

export class HirOriginAllocatorImpl implements HirOriginAllocatorAndTable {
  private readonly records: HirOrigin[] = [];
  private readonly keyToIndex = new Map<string, number>();

  forSyntax(input: {
    readonly moduleId: ModuleId;
    readonly node: RedNode;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId {
    const span = input.node.span;
    const key = `syntax|module:${input.moduleId}|${sourceSegment(input.node.source)}|start:${span.start}|end:${span.end}|kind:${syntaxKindName(input.node.kind)}|offset:${input.node.offset}|child:${input.node.childIndex}|${ownerSegment(input.ownerItemId, input.ownerFunctionId)}`;
    return this.allocate(key, {
      moduleId: input.moduleId,
      span,
      syntaxKind: input.node.kind,
      ownerItemId: input.ownerItemId,
      ownerFunctionId: input.ownerFunctionId,
    });
  }

  forMissingSyntax(input: {
    readonly moduleId: ModuleId;
    readonly parent: RedNode;
    readonly expectedSlotIndex: number;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId {
    const parentSpan = input.parent.span;
    const span = SourceSpan.from(parentSpan.start, parentSpan.start);
    const key = `missing|module:${input.moduleId}|${sourceSegment(input.parent.source)}|parentStart:${parentSpan.start}|parentEnd:${parentSpan.end}|parentKind:${syntaxKindName(input.parent.kind)}|parentOffset:${input.parent.offset}|parentChild:${input.parent.childIndex}|slot:${input.expectedSlotIndex}|${ownerSegment(input.ownerItemId, input.ownerFunctionId)}`;
    return this.allocate(key, {
      moduleId: input.moduleId,
      span,
      ownerItemId: input.ownerItemId,
      ownerFunctionId: input.ownerFunctionId,
    });
  }

  forSynthetic(input: {
    readonly moduleId: ModuleId;
    readonly span: SourceSpan;
    readonly stableDetail: string;
    readonly ownerItemId?: ItemId;
    readonly ownerFunctionId?: FunctionId;
  }): HirOriginId {
    const key = `synthetic|module:${input.moduleId}|start:${input.span.start}|end:${input.span.end}|detail:${input.stableDetail}|${ownerSegment(input.ownerItemId, input.ownerFunctionId)}`;
    return this.allocate(key, {
      moduleId: input.moduleId,
      span: input.span,
      ownerItemId: input.ownerItemId,
      ownerFunctionId: input.ownerFunctionId,
    });
  }

  get(originId: HirOriginId): HirOrigin | undefined {
    return this.records[originId as number];
  }

  originRecords(): readonly HirOrigin[] {
    return this.records.slice();
  }

  private allocate(key: string, fields: Omit<HirOrigin, "originId">): HirOriginId {
    const existing = this.keyToIndex.get(key);
    if (existing !== undefined) {
      return hirOriginId(existing);
    }
    const index = this.records.length;
    const allocatedOriginId = hirOriginId(index);
    this.records.push({ ...fields, originId: allocatedOriginId });
    this.keyToIndex.set(key, index);
    return allocatedOriginId;
  }
}

export function createHirOriginAllocator(): HirOriginAllocatorAndTable {
  return new HirOriginAllocatorImpl();
}
