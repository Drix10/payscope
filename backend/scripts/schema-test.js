const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260822_agentic_mvp_foundation.sql'), 'utf8');
for (const required of [
  'create table if not exists public.payscope_events',
  'unique (organization_id, razorpay_event_id)',
  'create table if not exists public.payscope_queue_jobs',
  'job_key text not null unique',
  'create table if not exists public.payscope_audit_entries',
  'create trigger payscope_audit_reject_update',
  'create trigger payscope_audit_reject_delete',
  'create trigger payscope_organization_audit_genesis',
  'create or replace function public.payscope_append_audit_entry',
  'create or replace function public.payscope_verify_audit_chain',
  'create or replace function public.payscope_ingest_event_and_enqueue',
  'create or replace function public.payscope_complete_enrichment_and_enqueue',
  'create or replace function public.payscope_correlation_candidates',
  'create or replace function public.payscope_persist_correlation',
  'create or replace function public.payscope_record_investigation_failure',
  'create or replace function public.payscope_persist_investigation',
  'create or replace function public.payscope_claim_queue_job',
  'enable row level security',
]) assert.match(migration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
assert.doesNotMatch(migration, /raw_payload\s+jsonb/i);
assert.match(migration, /extensions\.digest\(/i);
const proposalMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220002_proposals_and_simulated_delivery.sql'), 'utf8');
for (const required of ['payscope_merchant_policies', 'payscope_policy_context', 'payscope_persist_investigation_with_proposals', 'payscope_approve_proposal', 'payscope_cancel_pending_proposals']) assert.match(proposalMigration, new RegExp(required, 'i'));
const reliabilityMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220003_atomic_terminal_cancellation_and_cron.sql'), 'utf8');
for (const required of ['payscope_persist_correlation', 'payscope_cancel_pending_proposals', 'create extension if not exists pg_cron', 'payscope-requeue-stale-locks', 'payscope_requeue_stale_jobs']) assert.match(reliabilityMigration, new RegExp(required, 'i'));
const enrichmentReliabilityMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220004_idempotent_enrichment_audit.sql'), 'utf8');
for (const required of ['payscope_complete_enrichment_and_enqueue', 'enrichment_source is null', 'event_enriched', 'enrichment_unavailable']) assert.match(enrichmentReliabilityMigration, new RegExp(required, 'i'));
const policyTraceMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220005_policy_gate_explanations.sql'), 'utf8');
for (const required of ['policy_decision', 'auto_resolve_ceiling', 'human_review_floor', "policy_decision ? 'gates'"]) assert.match(policyTraceMigration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
const approvalSafetyMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220006_approval_locking_and_contact_limits.sql'), 'utf8');
for (const required of ['pg_advisory_xact_lock', 'customerReferenceAvailable', 'payscope_contact_attempts', 'PayScope outreach proposal has no customer reference']) assert.match(approvalSafetyMigration, new RegExp(required, 'i'));
const phase3SafetyMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220007_risk_tools_and_audit_integrity.sql'), 'utf8');
for (const required of ['payscope_risk_tool_metrics', 'payscope_audit_chain_summary', 'p_window_hours not in (1, 4, 24)', 'payscope_verify_audit_chain']) assert.match(phase3SafetyMigration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
const auditApprovalMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220008_audit_integrity_approval_gate.sql'), 'utf8');
for (const required of ['payscope_verify_audit_chain', 'audit integrity is broken', 'pg_advisory_xact_lock']) assert.match(auditApprovalMigration, new RegExp(required, 'i'));
const queueIntegrityMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220009_queue_event_integrity.sql'), 'utf8');
for (const required of ['source_event_id', 'foreign key (organization_id, source_event_id)', 'on delete cascade', 'p_fixture_job_id', "payload->>'testFixture'", 'drop function if exists public.payscope_claim_queue_job(text)']) assert.match(queueIntegrityMigration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
const queueRpcMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608220010_queue_event_integrity_rpc.sql'), 'utf8');
for (const required of ['payscope_ingest_event_and_enqueue', 'payscope_complete_enrichment_and_enqueue', 'payscope_persist_correlation', 'source_event_id']) assert.match(queueRpcMigration, new RegExp(required, 'i'));
const dashboardMetricsMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608230001_dashboard_metrics.sql'), 'utf8');
for (const required of ['payscope_dashboard_metrics', 'p_organization_id', 'attributedRecoveries', 'Recovery is Test Mode simulation only', 'grant execute']) assert.match(dashboardMetricsMigration, new RegExp(required, 'i'));
const safeMetricsMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608230002_dashboard_metrics_safe_counts.sql'), 'utf8');
for (const required of ['9007199254740991', 'proposalsGenerated', 'proposalsApproved', 'create or replace function']) assert.match(safeMetricsMigration, new RegExp(required, 'i'));
const evaluationReportMigration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '202608230003_evaluation_reports.sql'), 'utf8');
for (const required of ['payscope_evaluation_reports', 'payscope_record_evaluation_report', 'held-out evaluation already exists', 'evaluation_report_recorded', 'payscope_dashboard_metrics', 'grant execute on function public.payscope_record_evaluation_report']) assert.match(evaluationReportMigration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
console.log('Agentic MVP schema contract checks passed.');
