import { ActionTypeSchema } from '../domain/contracts';
import { z } from 'zod';

export type ActionType = z.infer<typeof ActionTypeSchema>;
export type RiskLevel = 'none' | 'low' | 'medium' | 'high';
export type CapabilityStatus = 'verified' | 'verified_read_only' | 'adapter_ready' | 'not_available';

export interface CapabilityDefinition {
  displayName: string;
  riskLevel: RiskLevel;
  financialEffect: boolean;
  requiresMerchantOptIn: boolean;
  status: CapabilityStatus;
  allowedWhen: string[] | 'all' | 'never';
}

export const CAPABILITY_REGISTRY: Record<ActionType, CapabilityDefinition> = {
  deliver_recovery_link_email: {
    displayName: 'Recovery Email (Razorpay Payment Link)',
    riskLevel: 'low',
    financialEffect: false,
    requiresMerchantOptIn: true,
    status: 'verified',
    allowedWhen: ['gateway_degraded', 'customer_error', 'subscription_lapse', 'issuer_block', 'issuer_timeout', 'routing_suboptimal', 'unknown'],
  },
  capture_authorized_payment: {
    displayName: 'Capture Authorized Payment',
    riskLevel: 'medium',
    financialEffect: true,
    requiresMerchantOptIn: true,
    status: 'verified',
    allowedWhen: ['unknown'],
  },
  refund_payment: {
    displayName: 'Issue Refund',
    riskLevel: 'high',
    financialEffect: true,
    requiresMerchantOptIn: true,
    status: 'verified',
    allowedWhen: 'all',
  },
  retry_subscription_charge: {
    displayName: 'Retry Subscription Charge',
    riskLevel: 'medium',
    financialEffect: true,
    requiresMerchantOptIn: true,
    status: 'verified',
    allowedWhen: ['subscription_lapse'],
  },
  submit_dispute_evidence: {
    displayName: 'Submit Chargeback Evidence',
    riskLevel: 'low',
    financialEffect: false,
    requiresMerchantOptIn: true,
    status: 'verified',
    allowedWhen: 'all',
  },
  cancel_payment_link: {
    displayName: 'Cancel Expired Payment Link',
    riskLevel: 'none',
    financialEffect: false,
    requiresMerchantOptIn: false,
    status: 'verified',
    allowedWhen: 'all',
  },
  fetch_payment_status: {
    displayName: 'Observe Payment Status',
    riskLevel: 'none',
    financialEffect: false,
    requiresMerchantOptIn: false,
    status: 'verified_read_only',
    allowedWhen: 'all',
  },
  record_risk_signal: {
    displayName: 'Record Risk Signal',
    riskLevel: 'none',
    financialEffect: false,
    requiresMerchantOptIn: false,
    status: 'verified',
    allowedWhen: 'all',
  },
  resolve_infrastructure: {
    displayName: 'Resolve Infrastructure Incident',
    riskLevel: 'none',
    financialEffect: false,
    requiresMerchantOptIn: false,
    status: 'verified',
    allowedWhen: ['gateway_degraded', 'routing_suboptimal'],
  },
};
