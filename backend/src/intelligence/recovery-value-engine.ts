import { ActionType, AutonomyPolicy, Incident, RiskAnalysis, VulcanEnrichment } from '../domain/contracts';

export type CustomerProfile = {
  organizationId: string;
  customerHash: string;
  successfulPaymentMethods: string[];
  failedPaymentMethods: string[];
  successfulPaymentCount: number;
  totalIncidentCount: number;
  recoveryEmailsSent: number;
  recoveryEmailsPaid: number;
  lastContactedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type RecoveryStrategy = {
  name: string;
  displayName: string;
  capabilities: ActionType[];
  baseScore: number;
  customerAdjustment: number;
  finalScore: number;
  expectedValuePaise: number;
  dataSource: 'vulcan_direct' | 'razorpay_fields_heuristic';
  blockedBy: string | null;
};

const ATTRIBUTION_STRATEGY_SCORES: Record<string, Record<string, number>> = {
  gateway_degraded: {
    recovery_email_upi_link: 68,
    recovery_email_netbanking: 61,
    wait_and_observe: 52,
  },
  customer_drop: {
    recovery_email_same_method: 74,
    recovery_email_alt_method: 58,
  },
  subscription_lapse: {
    subscription_retry_direct: 62,
    recovery_email_upi_link: 48,
  },
  issuer_timeout: {
    recovery_email_alt_method: 55,
    wait_and_observe: 30,
  },
  issuer_block: {
    recovery_email_alt_method: 50,
    wait_and_observe: 15,
  },
  routing_suboptimal: {
    recovery_email_upi_link: 63,
    recovery_email_netbanking: 55,
  },
  insufficient_funds: {
    wait_and_observe: 40,
    recovery_email_same_method: 25,
  },
  fraud_block: {},
  unknown: {
    recovery_email_same_method: 42,
    recovery_email_alt_method: 38,
    wait_and_observe: 35,
  },
};

function strategyDisplayName(name: string): string {
  switch (name) {
    case 'recovery_email_same_method': return '1-Click Razorpay Payment Link (Primary Channel)';
    case 'recovery_email_upi_link': return '1-Click UPI Recovery Link Email';
    case 'recovery_email_netbanking': return 'Alternate Netbanking Payment Link Email';
    case 'recovery_email_alt_method': return 'Alternate Method Recovery Link Email';
    case 'subscription_retry_direct': return 'Razorpay Subscription Mandate Charge Retry';
    case 'wait_and_observe': return 'Telemetry Telemetry Monitoring & Infrastructure Resolution';
    case 'dispute_evidence_auto': return 'Autonomous Chargeback Dispute Evidence Submission';
    default: return name.replace(/_/g, ' ');
  }
}

function strategyCaps(name: string): ActionType[] {
  switch (name) {
    case 'subscription_retry_direct': return ['retry_subscription_charge', 'deliver_recovery_link_email'];
    case 'wait_and_observe': return ['resolve_infrastructure'];
    case 'dispute_evidence_auto': return ['submit_dispute_evidence'];
    default: return ['deliver_recovery_link_email'];
  }
}

function checkAutonomyPolicy(name: string, policy: AutonomyPolicy | null): string | null {
  if (!policy) return null;
  if (name.includes('email') && !policy.recoveryEmailEnabled) return 'recovery_email_disabled';
  if (name.includes('subscription') && !policy.subscriptionRetryEnabled) return 'subscription_retry_disabled';
  return null;
}

export function rankStrategies(
  incident: Incident,
  enrichment: VulcanEnrichment | null,
  riskAnalysis: RiskAnalysis,
  customerProfile: CustomerProfile | null,
  autonomyPolicy: AutonomyPolicy | null
): RecoveryStrategy[] {
  if (riskAnalysis.failureRootCause === 'fraud_confirmed' || riskAnalysis.failureRootCause === 'fraud_suspected' || enrichment?.failureAttribution === 'fraud_block') {
    return [];
  }

  const attribution = enrichment?.failureAttribution ?? 'unknown';
  const scores = ATTRIBUTION_STRATEGY_SCORES[attribution] ?? ATTRIBUTION_STRATEGY_SCORES.unknown;
  const dataSource = enrichment?.source === 'vulcan_direct' ? 'vulcan_direct' : 'razorpay_fields_heuristic';

  const strategies: RecoveryStrategy[] = [];

  for (const [name, baseScore] of Object.entries(scores)) {
    let adjustment = 0;

    if (enrichment?.recommendedRetryMethod) {
      if (name.includes(enrichment.recommendedRetryMethod)) adjustment += 15;
    }

    if (customerProfile) {
      if (customerProfile.successfulPaymentCount > 3) adjustment += 8;
      if (customerProfile.lastContactedAt) {
        const hoursAgo = (Date.now() - Date.parse(customerProfile.lastContactedAt)) / 3_600_000;
        if (hoursAgo < 24) adjustment -= 22;
      }
      if (customerProfile.successfulPaymentMethods.length > 0) {
        const preferred = customerProfile.successfulPaymentMethods[0];
        if (name.includes(preferred)) adjustment += 12;
      }
    }

    if (incident.remainingAmountPaise > 1_000_000) adjustment -= 5;

    const finalScore = Math.max(0, Math.min(100, baseScore + adjustment));
    const expectedValuePaise = Math.round((finalScore / 100) * incident.remainingAmountPaise);
    const blockedBy = checkAutonomyPolicy(name, autonomyPolicy);

    strategies.push({
      name,
      displayName: strategyDisplayName(name),
      capabilities: strategyCaps(name),
      baseScore,
      customerAdjustment: adjustment,
      finalScore,
      expectedValuePaise,
      dataSource,
      blockedBy,
    });
  }

  return strategies
    .filter(s => s.blockedBy === null)
    .sort((a, b) => b.expectedValuePaise - a.expectedValuePaise);
}
