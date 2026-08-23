-- Direct-execution Phase A: immutable action commands, transactional outbox,
-- server-encrypted email recipients, and compact long-term incident memory.
-- Existing migration files remain immutable; this migration supersedes their
-- simulated runtime through new tables and forward-compatible constraints.

create table if not exists public.payscope_recipient_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  customer_hash text not null check (customer_hash ~ '^[a-f0-9]{64}$'),
  email_envelope jsonb not null check (jsonb_typeof(email_envelope) = 'object'),
  key_version smallint not null default 1 check (key_version > 0),
  email_consent boolean not null default false,
  suppressed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_hash)
);
create index if not exists payscope_recipient_emails_eligible_idx on public.payscope_recipient_emails (organization_id, customer_hash) where email_consent and suppressed_at is null;

create table if not exists public.payscope_execution_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  incident_id uuid not null references public.payscope_incidents(id) on delete cascade,
  proposal_id uuid references public.payscope_action_proposals(id) on delete set null,
  capability text not null check (capability in ('deliver_recovery_link_email', 'capture_authorized_payment', 'refund_payment', 'submit_dispute_evidence', 'record_risk_signal', 'resolve_infrastructure')),
  command_key text not null check (char_length(command_key) between 1 and 240),
  command_payload jsonb not null check (jsonb_typeof(command_payload) = 'object' and octet_length(command_payload::text) <= 4096),
  command_payload_hash text not null check (command_payload_hash ~ '^[a-f0-9]{64}$'),
  canonical_payment_id text,
  canonical_order_id text,
  amount_paise integer check (amount_paise is null or amount_paise >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  state text not null default 'queued' check (state in ('queued', 'dispatching', 'accepted', 'unreconciled', 'confirmed', 'retry_scheduled', 'compensating', 'failed', 'cancelled')),
  retry_count integer not null default 0 check (retry_count >= 0 and retry_count <= 3),
  next_reconciliation_at timestamptz,
  terminal_reason text,
  provider_object_id text,
  email_send_started_at timestamptz,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, command_key),
  unique (organization_id, proposal_id)
);
create index if not exists payscope_execution_actions_incident_idx on public.payscope_execution_actions (organization_id, incident_id, created_at desc);
create index if not exists payscope_execution_actions_state_idx on public.payscope_execution_actions (state, next_reconciliation_at);

create table if not exists public.payscope_execution_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  action_id uuid not null references public.payscope_execution_actions(id) on delete cascade,
  command_type text not null check (command_type in ('deliver_recovery_link_email')),
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'dead')),
  attempt_number integer not null default 1 check (attempt_number between 1 and 4),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action_id, command_type)
);
create index if not exists payscope_execution_outbox_due_idx on public.payscope_execution_outbox (status, next_attempt_at, created_at);

create table if not exists public.payscope_execution_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  action_id uuid not null references public.payscope_execution_actions(id) on delete cascade,
  provider text not null check (provider in ('razorpay', 'smtp')),
  receipt_kind text not null check (receipt_kind in ('payment_link_created', 'smtp_accepted', 'smtp_rejected', 'unreconciled', 'payment_link_paid', 'failed')),
  provider_operation_id text,
  receipt_hash text not null check (receipt_hash ~ '^[a-f0-9]{64}$'),
  redacted_payload jsonb not null check (jsonb_typeof(redacted_payload) = 'object' and octet_length(redacted_payload::text) <= 4096),
  created_at timestamptz not null default now(),
  unique (organization_id, action_id, provider, receipt_kind, receipt_hash)
);
create index if not exists payscope_execution_receipts_action_idx on public.payscope_execution_receipts (organization_id, action_id, created_at);

create table if not exists public.payscope_incident_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  incident_id uuid not null references public.payscope_incidents(id) on delete cascade,
  memory_type text not null check (memory_type in ('event_summary', 'investigation', 'execution', 'customer_message', 'customer_reply')),
  source_id text not null check (char_length(source_id) between 1 and 160),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 4096),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  importance smallint not null default 50 check (importance between 0 and 100),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, incident_id, memory_type, source_id, content_hash)
);
create index if not exists payscope_incident_memory_recent_idx on public.payscope_incident_memory (organization_id, incident_id, importance desc, created_at desc);

alter table public.payscope_recipient_emails enable row level security;
alter table public.payscope_execution_actions enable row level security;
alter table public.payscope_execution_outbox enable row level security;
alter table public.payscope_execution_receipts enable row level security;
alter table public.payscope_incident_memory enable row level security;
-- These tables are intentionally server-only. RLS stays enabled and no
-- authenticated/table policy is created: dashboard data is projected through
-- the API, while recipient envelopes and execution records never reach a
-- browser client. The service role used by the VPS bypasses RLS.

create or replace function public.payscope_policy_context(
  p_organization_id uuid,
  p_incident_id uuid,
  p_customer_hash text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare policy_row public.payscope_merchant_policies; incident_attempts integer := 0; attempts_24h integer := 0; attempts_7d integer := 0; daily_incidents integer := 0; daily_auto_resolved integer := 0; email_eligible boolean := false;
begin
  select * into policy_row from public.payscope_merchant_policies where organization_id = p_organization_id;
  if not found or not exists (select 1 from public.payscope_incidents where id = p_incident_id and organization_id = p_organization_id) then raise exception 'PayScope policy context is outside organization'; end if;
  if p_customer_hash is not null then
    select count(*) into incident_attempts from public.payscope_contact_attempts where organization_id = p_organization_id and incident_id = p_incident_id;
    select count(*) into attempts_24h from public.payscope_contact_attempts where organization_id = p_organization_id and customer_hash = p_customer_hash and attempted_at >= now() - interval '24 hours';
    select count(*) into attempts_7d from public.payscope_contact_attempts where organization_id = p_organization_id and customer_hash = p_customer_hash and attempted_at >= now() - interval '7 days';
    select exists(select 1 from public.payscope_recipient_emails where organization_id = p_organization_id and customer_hash = p_customer_hash and email_consent and suppressed_at is null) into email_eligible;
  end if;
  select count(*) into daily_incidents from public.payscope_incidents where organization_id = p_organization_id and opened_at >= date_trunc('day', now());
  select count(*) into daily_auto_resolved from public.payscope_audit_entries where organization_id = p_organization_id and created_at >= date_trunc('day', now()) and decision in ('auto_with_proposals', 'auto_no_action');
  return jsonb_build_object('policy', jsonb_build_object('id', policy_row.id, 'enabled', policy_row.enabled, 'minimumConfidence', policy_row.minimum_confidence, 'rootCauses', policy_row.root_causes, 'allowedActions', policy_row.allowed_actions, 'merchantOptedIn', policy_row.merchant_opted_in_to_recovery),
    'stats', jsonb_build_object('autoResolveFraction', case when daily_incidents = 0 then 0 else least(1, daily_auto_resolved::numeric / daily_incidents) end),
    'contact', jsonb_build_object('incidentAttempts', incident_attempts, 'attemptsLast24Hours', attempts_24h, 'attemptsLast7Days', attempts_7d, 'merchantOptedIn', policy_row.merchant_opted_in_to_recovery, 'customerReferenceAvailable', email_eligible));
end;
$$;
revoke all on function public.payscope_policy_context(uuid, uuid, text) from public;
grant execute on function public.payscope_policy_context(uuid, uuid, text) to service_role;

create or replace function public.payscope_reject_execution_command_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.dispatched_at is not null and (
    new.command_payload is distinct from old.command_payload or
    new.command_payload_hash is distinct from old.command_payload_hash or
    new.canonical_payment_id is distinct from old.canonical_payment_id or
    new.canonical_order_id is distinct from old.canonical_order_id or
    new.amount_paise is distinct from old.amount_paise or
    new.currency is distinct from old.currency or
    new.command_key is distinct from old.command_key
  ) then raise exception 'PayScope dispatched execution commands are immutable'; end if;
  if old.state in ('confirmed', 'failed', 'cancelled') and new.state is distinct from old.state then raise exception 'PayScope terminal execution action cannot transition'; end if;
  return new;
end;
$$;
drop trigger if exists payscope_execution_actions_immutable on public.payscope_execution_actions;
create trigger payscope_execution_actions_immutable before update on public.payscope_execution_actions for each row execute function public.payscope_reject_execution_command_mutation();

create or replace function public.payscope_claim_execution_outbox(p_worker_id text)
returns table(id uuid, organization_id uuid, action_id uuid, command_type text, attempt_number integer)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with candidate as (
    select o.id from public.payscope_execution_outbox o
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'running' and o.locked_at < now() - interval '60 seconds')
    order by o.next_attempt_at, o.created_at
    for update skip locked limit 1
  )
  update public.payscope_execution_outbox o set status = 'running', locked_at = now(), locked_by = left(p_worker_id, 160), updated_at = now()
  from candidate where o.id = candidate.id
  returning o.id, o.organization_id, o.action_id, o.command_type, o.attempt_number;
end;
$$;
revoke all on function public.payscope_claim_execution_outbox(text) from public;
grant execute on function public.payscope_claim_execution_outbox(text) to service_role;

create or replace function public.payscope_enqueue_recovery_email_action(
  p_organization_id uuid,
  p_incident_id uuid,
  p_proposal_id uuid,
  p_command_key text,
  p_command_payload jsonb,
  p_command_payload_hash text,
  p_payment_id text,
  p_order_id text,
  p_amount_paise integer,
  p_currency text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare action_id uuid;
declare customer_hash_value text;
declare incident_attempts integer;
declare attempts_24h integer;
declare attempts_7d integer;
begin
  if jsonb_typeof(p_command_payload) <> 'object' or p_command_payload_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid execution command payload'; end if;
  if char_length(p_command_key) < 1 or char_length(p_command_key) > 240 then raise exception 'Invalid execution command key'; end if;
  if p_amount_paise is null or p_amount_paise < 100 or p_currency !~ '^[A-Z]{3}$' then raise exception 'Invalid recovery amount or currency'; end if;
  if not exists (select 1 from public.payscope_incidents where id = p_incident_id and organization_id = p_organization_id) then raise exception 'Execution incident is outside organization'; end if;
  customer_hash_value := p_command_payload->>'customerHash';
  if customer_hash_value is null or customer_hash_value !~ '^[a-f0-9]{64}$' then raise exception 'Execution command requires customer hash'; end if;
  select id into action_id from public.payscope_execution_actions where organization_id = p_organization_id and command_key = p_command_key;
  if action_id is not null then return action_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || customer_hash_value, 0));
  -- A competing transaction may have created this command while this caller
  -- waited for the customer-level stopping-rule lock. Re-read after locking
  -- so an idempotent retry returns the original action rather than failing its
  -- unique constraint (or recording another contact attempt).
  select id into action_id from public.payscope_execution_actions where organization_id = p_organization_id and command_key = p_command_key;
  if action_id is not null then return action_id; end if;
  if exists (select 1 from public.payscope_incidents where id = p_incident_id and organization_id = p_organization_id and status in ('DISPUTE_OPENED', 'RESOLVED', 'DISMISSED')) then raise exception 'Execution command cannot contact a terminal incident'; end if;
  if not exists (select 1 from public.payscope_recipient_emails where organization_id = p_organization_id and customer_hash = customer_hash_value and email_consent and suppressed_at is null) then raise exception 'No eligible recipient email exists for execution command'; end if;
  select count(*) into incident_attempts from public.payscope_contact_attempts where organization_id = p_organization_id and incident_id = p_incident_id;
  select count(*) into attempts_24h from public.payscope_contact_attempts where organization_id = p_organization_id and customer_hash = customer_hash_value and attempted_at >= now() - interval '24 hours';
  select count(*) into attempts_7d from public.payscope_contact_attempts where organization_id = p_organization_id and customer_hash = customer_hash_value and attempted_at >= now() - interval '7 days';
  if incident_attempts >= 2 or attempts_24h >= 1 or attempts_7d >= 3 then raise exception 'Execution command violates contact stopping rules'; end if;
  insert into public.payscope_execution_actions (
    organization_id, incident_id, proposal_id, capability, command_key, command_payload, command_payload_hash,
    canonical_payment_id, canonical_order_id, amount_paise, currency
  ) values (
    p_organization_id, p_incident_id, p_proposal_id, 'deliver_recovery_link_email', p_command_key, p_command_payload, p_command_payload_hash,
    nullif(left(p_payment_id, 160), ''), nullif(left(p_order_id, 160), ''), p_amount_paise, p_currency
  ) returning id into action_id;
  insert into public.payscope_contact_attempts (organization_id, customer_hash, incident_id) values (p_organization_id, customer_hash_value, p_incident_id);
  insert into public.payscope_execution_outbox (organization_id, action_id, command_type)
  values (p_organization_id, action_id, 'deliver_recovery_link_email') on conflict (action_id, command_type) do nothing;
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'execution_command_queued', 'system', 'payscope-policy', null,
    'email_recovery_queued', 'A deterministic policy queued one immutable email recovery command.', null,
    jsonb_build_object('action_id', action_id, 'capability', 'deliver_recovery_link_email', 'command_key', p_command_key)
  );
  return action_id;
end;
$$;
revoke all on function public.payscope_enqueue_recovery_email_action(uuid, uuid, uuid, text, jsonb, text, text, text, integer, text) from public;
grant execute on function public.payscope_enqueue_recovery_email_action(uuid, uuid, uuid, text, jsonb, text, text, text, integer, text) to service_role;

create or replace function public.payscope_mark_email_send_started(p_organization_id uuid, p_action_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.payscope_execution_actions execution_action set state = 'dispatching', dispatched_at = coalesce(execution_action.dispatched_at, now()), email_send_started_at = now(), updated_at = now()
  where execution_action.id = p_action_id and execution_action.organization_id = p_organization_id and execution_action.state in ('queued', 'dispatching') and execution_action.email_send_started_at is null
    -- A delayed outbox message must never revive a terminal incident or a
    -- withdrawn recipient consent. Commands are deliberately short-lived;
    -- a later customer contact requires a fresh investigation and policy run.
    and execution_action.created_at > now() - interval '24 hours'
    and exists (
      select 1 from public.payscope_incidents incident
      where incident.id = execution_action.incident_id and incident.organization_id = execution_action.organization_id
        and incident.status not in ('DISPUTE_OPENED', 'RESOLVED', 'DISMISSED')
    )
    and exists (
      select 1 from public.payscope_recipient_emails recipient
      where recipient.organization_id = execution_action.organization_id
        and recipient.customer_hash = execution_action.command_payload->>'customerHash'
        and recipient.email_consent and recipient.suppressed_at is null
    );
  return found;
end;
$$;
revoke all on function public.payscope_mark_email_send_started(uuid, uuid) from public;
grant execute on function public.payscope_mark_email_send_started(uuid, uuid) to service_role;

create or replace function public.payscope_record_execution_receipt(
  p_organization_id uuid,
  p_action_id uuid,
  p_provider text,
  p_receipt_kind text,
  p_provider_operation_id text,
  p_receipt_hash text,
  p_redacted_payload jsonb,
  p_state text,
  p_terminal_reason text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare action_row public.payscope_execution_actions;
begin
  if p_receipt_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_redacted_payload) <> 'object' then raise exception 'Invalid execution receipt'; end if;
  select * into action_row from public.payscope_execution_actions where id = p_action_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Unknown execution action'; end if;
  if action_row.state in ('confirmed', 'failed', 'cancelled') then return; end if;
  insert into public.payscope_execution_receipts (organization_id, action_id, provider, receipt_kind, provider_operation_id, receipt_hash, redacted_payload)
  values (p_organization_id, p_action_id, p_provider, p_receipt_kind, nullif(left(p_provider_operation_id, 320), ''), p_receipt_hash, p_redacted_payload)
  on conflict do nothing;
  update public.payscope_execution_actions set
    state = p_state,
    provider_object_id = coalesce(nullif(left(p_provider_operation_id, 320), ''), provider_object_id),
    terminal_reason = coalesce(nullif(left(p_terminal_reason, 320), ''), terminal_reason),
    completed_at = case when p_state in ('confirmed', 'failed', 'cancelled', 'unreconciled') then now() else completed_at end,
    updated_at = now()
  where id = p_action_id and organization_id = p_organization_id;
  perform public.payscope_append_audit_entry(
    p_organization_id, action_row.incident_id, 'execution_receipt_recorded', 'system', 'payscope-execution', null,
    p_receipt_kind, 'A redacted provider receipt was recorded for the immutable action command.', null,
    jsonb_build_object('action_id', p_action_id, 'provider', p_provider, 'state', p_state)
  );
end;
$$;
revoke all on function public.payscope_record_execution_receipt(uuid, uuid, text, text, text, text, jsonb, text, text) from public;
grant execute on function public.payscope_record_execution_receipt(uuid, uuid, text, text, text, text, jsonb, text, text) to service_role;

-- Keep historical proposal rows readable while allowing the new email-only
-- capability to be persisted during the compatibility window.
alter table public.payscope_action_proposals drop constraint if exists payscope_action_proposals_action_type_check;
alter table public.payscope_action_proposals add constraint payscope_action_proposals_action_type_check
  check (action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script', 'merchant_email_notification', 'merchant_webhook_notification', 'flag_for_review', 'prepare_chargeback_evidence', 'auto_resolve_infrastructure', 'deliver_recovery_link_email', 'record_risk_signal', 'submit_dispute_evidence', 'capture_authorized_payment', 'refund_payment', 'resolve_infrastructure'));

create or replace function public.payscope_persist_direct_investigation(
  p_organization_id uuid,
  p_incident_id uuid,
  p_trigger_event_id uuid,
  p_plan jsonb,
  p_risk_analysis jsonb,
  p_recovery_plan jsonb,
  p_policy_decision jsonb,
  p_proposals jsonb,
  p_model_id text,
  p_tokens_used integer,
  p_latency_ms integer
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare proposal jsonb; proposal_id uuid; proposal_action text; persisted_investigation_id uuid;
declare policy_outcome text; no_action_reason text; latest_event public.payscope_events;
declare command_payload jsonb; customer_hash_value text;
begin
  if p_trigger_event_id is null or p_tokens_used < 0 or p_latency_ms < 0 or jsonb_typeof(p_proposals) <> 'array' then raise exception 'Invalid direct investigation payload'; end if;
  if not exists (select 1 from public.payscope_events where id = p_trigger_event_id and organization_id = p_organization_id) then raise exception 'Direct investigation trigger is outside organization'; end if;
  policy_outcome := coalesce(p_policy_decision->>'outcome', 'auto_no_action');
  if policy_outcome not in ('auto_with_proposals', 'auto_no_action') then raise exception 'Invalid direct policy outcome'; end if;
  no_action_reason := nullif(left(coalesce(p_policy_decision->>'noActionReason', ''), 120), '');
  insert into public.payscope_investigations (organization_id, incident_id, trigger_event_id, status, plan, risk_analysis, recovery_plan, policy_decision, model_id, tokens_used, latency_ms, started_at, completed_at)
  values (p_organization_id, p_incident_id, p_trigger_event_id, 'COMPLETE', p_plan, p_risk_analysis, p_recovery_plan, p_policy_decision, left(p_model_id, 160), p_tokens_used, p_latency_ms, now(), now())
  on conflict (organization_id, incident_id, trigger_event_id) where trigger_event_id is not null do nothing returning id into persisted_investigation_id;
  if persisted_investigation_id is null then return; end if;
  update public.payscope_incidents set status = case when status = 'DISPUTE_OPENED' then status when policy_outcome = 'auto_no_action' then 'DISMISSED' else status end,
    resolved_at = case when status = 'DISPUTE_OPENED' then resolved_at when policy_outcome = 'auto_no_action' then now() else resolved_at end, updated_at = now()
  where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'Direct investigation incident was not found'; end if;
  perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'policy_decision_recorded', 'system', 'payscope-policy', null, policy_outcome,
    coalesce(no_action_reason, 'Deterministic policy permitted direct execution.'), (p_risk_analysis->>'confidence')::numeric,
    jsonb_build_object('trigger_event_id', p_trigger_event_id, 'matched_policy_id', p_policy_decision->>'matchedPolicyId', 'permitted_action_count', jsonb_array_length(coalesce(p_policy_decision->'permittedActions', '[]'::jsonb))));
  if policy_outcome = 'auto_with_proposals' then
    select * into latest_event from public.payscope_events where organization_id = p_organization_id and id = any((select correlated_event_ids from public.payscope_incidents where id = p_incident_id)) order by (normalized->>'occurredAt')::timestamptz desc, id desc limit 1;
    for proposal in select value from jsonb_array_elements(p_proposals) loop
      proposal_id := (proposal->>'id')::uuid; proposal_action := proposal->>'action_type';
      if proposal_id is null or proposal_action not in ('deliver_recovery_link_email', 'record_risk_signal', 'resolve_infrastructure') then raise exception 'Invalid Phase-A direct proposal action'; end if;
      insert into public.payscope_action_proposals (id, organization_id, incident_id, action_type, content) values (proposal_id, p_organization_id, p_incident_id, proposal_action, coalesce(proposal->'content', '{}'::jsonb));
      if proposal_action = 'deliver_recovery_link_email' then
        customer_hash_value := latest_event.normalized->>'customerHash';
        if customer_hash_value is null or latest_event.normalized->>'currency' is null then
          update public.payscope_action_proposals set status = 'failed', delivery_result = jsonb_build_object('reason', 'Missing canonical recipient/payment context.') where id = proposal_id;
          perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'execution_command_blocked', 'system', 'payscope-policy', null, 'missing_canonical_context', 'Direct email action was blocked because canonical recipient or currency context was unavailable.', null, jsonb_build_object('proposal_id', proposal_id));
        elsif not exists (select 1 from public.payscope_recipient_emails where organization_id = p_organization_id and customer_hash = customer_hash_value and email_consent and suppressed_at is null) then
          update public.payscope_action_proposals set status = 'failed', delivery_result = jsonb_build_object('reason', 'No eligible encrypted recipient email.') where id = proposal_id;
          perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'execution_command_blocked', 'system', 'payscope-policy', null, 'missing_email_consent', 'Direct email action was blocked because no opted-in encrypted email record exists.', null, jsonb_build_object('proposal_id', proposal_id));
        else
          command_payload := jsonb_build_object('customerHash', customer_hash_value, 'referenceId', 'ps_' || replace(proposal_id::text, '-', ''), 'copyIntent', left(coalesce(proposal->'content'->>'emailCopyIntent', 'Your payment could not be completed. Please use this secure link to try again.'), 600));
          perform public.payscope_enqueue_recovery_email_action(p_organization_id, p_incident_id, proposal_id, p_organization_id::text || ':deliver_recovery_link_email:' || proposal_id::text,
            command_payload, encode(extensions.digest(command_payload::text, 'sha256'), 'hex'), latest_event.normalized->>'paymentId', latest_event.normalized->>'orderId',
            (select remaining_amount_paise from public.payscope_incidents where id = p_incident_id), latest_event.normalized->>'currency');
        end if;
      else
        perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'execution_command_recorded', 'system', 'payscope-policy', null, proposal_action,
          coalesce(proposal->>'rationale', 'Validated autonomous internal action recorded.'), (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('proposal_id', proposal_id));
      end if;
    end loop;
  elsif jsonb_array_length(p_proposals) <> 0 then raise exception 'Direct proposals require auto_with_proposals';
  else perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'autonomous_no_action_recorded', 'system', 'payscope-policy', null, 'no_action_terminalized', coalesce(no_action_reason, 'The deterministic policy allowed no autonomous action.'), (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('trigger_event_id', p_trigger_event_id));
  end if;
  insert into public.payscope_incident_memory (organization_id, incident_id, memory_type, source_id, content, content_hash, importance)
  values (p_organization_id, p_incident_id, 'investigation', persisted_investigation_id::text,
    jsonb_build_object('failureRootCause', p_risk_analysis->>'failureRootCause', 'policyOutcome', policy_outcome, 'actionCount', jsonb_array_length(p_proposals)),
    encode(extensions.digest(jsonb_build_object('failureRootCause', p_risk_analysis->>'failureRootCause', 'policyOutcome', policy_outcome, 'actionCount', jsonb_array_length(p_proposals))::text, 'sha256'), 'hex'), 80);
  perform public.payscope_append_audit_entry(p_organization_id, p_incident_id, 'investigation_completed', 'system', 'payscope-worker', null, policy_outcome, coalesce(no_action_reason, 'Validated direct-execution investigation completed.'), (p_risk_analysis->>'confidence')::numeric, jsonb_build_object('trigger_event_id', p_trigger_event_id));
end;
$$;
revoke all on function public.payscope_persist_direct_investigation(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) from public;
grant execute on function public.payscope_persist_direct_investigation(uuid, uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, integer, integer) to service_role;
