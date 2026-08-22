-- Repair the initial foundation migration on hosted Supabase, where pgcrypto
-- lives in the extensions schema and the audit functions use a restricted
-- search_path. Fresh installs receive the same qualified calls in 20260822.

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
