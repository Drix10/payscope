import { NormalizedEvent, TelemetryEnrichment } from '../../domain/contracts';

export interface EnrichmentProvider {
  enrich(event: NormalizedEvent): Promise<TelemetryEnrichment>;
  isAvailable(): Promise<boolean>;
}
