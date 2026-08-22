import type { ProviderAdapter } from "./ProviderAdapter.ts";

// LEGACY generative AI provider. The ORIGINAL cloud engine, kept ONLY as a dormant
// fallback until the deterministic local-agent DevelopEngine flow is validated.
//
// IMPORTANT: this is the generative path that was explicitly DEPRECATED for product
// reasons — Wedding RAW AI reveals, it never generates or reinterprets content. The
// live path is src/lib/develop (LocalAgentDevelopEngine). Nothing in the active UI
// invokes this provider; it exists so the old processBatch path can be reactivated
// if the new flow needs to be rolled back in an emergency.
export class AiEditProvider implements ProviderAdapter {
  readonly provider = "ai";
  readonly version = "0.4.0";

  async process(image: any, recipe: any, _project: any, base44Client: any) {
    const startedAt = Date.now();
    const preset = recipe?.preset_data || {};
    const prompt = [
      "Apply these Lightroom-style develop settings to this photo and return the edited image:",
      `exposure ${preset.exposure}, contrast ${preset.contrast}, highlights ${preset.highlights},`,
      `shadows ${preset.shadows}, whites ${preset.whites}, blacks ${preset.blacks},`,
      `temperature ${preset.temperature}, tint ${preset.tint}, vibrance ${preset.vibrance},`,
      `saturation ${preset.saturation}. Preserve identity, composition and resolution.`
    ].join(" ");

    const { url } = await base44Client.integrations.Core.GenerateImage({
      prompt,
      existing_image_urls: [image.original_url]
    });

    return {
      provider: this.provider,
      version: this.version,
      execution_time: (Date.now() - startedAt) / 1000,
      output_url: url,
      metadata: {
        deliverable: "generated_edit",
        sceneRecipeId: recipe?.id || null,
        warning: "LEGACY generative provider — not used by the live DevelopEngine flow"
      },
      logs: ["ai provider: GenerateImage-based edit (LEGACY, deprecated in favour of deterministic local develop)"]
    };
  }
}