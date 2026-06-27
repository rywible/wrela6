import type { MonoInstanceId } from "../../mono/ids";
import {
  createProofMirLayoutBindingIndex,
  proofMirLayoutReferenceKey,
  type ProofMirLayoutBindingIndex,
} from "../domains/layout-binding-index";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type {
  ProofMirLayoutTermBindingId,
  ProofMirOwnedLayoutTermBindingId,
  ProofMirValueId,
} from "../ids";
import { proofMirOwnedLayoutTermBindingIdKey } from "../ids";
import type {
  ProofMirLayoutReference,
  ProofMirLayoutTermReference,
} from "../model/layout-bindings";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirStatementKind,
  ProofMirTerminatorKind,
} from "../model/graph";
import type { ProofMirProgram } from "../model/program";

function layoutDiagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly functionInstanceId?: MonoInstanceId;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: input.code,
    message: input.message,
    ownerKey: input.ownerKey,
    rootCauseKey: "layout",
    stableDetail: input.stableDetail,
    ...(input.functionInstanceId === undefined
      ? {}
      : { functionInstanceId: input.functionInstanceId }),
  });
}

function validateLayoutReference(input: {
  readonly program: ProofMirProgram;
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly reference: ProofMirLayoutReference;
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly functionInstanceId?: MonoInstanceId;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const result = input.layoutBindingIndex.resolveReference(input.reference);
  if (result.kind === "error") {
    input.diagnostics.push(
      ...result.diagnostics.map((diagnostic) =>
        layoutDiagnostic({
          code: diagnostic.code,
          message: diagnostic.message,
          ownerKey: input.ownerKey,
          stableDetail: `${input.stableDetail}:${diagnostic.stableDetail}`,
          functionInstanceId: input.functionInstanceId,
        }),
      ),
    );
  }
}

function validateLayoutTermReference(input: {
  readonly program: ProofMirProgram;
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly term: ProofMirLayoutTermReference;
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly functionInstanceId?: MonoInstanceId;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const result = input.layoutBindingIndex.resolveTerm({
    root: input.term.path.root,
    childPath: input.term.path.childPath,
    expectedUnit: input.term.unit,
  });
  if (result.kind === "error") {
    input.diagnostics.push(
      ...result.diagnostics.map((diagnostic) =>
        layoutDiagnostic({
          code: diagnostic.code,
          message: diagnostic.message,
          ownerKey: input.ownerKey,
          stableDetail: `${input.stableDetail}:${diagnostic.stableDetail}`,
          functionInstanceId: input.functionInstanceId,
        }),
      ),
    );
    return;
  }

  const layoutTerm = input.program.layoutTerms.get(input.term.termId);
  if (layoutTerm === undefined) {
    input.diagnostics.push(
      layoutDiagnostic({
        code: "PROOF_MIR_INVALID_LAYOUT_TERM_PATH",
        message: "Layout term reference does not resolve to a frozen layout term record.",
        ownerKey: input.ownerKey,
        stableDetail: `${input.stableDetail}:missing-term:${String(input.term.termId)}`,
        functionInstanceId: input.functionInstanceId,
      }),
    );
    return;
  }

  if (layoutTerm.unit !== input.term.unit) {
    input.diagnostics.push(
      layoutDiagnostic({
        code: "PROOF_MIR_INVALID_LAYOUT_TERM_PATH",
        message: "Layout term record unit does not match the term reference.",
        ownerKey: input.ownerKey,
        stableDetail: `${input.stableDetail}:unit:${layoutTerm.unit}`,
        functionInstanceId: input.functionInstanceId,
      }),
    );
  }
}

function validateLayoutTermBindingReference(input: {
  readonly program: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly bindingId: ProofMirLayoutTermBindingId;
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const ownedBindingId: ProofMirOwnedLayoutTermBindingId = {
    functionInstanceId: input.functionInstanceId,
    bindingId: input.bindingId,
  };
  const bindingKey = proofMirOwnedLayoutTermBindingIdKey(ownedBindingId);
  const hasBindingStatement = functionHasLayoutTermBinding(
    input.program.functions.get(input.functionInstanceId),
    input.bindingId,
  );
  if (!hasBindingStatement) {
    input.diagnostics.push(
      layoutDiagnostic({
        code: "PROOF_MIR_MISSING_LAYOUT_TERM_BINDING",
        message: "Validated-buffer read references a missing layout term binding.",
        ownerKey: bindingKey,
        stableDetail: `${input.stableDetail}:binding:${String(input.bindingId)}`,
        functionInstanceId: input.functionInstanceId,
      }),
    );
  }
}

function functionHasLayoutTermBinding(
  function_: ProofMirFunction | undefined,
  bindingId: ProofMirLayoutTermBindingId,
): boolean {
  if (function_ === undefined) {
    return false;
  }
  for (const block of function_.blocks.entries()) {
    for (const statement of block.statements) {
      if (
        statement.kind.kind === "bindLayoutTerm" &&
        statement.kind.binding.bindingId === bindingId
      ) {
        return true;
      }
    }
  }
  return false;
}

function validateValidatedBufferRead(input: {
  readonly program: ProofMirProgram;
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly functionInstanceId: MonoInstanceId;
  readonly read: Extract<
    ProofMirStatementKind,
    { readonly kind: "readValidatedBufferField" }
  >["read"];
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const ownerKey = proofMirLayoutReferenceKey(input.read.layoutField);
  validateLayoutReference({
    program: input.program,
    layoutBindingIndex: input.layoutBindingIndex,
    reference: input.read.layoutField,
    ownerKey,
    stableDetail: "validated-buffer-read:layout-field",
    functionInstanceId: input.functionInstanceId,
    diagnostics: input.diagnostics,
  });
  validateLayoutTermReference({
    program: input.program,
    layoutBindingIndex: input.layoutBindingIndex,
    term: input.read.offsetTerm,
    ownerKey,
    stableDetail: "validated-buffer-read:offset",
    functionInstanceId: input.functionInstanceId,
    diagnostics: input.diagnostics,
  });
  validateLayoutTermReference({
    program: input.program,
    layoutBindingIndex: input.layoutBindingIndex,
    term: input.read.endTerm,
    ownerKey,
    stableDetail: "validated-buffer-read:end",
    functionInstanceId: input.functionInstanceId,
    diagnostics: input.diagnostics,
  });
  for (const bindingId of input.read.termBindings) {
    validateLayoutTermBindingReference({
      program: input.program,
      functionInstanceId: input.functionInstanceId,
      bindingId,
      ownerKey,
      stableDetail: "validated-buffer-read",
      diagnostics: input.diagnostics,
    });
  }
}

function edgeCarriesBindingOperand(
  edge: ProofMirControlEdge | undefined,
  bindingOperandValueId: ProofMirValueId | undefined,
): boolean {
  if (edge === undefined || bindingOperandValueId === undefined) {
    return bindingOperandValueId === undefined;
  }
  return edge.arguments.includes(bindingOperandValueId);
}

function validateValidationMatch(input: {
  readonly program: ProofMirProgram;
  readonly function_: ProofMirFunction;
  readonly match: Extract<ProofMirTerminatorKind, { readonly kind: "matchValidation" }>["match"];
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  const okEdge = input.function_.edges.get(input.match.okTarget.edgeId);
  const errEdge = input.function_.edges.get(input.match.errTarget.edgeId);

  for (const binding of input.match.okBindings) {
    const operandValueId =
      binding.operand.kind === "value"
        ? binding.operand.value
        : binding.operand.kind === "valueAndPlace"
          ? binding.operand.value
          : undefined;
    if (!edgeCarriesBindingOperand(okEdge, operandValueId)) {
      input.diagnostics.push(
        layoutDiagnostic({
          code: "PROOF_MIR_INVALID_VALIDATION_BINDING",
          message: "Validation ok binding operand is not visible on the ok edge.",
          ownerKey: String(input.match.validationId.instanceId),
          stableDetail: `validation-ok-binding:${String(operandValueId ?? "place-only")}`,
          functionInstanceId: input.function_.functionInstanceId,
        }),
      );
    }
  }

  for (const binding of input.match.errBindings) {
    const operandValueId =
      binding.operand.kind === "value"
        ? binding.operand.value
        : binding.operand.kind === "valueAndPlace"
          ? binding.operand.value
          : undefined;
    if (!edgeCarriesBindingOperand(errEdge, operandValueId)) {
      input.diagnostics.push(
        layoutDiagnostic({
          code: "PROOF_MIR_INVALID_VALIDATION_BINDING",
          message: "Validation err binding operand is not visible on the err edge.",
          ownerKey: String(input.match.validationId.instanceId),
          stableDetail: `validation-err-binding:${String(operandValueId ?? "place-only")}`,
          functionInstanceId: input.function_.functionInstanceId,
        }),
      );
    }
  }
}

function validateAttemptStart(input: {
  readonly function_: ProofMirFunction;
  readonly attempt: Extract<ProofMirStatementKind, { readonly kind: "attempt" }>["attempt"];
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  if (input.attempt.fallible.result === undefined) {
    input.diagnostics.push(
      layoutDiagnostic({
        code: "PROOF_MIR_MISSING_ATTEMPT_START",
        message: "Attempt start is missing a lowered fallible expression operand.",
        ownerKey: String(input.attempt.attemptId.instanceId),
        stableDetail: "missing-fallible-operand",
        functionInstanceId: input.function_.functionInstanceId,
      }),
    );
  }
}

function validateExtensionRecord(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly gate: string;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  input.diagnostics.push(
    layoutDiagnostic({
      code: "PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD",
      message: "Proof MIR extension record is not supported by any enabled extension validator.",
      ownerKey: input.functionInstanceId,
      stableDetail: `extension:${input.gate}`,
      functionInstanceId: input.functionInstanceId,
    }),
  );
}

function validateBlock(input: {
  readonly program: ProofMirProgram;
  readonly layoutBindingIndex: ProofMirLayoutBindingIndex;
  readonly function_: ProofMirFunction;
  readonly block: ProofMirBlock;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  for (const statement of input.block.statements) {
    switch (statement.kind.kind) {
      case "readValidatedBufferField":
        validateValidatedBufferRead({
          program: input.program,
          layoutBindingIndex: input.layoutBindingIndex,
          functionInstanceId: input.function_.functionInstanceId,
          read: statement.kind.read,
          diagnostics: input.diagnostics,
        });
        break;
      case "bindLayoutTerm":
        validateLayoutTermReference({
          program: input.program,
          layoutBindingIndex: input.layoutBindingIndex,
          term: statement.kind.binding.term,
          ownerKey: proofMirLayoutReferenceKey({
            kind: "validatedBuffer",
            instanceId: input.function_.functionInstanceId,
          }),
          stableDetail: `bind-layout-term:${String(statement.kind.binding.bindingId)}`,
          functionInstanceId: input.function_.functionInstanceId,
          diagnostics: input.diagnostics,
        });
        break;
      case "validate":
        validateLayoutReference({
          program: input.program,
          layoutBindingIndex: input.layoutBindingIndex,
          reference: statement.kind.validation.layout,
          ownerKey: proofMirLayoutReferenceKey(statement.kind.validation.layout),
          stableDetail: "validation-start",
          functionInstanceId: input.function_.functionInstanceId,
          diagnostics: input.diagnostics,
        });
        break;
      case "attempt":
        validateAttemptStart({
          function_: input.function_,
          attempt: statement.kind.attempt,
          diagnostics: input.diagnostics,
        });
        break;
      case "extension":
        validateExtensionRecord({
          functionInstanceId: input.function_.functionInstanceId,
          gate: statement.kind.extension.gate,
          diagnostics: input.diagnostics,
        });
        break;
      default:
        break;
    }
  }

  validateTerminator({
    program: input.program,
    function_: input.function_,
    terminator: input.block.terminator.kind,
    diagnostics: input.diagnostics,
  });
}

function validateTerminator(input: {
  readonly program: ProofMirProgram;
  readonly function_: ProofMirFunction;
  readonly terminator: ProofMirTerminatorKind;
  readonly diagnostics: ProofMirDiagnostic[];
}): void {
  switch (input.terminator.kind) {
    case "matchValidation":
      validateValidationMatch({
        program: input.program,
        function_: input.function_,
        match: input.terminator.match,
        diagnostics: input.diagnostics,
      });
      break;
    case "matchAttempt":
      break;
    default:
      if ("gate" in input.terminator) {
        validateExtensionRecord({
          functionInstanceId: input.function_.functionInstanceId,
          gate: input.terminator.gate,
          diagnostics: input.diagnostics,
        });
      }
      break;
  }
}

export function validateProofMirLayout(program: ProofMirProgram): ProofMirDiagnostic[] {
  const diagnostics: ProofMirDiagnostic[] = [];
  const layoutBindingIndex = createProofMirLayoutBindingIndex({
    layout: program.layout,
  });

  validateLayoutReference({
    program,
    layoutBindingIndex,
    reference: program.image.layout,
    ownerKey: "image",
    stableDetail: "image-entry-abi",
    diagnostics,
  });

  for (const edge of program.platformEdges.entries()) {
    validateLayoutReference({
      program,
      layoutBindingIndex,
      reference: edge.abi,
      ownerKey: proofMirLayoutReferenceKey(edge.abi),
      stableDetail: "platform-edge-abi",
      diagnostics,
    });
  }

  for (const term of program.layoutTerms.entries()) {
    validateLayoutTermReference({
      program,
      layoutBindingIndex,
      term: {
        termId: term.termId,
        path: term.path,
        unit: term.unit,
      },
      ownerKey: "program",
      stableDetail: `layout-term:${String(term.termId)}`,
      diagnostics,
    });
  }

  for (const function_ of program.functions.entries()) {
    for (const block of function_.blocks.entries()) {
      validateBlock({
        program,
        layoutBindingIndex,
        function_,
        block,
        diagnostics,
      });
    }
  }

  return sortProofMirDiagnostics(diagnostics);
}
