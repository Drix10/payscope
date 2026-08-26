import { z } from 'zod';
import { Incident, VulcanEnrichment } from '../domain/contracts';
import { StoredEvent } from '../db/mvp-repository';
import { ModelProvider } from '../providers/model/interface';

const DisputeNarrativeSchema = z.object({
  narrative: z.string().min(10).max(2000),
  keyFacts: z.array(z.string()),
  recommendedEvidenceCategory: z.string(),
});

const DISPUTE_SYSTEM_PROMPT = `You are PayScope's Dispute Evidence Analyst.
Write a factual, professional chargeback response narrative for Razorpay dispute arbitration based strictly on supplied timeline events and Vulcan signals.

Rules:
1. State only facts present in the timeline and enrichment.
2. Reference payment timestamps, Vulcan failure attribution, gateway health, and acquirer response signals.
3. Do not guess customer intent or mention internal AI system names.
4. Keep plain text suitable for bank arbitration submission.`;

export interface DisputeEvidenceResult {
  narrative: string;
  evidenceItems: string[];
  deadlineHoursRemaining: number;
}

export async function buildDisputeEvidenceNarrative(
  incident: Incident,
  events: StoredEvent[],
  dispute: { id: string; dueBy: string; amountPaise: number },
  enrichment: VulcanEnrichment | null,
  provider: ModelProvider | undefined,
  organizationId: string
): Promise<DisputeEvidenceResult> {
  const hoursRemaining = Math.max(0, (Date.parse(dispute.dueBy) - Date.now()) / 3_600_000);

  const timelineText = events
    .map(e => `${e.event.occurredAt}: ${e.event.eventType} (INR ${((e.event.amountPaise ?? 0) / 100).toFixed(2)})`)
    .join('\n');

  const vulcanContext = enrichment ? [
    `Vulcan failure attribution: ${enrichment.failureAttribution}`,
    `Gateway health score at failure: ${(enrichment.gatewayHealthScore * 100).toFixed(0)}%`,
    `Gateway in documented downtime: ${enrichment.gatewayInDowntime}`,
    `Cross-border flag: ${enrichment.crossBorderFlag}`,
    `Signals evaluated: ${enrichment.signalsUsed.join(', ')}`,
  ].join('\n') : 'Enrichment telemetry unavailable';

  if (!provider) {
    return {
      narrative: `Chargeback response statement for Dispute ID ${dispute.id}.\n\nPayment amount of INR ${(dispute.amountPaise / 100).toFixed(2)} was attempted. Telemetry summary:\n${vulcanContext}\n\nTimeline:\n${timelineText}`,
      evidenceItems: [
        `Payment timeline (${events.length} events logged)`,
        `Vulcan telemetry attribution: ${enrichment?.failureAttribution ?? 'unavailable'}`,
        `Gateway health score: ${enrichment ? `${(enrichment.gatewayHealthScore * 100).toFixed(0)}%` : 'unavailable'}`,
      ],
      deadlineHoursRemaining: Math.round(hoursRemaining),
    };
  }

  try {
    const result = await provider.complete({
      systemPrompt: DISPUTE_SYSTEM_PROMPT,
      userContent: JSON.stringify({
        incidentId: incident.id,
        disputeId: dispute.id,
        disputeAmountPaise: dispute.amountPaise,
        timeline: timelineText,
        vulcanSignals: vulcanContext,
      }),
      maxInputTokens: 2_048,
      maxTokens: 512,
      responseSchema: DisputeNarrativeSchema,
      tenantId: organizationId,
    });

    return {
      narrative: result.content.narrative,
      evidenceItems: result.content.keyFacts.length ? result.content.keyFacts : [
        `Timeline events: ${events.length}`,
        `Vulcan attribution: ${enrichment?.failureAttribution ?? 'unavailable'}`,
      ],
      deadlineHoursRemaining: Math.round(hoursRemaining),
    };
  } catch {
    return {
      narrative: `Chargeback response statement for Dispute ID ${dispute.id}.\n\nPayment amount of INR ${(dispute.amountPaise / 100).toFixed(2)} was attempted. Telemetry summary:\n${vulcanContext}\n\nTimeline:\n${timelineText}`,
      evidenceItems: [
        `Payment timeline (${events.length} events logged)`,
        `Vulcan telemetry attribution: ${enrichment?.failureAttribution ?? 'unavailable'}`,
      ],
      deadlineHoursRemaining: Math.round(hoursRemaining),
    };
  }
}
