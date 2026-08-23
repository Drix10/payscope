-- Internal, non-provider action finalization: record_risk_signal and
-- resolve_infrastructure complete without a provider receipt, and local
-- policy blocks (CAPABILITY_NOT_ENABLED) terminalize the same way.
-- No provider receipt row is created; state, terminal reason, and audit entry
-- are appended monotonically like every other action transition.

create or replace function public.payscope_finalize_internal_action(
  p_organization_id uuid,
  p_action_id uuid,
  p_state text,
  p_terminal_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare action_row public.payscope_execution_actions;
begin
  if p_state not in ('confirmed', 'failed') then raise exception 'Invalid internal finalize state %', p_state; end if;
  if p_terminal_reason is null or char_length(p_terminal_reason) < 1 or char_length(p_terminal_reason) > 320 then raise exception 'Invalid internal terminal reason'; end if;
  select * into action_row from public.payscope_execution_actions where id = p_action_id and organization_id = p_organization_id for update;
  if not found then raise exception 'Unknown execution action'; end if;
  if action_row.state in ('confirmed', 'failed', 'cancelled') then return; end if;
  update public.payscope_execution_actions set
    state = p_state,
    terminal_reason = left(p_terminal_reason, 320),
    completed_at = now(),
    updated_at = now()
  where id = p_action_id and organization_id = p_organization_id;
  perform public.payscope_append_audit_entry(
    p_organization_id, action_row.incident_id, 'execution_internal_finalized', 'system', 'payscope-execution', null,
    p_state, 'An internal, non-provider action was finalized with a bounded terminal reason.', null,
    jsonb_build_object('action_id', p_action_id, 'state', p_state, 'terminal_reason', left(p_terminal_reason, 320))
  );
end;
$$;
revoke all on function public.payscope_finalize_internal_action(uuid, uuid, text, text) from public;
grant execute on function public.payscope_finalize_internal_action(uuid, uuid, text, text) to service_role;
