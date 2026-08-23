import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import WebSocket from 'ws';
import { createRuntimeConfig, RuntimeConfig } from '../config/runtime-config';

// The worker, API, model, and Razorpay requests all have bounded work. Apply
// the same ceiling to Supabase's HTTP transport so a network stall cannot keep
// a queue lease or request handler alive indefinitely.
const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;

function boundedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): ReturnType<typeof fetch> {
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  const callerSignal = init?.signal;
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}

/**
 * The MVP uses the service-role client only on the VPS. Browser code never
 * receives this client or either credential.
 */
export function createDatabaseClient(config: RuntimeConfig = createRuntimeConfig()): SupabaseClient | undefined {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return undefined;
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // supabase-js creates its Realtime client eagerly, even though this MVP
    // does not subscribe to Realtime channels. Node 20/21 have no native
    // WebSocket, so supply the server implementation explicitly.
    realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
    global: { fetch: boundedFetch },
  });
}

export function requireDatabaseClient(config: RuntimeConfig = createRuntimeConfig()): SupabaseClient {
  const client = createDatabaseClient(config);
  if (!client) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the durable PayScope MVP pipeline');
  return client;
}
