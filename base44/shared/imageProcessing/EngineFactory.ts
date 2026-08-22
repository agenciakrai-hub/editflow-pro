import type { ProviderAdapter } from "./ProviderAdapter.ts";
import { StubProvider } from "./StubProvider.ts";
import { LocalProcessingProvider } from "./LocalProcessingProvider.ts";
import { AiEditProvider } from "./AiEditProvider.ts";
import { ImageProcessingEngine } from "./ImageProcessingEngine.ts";

// Legacy cloud-side engine factory. Dormant fallback; the live engine is the
// client DevelopEngine (src/lib/develop). Kept so processBatch can be reactivated
// if the local-agent flow ever needs to be rolled back.
const REGISTRY: Record<string, () => ProviderAdapter> = {
  stub: () => new StubProvider(),
  local: () => new LocalProcessingProvider(),
  ai: () => new AiEditProvider()
};

export function createImageProcessingEngine(kind: string = "ai"): ImageProcessingEngine {
  const factory = REGISTRY[kind] || REGISTRY.ai;
  return new ImageProcessingEngine(factory());
}