-- Direct-only enforcement: purge old-plan simulation values which have no production work.
-- Legacy values (whatsapp/sms/voice/flag) were readable for compatibility; now fully retired.
-- This is a forward migration — old migrations remain immutable, this supersedes them.

-- Migrate legacy proposal rows to direct equivalents before tightening constraint
update public.payscope_action_proposals set action_type = 'record_risk_signal' where action_type = 'flag_for_review';
update public.payscope_action_proposals set action_type = 'resolve_infrastructure' where action_type = 'auto_resolve_infrastructure';
update public.payscope_action_proposals set action_type = 'submit_dispute_evidence' where action_type = 'prepare_chargeback_evidence';
update public.payscope_action_proposals set action_type = 'deliver_recovery_link_email' where action_type in ('retry_link_whatsapp','retry_link_sms','hinglish_voice_script','merchant_email_notification','merchant_webhook_notification');

-- Tighten proposal check to direct-only 6 capabilities
alter table public.payscope_action_proposals drop constraint if exists payscope_action_proposals_action_type_check;
alter table public.payscope_action_proposals add constraint payscope_action_proposals_action_type_check
  check (action_type in ('deliver_recovery_link_email','record_risk_signal','submit_dispute_evidence','capture_authorized_payment','refund_payment','resolve_infrastructure'));

-- Enforce direct-only in execution tables
alter table public.payscope_execution_actions drop constraint if exists payscope_execution_actions_capability_check;
alter table public.payscope_execution_actions add constraint payscope_execution_actions_capability_check
  check (capability in ('deliver_recovery_link_email','record_risk_signal','submit_dispute_evidence','capture_authorized_payment','refund_payment','resolve_infrastructure'));
alter table public.payscope_execution_outbox drop constraint if exists payscope_execution_outbox_command_type_check;
alter table public.payscope_execution_outbox add constraint payscope_execution_outbox_command_type_check
  check (command_type in ('deliver_recovery_link_email','record_risk_signal','submit_dispute_evidence','capture_authorized_payment','refund_payment','resolve_infrastructure'));

-- Update merchant policy allowed_actions: migrate legacy arrays
update public.payscope_merchant_policies set allowed_actions = array(
  select distinct case
    when elem = 'flag_for_review' then 'record_risk_signal'
    when elem = 'auto_resolve_infrastructure' then 'resolve_infrastructure'
    when elem = 'prepare_chargeback_evidence' then 'submit_dispute_evidence'
    when elem in ('retry_link_whatsapp','retry_link_sms','hinglish_voice_script','merchant_email_notification','merchant_webhook_notification') then 'deliver_recovery_link_email'
    else elem end
  from unnest(allowed_actions) as elem
  where case
    when elem = 'flag_for_review' then 'record_risk_signal'
    when elem = 'auto_resolve_infrastructure' then 'resolve_infrastructure'
    when elem = 'prepare_chargeback_evidence' then 'submit_dispute_evidence'
    when elem in ('retry_link_whatsapp','retry_link_sms','hinglish_voice_script','merchant_email_notification','merchant_webhook_notification') then 'deliver_recovery_link_email'
    else elem end in ('deliver_recovery_link_email','record_risk_signal','submit_dispute_evidence','capture_authorized_payment','refund_payment','resolve_infrastructure')
) where allowed_actions && array['retry_link_whatsapp','retry_link_sms','hinglish_voice_script','merchant_email_notification','merchant_webhook_notification','flag_for_review','prepare_chargeback_evidence','auto_resolve_infrastructure'];

-- Update org execution policy: already direct-only, but ensure no legacy leakage
update public.payscope_organization_execution_policy set enabled_capabilities = array(
  select distinct case
    when elem = 'flag_for_review' then 'record_risk_signal'
    when elem = 'auto_resolve_infrastructure' then 'resolve_infrastructure'
    else elem end
  from unnest(enabled_capabilities) as elem
  where elem in ('deliver_recovery_link_email','record_risk_signal','submit_dispute_evidence','capture_authorized_payment','refund_payment','resolve_infrastructure')
) where enabled_capabilities && array['flag_for_review','auto_resolve_infrastructure'];

-- Drop legacy simulation metrics that counted whatsapp/sms — replaced by verified execution metrics
-- Keep payscope_dashboard_metrics for history; new verified metrics will be payscope_dashboard_metrics_v2 (already planned)

-- Remove unreachable legacy branches: truncate any remaining legacy enum comments
comment on constraint payscope_action_proposals_action_type_check on public.payscope_action_proposals is 'Direct-only: 6 capabilities. Legacy simulation channels fully removed in 202608230011.';

-- Ensure no legacy action remains
do $$ declare cnt integer; begin select count(*) into cnt from public.payscope_action_proposals where action_type not in ('deliver_recovery_link_email','record_risk_signal','submit_dispute_evidence','capture_authorized_payment','refund_payment','resolve_infrastructure'); if cnt > 0 then raise exception 'Legacy action_type still present: %', cnt; end if; end $$;
