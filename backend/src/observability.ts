import pino from 'pino';
import { Counter, Registry, Histogram } from 'prom-client';
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
/** No exporter is required for local/VPS operation; hosts can attach one later. */
export const executionTracer = trace.getTracer('payscope.execution');
