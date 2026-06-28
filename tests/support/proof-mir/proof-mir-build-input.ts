import { computeRepresentationLayoutFacts } from "../../../src/layout";
import type { LayoutFactProgram, LayoutTargetSurface } from "../../../src/layout";
import type { TypedHirProgram } from "../../../src/hir/hir";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import type {
  MonoExpressionId,
  MonoExternalRoot,
  MonoFunctionInstance,
  MonoReachableFunction,
  MonoReachableFunctionReason,
  MonoReachableFunctionTable,
  MonoResolvedCallTarget,
} from "../../../src/mono/mono-hir";
import { callResolvedTargetKey } from "../../../src/mono/call-resolved-target-application";
import { monoResolvedCallTargetEntriesForCaller } from "../../../src/mono/resolved-call-targets";
import { hirOriginId } from "../../../src/hir/ids";
import type { MonoInstanceId } from "../../../src/mono/ids";
import type { DraftProofMirBuildTargetContext } from "../../../src/proof-mir/draft/draft-builder-context";
import type { ProofMirRuntimeOperation } from "../../../src/runtime/runtime-catalog-types";
import { proofMirRuntimeOperationId } from "../../../src/runtime/runtime-catalog";
import type { FieldId, TargetId } from "../../../src/semantic/ids";
import { targetId } from "../../../src/semantic/ids";
import type { SemanticTargetSurface } from "../../../src/semantic/surface/platform-surface";
import { lowerTypedHirForTest } from "../hir/typed-hir-fixtures";
import { targetWithSerialDevice } from "../hir/typed-hir-fakes";
import { layoutDeviceSurfaceCatalogFake } from "../layout/layout-fakes";
import { layoutTargetWithUefiProfile } from "../layout/layout-fixtures";
import { proofMirRuntimeCatalogFake, proofMirRuntimeOperationFake } from "./proof-mir-fakes";

export interface ProofMirBuildInput {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly target: DraftProofMirBuildTargetContext;
}

export interface ProofMirBuildInputForSourceOptions {
  readonly files?: readonly [string, string][];
  readonly platformNames?: readonly string[];
  readonly targetSurface?: SemanticTargetSurface;
  readonly layoutTarget?: LayoutTargetSurface;
  readonly features?: readonly string[];
  readonly runtimeCatalogOperations?: readonly ProofMirRuntimeOperation[];
}

export interface MonoAndLayoutForTypedHirProgramOptions {
  readonly layoutTarget?: LayoutTargetSurface;
}

export interface ValidatedBufferProofMirLayoutFixtureInput {
  readonly layoutSource: readonly string[];
  readonly deriveSource?: readonly string[];
  readonly layoutTarget?: LayoutTargetSurface;
}

export interface ValidatedBufferProofMirLayoutFixture {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly bufferInstanceId: MonoInstanceId;
  readonly tagFieldId: FieldId;
  readonly payloadFieldId: FieldId;
}

const DEFAULT_PROOF_MIR_FEATURES: readonly string[] = [];
const DEFAULT_PROOF_MIR_TARGET_ID = targetId("uefi-aarch64");

export function defaultProofMirLayoutTarget(): LayoutTargetSurface {
  return layoutTargetWithUefiProfile({ targetId: DEFAULT_PROOF_MIR_TARGET_ID });
}

export function layoutTargetForSerialDevice(): LayoutTargetSurface {
  const semanticTarget = targetWithSerialDevice(["rx", "tx"]);
  const serialDevice = semanticTarget.deviceSurfaces[0];
  if (serialDevice === undefined) {
    throw new Error("expected serial device surface in proof-mir layout target helper");
  }

  return layoutTargetWithUefiProfile({
    targetId: semanticTarget.targetId,
    deviceSurfaces: layoutDeviceSurfaceCatalogFake([
      {
        deviceSurfaceId: serialDevice.deviceSurfaceId,
        representation: { kind: "zeroSizedCapability" },
      },
    ]),
  });
}

function defaultProofMirRuntimeCatalogOperations(): readonly ProofMirRuntimeOperation[] {
  return [
    proofMirRuntimeOperationFake({
      runtimeId: proofMirRuntimeOperationId(1),
      name: "panic_abort",
    }),
  ];
}

function proofMirTargetContextForLayoutTarget(
  layoutTarget: LayoutTargetSurface,
  options?: {
    readonly features?: readonly string[];
    readonly runtimeCatalogOperations?: readonly ProofMirRuntimeOperation[];
  },
): DraftProofMirBuildTargetContext {
  const features = options?.features ?? DEFAULT_PROOF_MIR_FEATURES;
  const runtimeCatalog = proofMirRuntimeCatalogFake({
    targetId: layoutTarget.targetId,
    features,
    operations: options?.runtimeCatalogOperations ?? defaultProofMirRuntimeCatalogOperations(),
  });

  return {
    targetId: layoutTarget.targetId,
    features,
    runtimeCatalog,
  };
}

function sourceTextFromInput(source: string | readonly string[]): string {
  if (typeof source === "string") {
    return source;
  }
  return source.join("\n");
}

function sourceFilesFromInput(
  source: string | readonly string[],
  files?: readonly [string, string][],
): readonly [string, string][] {
  if (files !== undefined) {
    return files;
  }
  return [["main.wr", sourceTextFromInput(source)]];
}

export function requireMonoProgram(program: TypedHirProgram): MonomorphizedHirProgram {
  const result = monomorphizeWholeImage({ program });
  if (result.kind !== "ok") {
    throw new Error(
      `proof-mir fixture monomorphization failed: ${result.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }
  return result.program;
}

export function requireLayoutFacts(input: {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
}): LayoutFactProgram {
  const result = computeRepresentationLayoutFacts(input);
  if (result.kind !== "ok") {
    throw new Error(
      `proof-mir fixture layout computation failed: ${result.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }
  return result.facts;
}

export function proofMirBuildInputFromMonoLayout(input: {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly layoutTarget: LayoutTargetSurface;
  readonly features?: readonly string[];
  readonly runtimeCatalogOperations?: readonly ProofMirRuntimeOperation[];
}): ProofMirBuildInput {
  return {
    program: input.program,
    layout: input.layout,
    target: proofMirTargetContextForLayoutTarget(input.layoutTarget, {
      ...(input.features !== undefined ? { features: input.features } : {}),
      ...(input.runtimeCatalogOperations !== undefined
        ? { runtimeCatalogOperations: input.runtimeCatalogOperations }
        : {}),
    }),
  };
}

export function monoAndLayoutForTypedHirProgram(
  program: TypedHirProgram,
  options: MonoAndLayoutForTypedHirProgramOptions = {},
): {
  readonly program: MonomorphizedHirProgram;
  readonly layout: LayoutFactProgram;
  readonly layoutTarget: LayoutTargetSurface;
} {
  const layoutTarget = options.layoutTarget ?? defaultProofMirLayoutTarget();
  const monoProgram = requireMonoProgram(program);
  const layout = requireLayoutFacts({ program: monoProgram, target: layoutTarget });
  return { program: monoProgram, layout, layoutTarget };
}

export function proofMirBuildInputForSource(
  source: string | readonly string[],
  options: ProofMirBuildInputForSourceOptions = {},
): ProofMirBuildInput {
  const layoutTarget = options.layoutTarget ?? defaultProofMirLayoutTarget();
  const hirResult = lowerTypedHirForTest(sourceFilesFromInput(source, options.files), {
    ...(options.platformNames !== undefined ? { platformNames: options.platformNames } : {}),
    ...(options.targetSurface !== undefined ? { targetSurface: options.targetSurface } : {}),
  });
  const monoLayout = monoAndLayoutForTypedHirProgram(hirResult.program, { layoutTarget });
  return proofMirBuildInputFromMonoLayout({
    program: monoLayout.program,
    layout: monoLayout.layout,
    layoutTarget,
    ...(options.features !== undefined ? { features: options.features } : {}),
    ...(options.runtimeCatalogOperations !== undefined
      ? { runtimeCatalogOperations: options.runtimeCatalogOperations }
      : {}),
  });
}

export function closedProofMirFixture(): ProofMirBuildInput {
  return proofMirBuildInputForSource(
    ["uefi image Boot:", "    fn main() -> Never:", "        return"].join("\n"),
  );
}

export function proofMirDefaultTargetId(): TargetId {
  return defaultProofMirLayoutTarget().targetId;
}

export function proofMirDefaultLayoutTarget(): LayoutTargetSurface {
  return defaultProofMirLayoutTarget();
}

const MONO_REACHABLE_FUNCTION_REASON_RANK: Readonly<Record<MonoReachableFunctionReason, number>> = {
  imageEntry: 0,
  deviceHandler: 1,
  hardwareCallback: 2,
  targetRequired: 3,
  sourceCall: 4,
};

export function monoReachableFunctionTableForTest(
  entries: readonly MonoReachableFunction[],
): MonoReachableFunctionTable {
  const lookup = new Map<string, MonoReachableFunction>();
  for (const entry of entries) {
    lookup.set(String(entry.functionInstanceId), entry);
  }
  return {
    get(key) {
      return lookup.get(String(key));
    },
    has(key) {
      return lookup.has(String(key));
    },
    entries: () => entries,
  };
}

export function buildReachableFunctionsForProofMirTest(input: {
  readonly externalRoots: readonly MonoExternalRoot[];
  readonly functions: readonly MonoFunctionInstance[];
  readonly resolvedCallTargetEntries?: readonly {
    readonly callerInstanceId: MonoInstanceId;
    readonly callExpressionId: MonoExpressionId;
    readonly resolvedTarget: MonoResolvedCallTarget;
  }[];
  readonly seedReachableFunctions?: readonly MonoReachableFunction[];
}): MonoReachableFunctionTable {
  const functionByInstanceId = new Map<string, MonoFunctionInstance>();
  for (const functionInstance of input.functions) {
    functionByInstanceId.set(String(functionInstance.instanceId), functionInstance);
  }

  const entries = new Map<string, MonoReachableFunction>();
  const queue: MonoInstanceId[] = [];

  const enqueue = (entry: MonoReachableFunction): void => {
    const key = String(entry.functionInstanceId);
    const existing = entries.get(key);
    if (existing === undefined) {
      entries.set(key, entry);
      queue.push(entry.functionInstanceId);
      return;
    }
    if (
      MONO_REACHABLE_FUNCTION_REASON_RANK[entry.reason] <
      MONO_REACHABLE_FUNCTION_REASON_RANK[existing.reason]
    ) {
      entries.set(key, entry);
    }
  };

  for (const entry of input.seedReachableFunctions ?? []) {
    enqueue(entry);
  }
  for (const root of input.externalRoots) {
    enqueue({
      functionInstanceId: root.functionInstanceId,
      reason: root.reason,
      origin: root.origin,
    });
  }

  const callResolvedTargets = new Map(
    (input.resolvedCallTargetEntries ?? []).map((entry) => [
      callResolvedTargetKey({
        callerInstanceId: entry.callerInstanceId,
        callExpressionId: entry.callExpressionId,
      }),
      entry,
    ]),
  );

  while (queue.length > 0) {
    const callerInstanceId = queue.shift();
    if (callerInstanceId === undefined) {
      continue;
    }
    const caller = functionByInstanceId.get(String(callerInstanceId));
    if (caller === undefined) {
      continue;
    }
    for (const resolvedCallTargetEntry of monoResolvedCallTargetEntriesForCaller({
      callResolvedTargets,
      callerInstanceId,
    })) {
      if (resolvedCallTargetEntry.resolvedTarget.kind !== "sourceFunction") {
        continue;
      }
      const callExpressionId = resolvedCallTargetEntry.callExpressionId;
      const callee = resolvedCallTargetEntry.resolvedTarget.targetFunctionInstanceId;
      const expression = caller.bodyIndex?.expressions.get(callExpressionId);
      const expressionOrigin =
        expression === undefined ? Number.NaN : Number(expression.sourceOrigin);
      const callerOrigin = Number(caller.sourceOrigin);
      const origin =
        Number.isInteger(expressionOrigin) && expressionOrigin >= 0
          ? hirOriginId(expressionOrigin)
          : Number.isInteger(callerOrigin) && callerOrigin >= 0
            ? hirOriginId(callerOrigin)
            : hirOriginId(0);
      enqueue({
        functionInstanceId: callee,
        reason: "sourceCall",
        origin,
      });
    }
  }

  const sortedEntries = [...entries.values()].sort((left, right) =>
    String(left.functionInstanceId).localeCompare(String(right.functionInstanceId)),
  );
  return monoReachableFunctionTableForTest(sortedEntries);
}
