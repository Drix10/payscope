import { NormalizedEvent, TelemetryEnrichment, TelemetryEnrichmentSchema } from '../../domain/contracts';
import { EnrichmentProvider } from './interface';

/** Signed fixture-only adapter; production startup must never select it. */
export class FixtureEnrichmentAdapter implements EnrichmentProvider {
  constructor(private readonly fixtures: ReadonlyMap<string, TelemetryEnrichment>) {}

  async isAvailable(): Promise<boolean> { return true; }

  async enrich(event: NormalizedEvent): Promise<TelemetryEnrichment> {
    const fixture = this.fixtures.get(event.eventId);
    if (!fixture) throw new Error(`No signed fixture enrichment exists for event ${event.eventId}`);
    return TelemetryEnrichmentSchema.parse({ ...fixture, source: 'fixture_signed' });
  }
}
