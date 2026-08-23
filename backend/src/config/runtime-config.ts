import { ENRICHMENT_TIMEOUT_MS, MODEL_TIMEOUT_MS, QUEUE_LOCK_TIMEOUT_MS, RECOVERY_WINDOW_MS } from './stopping-rules';

export type RuntimeConfig = {
  environment: 'development' | 'test' | 'production';
  razorpayEnvironment: 'test' | 'live';
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  webhookSecret?: string;
  organizationId?: string;
  workerId: string;
  enrichmentTimeoutMs: number;
  modelTimeoutMs: number;
  queueLockTimeoutMs: number;
  recoveryWindowMs: number;
};

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function boundedText(value: string | undefined, fallback: string, name: string): string {
  const parsed = optional(value) ?? fallback;
  if (parsed.length > 160) throw new Error(`${name} must be at most 160 characters`);
  return parsed;
}

/** Parses the Razorpay ingestion environment without granting financial actions. */
export function createRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const declaredEnvironment = optional(env.NODE_ENV) ?? 'development';
  if (!['development', 'test', 'production'].includes(declaredEnvironment)) throw new Error('NODE_ENV must be development, test, or production');
  const razorpayEnvironment = optional(env.RAZORPAY_ENVIRONMENT) ?? 'test';
  if (razorpayEnvironment !== 'test' && razorpayEnvironment !== 'live') throw new Error('RAZORPAY_ENVIRONMENT must be test or live');
  const razorpayKeyId = optional(env.RAZORPAY_KEY_ID);
  if (razorpayKeyId && !razorpayKeyId.startsWith(`rzp_${razorpayEnvironment}_`)) throw new Error(`RAZORPAY_KEY_ID does not match RAZORPAY_ENVIRONMENT=${razorpayEnvironment}`);

  return {
    environment: declaredEnvironment as RuntimeConfig['environment'],
    razorpayEnvironment,
    supabaseUrl: optional(env.SUPABASE_URL),
    supabaseServiceRoleKey: optional(env.SUPABASE_SERVICE_ROLE_KEY),
    webhookSecret: optional(env.RAZORPAY_WEBHOOK_SECRET),
    organizationId: optional(env.PAYSCOPE_ORGANIZATION_ID),
    workerId: optional(env.PAYSCOPE_WORKER_ID) ?? `worker-${process.pid}`,
    enrichmentTimeoutMs: positiveInteger(env.PAYSCOPE_ENRICHMENT_TIMEOUT_MS, ENRICHMENT_TIMEOUT_MS, 'PAYSCOPE_ENRICHMENT_TIMEOUT_MS'),
    modelTimeoutMs: positiveInteger(env.PAYSCOPE_MODEL_TIMEOUT_MS, MODEL_TIMEOUT_MS, 'PAYSCOPE_MODEL_TIMEOUT_MS'),
    queueLockTimeoutMs: positiveInteger(env.PAYSCOPE_QUEUE_LOCK_TIMEOUT_MS, QUEUE_LOCK_TIMEOUT_MS, 'PAYSCOPE_QUEUE_LOCK_TIMEOUT_MS'),
    recoveryWindowMs: positiveInteger(env.PAYSCOPE_RECOVERY_WINDOW_MS, RECOVERY_WINDOW_MS, 'PAYSCOPE_RECOVERY_WINDOW_MS'),
  };
}
