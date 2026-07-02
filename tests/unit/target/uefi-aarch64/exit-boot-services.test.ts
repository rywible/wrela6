import { describe, expect, test } from "bun:test";

import { canonicalUefiAArch64ExitBootServicesPolicy } from "../../../../src/target/uefi-aarch64";
import {
  evaluateUefiAArch64ExitBootServicesTrace,
  fakeExitBootServicesTrace,
} from "../../../support/target/uefi-aarch64/fake-exit-boot-services";

describe("UEFI GetMemoryMap/ExitBootServices policy", () => {
  test("retries stale map key with a fresh map within policy bound", () => {
    const result = evaluateUefiAArch64ExitBootServicesTrace({
      policy: canonicalUefiAArch64ExitBootServicesPolicy({ maxInvalidParameterRetries: 1 }),
      trace: fakeExitBootServicesTrace([
        {
          kind: "getMemoryMap",
          status: "success",
          mapKey: 10n,
          descriptorSize: 48,
          descriptorVersion: 1,
        },
        { kind: "exitBootServices", status: "invalid-parameter", mapKey: 10n },
        {
          kind: "getMemoryMap",
          status: "success",
          mapKey: 11n,
          descriptorSize: 48,
          descriptorVersion: 1,
        },
        { kind: "exitBootServices", status: "success", mapKey: 11n },
      ]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.bootServicesAuthority).toBe("consumed");
      expect(result.value.finalMapKey).toBe(11n);
    }
  });

  test("fails closed when retry budget is exhausted", () => {
    const result = evaluateUefiAArch64ExitBootServicesTrace({
      policy: canonicalUefiAArch64ExitBootServicesPolicy({ maxInvalidParameterRetries: 0 }),
      trace: fakeExitBootServicesTrace([
        {
          kind: "getMemoryMap",
          status: "success",
          mapKey: 10n,
          descriptorSize: 48,
          descriptorVersion: 1,
        },
        { kind: "exitBootServices", status: "invalid-parameter", mapKey: 10n },
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe("exit-boot-services:retry-budget-exhausted");
  });

  test("grows capacity at most once for each attempt", () => {
    const result = evaluateUefiAArch64ExitBootServicesTrace({
      policy: canonicalUefiAArch64ExitBootServicesPolicy({
        maxBufferTooSmallRetries: 1,
        maxInvalidParameterRetries: 1,
      }),
      trace: fakeExitBootServicesTrace([
        { kind: "getMemoryMap", status: "buffer-too-small", requiredSizeBytes: 4096 },
        { kind: "getMemoryMap", status: "buffer-too-small", requiredSizeBytes: 8192 },
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "exit-boot-services:buffer-growth-budget-exhausted",
    );
  });

  test("rejects boot service calls other than memory allocation after first exit failure", () => {
    const result = evaluateUefiAArch64ExitBootServicesTrace({
      policy: canonicalUefiAArch64ExitBootServicesPolicy({ maxInvalidParameterRetries: 1 }),
      trace: fakeExitBootServicesTrace([
        {
          kind: "getMemoryMap",
          status: "success",
          mapKey: 10n,
          descriptorSize: 48,
          descriptorVersion: 1,
        },
        { kind: "exitBootServices", status: "invalid-parameter", mapKey: 10n },
        { kind: "bootServiceCall", service: "stall" },
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "exit-boot-services:boot-service-after-exit-failure",
    );
  });

  test("fails closed when fresh retry map would require growth outside policy", () => {
    const result = evaluateUefiAArch64ExitBootServicesTrace({
      policy: canonicalUefiAArch64ExitBootServicesPolicy({
        maxBufferTooSmallRetries: 1,
        maxInvalidParameterRetries: 1,
      }),
      trace: fakeExitBootServicesTrace([
        { kind: "getMemoryMap", status: "buffer-too-small", requiredSizeBytes: 4096 },
        {
          kind: "getMemoryMap",
          status: "success",
          mapKey: 10n,
          descriptorSize: 48,
          descriptorVersion: 1,
        },
        { kind: "exitBootServices", status: "invalid-parameter", mapKey: 10n },
        { kind: "getMemoryMap", status: "buffer-too-small", requiredSizeBytes: 8192 },
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "exit-boot-services:retry-requires-unplanned-allocation",
    );
  });
});
