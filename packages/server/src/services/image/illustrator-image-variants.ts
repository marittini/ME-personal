import { NaiGuardError, NaiRateLimitError } from "./nai-request-guard.js";
import { normalizeIllustratorImagesPerGeneration } from "@marinara-engine/shared";

export async function generateIllustratorImageVariants<T>({
  count,
  generate,
  onVariantError,
}: {
  count: unknown;
  generate: (index: number) => Promise<T>;
  onVariantError?: (error: unknown, index: number) => void;
}): Promise<T[]> {
  const variantCount = normalizeIllustratorImagesPerGeneration(count);
  const results: T[] = [];
  let lastError: unknown;

  for (let index = 0; index < variantCount; index += 1) {
    try {
      results.push(await generate(index));
    } catch (error) {
      lastError = error;
      if (error instanceof NaiGuardError || error instanceof NaiRateLimitError) {
        if (!results.length) throw error;
        break;
      }
      onVariantError?.(error, index);
    }
  }

  if (results.length === 0 && lastError) throw lastError;
  return results;
}
