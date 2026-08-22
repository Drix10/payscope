import { Incident, NormalizedEvent, RiskAnalysis, RiskAnalysisSchema, VulcanEnrichment } from '../domain/contracts';
import { ModelProvider } from '../providers/model/interface';

export type RiskAnalystTools = {
  getIncidentTimeline(incidentId: string): Promise<NormalizedEvent[]>;
  getMerchantFailureRate(windowHours: 1 | 4 | 24): Promise<number | null>;
  getNetworkFailureRate(gateway: string, windowHours: 1 | 4 | 24): Promise<number | null>;
  getCustomerIncidentCount(customerHash: string): Promise<number | null>;
};

export type RiskAnalystInput = {
  incident: Pick<Incident, 'id' | 'riskTier' | 'status' | 'totalFailedAmountPaise' | 'remainingAmountPaise'>;
  enrichment: VulcanEnrichment | null;
  customerHash?: string;
  gateway: string;
};

const SYSTEM_PROMPT = `You are the PayScope Risk Analyst. Produce structured risk analysis from the supplied tenant-scoped facts.
You cannot access PII, raw payloads, financial refund decisions, or undeclared tools. Include falsePositiveCostEstimatePaise, evidenceStrength, and missingEvidence. If enrichment is unavailable, say so in missingEvidence. Never infer fraud from one data point.`;

export async function runRiskAnalyst(provider: ModelProvider, tools: RiskAnalystTools, input: RiskAnalystInput, tenantId: string): Promise<{ analysis: RiskAnalysis; modelId: string; tokensUsed: number }> {
  // Each tool is server-scoped by its implementation; the model receives only
  // the bounded aggregate results, never a tenant identifier it can control.
  const [timeline, merchantFailureRate, networkFailureRate, customerIncidentCount] = await Promise.all([
    tools.getIncidentTimeline(input.incident.id),
    tools.getMerchantFailureRate(1),
    tools.getNetworkFailureRate(input.gateway, 1),
    input.customerHash ? tools.getCustomerIncidentCount(input.customerHash) : Promise.resolve(null),
  ]);
  const requiredMissingEvidence = [
    merchantFailureRate === null ? 'merchant failure-rate signal unavailable' : null,
    networkFailureRate === null ? 'network failure-rate signal unavailable' : null,
    customerIncidentCount === null ? 'customer incident-count signal unavailable' : null,
  ].filter((value): value is string => value !== null);
  const safeTimeline = timeline.map(event => ({ eventType: event.eventType, occurredAt: event.occurredAt, amountPaise: event.amountPaise, paymentStatus: event.paymentStatus, paymentMethod: event.paymentMethod }));
  const result = await provider.complete({
    systemPrompt: SYSTEM_PROMPT,
    userContent: JSON.stringify({ incident: input.incident, enrichment: input.enrichment, timeline: safeTimeline, merchantFailureRate, networkFailureRate, customerIncidentCount }),
    maxInputTokens: 3_072,
    maxTokens: 768,
    responseSchema: RiskAnalysisSchema,
    tenantId,
  });
  const analysis = requiredMissingEvidence.length
    ? RiskAnalysisSchema.parse({ ...result.content, missingEvidence: [...new Set([...requiredMissingEvidence, ...result.content.missingEvidence])].slice(0, 12) })
    : result.content;
  if (!input.enrichment && !analysis.missingEvidence.length) throw new Error('Risk analysis must record missing enrichment evidence');
  if (analysis.failureRootCause === 'fraud_confirmed' &&
    (!input.enrichment?.crossBorderFlag || customerIncidentCount === null || customerIncidentCount < 3 || analysis.evidenceStrength !== 'strong')) {
    throw new Error('Fraud-confirmed analysis requires cross-border evidence, at least three prior incidents, and strong evidence');
  }
  return { analysis, modelId: result.modelId, tokensUsed: result.usage.inputTokens + result.usage.outputTokens };
}
