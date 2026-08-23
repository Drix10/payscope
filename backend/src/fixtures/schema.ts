import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { NormalizedEventSchema, VulcanEnrichmentSchema } from '../domain/contracts';

export const FixtureSetSchema = z.enum(['development', 'held_out']);
export const FixtureGroundTruthSchema = z.enum(['fraud', 'not_fraud']);
export const SignedFixtureSchema = z.object({
  id: z.string().uuid(),
  fixtureSet: FixtureSetSchema,
  organizationId: z.string().uuid(),
  event: NormalizedEventSchema,
  enrichment: VulcanEnrichmentSchema.nullable(),
  expected: z.object({ incidentStatus: z.enum(['OPEN', 'MONITORING', 'DISPUTE_OPENED', 'RESOLVED', 'DISMISSED']), groundTruth: FixtureGroundTruthSchema }).strict(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type SignedFixture = z.infer<typeof SignedFixtureSchema>;
export type UnsignedFixture = Omit<SignedFixture, 'signature'>;

export function signFixture(fixture: UnsignedFixture, secret: string): SignedFixture {
  if (secret.length < 32) throw new Error('Fixture signing secret must be at least 32 characters');
  const unsigned = { ...fixture };
  return SignedFixtureSchema.parse({ ...unsigned, signature: fixtureSignature(unsigned, secret) });
}

export function verifyFixture(fixture: unknown, secret: string, expectedSet?: z.infer<typeof FixtureSetSchema>): SignedFixture {
  const parsed = SignedFixtureSchema.parse(fixture);
  if (secret.length < 32) throw new Error('Fixture signing secret must be at least 32 characters');
  if (expectedSet && parsed.fixtureSet !== expectedSet) throw new Error(`Fixture ${parsed.id} belongs to ${parsed.fixtureSet}, not ${expectedSet}`);
  const expected = fixtureSignature(withoutSignature(parsed), secret);
  if (!timingSafeEqual(Buffer.from(parsed.signature, 'hex'), Buffer.from(expected, 'hex'))) throw new Error(`Fixture ${parsed.id} has an invalid signature`);
  return parsed;
}

function withoutSignature(fixture: SignedFixture): UnsignedFixture { const { signature: _signature, ...unsigned } = fixture; return unsigned; }
function fixtureSignature(fixture: UnsignedFixture, secret: string): string { return createHmac('sha256', secret).update(stableJson(fixture)).digest('hex'); }
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}
