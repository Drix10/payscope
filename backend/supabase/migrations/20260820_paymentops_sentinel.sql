create table if not exists public.webhook_events (
  event_id text primary key,
  source text not null check (source in ('webhook', 'history_import')),
  event_type text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  payment_id text,
  order_id text,
  subscription_id text,
  customer_reference text not null,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  amount_paise bigint check (amount_paise is null or amount_paise >= 0),
  payment_status text,
  payment_method text,
  summary text not null,
  raw_payload jsonb not null check (octet_length(raw_payload::text) <= 16384),
  created_at timestamptz not null default now()
);
create index if not exists webhook_events_occurred_at_idx on public.webhook_events (occurred_at desc);
create index if not exists webhook_events_payment_id_idx on public.webhook_events (payment_id);
create index if not exists webhook_events_order_id_idx on public.webhook_events (order_id);
create index if not exists webhook_events_subscription_id_idx on public.webhook_events (subscription_id);

create table if not exists public.incidents (
  incident_id text primary key,
  incident_type text not null check (incident_type in ('payment_failure', 'refund_failure', 'payment_dispute', 'subscription_risk')),
  status text not null check (status in ('needs_review', 'monitoring', 'recovered', 'escalated', 'dismissed')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  title text not null,
  customer_reference text not null,
  payment_method text,
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  amount_at_risk_paise bigint not null default 0 check (amount_at_risk_paise >= 0),
  recovered_amount_paise bigint not null default 0 check (recovered_amount_paise >= 0 and recovered_amount_paise <= amount_at_risk_paise),
  event_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(event_ids) = 'array' and jsonb_array_length(event_ids) <= 100),
  event_count integer not null default 0 check (event_count >= jsonb_array_length(event_ids)),
  summary text not null,
  action_proposal jsonb,
  operator_action jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  latest_event_at timestamptz not null
);
create index if not exists incidents_status_updated_at_idx on public.incidents (status, updated_at desc);

create table if not exists public.agent_runs (
  run_id text primary key,
  incident_id text not null references public.incidents(incident_id) on delete cascade,
  status text not null check (status in ('completed', 'failed')),
  provider text not null check (provider in ('rules-v1', 'model')),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  incident_summary text not null,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  evidence_event_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_event_ids) = 'array' and jsonb_array_length(evidence_event_ids) <= 30),
  observed_pattern text not null,
  impact jsonb not null check (jsonb_typeof(impact) = 'object'),
  recommended_action jsonb not null check (jsonb_typeof(recommended_action) = 'object'),
  missing_context jsonb not null default '[]'::jsonb check (jsonb_typeof(missing_context) = 'array' and jsonb_array_length(missing_context) <= 10),
  error_message text
);
create index if not exists agent_runs_incident_id_idx on public.agent_runs (incident_id, completed_at desc);

create table if not exists public.audit_logs (
  audit_id text primary key,
  incident_id text not null references public.incidents(incident_id) on delete cascade,
  occurred_at timestamptz not null,
  actor text not null check (actor in ('system', 'agent', 'operator')),
  action text not null,
  detail text not null
);
create index if not exists audit_logs_incident_id_idx on public.audit_logs (incident_id, occurred_at desc);

create or replace function public.paymentops_persist_incident_with_audit(incident_payload jsonb, audit_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.incidents (
    incident_id, incident_type, status, severity, title, customer_reference,
    payment_method, currency, amount_at_risk_paise, recovered_amount_paise,
    event_ids, event_count, summary, action_proposal, operator_action,
    created_at, updated_at, latest_event_at
  ) values (
    incident_payload->>'incident_id', incident_payload->>'incident_type', incident_payload->>'status', incident_payload->>'severity',
    incident_payload->>'title', incident_payload->>'customer_reference', incident_payload->>'payment_method', incident_payload->>'currency',
    (incident_payload->>'amount_at_risk_paise')::bigint, (incident_payload->>'recovered_amount_paise')::bigint,
    incident_payload->'event_ids', (incident_payload->>'event_count')::integer, incident_payload->>'summary',
    incident_payload->'action_proposal', incident_payload->'operator_action',
    (incident_payload->>'created_at')::timestamptz, (incident_payload->>'updated_at')::timestamptz, (incident_payload->>'latest_event_at')::timestamptz
  ) on conflict (incident_id) do update set
    incident_type = excluded.incident_type,
    status = excluded.status,
    severity = excluded.severity,
    title = excluded.title,
    customer_reference = excluded.customer_reference,
    payment_method = excluded.payment_method,
    currency = excluded.currency,
    amount_at_risk_paise = excluded.amount_at_risk_paise,
    recovered_amount_paise = excluded.recovered_amount_paise,
    event_ids = excluded.event_ids,
    event_count = excluded.event_count,
    summary = excluded.summary,
    action_proposal = excluded.action_proposal,
    operator_action = excluded.operator_action,
    updated_at = excluded.updated_at,
    latest_event_at = excluded.latest_event_at;

  insert into public.audit_logs (audit_id, incident_id, occurred_at, actor, action, detail)
  values (
    audit_payload->>'audit_id', audit_payload->>'incident_id', (audit_payload->>'occurred_at')::timestamptz,
    audit_payload->>'actor', audit_payload->>'action', audit_payload->>'detail'
  );
end;
$$;

revoke all on function public.paymentops_persist_incident_with_audit(jsonb, jsonb) from public;
grant execute on function public.paymentops_persist_incident_with_audit(jsonb, jsonb) to service_role;

create or replace function public.paymentops_persist_investigation_with_incident_audit(incident_payload jsonb, investigation_payload jsonb, audit_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.paymentops_persist_incident_with_audit(incident_payload, audit_payload);

  insert into public.agent_runs (
    run_id, incident_id, status, provider, started_at, completed_at,
    incident_summary, severity, confidence, evidence_event_ids,
    observed_pattern, impact, recommended_action, missing_context, error_message
  ) values (
    investigation_payload->>'run_id', investigation_payload->>'incident_id', investigation_payload->>'status', investigation_payload->>'provider',
    (investigation_payload->>'started_at')::timestamptz, (investigation_payload->>'completed_at')::timestamptz,
    investigation_payload->>'incident_summary', investigation_payload->>'severity', (investigation_payload->>'confidence')::numeric,
    investigation_payload->'evidence_event_ids', investigation_payload->>'observed_pattern', investigation_payload->'impact',
    investigation_payload->'recommended_action', investigation_payload->'missing_context', investigation_payload->>'error_message'
  ) on conflict (run_id) do update set
    status = excluded.status,
    provider = excluded.provider,
    started_at = excluded.started_at,
    completed_at = excluded.completed_at,
    incident_summary = excluded.incident_summary,
    severity = excluded.severity,
    confidence = excluded.confidence,
    evidence_event_ids = excluded.evidence_event_ids,
    observed_pattern = excluded.observed_pattern,
    impact = excluded.impact,
    recommended_action = excluded.recommended_action,
    missing_context = excluded.missing_context,
    error_message = excluded.error_message;
end;
$$;

revoke all on function public.paymentops_persist_investigation_with_incident_audit(jsonb, jsonb, jsonb) from public;
grant execute on function public.paymentops_persist_investigation_with_incident_audit(jsonb, jsonb, jsonb) to service_role;

alter table public.webhook_events enable row level security;
alter table public.incidents enable row level security;
alter table public.agent_runs enable row level security;
alter table public.audit_logs enable row level security;

-- The API accesses these tables using the Supabase service-role key only. Add
-- organization-scoped policies before exposing direct browser database access.
