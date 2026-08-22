import type { ProviderAdapter } from "./ProviderAdapter.ts";

// No-op adapter for local development / dry runs. Legacy, dormant.
export class StubProvider implements ProviderAdapter {
  readonly provider = "stub";
  readonly version = "0.0.0";

  async process(image: any, recipe: any) {
    return {
      provider: this.provider,
      version: this.version,
      execution_time: 0,
      output_url: image?.original_url || "",
      metadata: { deliverable: "stub", recipe_id: recipe?.id || null },
      logs: ["stub provider: no real develop performed"]
    };
  }
}