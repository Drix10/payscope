-- PayScope agentic MVP foundation.
-- `payscope_` names identify the canonical MVP data model.
-- All webhook/provider work is performed by the VPS service-role client.

create extension if not exists pgcrypto;

create table if not exists public.payscope_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  razorpay_key_id text not null check (char_length(razorpay_key_id) between 1 and 160),
  customer_hash_secret text not null check (char_length(customer_hash_secret) >= 32),
  customer_hash_secret_version smallint not null default 1 check (customer_hash_secret_version > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payscope_users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  email text not null unique check (char_length(email) between 3 and 320),
  display_name text not null check (char_length(display_name) between 1 and 160),
  created_at timestamptz not null default now()
);
create index if not exists payscope_users_organization_idx on public.payscope_users (organization_id);

create table if not exists public.payscope_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  razorpay_event_id text not null check (char_length(razorpay_event_id) between 1 and 160),
  event_type text not null check (char_length(event_type) between 1 and 120),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  normalized jsonb not null check (jsonb_typeof(normalized) = 'object'),
  enrichment jsonb,
  enrichment_source text check (enrichment_source in ('razorpay_fields_heuristic', 'fixture_signed', 'unavailable')),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, razorpay_event_id),
  unique (organization_id, id)
);
create index if not exists payscope_events_org_created_idx on public.payscope_events (organization_id, created_at desc);
create index if not exists payscope_events_org_type_idx on public.payscope_events (organization_id, event_type, created_at desc);

create table if not exists public.payscope_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  risk_tier text not null check (risk_tier in ('CRITICAL', 'HIGH', 'MEDIUM', 'MONITOR')),
  status text not null default 'OPEN' check (status in ('OPEN', 'MONITORING', 'ESCALATED', 'DISPUTE_OPENED', 'RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED')),
  total_failed_amount_paise integer not null check (total_failed_amount_paise >= 0),
  recovered_amount_paise integer not null default 0 check (recovered_amount_paise >= 0 and recovered_amount_paise <= total_failed_amount_paise),
  remaining_amount_paise integer generated always as (total_failed_amount_paise - recovered_amount_paise) stored,
  correlated_event_ids uuid[] not null default '{}'::uuid[] check (cardinality(correlated_event_ids) <= 100),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists payscope_incidents_org_status_idx on public.payscope_incidents (organization_id, status, updated_at desc);

create table if not exists public.payscope_investigations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  incident_id uuid not null references public.payscope_incidents(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED')),
  plan jsonb,
  risk_analysis jsonb,
  recovery_plan jsonb,
  policy_decision jsonb,
  model_id text,
  tokens_used integer check (tokens_used is null or tokens_used >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists payscope_investigations_incident_idx on public.payscope_investigations (organization_id, incident_id, started_at desc);

create table if not exists public.payscope_action_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  incident_id uuid not null references public.payscope_incidents(id) on delete cascade,
  action_type text not null check (action_type in ('retry_link_whatsapp', 'retry_link_sms', 'hinglish_voice_script', 'merchant_email_notification', 'merchant_webhook_notification', 'flag_for_review', 'prepare_chargeback_evidence', 'auto_resolve_infrastructure')),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'simulated', 'cancelled_by_dispute', 'cancelled_by_recovery', 'failed')),
  proposed_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.payscope_users(id),
  delivery_result jsonb
);
create index if not exists payscope_proposals_incident_idx on public.payscope_action_proposals (organization_id, incident_id, proposed_at desc);

create table if not exists public.payscope_audit_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  incident_id uuid references public.payscope_incidents(id) on delete set null,
  sequence_number bigint not null check (sequence_number >= 0),
  event_type text not null check (char_length(event_type) between 1 and 120),
  actor_type text not null check (actor_type in ('system', 'human')),
  actor_id text not null check (char_length(actor_id) between 1 and 160),
  actor_session_hash text check (actor_session_hash is null or actor_session_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check (char_length(decision) between 1 and 240),
  rationale text not null check (char_length(rationale) between 1 and 1_000),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  enrichment_snapshot jsonb,
  prev_entry_hash text not null check (prev_entry_hash ~ '^[a-f0-9]{64}$'),
  entry_hash text not null check (entry_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, sequence_number)
);
create index if not exists payscope_audit_org_sequence_idx on public.payscope_audit_entries (organization_id, sequence_number);

create table if not exists public.payscope_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  customer_hash text not null check (customer_hash ~ '^[a-f0-9]{64}$'),
  incident_id uuid not null references public.payscope_incidents(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists payscope_contact_attempts_lookup_idx on public.payscope_contact_attempts (organization_id, customer_hash, attempted_at desc);

create table if not exists public.payscope_processed_jobs (
  job_key text primary key check (char_length(job_key) between 1 and 240),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  processed_at timestamptz not null default now(),
  result_summary text
);

create table if not exists public.payscope_queue_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.payscope_organizations(id) on delete cascade,
  -- This is deliberately a first-class relation rather than a value that
  -- exists only in payload JSON.  It keeps every pipeline job tenant-bound to
  -- its triggering event and cascades cleanup safely.
  source_event_id uuid not null,
  job_key text not null unique check (char_length(job_key) between 1 and 240),
  job_type text not null check (job_type in ('enrich_event', 'correlate_event', 'investigate_incident')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'running', 'complete', 'failed', 'dead')),
  attempt_number integer not null default 1 check (attempt_number between 1 and 4),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, source_event_id)
    references public.payscope_events(organization_id, id) on delete cascade
);
create index if not exists payscope_queue_jobs_due_idx on public.payscope_queue_jobs (status, next_attempt_at, created_at);
create index if not exists payscope_queue_jobs_source_event_idx on public.payscope_queue_jobs (organization_id, source_event_id);

-- Audit rows never update or delete, including through the service role. A
-- rejecting trigger is deliberate: silently doing nothing could mislead a
-- caller into believing an audit correction was recorded.
create or replace function public.payscope_reject_audit_mutation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'PayScope audit entries are append-only; write a compensating entry instead';
end;
$$;
drop trigger if exists payscope_audit_reject_update on public.payscope_audit_entries;
drop trigger if exists payscope_audit_reject_delete on public.payscope_audit_entries;
create trigger payscope_audit_reject_update before update on public.payscope_audit_entries for each row execute function public.payscope_reject_audit_mutation();
create trigger payscope_audit_reject_delete before delete on public.payscope_audit_entries for each row execute function public.payscope_reject_audit_mutation();

create or replace function public.payscope_current_organization_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select organization_id from public.payscope_users where id = auth.uid()
$$;
revoke all on function public.payscope_current_organization_id() from public;
grant execute on function public.payscope_current_organization_id() to authenticated;

alter table public.payscope_organizations enable row level security;
alter table public.payscope_users enable row level security;
alter table public.payscope_events enable row level security;
alter table public.payscope_incidents enable row level security;
alter table public.payscope_investigations enable row level security;
alter table public.payscope_action_proposals enable row level security;
alter table public.payscope_audit_entries enable row level security;
alter table public.payscope_contact_attempts enable row level security;
alter table public.payscope_processed_jobs enable row level security;
alter table public.payscope_queue_jobs enable row level security;

create policy payscope_org_read on public.payscope_organizations for select to authenticated using (id = public.payscope_current_organization_id());
create policy payscope_user_read on public.payscope_users for select to authenticated using (organization_id = public.payscope_current_organization_id());

create policy payscope_events_isolation on public.payscope_events for all to authenticated using (organization_id = public.payscope_current_organization_id()) with check (organization_id = public.payscope_current_organization_id());
create policy payscope_incidents_isolation on public.payscope_incidents for all to authenticated using (organization_id = public.payscope_current_organization_id()) with check (organization_id = public.payscope_current_organization_id());
create policy payscope_investigations_isolation on public.payscope_investigations for all to authenticated using (organization_id = public.payscope_current_organization_id()) with check (organization_id = public.payscope_current_organization_id());
create policy payscope_proposals_isolation on public.payscope_action_proposals for all to authenticated using (organization_id = public.payscope_current_organization_id()) with check (organization_id = public.payscope_current_organization_id());
create policy payscope_contacts_isolation on public.payscope_contact_attempts for all to authenticated using (organization_id = public.payscope_current_organization_id()) with check (organization_id = public.payscope_current_organization_id());
create policy payscope_processed_jobs_isolation on public.payscope_processed_jobs for all to authenticated using (organization_id = public.payscope_current_organization_id()) with check (organization_id = public.payscope_current_organization_id());
create policy payscope_queue_jobs_isolation on public.payscope_queue_jobs for all to authenticated using (organization_id = public.payscope_current_organization_id()) with check (organization_id = public.payscope_current_organization_id());
create policy payscope_audit_read on public.payscope_audit_entries for select to authenticated using (organization_id = public.payscope_current_organization_id());
create policy payscope_audit_insert on public.payscope_audit_entries for insert to authenticated with check (organization_id = public.payscope_current_organization_id());

create or replace function public.payscope_append_audit_entry(
  p_organization_id uuid,
  p_incident_id uuid,
  p_event_type text,
  p_actor_type text,
  p_actor_id text,
  p_actor_session_hash text,
  p_decision text,
  p_rationale text,
  p_confidence numeric,
  p_enrichment_snapshot jsonb
) returns public.payscope_audit_entries
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous_hash text := encode(extensions.digest('genesis', 'sha256'), 'hex');
  next_sequence bigint := 0;
  entry_json jsonb;
  created_entry public.payscope_audit_entries;
begin
  perform 1 from public.payscope_organizations where id = p_organization_id for update;
  if not found then raise exception 'Unknown PayScope organization'; end if;
  select sequence_number + 1, entry_hash into next_sequence, previous_hash
  from public.payscope_audit_entries where organization_id = p_organization_id
  order by sequence_number desc limit 1;
  if not found then
    next_sequence := 0;
    previous_hash := encode(extensions.digest('genesis', 'sha256'), 'hex');
  end if;
  entry_json := jsonb_build_object('organization_id', p_organization_id, 'incident_id', p_incident_id, 'sequence_number', next_sequence, 'event_type', p_event_type, 'actor_type', p_actor_type, 'actor_id', p_actor_id, 'actor_session_hash', p_actor_session_hash, 'decision', p_decision, 'rationale', p_rationale, 'confidence', p_confidence, 'enrichment_snapshot', p_enrichment_snapshot);
  insert into public.payscope_audit_entries (organization_id, incident_id, sequence_number, event_type, actor_type, actor_id, actor_session_hash, decision, rationale, confidence, enrichment_snapshot, prev_entry_hash, entry_hash)
  values (p_organization_id, p_incident_id, next_sequence, p_event_type, p_actor_type, p_actor_id, p_actor_session_hash, p_decision, p_rationale, p_confidence, p_enrichment_snapshot, previous_hash, encode(extensions.digest(previous_hash || entry_json::text, 'sha256'), 'hex'))
  returning * into created_entry;
  return created_entry;
end;
$$;
revoke all on function public.payscope_append_audit_entry(uuid, uuid, text, text, text, text, text, text, numeric, jsonb) from public;
grant execute on function public.payscope_append_audit_entry(uuid, uuid, text, text, text, text, text, text, numeric, jsonb) to service_role;

create or replace function public.payscope_verify_audit_chain(p_organization_id uuid)
returns table(sequence_number bigint, valid boolean, expected_hash text, actual_hash text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous_hash text := encode(extensions.digest('genesis', 'sha256'), 'hex');
  expected_sequence bigint := 0;
  audit_row public.payscope_audit_entries;
  entry_json jsonb;
  calculated_hash text;
begin
  for audit_row in select * from public.payscope_audit_entries where organization_id = p_organization_id order by sequence_number loop
    entry_json := jsonb_build_object('organization_id', audit_row.organization_id, 'incident_id', audit_row.incident_id, 'sequence_number', audit_row.sequence_number, 'event_type', audit_row.event_type, 'actor_type', audit_row.actor_type, 'actor_id', audit_row.actor_id, 'actor_session_hash', audit_row.actor_session_hash, 'decision', audit_row.decision, 'rationale', audit_row.rationale, 'confidence', audit_row.confidence, 'enrichment_snapshot', audit_row.enrichment_snapshot);
    calculated_hash := encode(extensions.digest(previous_hash || entry_json::text, 'sha256'), 'hex');
    sequence_number := audit_row.sequence_number;
    valid := audit_row.sequence_number = expected_sequence and audit_row.prev_entry_hash = previous_hash and audit_row.entry_hash = calculated_hash;
    expected_hash := calculated_hash;
    actual_hash := audit_row.entry_hash;
    return next;
    previous_hash := audit_row.entry_hash;
    expected_sequence := expected_sequence + 1;
  end loop;
end;
$$;
revoke all on function public.payscope_verify_audit_chain(uuid) from public;
grant execute on function public.payscope_verify_audit_chain(uuid) to service_role;

create or replace function public.payscope_create_audit_genesis()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  genesis_hash text := encode(extensions.digest('genesis', 'sha256'), 'hex');
  entry_json jsonb;
begin
  entry_json := jsonb_build_object('organization_id', new.id, 'incident_id', null, 'sequence_number', 0, 'event_type', 'audit_genesis', 'actor_type', 'system', 'actor_id', 'payscope', 'actor_session_hash', null, 'decision', 'audit_chain_initialized', 'rationale', 'Organization audit chain initialized', 'confidence', null, 'enrichment_snapshot', null);
  insert into public.payscope_audit_entries (organization_id, sequence_number, event_type, actor_type, actor_id, decision, rationale, prev_entry_hash, entry_hash)
  values (new.id, 0, 'audit_genesis', 'system', 'payscope', 'audit_chain_initialized', 'Organization audit chain initialized', genesis_hash, encode(extensions.digest(genesis_hash || entry_json::text, 'sha256'), 'hex'));
  return new;
end;
$$;
drop trigger if exists payscope_organization_audit_genesis on public.payscope_organizations;
create trigger payscope_organization_audit_genesis after insert on public.payscope_organizations for each row execute function public.payscope_create_audit_genesis();

create or replace function public.payscope_ingest_event_and_enqueue(
  p_event_id uuid,
  p_organization_id uuid,
  p_razorpay_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_normalized jsonb,
  p_job_id uuid,
  p_job_payload jsonb
) returns table(event_id uuid, duplicate boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inserted_event_id uuid;
begin
  insert into public.payscope_events (id, organization_id, razorpay_event_id, event_type, payload_hash, normalized)
  values (p_event_id, p_organization_id, p_razorpay_event_id, p_event_type, p_payload_hash, p_normalized)
  on conflict (organization_id, razorpay_event_id) do nothing
  returning id into inserted_event_id;
  if inserted_event_id is null then
    select id into event_id from public.payscope_events where organization_id = p_organization_id and razorpay_event_id = p_razorpay_event_id;
    duplicate := true;
    return next;
    return;
  end if;
  insert into public.payscope_queue_jobs (id, organization_id, source_event_id, job_key, job_type, payload)
  values (p_job_id, p_organization_id, p_event_id, 'enrich:' || p_event_id::text, 'enrich_event', p_job_payload)
  on conflict (job_key) do nothing;
  event_id := inserted_event_id;
  duplicate := false;
  return next;
end;
$$;
revoke all on function public.payscope_ingest_event_and_enqueue(uuid, uuid, text, text, text, jsonb, uuid, jsonb) from public;
grant execute on function public.payscope_ingest_event_and_enqueue(uuid, uuid, text, text, text, jsonb, uuid, jsonb) to service_role;

create or replace function public.payscope_claim_queue_job(
  p_worker_id text,
  p_fixture_job_id uuid default null
)
returns setof public.payscope_queue_jobs
language sql security definer set search_path = public, pg_temp as $$
  with next_job as (
    select id from public.payscope_queue_jobs
    where status = 'pending'
      and next_attempt_at <= now()
      -- Integration fixtures are never available to the live VPS worker. The
      -- test passes its exact job ID, so it cannot claim a merchant job.
      and (
        (p_fixture_job_id is null and coalesce((payload->>'testFixture')::boolean, false) = false)
        or (p_fixture_job_id is not null and id = p_fixture_job_id and coalesce((payload->>'testFixture')::boolean, false) = true)
      )
    order by created_at asc
    for update skip locked
    limit 1
  )
  update public.payscope_queue_jobs jobs
  set status = 'running', locked_at = now(), locked_by = p_worker_id, updated_at = now()
  from next_job
  where jobs.id = next_job.id
  returning jobs.*
$$;
revoke all on function public.payscope_claim_queue_job(text, uuid) from public;
grant execute on function public.payscope_claim_queue_job(text, uuid) to service_role;

create or replace function public.payscope_requeue_stale_jobs(p_lock_timeout_seconds integer default 30)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare affected integer;
begin
  update public.payscope_queue_jobs
  set status = 'pending', locked_at = null, locked_by = null, next_attempt_at = now(), updated_at = now()
  where status = 'running' and locked_at < now() - make_interval(secs => p_lock_timeout_seconds);
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.payscope_requeue_stale_jobs(integer) from public;
grant execute on function public.payscope_requeue_stale_jobs(integer) to service_role;

create or replace function public.payscope_complete_enrichment_and_enqueue(
  p_event_id uuid,
  p_organization_id uuid,
  p_enrichment jsonb,
  p_enrichment_source text,
  p_job_id uuid,
  p_job_payload jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.payscope_events
  set enrichment = p_enrichment, enrichment_source = p_enrichment_source, processed_at = null
  where id = p_event_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope event not found for enrichment'; end if;
  insert into public.payscope_queue_jobs (id, organization_id, source_event_id, job_key, job_type, payload)
  values (p_job_id, p_organization_id, p_event_id, 'correlate:' || p_event_id::text, 'correlate_event', p_job_payload)
  on conflict (job_key) do nothing;
end;
$$;
revoke all on function public.payscope_complete_enrichment_and_enqueue(uuid, uuid, jsonb, text, uuid, jsonb) from public;
grant execute on function public.payscope_complete_enrichment_and_enqueue(uuid, uuid, jsonb, text, uuid, jsonb) to service_role;

-- Candidate selection stays in Postgres so correlation does not construct an
-- unbounded PostgREST `IN (...)` URL. Terminal incidents are returned only for
-- late recovery/dispute events; normal risk events cannot reopen them.
create or replace function public.payscope_correlation_candidates(
  p_organization_id uuid,
  p_payment_id text,
  p_order_id text,
  p_subscription_id text,
  p_customer_hash text,
  p_occurred_at timestamptz,
  p_include_terminal boolean default false
) returns table(incident jsonb, correlated_events jsonb)
language sql security definer set search_path = public, pg_temp as $$
  with matching_incidents as (
    select i.*
    from public.payscope_incidents i
    join lateral unnest(i.correlated_event_ids) as references_to_events(event_id) on true
    join public.payscope_events e on e.id = references_to_events.event_id and e.organization_id = i.organization_id
    where i.organization_id = p_organization_id
      and (p_include_terminal or i.status not in ('RESOLVED', 'HUMAN_RESOLVED', 'DISMISSED', 'DISPUTE_OPENED'))
      and (
        (p_payment_id is not null and e.normalized ->> 'paymentId' = p_payment_id)
        or (p_order_id is not null and e.normalized ->> 'orderId' = p_order_id)
        or (p_subscription_id is not null and e.normalized ->> 'subscriptionId' = p_subscription_id)
        or (
          p_customer_hash is not null
          and e.normalized ->> 'customerHash' = p_customer_hash
          and abs(extract(epoch from ((e.normalized ->> 'occurredAt')::timestamptz - p_occurred_at))) <= 900
        )
      )
    group by i.id
    order by max(i.updated_at) desc
    limit 100
  )
  select
    jsonb_build_object(
      'id', i.id,
      'organization_id', i.organization_id,
      'risk_tier', i.risk_tier,
      'status', i.status,
      'total_failed_amount_paise', i.total_failed_amount_paise,
      'recovered_amount_paise', i.recovered_amount_paise,
      'remaining_amount_paise', i.remaining_amount_paise,
      'correlated_event_ids', to_jsonb(i.correlated_event_ids),
      'opened_at', i.opened_at,
      'resolved_at', i.resolved_at,
      'updated_at', i.updated_at
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'organization_id', e.organization_id,
        'normalized', e.normalized,
        'enrichment', e.enrichment,
        'enrichment_source', e.enrichment_source
      ) order by (e.normalized ->> 'occurredAt')::timestamptz, e.id), '[]'::jsonb)
      from public.payscope_events e
      where e.organization_id = i.organization_id and e.id = any(i.correlated_event_ids)
    )
  from matching_incidents i
$$;
revoke all on function public.payscope_correlation_candidates(uuid, text, text, text, text, timestamptz, boolean) from public;
grant execute on function public.payscope_correlation_candidates(uuid, text, text, text, text, timestamptz, boolean) to service_role;

create or replace function public.payscope_persist_correlation(
  p_event_id uuid,
  p_organization_id uuid,
  p_incident jsonb,
  p_enqueue_investigation boolean,
  p_job_id uuid,
  p_job_payload jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  correlation_ids uuid[];
begin
  update public.payscope_events set processed_at = now()
  where id = p_event_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope event not found for correlation'; end if;
  if p_incident is not null then
    select coalesce(array_agg(value::uuid), '{}'::uuid[]) into correlation_ids
    from jsonb_array_elements_text(coalesce(p_incident->'correlated_event_ids', '[]'::jsonb));
    if cardinality(correlation_ids) = 0 then raise exception 'PayScope incident must reference at least one event'; end if;
    if exists (
      select 1
      from unnest(correlation_ids) as referenced_event(id)
      left join public.payscope_events e on e.id = referenced_event.id and e.organization_id = p_organization_id
      where e.id is null
    ) then raise exception 'PayScope incident references an event outside its organization'; end if;
    insert into public.payscope_incidents (
      id, organization_id, risk_tier, status, total_failed_amount_paise,
      recovered_amount_paise, correlated_event_ids, opened_at, resolved_at, updated_at
    ) values (
      (p_incident->>'id')::uuid, p_organization_id, p_incident->>'risk_tier',
      p_incident->>'status', (p_incident->>'total_failed_amount_paise')::integer,
      (p_incident->>'recovered_amount_paise')::integer,
      array(select jsonb_array_elements_text(p_incident->'correlated_event_ids')::uuid),
      (p_incident->>'opened_at')::timestamptz, nullif(p_incident->>'resolved_at', '')::timestamptz,
      (p_incident->>'updated_at')::timestamptz
    ) on conflict (id) do update set
      risk_tier = excluded.risk_tier,
      status = excluded.status,
      total_failed_amount_paise = excluded.total_failed_amount_paise,
      recovered_amount_paise = excluded.recovered_amount_paise,
      correlated_event_ids = excluded.correlated_event_ids,
      resolved_at = excluded.resolved_at,
      updated_at = excluded.updated_at
    where public.payscope_incidents.organization_id = p_organization_id;
    if not found then raise exception 'PayScope incident ID belongs to another organization'; end if;
  end if;
  if p_enqueue_investigation then
    if p_incident is null then raise exception 'PayScope investigation requires an incident'; end if;
    insert into public.payscope_queue_jobs (id, organization_id, source_event_id, job_key, job_type, payload)
    values (p_job_id, p_organization_id, p_event_id, 'investigate:' || (p_incident->>'id') || ':' || p_event_id::text, 'investigate_incident', p_job_payload)
    on conflict (job_key) do nothing;
  end if;
end;
$$;
revoke all on function public.payscope_persist_correlation(uuid, uuid, jsonb, boolean, uuid, jsonb) from public;
grant execute on function public.payscope_persist_correlation(uuid, uuid, jsonb, boolean, uuid, jsonb) to service_role;

-- Until an investigation run can persist a fully validated agent result, the
-- worker records a terminally safe failure: the incident is escalated and the
-- audit chain says exactly why. No proposal can be created through this path.
create or replace function public.payscope_record_investigation_failure(
  p_organization_id uuid,
  p_incident_id uuid,
  p_trigger_event_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.payscope_incidents
  set status = case when status = 'DISPUTE_OPENED' then status else 'ESCALATED' end,
      updated_at = now()
  where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope incident not found for investigation failure'; end if;
  insert into public.payscope_investigations (organization_id, incident_id, status, started_at, completed_at)
  values (p_organization_id, p_incident_id, 'FAILED', now(), now());
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'investigation_failed', 'system',
    'payscope-worker', null, 'escalated_for_human_review',
    left(p_reason, 1000), null,
    jsonb_build_object('trigger_event_id', p_trigger_event_id)
  );
end;
$$;
revoke all on function public.payscope_record_investigation_failure(uuid, uuid, uuid, text) from public;
grant execute on function public.payscope_record_investigation_failure(uuid, uuid, uuid, text) to service_role;

create or replace function public.payscope_persist_investigation(
  p_organization_id uuid,
  p_incident_id uuid,
  p_plan jsonb,
  p_risk_analysis jsonb,
  p_recovery_plan jsonb,
  p_policy_decision jsonb,
  p_model_id text,
  p_tokens_used integer,
  p_latency_ms integer
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_tokens_used < 0 or p_latency_ms < 0 then raise exception 'Invalid investigation telemetry'; end if;
  update public.payscope_incidents
  set status = case when status = 'DISPUTE_OPENED' then status when p_policy_decision->>'outcome' = 'escalate' then 'ESCALATED' else status end,
      updated_at = now()
  where id = p_incident_id and organization_id = p_organization_id;
  if not found then raise exception 'PayScope incident not found for investigation'; end if;
  insert into public.payscope_investigations (organization_id, incident_id, status, plan, risk_analysis, recovery_plan, policy_decision, model_id, tokens_used, latency_ms, started_at, completed_at)
  values (p_organization_id, p_incident_id, 'COMPLETE', p_plan, p_risk_analysis, p_recovery_plan, p_policy_decision, left(p_model_id, 160), p_tokens_used, p_latency_ms, now(), now());
  perform public.payscope_append_audit_entry(
    p_organization_id, p_incident_id, 'investigation_completed', 'system',
    'payscope-worker', null, coalesce(p_policy_decision->>'outcome', 'escalate'),
    coalesce(p_policy_decision->>'escalationReason', 'Validated investigation completed.'),
    (p_risk_analysis->>'confidence')::numeric, null
  );
end;
$$;
revoke all on function public.payscope_persist_investigation(uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, integer, integer) from public;
grant execute on function public.payscope_persist_investigation(uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, integer, integer) to service_role;
