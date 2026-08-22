import { NormalizedEvent, VulcanEnrichment, VulcanEnrichmentSchema } from '../../domain/contracts';
import { EnrichmentProvider } from './interface';

/** Signed fixture-only adapter; production startup must never select it. */
export class FixtureEnrichmentAdapter implements EnrichmentProvider {
  constructor(private readonly fixtures: ReadonlyMap<string, VulcanEnrichment>) {}

  async isAvailable(): Promise<boolean> { return true; }

  async enrich(event: NormalizedEvent): Promise<VulcanEnrichment> {
    const fixture = this.fixtures.get(event.eventId);
    if (!fixture) throw new Error(`No signed fixture enrichment exists for event ${event.eventId}`);
    return VulcanEnrichmentSchema.parse({ ...fixture, source: 'fixture_signed' });
  }
}
