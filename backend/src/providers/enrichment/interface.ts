import { NormalizedEvent, VulcanEnrichment } from '../../domain/contracts';

export interface EnrichmentProvider {
  enrich(event: NormalizedEvent): Promise<VulcanEnrichment>;
  isAvailable(): Promise<boolean>;
}
