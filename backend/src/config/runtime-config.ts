import { ENRICHMENT_TIMEOUT_MS, MODEL_TIMEOUT_MS, QUEUE_LOCK_TIMEOUT_MS, RECOVERY_WINDOW_MS } from './stopping-rules';

export type RuntimeConfig = {
  environment: 'development' | 'test' | 'production';
  razorpayEnvironment: 'test' | 'live';
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  webhookSecret?: string;
  previousWebhookSecret?: string;
  organizationId?: string;
  workerId: string;
  enrichmentTimeoutMs: number;
  modelTimeoutMs: number;
  queueLockTimeoutMs: number;
  recoveryWindowMs: number;
  directExecutionEnabled: boolean;
  executionPollIntervalMs: number;
  emailEncryptionKey?: string;
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    maxConnections: number;
  };
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

function boolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (!value?.trim()) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function smtpConfig(env: NodeJS.ProcessEnv): RuntimeConfig['smtp'] | undefined {
  const host = optional(env.SMTP_HOST);
  const user = optional(env.SMTP_USER);
  const pass = optional(env.SMTP_PASS);
  const from = optional(env.MAIL_FROM);
  if (![host, user, pass, from].some(Boolean)) return undefined;
  if (!host || !user || !pass || !from) throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM must be configured together');
  if (host.length > 253 || user.length > 320 || pass.length > 1_024 || from.length > 320 || /[\r\n]/.test(from)) throw new Error('SMTP configuration contains an invalid field length');
  return {
    host,
    user,
    pass,
    from,
    port: positiveInteger(env.SMTP_PORT, 587, 'SMTP_PORT'),
    secure: boolean(env.SMTP_SECURE, false, 'SMTP_SECURE'),
    maxConnections: positiveInteger(env.SMTP_POOL_MAX_CONNECTIONS, 2, 'SMTP_POOL_MAX_CONNECTIONS'),
  };
}

/** Parses the Razorpay ingestion environment without granting financial actions. */
export function createRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const declaredEnvironment = optional(env.NODE_ENV) ?? 'development';
  if (!['development', 'test', 'production'].includes(declaredEnvironment)) throw new Error('NODE_ENV must be development, test, or production');
  const razorpayEnvironment = optional(env.RAZORPAY_ENVIRONMENT) ?? 'test';
  if (razorpayEnvironment !== 'test' && razorpayEnvironment !== 'live') throw new Error('RAZORPAY_ENVIRONMENT must be test or live');
  const razorpayKeyId = optional(env.RAZORPAY_KEY_ID);
  if (razorpayKeyId && !razorpayKeyId.startsWith(`rzp_${razorpayEnvironment}_`)) throw new Error(`RAZORPAY_KEY_ID does not match RAZORPAY_ENVIRONMENT=${razorpayEnvironment}`);

  const directExecutionEnabled = boolean(env.PAYSCOPE_DIRECT_EXECUTION_ENABLED, false, 'PAYSCOPE_DIRECT_EXECUTION_ENABLED');
  const directSmtp = smtpConfig(env);
  const emailEncryptionKey = optional(env.PAYSCOPE_EMAIL_ENCRYPTION_KEY);
  if (directExecutionEnabled) {
    if (!razorpayKeyId || !optional(env.RAZORPAY_KEY_SECRET)) throw new Error('Direct execution requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
    if (!directSmtp) throw new Error('Direct execution requires SMTP configuration');
    if (!emailEncryptionKey) throw new Error('Direct execution requires PAYSCOPE_EMAIL_ENCRYPTION_KEY');
    if (Buffer.from(emailEncryptionKey, 'base64').length !== 32) throw new Error('PAYSCOPE_EMAIL_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }

  return {
    environment: declaredEnvironment as RuntimeConfig['environment'],
    razorpayEnvironment,
    supabaseUrl: optional(env.SUPABASE_URL),
    supabaseServiceRoleKey: optional(env.SUPABASE_SERVICE_ROLE_KEY),
    webhookSecret: optional(env.RAZORPAY_WEBHOOK_SECRET),
    previousWebhookSecret: (() => {
      const prev = optional(env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS);
      if (prev && prev.length < 16) throw new Error('RAZORPAY_WEBHOOK_SECRET_PREVIOUS must be at least 16 characters');
      return prev;
    })(),
    organizationId: optional(env.PAYSCOPE_ORGANIZATION_ID),
    workerId: optional(env.PAYSCOPE_WORKER_ID) ?? `worker-${process.pid}`,
    enrichmentTimeoutMs: positiveInteger(env.PAYSCOPE_ENRICHMENT_TIMEOUT_MS, ENRICHMENT_TIMEOUT_MS, 'PAYSCOPE_ENRICHMENT_TIMEOUT_MS'),
    modelTimeoutMs: positiveInteger(env.PAYSCOPE_MODEL_TIMEOUT_MS, MODEL_TIMEOUT_MS, 'PAYSCOPE_MODEL_TIMEOUT_MS'),
    queueLockTimeoutMs: positiveInteger(env.PAYSCOPE_QUEUE_LOCK_TIMEOUT_MS, QUEUE_LOCK_TIMEOUT_MS, 'PAYSCOPE_QUEUE_LOCK_TIMEOUT_MS'),
    recoveryWindowMs: positiveInteger(env.PAYSCOPE_RECOVERY_WINDOW_MS, RECOVERY_WINDOW_MS, 'PAYSCOPE_RECOVERY_WINDOW_MS'),
    directExecutionEnabled,
    executionPollIntervalMs: positiveInteger(env.PAYSCOPE_EXECUTION_POLL_INTERVAL_MS, 2_000, 'PAYSCOPE_EXECUTION_POLL_INTERVAL_MS'),
    emailEncryptionKey,
    smtp: directSmtp,
  };
}
