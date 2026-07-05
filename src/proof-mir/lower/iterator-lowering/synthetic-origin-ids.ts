import { hirExpressionId } from "../../../hir/ids";
import { instantiatedHirId, instantiatedHirIdKey, type MonoInstanceId } from "../../../mono/ids";
import type {
  MonoCallSiteRequirement,
  MonoExpressionId,
  MonomorphizedHirProgram,
} from "../../../mono/mono-hir";
import { proofMetadataIdKey } from "../../../mono/proof-metadata-tables";
import { proofMirOriginId } from "../../ids";

export function syntheticStreamLoopGateOriginId(): ReturnType<typeof proofMirOriginId> {
  return proofMirOriginId(1);
}

export interface IteratorSyntheticExpressionIds {
  readonly nextCalleeExpressionId: MonoExpressionId;
  readonly finishExpressionId: MonoExpressionId;
}

export function allocateIteratorSyntheticExpressionIds(input: {
  readonly program: MonomorphizedHirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly callExpressionId: MonoExpressionId;
}): IteratorSyntheticExpressionIds {
  const occupiedOrdinals = new Set<number>();
  const collectExpressionId = (expressionId: MonoExpressionId): void => {
    if (expressionId.instanceId !== input.functionInstanceId) {
      return;
    }
    const ordinal = Number(expressionId.hirId);
    if (Number.isInteger(ordinal) && ordinal >= 0) {
      occupiedOrdinals.add(ordinal);
    }
  };

  const functionInstance = input.program.functions.get(input.functionInstanceId);
  for (const expression of functionInstance?.bodyIndex?.expressions.entries() ?? []) {
    collectExpressionId(expression.expressionId);
  }

  const requirements = sortedCallSiteRequirementsForFunction(input);
  for (const requirement of requirements) {
    collectExpressionId(requirement.callExpressionId);
  }
  collectExpressionId(input.callExpressionId);

  const allocations = new Map<string, IteratorSyntheticExpressionIds>();
  let nextOrdinal = occupiedOrdinals.size === 0 ? 0 : Math.max(...occupiedOrdinals.values()) + 1;
  for (const requirement of requirements) {
    while (occupiedOrdinals.has(nextOrdinal) || occupiedOrdinals.has(nextOrdinal + 1)) {
      nextOrdinal++;
    }
    const ids = {
      nextCalleeExpressionId: instantiatedHirId(
        input.functionInstanceId,
        hirExpressionId(nextOrdinal),
      ),
      finishExpressionId: instantiatedHirId(
        input.functionInstanceId,
        hirExpressionId(nextOrdinal + 1),
      ),
    };
    allocations.set(instantiatedHirIdKey(requirement.callExpressionId), ids);
    occupiedOrdinals.add(nextOrdinal);
    occupiedOrdinals.add(nextOrdinal + 1);
    nextOrdinal += 2;
  }

  const callExpressionKey = instantiatedHirIdKey(input.callExpressionId);
  const allocated = allocations.get(callExpressionKey);
  if (allocated !== undefined) {
    return allocated;
  }

  while (occupiedOrdinals.has(nextOrdinal) || occupiedOrdinals.has(nextOrdinal + 1)) {
    nextOrdinal++;
  }
  return {
    nextCalleeExpressionId: instantiatedHirId(
      input.functionInstanceId,
      hirExpressionId(nextOrdinal),
    ),
    finishExpressionId: instantiatedHirId(
      input.functionInstanceId,
      hirExpressionId(nextOrdinal + 1),
    ),
  };
}

function sortedCallSiteRequirementsForFunction(input: {
  readonly program: MonomorphizedHirProgram;
  readonly functionInstanceId: MonoInstanceId;
}): readonly MonoCallSiteRequirement[] {
  return input.program.proofMetadata.callSiteRequirements
    .entries()
    .filter(
      (requirement) =>
        requirement.callSiteRequirementId.instanceId === input.functionInstanceId &&
        requirement.callExpressionId.instanceId === input.functionInstanceId,
    )
    .sort((left, right) => {
      const expressionOrder = instantiatedHirIdKey(left.callExpressionId).localeCompare(
        instantiatedHirIdKey(right.callExpressionId),
      );
      if (expressionOrder !== 0) {
        return expressionOrder;
      }
      return proofMetadataIdKey(left.callSiteRequirementId).localeCompare(
        proofMetadataIdKey(right.callSiteRequirementId),
      );
    });
}
