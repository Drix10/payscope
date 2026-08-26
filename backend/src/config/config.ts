export const STOPPING_RULES = {
  MAX_CONTACT_ATTEMPTS_PER_INCIDENT: 2,
  MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_24H: 1,
  MAX_CONTACT_ATTEMPTS_PER_CUSTOMER_PER_7D: 3,
  NO_CONTACT_AFTER_DISPUTE_OPENED: true,
  NO_CONTACT_ON_FRAUD_CONFIRMED: true,
  NO_CONTACT_WITHOUT_MERCHANT_OPT_IN: true,
  AUTO_RESOLVE_RATE_CEILING_PER_ORG_PER_DAY: 0.90,
  MAX_STEPS_PER_SAGA: 15,
} as const;

export const RECOVERY_WINDOW_MS = 72 * 60 * 60 * 1_000;
export const WEBHOOK_ACK_TARGET_MS = 500;
export const ENRICHMENT_TIMEOUT_MS = 5_000;
export const MODEL_TIMEOUT_MS = 25_000;
export const QUEUE_LOCK_TIMEOUT_MS = 45_000;
export const QUEUE_RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 300_000, 900_000] as const;

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
  callbackEncryptionKey?: string;
  /** dashboardApiKeys[0] is the active key; any further entries are previous keys still accepted during rotation. */
  dashboardApiKeys: string[];
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
  const callbackEncryptionKey = optional(env.PAYSCOPE_CALLBACK_ENCRYPTION_KEY);
  if (callbackEncryptionKey && Buffer.from(callbackEncryptionKey, 'base64').length !== 32) throw new Error('PAYSCOPE_CALLBACK_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  const dashboardApiKey = optional(env.PAYSCOPE_DASHBOARD_API_KEY);
  const previousDashboardApiKey = optional(env.PAYSCOPE_DASHBOARD_API_KEY_PREVIOUS);
  if (declaredEnvironment === 'production' && (!dashboardApiKey || dashboardApiKey.length < 24)) throw new Error('Production PayScope API requires PAYSCOPE_DASHBOARD_API_KEY of at least 24 characters');
  if (previousDashboardApiKey && previousDashboardApiKey.length < 24) throw new Error('PAYSCOPE_DASHBOARD_API_KEY_PREVIOUS must be at least 24 characters');
  if (previousDashboardApiKey && !dashboardApiKey) throw new Error('PAYSCOPE_DASHBOARD_API_KEY_PREVIOUS requires PAYSCOPE_DASHBOARD_API_KEY');
  // Rotation: the active key is accepted alongside one bounded previous key
  // so merchants can replace a credential without an availability gap.
  // The key binds to exactly the organization configured for this process;
  // multi-tenant deployments must issue per-tenant keys behind separate
  // processes until a merchant-authenticated control plane exists.
  const dashboardApiKeys = [dashboardApiKey, previousDashboardApiKey].filter((key): key is string => Boolean(key));
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
    callbackEncryptionKey,
    dashboardApiKeys,
    smtp: directSmtp,
  };
}
