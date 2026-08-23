import pino from 'pino';
import { Counter, Registry } from 'prom-client';
import { trace } from '@opentelemetry/api';

export const logger = pino({
  level: process.env.LOG_LEVEL?.trim() || 'info',
  redact: { paths: ['email', 'recipient', 'authorization', 'headers.authorization', 'smtp.pass', 'razorpayKeySecret'], censor: '[REDACTED]' },
});

export const metrics = new Registry();
export const executionAttempts = new Counter({ name: 'payscope_execution_attempts_total', help: 'Direct execution attempts by capability and terminal outcome.', labelNames: ['capability', 'outcome'] as const, registers: [metrics] });
/** No exporter is required for local/VPS operation; hosts can attach one later. */
export const executionTracer = trace.getTracer('payscope.execution');
