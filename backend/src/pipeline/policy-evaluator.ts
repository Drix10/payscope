import { ActionType, Incident, RecoveryPlan, RiskAnalysis } from '../domain/contracts';
import { STOPPING_RULES } from '../config/stopping-rules';

export type MerchantPolicy = { id: string; enabled: boolean; minimumConfidence: number; rootCauses: RiskAnalysis['failureRootCause'][]; allowedActions: ActionType[]; merchantOptedIn: boolean };
export type OrgDailyStats = { autoResolveFraction: number };
export type CustomerContactStats = { incidentAttempts: number; attemptsLast24Hours: number; attemptsLast7Days: number; merchantOptedIn: boolean; customerReferenceAvailable: boolean };
export type PolicyGate = { name: 'fraud' | 'dispute' | 'auto_resolve_ceiling' | 'critical_tier' | 'contact_limits' | 'merchant_policy'; result: 'passed' | 'blocked' | 'restricted' | 'skipped'; rationale: string };
export type PolicyDecision = { outcome: 'auto_with_proposals' | 'auto_no_action'; permittedActions: RecoveryPlan['proposedActions']; noActionReason: string | null; matchedPolicyId: string | null; gates: PolicyGate[] };

const OUTREACH = new Set<ActionType>(['retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script']);

/** The only component that permits an action proposal to leave an investigation. */
export function evaluatePolicy(incident: Incident, risk: RiskAnalysis, recovery: RecoveryPlan, policies: MerchantPolicy[], stats: OrgDailyStats, contact: CustomerContactStats): PolicyDecision {
  if (!Number.isFinite(stats.autoResolveFraction) || stats.autoResolveFraction < 0 || stats.autoResolveFraction > 1) throw new Error('Organization daily policy statistics must be fractions between 0 and 1');
  if (![contact.incidentAttempts, contact.attemptsLast24Hours, contact.attemptsLast7Days].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Customer contact statistics must be non-negative integers');
  const gates: PolicyGate[] = [];
  if (risk.failureRootCause === 'fraud_confirmed') return halt(gates, 'fraud', 'FRAUD_CONFIRMED_HARD_STOP');
  gates.push({ name: 'fraud', result: 'passed', rationale: 'No confirmed-fraud hard stop.' });
  if (incident.status === 'DISPUTE_OPENED') return halt(gates, 'dispute', 'DISPUTE_OPEN_HARD_STOP');
  gates.push({ name: 'dispute', result: 'passed', rationale: 'No open dispute.' });
  if (stats.autoResolveFraction >= STOPPING_RULES.AUTO_RESOLVE_RATE_CEILING_PER_ORG_PER_DAY) return halt(gates, 'auto_resolve_ceiling', 'AUTO_RESOLVE_CEILING_REACHED');
  gates.push({ name: 'auto_resolve_ceiling', result: 'passed', rationale: `Daily auto-resolve fraction ${stats.autoResolveFraction.toFixed(3)} is below the 0.900 ceiling.` });
  if (incident.riskTier === 'CRITICAL') return halt(gates, 'critical_tier', 'CRITICAL_RISK_TIER');
  gates.push({ name: 'critical_tier', result: 'passed', rationale: 'Incident is below the critical tier.' });
  // Apply contact stopping rules before policy matching. A merchant policy may
  // never turn a contact which has hit a hard limit into an eligible proposal.
  const outreachAllowed = contactAllowed(contact);
  const contactPermitted = recovery.proposedActions.filter(action => !OUTREACH.has(action.actionType) || outreachAllowed);
  gates.push({ name: 'contact_limits', result: outreachAllowed ? 'passed' : 'restricted', rationale: outreachAllowed ? `Customer contact limits allow outreach (${contact.incidentAttempts}/2 incident attempts).` : `Outreach removed by contact limits or opt-in (${contact.incidentAttempts}/2 incident attempts; ${contact.attemptsLast24Hours}/1 in 24h).` });
  const matched = policies.find(policy => policy.enabled && policy.minimumConfidence <= risk.confidence && policy.rootCauses.includes(risk.failureRootCause));
  if (!matched && contactPermitted.length) {
    gates.push({ name: 'merchant_policy', result: 'blocked', rationale: 'No enabled merchant policy matches this root cause and confidence.' });
    return { outcome: 'auto_no_action', permittedActions: [], noActionReason: 'NO_POLICY_MATCH', matchedPolicyId: null, gates };
  }
  const permittedActions = contactPermitted.filter(action => matched?.allowedActions.includes(action.actionType) ?? false);
  gates.push({ name: 'merchant_policy', result: matched ? 'passed' : 'restricted', rationale: matched ? 'Merchant policy matched and allowed actions were filtered deterministically.' : 'No action required and no merchant policy match was needed.' });
  return { outcome: permittedActions.length ? 'auto_with_proposals' : 'auto_no_action', permittedActions, noActionReason: permittedActions.length ? null : 'NO_PERMITTED_ACTION', matchedPolicyId: matched?.id ?? null, gates };
}

function contactAllowed(contact: CustomerContactStats): boolean {
  return contact.customerReferenceAvailable && contact.merchantOptedIn && contact.incidentAttempts < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_INCIDENT && contact.attemptsLast24Hours < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_24H && contact.attemptsLast7Days < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_7D;
}

function halt(gates: PolicyGate[], name: PolicyGate['name'], reason: string): PolicyDecision {
  gates.push({ name, result: 'blocked', rationale: reason });
  for (const later of ['fraud', 'dispute', 'auto_resolve_ceiling', 'critical_tier', 'contact_limits', 'merchant_policy'] as const) {
    if (!gates.some(gate => gate.name === later)) gates.push({ name: later, result: 'skipped', rationale: `Not evaluated after ${name} blocked automatic action.` });
  }
  return { outcome: 'auto_no_action', permittedActions: [], noActionReason: reason, matchedPolicyId: null, gates };
}
