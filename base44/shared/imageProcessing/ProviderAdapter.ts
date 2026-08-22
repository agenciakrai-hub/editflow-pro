// Legacy cloud-side image-processing strategy. The LIVE editing path is now the
// client DevelopEngine (src/lib/develop) backed by the local agent; this package
// stays only as a dormant fallback until that flow is fully validated. Nothing in
// the active UI invokes it.
export interface ProviderAdapter {
  readonly provider: string;
  readonly version: string;
  process(image: any, recipe: any, project: any, base44Client: any): Promise<{
    provider: string;
    version: string;
    execution_time: number;
    output_url: string;
    metadata: Record<string, any>;
    logs: string[];
  }>;
}