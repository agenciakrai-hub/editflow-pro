import type { ProviderAdapter } from "./ProviderAdapter.ts";

// Thin wrapper around a ProviderAdapter. Legacy; the live engine is the client-side
// DevelopEngine (src/lib/develop). Kept dormant as a fallback.
export class ImageProcessingEngine {
  constructor(private readonly adapter: ProviderAdapter) {}

  get provider() {
    return this.adapter.provider;
  }

  get version() {
    return this.adapter.version;
  }

  process(image: any, recipe: any, project: any, base44Client: any) {
    return this.adapter.process(image, recipe, project, base44Client);
  }
}