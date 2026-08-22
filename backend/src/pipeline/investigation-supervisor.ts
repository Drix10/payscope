import { z } from 'zod';
import { Incident, InvestigationPlan, InvestigationPlanSchema, VulcanEnrichment } from '../domain/contracts';
import { ModelProvider } from '../providers/model/interface';

export type SupervisorInput = {
  incident: Pick<Incident, 'id' | 'riskTier' | 'status' | 'totalFailedAmountPaise' | 'correlatedEventIds' | 'openedAt'>;
  enrichment: VulcanEnrichment | null;
  merchantPolicyCount: number;
  autoResolveBudgetRemaining: number;
};

const SupervisorInputSchema = z.object({
  incident: z.object({ id: z.string().uuid(), riskTier: z.string(), status: z.string(), totalFailedAmountPaise: z.number().int().nonnegative(), correlatedEventIds: z.array(z.string().uuid()).max(100), openedAt: z.string().datetime({ offset: true }) }),
  enrichment: z.unknown().nullable(),
  merchantPolicyCount: z.number().int().nonnegative(),
  autoResolveBudgetRemaining: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `You are the PayScope Investigation Supervisor. You receive a structured payment incident and must produce an investigation plan.
You cannot access external systems, PII, raw provider payloads, or fields not supplied. You do not produce final risk scores or specific actions.
Return valid JSON. If enrichment is unavailable, requiresHumanReview must be true. For clear infrastructure (gateway health below 0.3 and no fraud signal), subAgents may be empty and estimatedAutoResolvable may be true.`;

export async function runInvestigationSupervisor(provider: ModelProvider, input: SupervisorInput, tenantId: string): Promise<{ plan: InvestigationPlan; modelId: string; tokensUsed: number }> {
  const safeInput = SupervisorInputSchema.parse(input);
  const result = await provider.complete({
    systemPrompt: SYSTEM_PROMPT,
    userContent: JSON.stringify(safeInput),
    maxInputTokens: 2_048,
    maxTokens: 512,
    responseSchema: InvestigationPlanSchema,
    tenantId,
  });
  if (!safeInput.enrichment && !result.content.requiresHumanReview) throw new Error('Supervisor must require human review when enrichment is unavailable');
  return { plan: result.content, modelId: result.modelId, tokensUsed: result.usage.inputTokens + result.usage.outputTokens };
}
