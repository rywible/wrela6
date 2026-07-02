import { uefiAArch64TargetDiagnostic } from "../../../../src/target/uefi-aarch64/diagnostics";
import type {
  UefiAArch64ExitBootServicesPolicy,
  UefiAArch64ExitBootServicesSuccess,
} from "../../../../src/target/uefi-aarch64/exit-boot-services";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "../../../../src/target/uefi-aarch64/result";

const EXIT_BOOT_SERVICES_VERIFIER_KEY = "uefi-aarch64.exit-boot-services";

export type FakeExitBootServicesEvent =
  | {
      readonly kind: "getMemoryMap";
      readonly status: "success";
      readonly mapKey: bigint;
      readonly descriptorSize: number;
      readonly descriptorVersion: number;
    }
  | {
      readonly kind: "getMemoryMap";
      readonly status: "buffer-too-small";
      readonly requiredSizeBytes: number;
    }
  | {
      readonly kind: "getMemoryMap";
      readonly status: "invalid-parameter" | "device-error";
    }
  | {
      readonly kind: "exitBootServices";
      readonly status: "success" | "invalid-parameter" | "device-error";
      readonly mapKey: bigint;
    }
  | {
      readonly kind: "bootServiceCall";
      readonly service: string;
    };

export function fakeExitBootServicesTrace(
  events: readonly FakeExitBootServicesEvent[],
): readonly FakeExitBootServicesEvent[] {
  return Object.freeze(events.map((event) => Object.freeze({ ...event })));
}

export function evaluateUefiAArch64ExitBootServicesTrace(input: {
  readonly policy: UefiAArch64ExitBootServicesPolicy;
  readonly trace: readonly FakeExitBootServicesEvent[];
}): UefiAArch64TargetResult<UefiAArch64ExitBootServicesSuccess> {
  let bufferGrowths = 0;
  let invalidParameterRetries = 0;
  let exitFailed = false;
  let freshMapAfterExitFailure = false;
  let latestMap:
    | {
        readonly mapKey: bigint;
        readonly descriptorSize: number;
        readonly descriptorVersion: number;
      }
    | undefined;

  if (input.policy.initialDescriptorSlackBytes < 0) {
    return exitBootServicesError("exit-boot-services:invalid-policy");
  }

  for (const event of input.trace) {
    if (event.kind === "bootServiceCall") {
      if (exitFailed && !isMemoryAllocationBootService(event.service)) {
        return exitBootServicesError("exit-boot-services:boot-service-after-exit-failure");
      }
      continue;
    }

    if (event.kind === "getMemoryMap" && event.status === "buffer-too-small") {
      if (exitFailed) {
        return exitBootServicesError("exit-boot-services:retry-requires-unplanned-allocation");
      }
      if (bufferGrowths >= input.policy.maxBufferTooSmallRetries) {
        return exitBootServicesError("exit-boot-services:buffer-growth-budget-exhausted");
      }
      bufferGrowths += 1;
      continue;
    }

    if (event.kind === "getMemoryMap" && event.status === "success") {
      latestMap = {
        mapKey: event.mapKey,
        descriptorSize: event.descriptorSize,
        descriptorVersion: event.descriptorVersion,
      };
      if (exitFailed) freshMapAfterExitFailure = true;
      continue;
    }

    if (event.kind === "getMemoryMap") {
      return exitBootServicesError(`exit-boot-services:get-memory-map-${event.status}`);
    }

    if (event.kind === "exitBootServices" && event.status === "invalid-parameter") {
      if (latestMap === undefined || latestMap.mapKey !== event.mapKey) {
        return exitBootServicesError("exit-boot-services:exit-without-fresh-map");
      }
      if (invalidParameterRetries >= input.policy.maxInvalidParameterRetries) {
        return exitBootServicesError("exit-boot-services:retry-budget-exhausted");
      }
      invalidParameterRetries += 1;
      exitFailed = true;
      freshMapAfterExitFailure = false;
      continue;
    }

    if (event.kind === "exitBootServices" && event.status === "success") {
      if (latestMap === undefined || latestMap.mapKey !== event.mapKey) {
        return exitBootServicesError("exit-boot-services:exit-without-fresh-map");
      }
      if (exitFailed && !freshMapAfterExitFailure) {
        return exitBootServicesError("exit-boot-services:retry-without-fresh-map");
      }
      return uefiAArch64Ok({
        value: {
          bootServicesAuthority: "consumed",
          finalMapKey: latestMap.mapKey,
          descriptorSize: latestMap.descriptorSize,
          descriptorVersion: latestMap.descriptorVersion,
        },
        verification: passedVerification(EXIT_BOOT_SERVICES_VERIFIER_KEY, "trace"),
      });
    }

    return exitBootServicesError(`exit-boot-services:exit-${event.status}`);
  }

  return exitBootServicesError("exit-boot-services:missing-successful-exit");
}

function isMemoryAllocationBootService(service: string): boolean {
  return (
    service === "allocate-pages" ||
    service === "free-pages" ||
    service === "allocate-pool" ||
    service === "free-pool"
  );
}

function exitBootServicesError(stableDetail: string): UefiAArch64TargetResult<never> {
  return uefiAArch64Error({
    diagnostics: [
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
        ownerKey: "exit-boot-services",
        stableDetail,
      }),
    ],
    verification: failedVerification(EXIT_BOOT_SERVICES_VERIFIER_KEY, "trace", stableDetail),
  });
}
