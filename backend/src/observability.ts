import pino from 'pino';
import { Counter, Registry, Histogram, Gauge } from 'prom-client';
import { trace } from '@opentelemetry/api';

export const logger = pino({
  level: process.env.LOG_LEVEL?.trim() || 'info',
  redact: {
    paths: [
      'email', '*.email', '*.*.email', 'recipient', '*.recipient', '*.*.recipient', 'to', '*.to', '*.*.to', 'customerHash', '*.customerHash', '*.*.customerHash', 'customer_hash', '*.customer_hash', '*.*.customer_hash',
      'authorization', 'headers.authorization', 'headers.Authorization', '*.authorization', '*.*.authorization',
      'smtp.pass', '*.smtp.pass', '*.*.smtp.pass', 'smtpPass', '*.smtpPass', '*.*.smtpPass',
      'razorpayKeySecret', '*.razorpayKeySecret', '*.*.razorpayKeySecret', 'RAZORPAY_KEY_SECRET', '*.RAZORPAY_KEY_SECRET', '*.*.RAZORPAY_KEY_SECRET',
      'MESH_API_KEY', '*.MESH_API_KEY', '*.*.MESH_API_KEY', 'meshApiKey', '*.meshApiKey', '*.*.meshApiKey',
      'providerData', '*.providerData', '*.*.providerData', 'raw_body', '*.raw_body', '*.*.raw_body', 'rawBody', '*.rawBody', '*.*.rawBody',
      'email_envelope', '*.email_envelope', '*.*.email_envelope', 'emailEnvelope', '*.emailEnvelope', '*.*.emailEnvelope',
      'payload', '*.payload', '*.*.payload', 'normalized', '*.normalized', '*.*.normalized',
      'paymentLinkUrl', '*.paymentLinkUrl', '*.*.paymentLinkUrl', 'shortUrl', '*.shortUrl', '*.*.shortUrl',
      'commandPayload', '*.commandPayload', '*.*.commandPayload', 'redacted_payload', '*.redacted_payload', '*.*.redacted_payload',
      'err.email', 'err.recipient', 'err.customerHash', 'err.customer_hash', 'err.authorization'
    ],
    censor: '[REDACTED]',
    remove: false,
  },
});

export const metrics = new Registry();
export const executionAttempts = new Counter({ name: 'payscope_execution_attempts_total', help: 'Direct execution attempts by capability and terminal outcome.', labelNames: ['capability', 'outcome'] as const, registers: [metrics] });
export const executionLatency = new Histogram({ name: 'payscope_execution_latency_ms', help: 'Execution adapter latency', labelNames: ['capability', 'provider'] as const, buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000], registers: [metrics] });
export const callbackVerification = new Counter({ name: 'payscope_callback_verification_total', help: 'Callback verification outcomes', labelNames: ['provider', 'result'] as const, registers: [metrics] });
export const auditChainBreaks = new Counter({ name: 'payscope_audit_chain_broken_total', help: 'Audit chain break detections', registers: [metrics] });
export const incidentLifecycleEvents = new Counter({ name: 'payscope_incident_lifecycle_events_total', help: 'Incident lifecycle events observed by the durable worker.', labelNames: ['event', 'status'] as const, registers: [metrics] });
export const strategyPerformanceEvents = new Counter({ name: 'payscope_strategy_performance_events_total', help: 'Strategy outcomes observed by the execution and reconciliation paths.', labelNames: ['strategy', 'outcome'] as const, registers: [metrics] });
export const llmFailureEvents = new Counter({ name: 'payscope_llm_failures_total', help: 'LLM investigation failures that caused deterministic fallback/no-action handling.', labelNames: ['stage'] as const, registers: [metrics] });
export const timeToRecoveryMs = new Histogram({ name: 'payscope_time_to_recovery_ms', help: 'Time from incident open to full recovery.', buckets: [1_000, 10_000, 60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000, 259_200_000], registers: [metrics] });
export const recoveryRateGauge = new Gauge({ name: 'payscope_recovery_rate', help: 'Latest observed tenant recovery rate from dashboard metrics.', registers: [metrics] });
/** No exporter is required for local/VPS operation; hosts can attach one later. */
export const executionTracer = trace.getTracer('payscope.execution');

export function isTransientNetworkError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  return /fetch failed|Gateway Timeout|504|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket hang up|network timeout/i.test(`${name} ${message}`);
}
