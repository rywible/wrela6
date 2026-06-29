import type { OptIrDiagnostic } from "../diagnostics";
import { optIrDiagnosticCode, optIrDiagnosticOrderKey, sortOptIrDiagnostics } from "../diagnostics";
import type { OptIrCallId, OptIrOperationId, OptIrOriginId } from "../ids";
import type { OptIrLoweredCallHeader } from "../lower/call-lowering";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";

export interface OptIrEffectToken {
  readonly tokenKey: string;
  readonly version: number;
}

export interface OptIrEffectTokenIndex {
  readonly tokenBefore: (
    operationId: OptIrOperationId,
    tokenKey: string,
  ) => OptIrEffectToken | undefined;
  readonly tokenAfter: (
    operationId: OptIrOperationId,
    tokenKey: string,
  ) => OptIrEffectToken | undefined;
  readonly requiredTokenKeysFor: (operationId: OptIrOperationId) => readonly string[];
}

export interface OptIrLoweredCallHeaderWithTokenExpectations extends OptIrLoweredCallHeader {
  readonly expectedTokenKeys?: readonly string[];
}

export interface OptIrEffectTokenBuildInput {
  readonly program: OptIrProgram;
  readonly regions: readonly OptIrRegion[];
  readonly operationForId: (operationId: OptIrOperationId) => OptIrOperation | undefined;
  readonly loweredCallHeaderForId?: (
    callId: OptIrCallId,
  ) => OptIrLoweredCallHeaderWithTokenExpectations | undefined;
}

export type OptIrEffectTokenBuildResult =
  | { readonly kind: "ok"; readonly index: OptIrEffectTokenIndex }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export function buildEffectTokenIndexForTest(
  input: OptIrEffectTokenBuildInput,
): OptIrEffectTokenBuildResult {
  return buildOptIrEffectTokenIndex(input);
}

export function buildOptIrEffectTokenIndex(
  input: OptIrEffectTokenBuildInput,
): OptIrEffectTokenBuildResult {
  const before = new Map<string, OptIrEffectToken>();
  const after = new Map<string, OptIrEffectToken>();
  const requiredByOperation = new Map<OptIrOperationId, readonly string[]>();
  const currentVersions = new Map<string, number>();
  const diagnostics: OptIrDiagnostic[] = [];

  for (const operation of operationsInProgramOrder(input)) {
    const requiredTokenKeys = tokenKeysForOperation(operation, input, diagnostics);
    if (requiredTokenKeys.length === 0) {
      continue;
    }
    requiredByOperation.set(operation.operationId, requiredTokenKeys);
    for (const tokenKey of requiredTokenKeys) {
      const current = currentVersions.get(tokenKey) ?? 0;
      before.set(
        tokenMapKey(operation.operationId, tokenKey),
        freezeToken({ tokenKey, version: current }),
      );
      const next = current + 1;
      currentVersions.set(tokenKey, next);
      after.set(
        tokenMapKey(operation.operationId, tokenKey),
        freezeToken({ tokenKey, version: next }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortOptIrDiagnostics(diagnostics) };
  }

  return {
    kind: "ok",
    index: Object.freeze({
      tokenBefore(operationId: OptIrOperationId, tokenKey: string) {
        return before.get(tokenMapKey(operationId, tokenKey));
      },
      tokenAfter(operationId: OptIrOperationId, tokenKey: string) {
        return after.get(tokenMapKey(operationId, tokenKey));
      },
      requiredTokenKeysFor(operationId: OptIrOperationId) {
        return [...(requiredByOperation.get(operationId) ?? [])];
      },
    }),
  };
}

function tokenKeysForOperation(
  operation: OptIrOperation,
  input: OptIrEffectTokenBuildInput,
  diagnostics: OptIrDiagnostic[],
): readonly string[] {
  if ("memoryAccess" in operation) {
    const region = input.regions.find(
      (candidate) => candidate.regionId === operation.memoryAccess.region,
    );
    if (
      region !== undefined &&
      (region.effects.ordering === "orderedEffectToken" ||
        operation.memoryAccess.volatility === "volatile")
    ) {
      return [`region:${region.regionId}`];
    }
    return [];
  }

  if (!("callId" in operation) || !operation.effects.usesCallSummary) {
    return [];
  }

  const header = input.loweredCallHeaderForId?.(operation.callId);
  if (header === undefined) {
    diagnostics.push(
      diagnostic({
        operationId: operation.operationId,
        originId: operation.originId,
        stableDetail: `call:${operation.callId}:missing-lowered-header`,
      }),
    );
    return [];
  }

  const actual = uniqueSorted([
    ...header.effects.readVersionRegions,
    ...header.effects.orderedRegions,
    ...header.effects.privateStateKeys.map((stateKey) => `private-state:${stateKey}`),
  ]);
  const expected = uniqueSorted(header.expectedTokenKeys ?? actual);
  const missing = expected.filter((tokenKey) => !actual.includes(tokenKey));
  if (missing.length > 0) {
    diagnostics.push(
      diagnostic({
        operationId: operation.operationId,
        originId: operation.originId,
        stableDetail: `call:${operation.callId}:missing:${missing.join(",")}`,
      }),
    );
  }
  return actual;
}

function operationsInProgramOrder(input: OptIrEffectTokenBuildInput): readonly OptIrOperation[] {
  const operations: OptIrOperation[] = [];
  for (const func of input.program.functions.entries()) {
    for (const block of [...func.blocks].sort(
      (left, right) => Number(left.blockId) - Number(right.blockId),
    )) {
      for (const operationId of block.operations) {
        const operation = input.operationForId(operationId);
        if (operation !== undefined) {
          operations.push(operation);
        }
      }
    }
  }
  return operations;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareStrings));
}

function tokenMapKey(operationId: OptIrOperationId, tokenKey: string): string {
  return `${operationId}:${tokenKey}`;
}

function freezeToken(token: OptIrEffectToken): OptIrEffectToken {
  return Object.freeze(token);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diagnostic(input: {
  readonly operationId: OptIrOperationId;
  readonly originId: OptIrOriginId;
  readonly stableDetail: string;
}): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_EFFECT_TOKEN_INCOMPLETE");
  const ownerKey = `operation:${input.operationId}`;
  return {
    severity: "error",
    code,
    messageTemplate: "Operation {operationId} is missing required effect-token metadata.",
    arguments: { operationId: input.operationId },
    ownerKey,
    rootCauseKey: input.stableDetail,
    stableDetail: input.stableDetail,
    originId: input.originId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(input.originId),
      functionKey: "",
      code,
      ownerKey,
      rootCauseKey: input.stableDetail,
      stableDetail: input.stableDetail,
    }),
  };
}
