import { Incident, RecoveryPlan, RecoveryPlanSchema, RiskAnalysis } from '../domain/contracts';
import { ModelProvider } from '../providers/model/interface';

export type RecoveryPlannerInput = {
  incident: Pick<Incident, 'id' | 'status' | 'remainingAmountPaise' | 'riskTier'>;
  riskAnalysis: RiskAnalysis;
  merchantOptedInToRecovery: boolean;
};

const SYSTEM_PROMPT = `You are the PayScope Recovery Planner. You propose bounded, non-financial recovery actions only.
Never include PII. Every proposed action requires operator approval. For fraud_suspected or fraud_confirmed, only flag_for_review is allowed. For DISPUTE_OPENED, no action is allowed. Hinglish scripts have at most 75 words and include a polite opt-out.`;

export async function runRecoveryPlanner(provider: ModelProvider, input: RecoveryPlannerInput, tenantId: string): Promise<{ plan: RecoveryPlan; modelId: string; tokensUsed: number }> {
  const result = await provider.complete({
    systemPrompt: SYSTEM_PROMPT,
    userContent: JSON.stringify(input),
    maxInputTokens: 2_048,
    maxTokens: 512,
    responseSchema: RecoveryPlanSchema,
    tenantId,
  });
  validateRecoveryPlan(result.content, input);
  return { plan: result.content, modelId: result.modelId, tokensUsed: result.usage.inputTokens + result.usage.outputTokens };
}

function validateRecoveryPlan(plan: RecoveryPlan, input: RecoveryPlannerInput): void {
  const actions = plan.proposedActions.map(action => action.actionType);
  if (input.incident.status === 'DISPUTE_OPENED' && actions.length) throw new Error('Recovery planner cannot propose actions on an open dispute');
  if (['fraud_confirmed', 'fraud_suspected'].includes(input.riskAnalysis.failureRootCause) && actions.some(action => action !== 'flag_for_review')) throw new Error('Recovery planner cannot propose outreach for fraud');
  if (!input.merchantOptedInToRecovery && actions.some(action => ['retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script'].includes(action))) throw new Error('Recovery planner cannot propose outreach without merchant opt-in');
  for (const action of plan.proposedActions) {
    if (action.scriptContent && action.scriptContent.trim().split(/\s+/).filter(Boolean).length > 75) throw new Error('Recovery planner script exceeds the 75-word limit');
    if (action.actionType === 'hinglish_voice_script' && (!action.scriptContent || !/\b(stop|opt\s*out|unsubscribe)\b/i.test(action.scriptContent))) throw new Error('Recovery planner voice script must include an opt-out instruction');
  }
}
