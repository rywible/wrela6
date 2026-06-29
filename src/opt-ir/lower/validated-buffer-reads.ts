import {
  optIrConstantId,
  optIrOriginId,
  optIrRegionId,
  type OptIrConstantId,
  type OptIrEdgeId,
  type OptIrOperationId,
  type OptIrOriginId,
  type OptIrPathCertificateId,
  type OptIrRegionId,
  type OptIrValueId,
} from "../ids";
import { optIrUnsignedIntegerType, type OptIrType } from "../types";
import type { OptIrBoundsAuthority, OptIrRuntimeBoundsGuard } from "../operations";

export type { OptIrBoundsAuthority, OptIrRuntimeBoundsGuard };

export type OptIrValidatedBufferRegionKind =
  | "packetSource"
  | "sourceAggregate"
  | "validatedPayload";
export type OptIrValidatedBufferEndian = "target" | "little" | "big";
export type OptIrValidatedBufferVolatility = "nonVolatile" | "volatile";
export type OptIrByteRangeExpression = {
  readonly start: bigint;
  readonly endExclusive: bigint;
};

export interface OptIrValidatedBufferAccessMetadata {
  readonly fieldName: string;
  readonly readRequires: readonly unknown[];
  readonly pathCertificates: readonly OptIrPathCertificateId[];
}

export interface OptIrValidatedBufferAccess {
  readonly regionKind: OptIrValidatedBufferRegionKind;
  readonly region: OptIrRegionId;
  readonly byteOffset: OptIrValueId | OptIrConstantId;
  readonly byteWidth: bigint;
  readonly alignment: bigint;
  readonly valueType: OptIrType;
  readonly endian: OptIrValidatedBufferEndian;
  readonly volatility: OptIrValidatedBufferVolatility;
  readonly layoutPath: readonly string[];
  readonly boundsAuthority: OptIrBoundsAuthority;
  readonly metadata: OptIrValidatedBufferAccessMetadata;
  readonly originId: OptIrOriginId;
}

export type ValidateOptIrValidatedBufferAccessesResult =
  | { readonly kind: "ok" }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly OptIrValidatedBufferAccessDiagnostic[];
    };

export interface OptIrValidatedBufferAccessDiagnostic {
  readonly severity: "error";
  readonly code:
    | "OPT_IR_VALIDATED_BUFFER_ACCESS_AUTHORITY"
    | "OPT_IR_VALIDATED_BUFFER_RUNTIME_GUARD"
    | "OPT_IR_VALIDATED_BUFFER_ENDIAN";
  readonly stableDetail: string;
  readonly messageTemplate: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly originId: OptIrOriginId;
}

export interface LowerValidatedBufferReadInput {
  readonly regionKind?: OptIrValidatedBufferRegionKind;
  readonly region?: OptIrRegionId;
  readonly byteOffset?: OptIrValueId | OptIrConstantId;
  readonly fieldName: string;
  readonly offsetBytes: bigint;
  readonly widthBytes: bigint;
  readonly wireEndian: OptIrValidatedBufferEndian;
  readonly alignment?: bigint;
  readonly valueType?: OptIrType;
  readonly volatility?: OptIrValidatedBufferVolatility;
  readonly layoutPath?: readonly string[];
  readonly boundsAuthority: OptIrBoundsAuthority;
  readonly readRequires?: readonly unknown[];
  readonly pathCertificates?: readonly OptIrPathCertificateId[];
  readonly originId?: OptIrOriginId;
}

export interface ValidateOptIrValidatedBufferAccessesInput {
  readonly accesses: readonly OptIrValidatedBufferAccess[];
  readonly guardOperations?: ReadonlySet<OptIrOperationId>;
  readonly successEdges?: ReadonlySet<OptIrEdgeId>;
  readonly dominates?: (dominator: OptIrEdgeId, access: OptIrValidatedBufferAccess) => boolean;
}

export function lowerValidatedBufferRead(
  input: LowerValidatedBufferReadInput,
): OptIrValidatedBufferAccess {
  const endian = requireEndian(input.wireEndian);
  const byteRange = {
    start: input.offsetBytes,
    endExclusive: input.offsetBytes + input.widthBytes,
  };
  const authority = freezeBoundsAuthority(input.boundsAuthority);

  if (authority.kind === "runtimeGuard") {
    assertGuardCoversAccess(authority.guard, byteRange);
  }

  return Object.freeze({
    regionKind: input.regionKind ?? "packetSource",
    region: input.region ?? optIrRegionId(0),
    byteOffset: input.byteOffset ?? optIrConstantId(0),
    byteWidth: input.widthBytes,
    alignment: input.alignment ?? 1n,
    valueType: input.valueType ?? optIrUnsignedIntegerType(Number(input.widthBytes * 8n)),
    endian,
    volatility: input.volatility ?? "nonVolatile",
    layoutPath: Object.freeze([...(input.layoutPath ?? [input.fieldName])]),
    boundsAuthority: authority,
    metadata: Object.freeze({
      fieldName: input.fieldName,
      readRequires: Object.freeze([...(input.readRequires ?? [])]),
      pathCertificates: Object.freeze([...(input.pathCertificates ?? [])]),
    }),
    originId: input.originId ?? optIrOriginId(0),
  });
}

export function validateOptIrValidatedBufferAccesses(
  input: ValidateOptIrValidatedBufferAccessesInput,
): ValidateOptIrValidatedBufferAccessesResult {
  const diagnostics: OptIrValidatedBufferAccessDiagnostic[] = [];

  for (const access of input.accesses) {
    if (!isExplicitEndian(access.endian)) {
      diagnostics.push(diagnostic(access, "OPT_IR_VALIDATED_BUFFER_ENDIAN", "endian", "invalid"));
      continue;
    }

    const authority = access.boundsAuthority;
    if (authority.kind === "constructionSize") {
      diagnostics.push(
        diagnostic(
          access,
          "OPT_IR_VALIDATED_BUFFER_ACCESS_AUTHORITY",
          "authority",
          "construction-size",
        ),
      );
      continue;
    }

    if (authority.kind !== "runtimeGuard") {
      continue;
    }

    if (
      input.guardOperations !== undefined &&
      !input.guardOperations.has(authority.guard.guardOperation)
    ) {
      diagnostics.push(
        diagnostic(
          access,
          "OPT_IR_VALIDATED_BUFFER_RUNTIME_GUARD",
          "runtime-guard",
          `missing:${authority.guard.guardOperation}`,
        ),
      );
      continue;
    }

    if (input.successEdges !== undefined && !input.successEdges.has(authority.guard.successEdge)) {
      diagnostics.push(
        diagnostic(
          access,
          "OPT_IR_VALIDATED_BUFFER_RUNTIME_GUARD",
          "runtime-guard",
          `success-edge-missing:${authority.guard.successEdge}`,
        ),
      );
      continue;
    }

    if (input.dominates !== undefined && !input.dominates(authority.guard.successEdge, access)) {
      diagnostics.push(
        diagnostic(
          access,
          "OPT_IR_VALIDATED_BUFFER_RUNTIME_GUARD",
          "runtime-guard",
          `dominance:${authority.guard.successEdge}`,
        ),
      );
    }
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: Object.freeze(diagnostics) };
  }
  return { kind: "ok" };
}

export function lowerValidatedBufferReadForTest(
  input: LowerValidatedBufferReadInput,
): OptIrValidatedBufferAccess {
  return lowerValidatedBufferRead(input);
}

function requireEndian(endian: OptIrValidatedBufferEndian): OptIrValidatedBufferEndian {
  if (!isExplicitEndian(endian)) {
    throw new RangeError("validated-buffer access endian must be target, little, or big.");
  }
  return endian;
}

function isExplicitEndian(endian: string): endian is OptIrValidatedBufferEndian {
  return endian === "target" || endian === "little" || endian === "big";
}

function freezeBoundsAuthority(authority: OptIrBoundsAuthority): OptIrBoundsAuthority {
  switch (authority.kind) {
    case "certifiedFact":
      return Object.freeze({ kind: authority.kind, factId: authority.factId });
    case "passDerivedFact":
      return Object.freeze({
        kind: authority.kind,
        factId: authority.factId,
        obligationId: authority.obligationId,
      });
    case "runtimeGuard":
      return Object.freeze({
        kind: authority.kind,
        guard: Object.freeze({
          guardOperation: authority.guard.guardOperation,
          successEdge: authority.guard.successEdge,
          checkedByteRange: Object.freeze({
            start: authority.guard.checkedByteRange.start,
            endExclusive: authority.guard.checkedByteRange.endExclusive,
          }),
          dominatesAccess: true,
        }),
      });
    case "constructionSize":
      return Object.freeze({ kind: authority.kind });
    case "layoutFact":
      return Object.freeze({ kind: authority.kind, layoutKey: authority.layoutKey });
    case "targetContract":
      return Object.freeze({ kind: authority.kind, authorityKey: authority.authorityKey });
    default: {
      const unexpected: never = authority;
      return unexpected;
    }
  }
}

function assertGuardCoversAccess(
  guard: OptIrRuntimeBoundsGuard,
  accessRange: OptIrByteRangeExpression,
): void {
  if (
    guard.checkedByteRange.start > accessRange.start ||
    guard.checkedByteRange.endExclusive < accessRange.endExclusive
  ) {
    throw new RangeError("runtime guard byte range must cover the lowered access range.");
  }
}

function diagnostic(
  access: OptIrValidatedBufferAccess,
  code: OptIrValidatedBufferAccessDiagnostic["code"],
  rootCauseKey: string,
  detail: string,
): OptIrValidatedBufferAccessDiagnostic {
  const stableDetail = detail.startsWith("missing:")
    ? `validated-buffer-runtime-guard-missing:${detail.slice("missing:".length)}`
    : `validated-buffer-${rootCauseKey}:${detail}`;
  return Object.freeze({
    severity: "error",
    code,
    stableDetail,
    messageTemplate: "Validated-buffer access has invalid bounds authority metadata.",
    ownerKey: `validated-buffer-access:${access.metadata.fieldName}`,
    rootCauseKey,
    originId: access.originId,
  });
}
