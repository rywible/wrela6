import type { OptIrBlock, OptIrEdge } from "../cfg";
import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrBlockId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";
import { optIrTypesEqual, type OptIrType } from "../types";
import { makeOptIrVerifierDiagnostic, type OptIrVerifierContext } from "./structural-verifier";

export interface OptIrValueDefinition {
  readonly valueId: OptIrValueId;
  readonly type: OptIrType;
  readonly ownerKey: string;
  readonly blockId: OptIrBlockId;
  readonly operationId?: OptIrOperationId;
  readonly position: number;
}

export interface OptIrSsaVerificationResult {
  readonly diagnostics: readonly OptIrDiagnostic[];
  readonly definitions: ReadonlyMap<OptIrValueId, OptIrValueDefinition>;
}

export function verifyOptIrSsa(input: {
  readonly func: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly context: OptIrVerifierContext;
}): OptIrSsaVerificationResult {
  const diagnostics: OptIrDiagnostic[] = [];
  const definitions = new Map<OptIrValueId, OptIrValueDefinition>();
  const blockById = new Map(input.func.blocks.map((block) => [block.blockId, block]));

  for (const block of input.func.blocks) {
    let position = 0;
    for (const parameter of block.parameters) {
      addDefinition({
        definitions,
        diagnostics,
        definition: {
          valueId: parameter.valueId,
          type: parameter.type,
          ownerKey: `block-parameter:${parameter.valueId}`,
          blockId: block.blockId,
          position,
        },
        originId: parameter.originId,
        context: input.context,
      });
      position += 1;
    }
    for (const operationId of block.operations) {
      const operation = input.operations.get(operationId);
      if (operation === undefined) {
        diagnostics.push(
          makeOptIrVerifierDiagnostic({
            code: "OPT_IR_INPUT_CONTRACT_INVALID",
            messageTemplate: "Block references an operation missing from the verifier input.",
            ownerKey: `block:${block.blockId}`,
            rootCauseKey: `operation:${operationId}`,
            stableDetail: `missing-operation:${operationId}`,
            originId: block.originId,
            functionId: input.func.functionId,
          }),
        );
        position += 1;
        continue;
      }
      operation.resultIds.forEach((valueId, resultIndex) => {
        const resultType = operation.resultTypes[resultIndex];
        if (resultType !== undefined) {
          addDefinition({
            definitions,
            diagnostics,
            definition: {
              valueId,
              type: resultType,
              ownerKey: `operation:${operation.operationId}:result:${resultIndex}`,
              blockId: block.blockId,
              operationId: operation.operationId,
              position,
            },
            originId: operation.originId,
            context: input.context,
          });
        }
      });
      position += 1;
    }
  }

  for (const edge of input.func.edges.entries()) {
    verifyEdgeArguments({
      edge,
      toBlock: edge.toBlock === undefined ? undefined : blockById.get(edge.toBlock),
      definitions,
      diagnostics,
      context: input.context,
    });
  }

  if (input.context.options.checkDominance !== false) {
    diagnostics.push(
      ...verifyValueDominance({
        func: input.func,
        operations: input.operations,
        definitions,
        context: input.context,
      }),
    );
  }

  return { diagnostics, definitions };
}

function addDefinition(input: {
  readonly definitions: Map<OptIrValueId, OptIrValueDefinition>;
  readonly diagnostics: OptIrDiagnostic[];
  readonly definition: OptIrValueDefinition;
  readonly originId: OptIrVerifierContext["originId"];
  readonly context: OptIrVerifierContext;
}): void {
  const previous = input.definitions.get(input.definition.valueId);
  if (previous !== undefined) {
    input.diagnostics.push(
      makeOptIrVerifierDiagnostic({
        code: "OPT_IR_DUPLICATE_VALUE_DEFINITION",
        messageTemplate: "OptIR value has more than one definition.",
        ownerKey: input.definition.ownerKey,
        rootCauseKey: previous.ownerKey,
        stableDetail: `duplicate-value:${input.definition.valueId}`,
        originId: input.originId,
        functionId: input.context.functionId,
      }),
    );
    return;
  }
  input.definitions.set(input.definition.valueId, input.definition);
}

function verifyEdgeArguments(input: {
  readonly edge: OptIrEdge;
  readonly toBlock: OptIrBlock | undefined;
  readonly definitions: ReadonlyMap<OptIrValueId, OptIrValueDefinition>;
  readonly diagnostics: OptIrDiagnostic[];
  readonly context: OptIrVerifierContext;
}): void {
  if (input.toBlock === undefined) {
    return;
  }
  if (input.edge.arguments.length !== input.toBlock.parameters.length) {
    input.diagnostics.push(
      makeOptIrVerifierDiagnostic({
        code: "OPT_IR_BLOCK_ARGUMENT_MISMATCH",
        messageTemplate: "CFG edge arguments do not match destination block parameter arity.",
        ownerKey: `edge:${input.edge.edgeId}`,
        rootCauseKey: `block:${input.toBlock.blockId}`,
        stableDetail: `block-argument-arity:${input.edge.edgeId}:${input.edge.arguments.length}:${input.toBlock.parameters.length}`,
        originId: input.edge.originId,
        functionId: input.context.functionId,
      }),
    );
    return;
  }
  input.edge.arguments.forEach((valueId, index) => {
    const argumentDefinition = input.definitions.get(valueId);
    const parameter = input.toBlock?.parameters[index];
    if (
      argumentDefinition !== undefined &&
      parameter !== undefined &&
      !optIrTypesEqual(argumentDefinition.type, parameter.type)
    ) {
      input.diagnostics.push(
        makeOptIrVerifierDiagnostic({
          code: "OPT_IR_BLOCK_ARGUMENT_MISMATCH",
          messageTemplate:
            "CFG edge argument type does not match destination block parameter type.",
          ownerKey: `edge:${input.edge.edgeId}:argument:${index}`,
          rootCauseKey: `block-parameter:${parameter.valueId}`,
          stableDetail: `block-argument-type:${input.edge.edgeId}:${index}`,
          originId: input.edge.originId,
          functionId: input.context.functionId,
        }),
      );
    }
  });
}

function verifyValueDominance(input: {
  readonly func: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly definitions: ReadonlyMap<OptIrValueId, OptIrValueDefinition>;
  readonly context: OptIrVerifierContext;
}): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  const available = new Set<OptIrValueId>();
  for (const block of input.func.blocks) {
    for (const parameter of block.parameters) {
      available.add(parameter.valueId);
    }
    for (const operationId of block.operations) {
      const operation = input.operations.get(operationId);
      if (operation === undefined) {
        continue;
      }
      for (const valueId of operation.operandIds) {
        if (!available.has(valueId)) {
          diagnostics.push(dominanceDiagnostic(input.context, operation, valueId));
        }
      }
      for (const valueId of operation.resultIds) {
        if (input.definitions.has(valueId)) {
          available.add(valueId);
        }
      }
    }
  }
  return diagnostics;
}

function dominanceDiagnostic(
  context: OptIrVerifierContext,
  operation: OptIrOperation,
  valueId: OptIrValueId,
): OptIrDiagnostic {
  return makeOptIrVerifierDiagnostic({
    code: "OPT_IR_DOMINANCE_VIOLATION",
    messageTemplate: "OptIR value use is not dominated by its definition.",
    ownerKey: `operation:${operation.operationId}`,
    rootCauseKey: `value:${valueId}`,
    stableDetail: `value-dominance:${operation.operationId}:${valueId}`,
    originId: operation.originId,
    functionId: context.functionId,
  });
}
