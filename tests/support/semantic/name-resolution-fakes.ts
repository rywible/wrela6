import { platformPrimitiveId } from "../../../src/semantic/ids";
import {
  platformPrimitiveNameCatalog,
  type PlatformPrimitiveNameCatalog,
} from "../../../src/semantic/names/platform-primitives";

export function platformPrimitiveNameCatalogFake(
  names: readonly string[],
): PlatformPrimitiveNameCatalog {
  return platformPrimitiveNameCatalog(
    names.map((name) => ({
      primitiveId: platformPrimitiveId(name),
      name,
    })),
  );
}
