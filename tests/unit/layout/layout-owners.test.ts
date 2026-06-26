import { describe, expect, test } from "bun:test";
import { fieldId } from "../../../src/semantic/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  layoutOwnerToKey,
  parseLayoutOwnerKey,
  validatedBufferDerivedOwner,
  validatedBufferRootOwner,
  enrichDependenciesForOwner,
  imageDeviceOwner,
} from "../../../src/layout/layout-owners";

describe("layout owners", () => {
  test("round-trips validated-buffer sub-owners with instance ids containing colons", () => {
    const instanceId = monoInstanceId("type:Packet:mono");
    const owner = validatedBufferDerivedOwner(instanceId, fieldId(3));
    const key = layoutOwnerToKey(owner);
    expect(String(key)).toBe("validated-buffer:type:Packet:mono:derived:3");
    expect(parseLayoutOwnerKey(String(key))).toEqual(owner);
  });

  test("parseLayoutOwnerKey recovers validated-buffer root owner", () => {
    const instanceId = monoInstanceId("validated-buffer:Packet");
    const key = layoutOwnerToKey(validatedBufferRootOwner(instanceId));
    expect(parseLayoutOwnerKey(String(key))).toEqual({
      kind: "validatedBuffer",
      instanceId,
    });
  });

  test("round-trips image-device owner keys", () => {
    const imageInstanceId = monoInstanceId("image:Boot");
    const owner = imageDeviceOwner(imageInstanceId, fieldId(7));
    const key = layoutOwnerToKey(owner);
    expect(String(key)).toBe("image-device:image:Boot:7");
    expect(parseLayoutOwnerKey(String(key))).toEqual(owner);
  });

  test("enrichDependenciesForOwner adds target and buffer parent deps", () => {
    const instanceId = monoInstanceId("type:Packet");
    const owner = validatedBufferDerivedOwner(instanceId, fieldId(1));
    const dependencies = enrichDependenciesForOwner(owner, [], "uefi-aarch64");
    expect(dependencies.map((dependency) => String(dependency.ownerKey))).toEqual([
      "target:uefi-aarch64",
      "validated-buffer:type:Packet",
    ]);
  });
});
