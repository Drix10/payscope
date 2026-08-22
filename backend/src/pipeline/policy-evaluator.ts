import { ActionType, Incident, RecoveryPlan, RiskAnalysis } from '../domain/contracts';
import { STOPPING_RULES } from '../config/stopping-rules';

export type MerchantPolicy = { id: string; enabled: boolean; minimumConfidence: number; rootCauses: RiskAnalysis['failureRootCause'][]; allowedActions: ActionType[] };
export type OrgDailyStats = { autoResolveFraction: number; humanReviewFraction: number };
export type CustomerContactStats = { incidentAttempts: number; attemptsLast24Hours: number; attemptsLast7Days: number; merchantOptedIn: boolean };
export type PolicyDecision = { outcome: 'auto_with_proposals' | 'auto_no_action' | 'escalate'; permittedActions: RecoveryPlan['proposedActions']; escalationReason: string | null; matchedPolicyId: string | null };

const OUTREACH = new Set<ActionType>(['retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script']);

/** The only component that permits an action proposal to leave an investigation. */
export function evaluatePolicy(incident: Incident, risk: RiskAnalysis, recovery: RecoveryPlan, policies: MerchantPolicy[], stats: OrgDailyStats, contact: CustomerContactStats): PolicyDecision {
  if (![stats.autoResolveFraction, stats.humanReviewFraction].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('Organization daily policy statistics must be fractions between 0 and 1');
  if (![contact.incidentAttempts, contact.attemptsLast24Hours, contact.attemptsLast7Days].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Customer contact statistics must be non-negative integers');
  if (risk.failureRootCause === 'fraud_confirmed') return escalate('FRAUD_CONFIRMED_HARD_STOP');
  if (incident.status === 'DISPUTE_OPENED') return escalate('DISPUTE_OPEN_HARD_STOP');
  if (stats.autoResolveFraction >= STOPPING_RULES.AUTO_RESOLVE_RATE_CEILING_PER_ORG_PER_DAY) return escalate('AUTO_RESOLVE_CEILING_REACHED');
  if (stats.humanReviewFraction < STOPPING_RULES.MIN_HUMAN_REVIEW_FRACTION_PER_ORG_PER_DAY) return escalate('HUMAN_REVIEW_FLOOR_NOT_MET');
  if (incident.riskTier === 'CRITICAL') return escalate('CRITICAL_RISK_TIER');
  // Apply contact stopping rules before policy matching. A merchant policy may
  // never turn a contact which has hit a hard limit into an eligible proposal.
  const contactPermitted = recovery.proposedActions.filter(action => !OUTREACH.has(action.actionType) || contactAllowed(contact));
  const matched = policies.find(policy => policy.enabled && policy.minimumConfidence <= risk.confidence && policy.rootCauses.includes(risk.failureRootCause));
  if (!matched && contactPermitted.length) return escalate('NO_POLICY_MATCH');
  const permittedActions = contactPermitted.filter(action => matched?.allowedActions.includes(action.actionType) ?? false);
  return { outcome: permittedActions.length ? 'auto_with_proposals' : 'auto_no_action', permittedActions, escalationReason: null, matchedPolicyId: matched?.id ?? null };
}

function contactAllowed(contact: CustomerContactStats): boolean {
  return contact.merchantOptedIn && contact.incidentAttempts < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_INCIDENT && contact.attemptsLast24Hours < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_24H && contact.attemptsLast7Days < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_7D;
}

function escalate(reason: string): PolicyDecision {
  return { outcome: 'escalate', permittedActions: [], escalationReason: reason, matchedPolicyId: null };
}
