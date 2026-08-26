import { ActionType, Incident, RecoveryPlan, RiskAnalysis } from '../domain/contracts';
import { STOPPING_RULES } from '../config/config';

export type MerchantPolicy = { id: string; enabled: boolean; minimumConfidence: number; rootCauses: RiskAnalysis['failureRootCause'][]; allowedActions: ActionType[]; merchantOptedIn: boolean };
export type OrgDailyStats = { autoResolveFraction: number };
export type CustomerContactStats = { incidentAttempts: number; attemptsLast24Hours: number; attemptsLast7Days: number; merchantOptedIn: boolean; customerReferenceAvailable: boolean };
export type ExecutionPolicy = {
  enabledCapabilities: ActionType[];
  maxAmountPaise: number;
  allowedCurrencies: string[];
  emailConsentRequired: boolean;
  providerHealthy: boolean;
  emergencyPaused: boolean;
  retryBudget: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  timezone?: string;
};
export type PolicyGate = { name: 'fraud' | 'dispute' | 'auto_resolve_ceiling' | 'critical_tier' | 'contact_limits' | 'merchant_policy' | 'execution_capability' | 'provider_health' | 'amount_currency' | 'consent_quiet_hours' | 'emergency_pause' | 'idempotency' | 'retry_budget'; result: 'passed' | 'blocked' | 'restricted' | 'skipped'; rationale: string };
export type PolicyDecision = { outcome: 'auto_with_proposals' | 'auto_no_action'; permittedActions: RecoveryPlan['proposedActions']; noActionReason: string | null; matchedPolicyId: string | null; gates: PolicyGate[]; executionPolicyVersion?: string };

const OUTREACH = new Set<ActionType>(['deliver_recovery_link_email']);
const ALL_GATES: PolicyGate['name'][] = ['fraud', 'dispute', 'auto_resolve_ceiling', 'critical_tier', 'contact_limits', 'merchant_policy', 'execution_capability', 'provider_health', 'amount_currency', 'consent_quiet_hours', 'emergency_pause', 'idempotency', 'retry_budget'];

/** The only component that permits an action proposal to leave an investigation. */
export function evaluatePolicy(
  incident: Incident,
  risk: RiskAnalysis,
  recovery: RecoveryPlan,
  policies: MerchantPolicy[],
  stats: OrgDailyStats,
  contact: CustomerContactStats,
  directOptions?: {
    executionPolicy?: ExecutionPolicy;
    existingCommandKeys?: Set<string>;
    commandKeyForAction?: (actionType: ActionType) => string;
    currentRetryCount?: number;
    amountPaise?: number;
    currency?: string;
    providerHealthy?: boolean;
    now?: Date;
  },
): PolicyDecision {
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
    // still evaluate extended gates as skipped for audit completeness
    if (directOptions?.executionPolicy) fillExtendedGatesSkipped(gates, 'merchant_policy');
    return { outcome: 'auto_no_action', permittedActions: [], noActionReason: 'NO_POLICY_MATCH', matchedPolicyId: null, gates };
  }
  let permittedActions = contactPermitted.filter(action => matched?.allowedActions.includes(action.actionType) ?? false);
  gates.push({ name: 'merchant_policy', result: matched ? 'passed' : 'restricted', rationale: matched ? 'Merchant policy matched and allowed actions were filtered deterministically.' : 'No action required and no merchant policy match was needed.' });

  // === Extended deterministic execution policy (direct execution) ===
  if (directOptions?.executionPolicy) {
    const ep = directOptions.executionPolicy;
    // emergency pause is hard stop — deterministic, audited, no duplicate work
    if (ep.emergencyPaused) {
      gates.push({ name: 'execution_capability', result: 'skipped', rationale: 'Skipped after emergency pause.' });
      gates.push({ name: 'provider_health', result: 'skipped', rationale: 'Skipped after emergency pause.' });
      gates.push({ name: 'amount_currency', result: 'skipped', rationale: 'Skipped after emergency pause.' });
      gates.push({ name: 'consent_quiet_hours', result: 'skipped', rationale: 'Skipped after emergency pause.' });
      gates.push({ name: 'idempotency', result: 'skipped', rationale: 'Skipped after emergency pause.' });
      gates.push({ name: 'retry_budget', result: 'skipped', rationale: 'Skipped after emergency pause.' });
      gates.push({ name: 'emergency_pause', result: 'blocked', rationale: 'EMERGENCY_PAUSE_ENABLED' });
      // fill any missing skipped
      for (const n of ALL_GATES) if (!gates.some(g => g.name === n)) gates.push({ name: n, result: 'skipped', rationale: `Not evaluated after emergency_pause blocked.` });
      return { outcome: 'auto_no_action', permittedActions: [], noActionReason: 'EMERGENCY_PAUSE_ENABLED', matchedPolicyId: matched?.id ?? null, gates: sortGates(gates) };
    }
    gates.push({ name: 'emergency_pause', result: 'passed', rationale: 'No emergency pause.' });

    // execution capability: model must not propose disabled capability
    const disabled = permittedActions.filter(a => !ep.enabledCapabilities.includes(a.actionType));
    if (disabled.length) {
      gates.push({ name: 'execution_capability', result: 'restricted', rationale: `Disabled capabilities removed: ${disabled.map(d => d.actionType).join(',')}` });
      permittedActions = permittedActions.filter(a => ep.enabledCapabilities.includes(a.actionType));
    }
    else gates.push({ name: 'execution_capability', result: 'passed', rationale: 'All proposed capabilities are enabled.' });

    // provider health
    const providerHealthy = directOptions.providerHealthy ?? ep.providerHealthy;
    if (!providerHealthy) {
      gates.push({ name: 'provider_health', result: 'blocked', rationale: 'PROVIDER_UNAVAILABLE' });
      for (const n of ['amount_currency', 'consent_quiet_hours', 'idempotency', 'retry_budget'] as const) if (!gates.some(g => g.name === n)) gates.push({ name: n, result: 'skipped', rationale: 'Skipped after provider health blocked.' });
      return { outcome: 'auto_no_action', permittedActions: [], noActionReason: 'PROVIDER_UNAVAILABLE', matchedPolicyId: matched?.id ?? null, gates: sortGates(gates) };
    }
    gates.push({ name: 'provider_health', result: 'passed', rationale: 'Provider is healthy.' });

    // amount / currency caps
    const amount = directOptions.amountPaise ?? incident.remainingAmountPaise;
    const currency = directOptions.currency ?? 'INR';
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > ep.maxAmountPaise || !ep.allowedCurrencies.includes(currency)) {
      gates.push({ name: 'amount_currency', result: 'blocked', rationale: `Amount ${amount} or currency ${currency} exceeds policy caps.` });
      for (const n of ['consent_quiet_hours', 'idempotency', 'retry_budget'] as const) if (!gates.some(g => g.name === n)) gates.push({ name: n, result: 'skipped', rationale: 'Skipped after amount/currency blocked.' });
      return { outcome: 'auto_no_action', permittedActions: [], noActionReason: 'AMOUNT_OR_CURRENCY_CAP_EXCEEDED', matchedPolicyId: matched?.id ?? null, gates: sortGates(gates) };
    }
    gates.push({ name: 'amount_currency', result: 'passed', rationale: `Amount ${amount} ${currency} within caps.` });

    // consent / quiet hours
    const now = directOptions.now ?? new Date();
    const validateHour = (v: unknown): number | undefined => {
      if (v === undefined) return undefined;
      if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 23) throw new Error('Quiet hours must be integers between 0 and 23');
      return v as number;
    };
    const qStart = validateHour(ep.quietHoursStart);
    const qEnd = validateHour(ep.quietHoursEnd);
    const inQuiet = qStart !== undefined && qEnd !== undefined ? (() => {
      const merchantHour = hourInTimezone(now, ep.timezone ?? 'Asia/Kolkata');
      return isInQuietHours(merchantHour, qStart, qEnd);
    })() : false;
    if (inQuiet && permittedActions.some(a => OUTREACH.has(a.actionType))) {
      gates.push({ name: 'consent_quiet_hours', result: 'blocked', rationale: `Quiet hours active (${ep.quietHoursStart}-${ep.quietHoursEnd} ${ep.timezone ?? 'Asia/Kolkata'}).` });
      for (const n of ['idempotency', 'retry_budget'] as const) if (!gates.some(g => g.name === n)) gates.push({ name: n, result: 'skipped', rationale: 'Skipped after quiet hours blocked.' });
      return { outcome: 'auto_no_action', permittedActions: [], noActionReason: 'QUIET_HOURS_ACTIVE', matchedPolicyId: matched?.id ?? null, gates: sortGates(gates) };
    }
    if (ep.emailConsentRequired && !contact.customerReferenceAvailable) {
      gates.push({ name: 'consent_quiet_hours', result: 'blocked', rationale: 'CONSENT_NOT_AVAILABLE' });
      for (const n of ['idempotency', 'retry_budget'] as const) if (!gates.some(g => g.name === n)) gates.push({ name: n, result: 'skipped', rationale: 'Skipped after consent blocked.' });
      return { outcome: 'auto_no_action', permittedActions: [], noActionReason: 'CONSENT_NOT_AVAILABLE', matchedPolicyId: matched?.id ?? null, gates: sortGates(gates) };
    }
    gates.push({ name: 'consent_quiet_hours', result: 'passed', rationale: 'Consent and quiet-hours checks passed.' });

    // idempotency: duplicate command_key already dispatched
    if (directOptions.existingCommandKeys && directOptions.commandKeyForAction) {
      const dup = permittedActions.filter(a => directOptions.existingCommandKeys!.has(directOptions.commandKeyForAction!(a.actionType)));
      if (dup.length) {
        gates.push({ name: 'idempotency', result: 'blocked', rationale: `Duplicate command key for ${dup.map(d => d.actionType).join(',')}` });
        permittedActions = permittedActions.filter(a => !directOptions.existingCommandKeys!.has(directOptions.commandKeyForAction!(a.actionType)));
      } else gates.push({ name: 'idempotency', result: 'passed', rationale: 'No duplicate command key.' });
    } else gates.push({ name: 'idempotency', result: 'passed', rationale: 'No duplicate command key.' });

    // retry budget: number of retries allowed after initial dispatch (0 = initial only)
    const retries = directOptions.currentRetryCount ?? 0;
    if (!Number.isSafeInteger(retries) || retries < 0) throw new Error('Retry count must be a non-negative integer');
    if (!Number.isSafeInteger(ep.retryBudget) || ep.retryBudget < 0 || ep.retryBudget > 5) throw new Error('Retry budget must be an integer between 0 and 5');
    if (retries > ep.retryBudget) {
      gates.push({ name: 'retry_budget', result: 'blocked', rationale: `Retry budget exhausted (${retries} > ${ep.retryBudget} retries allowed after initial).` });
      return { outcome: 'auto_no_action', permittedActions: [], noActionReason: 'RETRY_BUDGET_EXHAUSTED', matchedPolicyId: matched?.id ?? null, gates: sortGates(gates) };
    }
    gates.push({ name: 'retry_budget', result: 'passed', rationale: `Retry budget available (${retries}/${ep.retryBudget} retries used).` });
  } else {
    // fill extended gates as skipped when direct policy not evaluated (legacy simulation path)
    fillExtendedGatesSkipped(gates);
  }

  return { outcome: permittedActions.length ? 'auto_with_proposals' : 'auto_no_action', permittedActions, noActionReason: permittedActions.length ? null : 'NO_PERMITTED_ACTION', matchedPolicyId: matched?.id ?? null, gates: sortGates(gates) };
}

function contactAllowed(contact: CustomerContactStats): boolean {
  return contact.customerReferenceAvailable && contact.merchantOptedIn && contact.incidentAttempts < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_INCIDENT && contact.attemptsLast24Hours < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_24H && contact.attemptsLast7Days < STOPPING_RULES.MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_7D;
}

function halt(gates: PolicyGate[], name: PolicyGate['name'], reason: string): PolicyDecision {
  gates.push({ name, result: 'blocked', rationale: reason });
  for (const later of ALL_GATES) {
    if (!gates.some(gate => gate.name === later)) gates.push({ name: later, result: 'skipped', rationale: `Not evaluated after ${name} blocked automatic action.` });
  }
  return { outcome: 'auto_no_action', permittedActions: [], noActionReason: reason, matchedPolicyId: null, gates: sortGates(gates) };
}
function fillExtendedGatesSkipped(gates: PolicyGate[], after?: PolicyGate['name']): void {
  const extended: PolicyGate['name'][] = ['execution_capability', 'provider_health', 'amount_currency', 'consent_quiet_hours', 'emergency_pause', 'idempotency', 'retry_budget'];
  for (const n of extended) if (!gates.some(g => g.name === n)) gates.push({ name: n, result: 'skipped', rationale: after ? `Not evaluated after ${after} blocked.` : 'Not evaluated in simulation path.' });
}
function sortGates(gates: PolicyGate[]): PolicyGate[] {
  return [...gates].sort((a, b) => ALL_GATES.indexOf(a.name) - ALL_GATES.indexOf(b.name));
}
function isInQuietHours(nowHour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return nowHour >= start && nowHour < end;
  return nowHour >= start || nowHour < end; // wraps midnight
}

function hourInTimezone(now: Date, timezone: string): number {
  if (!/^[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?$/.test(timezone)) throw new Error('Execution policy timezone is invalid');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('Execution policy timezone could not be evaluated');
  return hour;
}
