import type { ProviderAdapter } from "./ProviderAdapter.ts";

// Legacy adapter placeholder for cloud-side local processing. Dormant fallback.
export class LocalProcessingProvider implements ProviderAdapter {
  readonly provider = "local";
  readonly version = "0.1.0";

  async process(image: any, recipe: any) {
    return {
      provider: this.provider,
      version: this.version,
      execution_time: 0,
      output_url: image?.original_url || "",
      metadata: { deliverable: "local_passthrough", recipe_id: recipe?.id || null },
      logs: ["local provider: passthrough (no cloud develop)"]
    };
  }
}