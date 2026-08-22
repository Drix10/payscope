-- The audit hash must be built from exactly the representation persisted in
-- payscope_audit_entries.  `confidence` is numeric(4,3); hashing an untyped
-- numeric such as 0.9 and later verifying the stored 0.900 breaks a valid
-- append-only chain.  Normalize before both hashing and insertion.

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
  normalized_confidence numeric(4,3);
  entry_json jsonb;
  created_entry public.payscope_audit_entries;
begin
  normalized_confidence := p_confidence::numeric(4,3);
  perform 1 from public.payscope_organizations where id = p_organization_id for update;
  if not found then raise exception 'Unknown PayScope organization'; end if;
  select sequence_number + 1, entry_hash into next_sequence, previous_hash
  from public.payscope_audit_entries where organization_id = p_organization_id
  order by sequence_number desc limit 1;
  if not found then
    next_sequence := 0;
    previous_hash := encode(extensions.digest('genesis', 'sha256'), 'hex');
  end if;
  entry_json := jsonb_build_object('organization_id', p_organization_id, 'incident_id', p_incident_id, 'sequence_number', next_sequence, 'event_type', p_event_type, 'actor_type', p_actor_type, 'actor_id', p_actor_id, 'actor_session_hash', p_actor_session_hash, 'decision', p_decision, 'rationale', p_rationale, 'confidence', normalized_confidence, 'enrichment_snapshot', p_enrichment_snapshot);
  insert into public.payscope_audit_entries (organization_id, incident_id, sequence_number, event_type, actor_type, actor_id, actor_session_hash, decision, rationale, confidence, enrichment_snapshot, prev_entry_hash, entry_hash)
  values (p_organization_id, p_incident_id, next_sequence, p_event_type, p_actor_type, p_actor_id, p_actor_session_hash, p_decision, p_rationale, normalized_confidence, p_enrichment_snapshot, previous_hash, encode(extensions.digest(previous_hash || entry_json::text, 'sha256'), 'hex'))
  returning * into created_entry;
  return created_entry;
end;
$$;

revoke all on function public.payscope_append_audit_entry(uuid, uuid, text, text, text, text, text, text, numeric, jsonb) from public;
grant execute on function public.payscope_append_audit_entry(uuid, uuid, text, text, text, text, text, text, numeric, jsonb) to service_role;
