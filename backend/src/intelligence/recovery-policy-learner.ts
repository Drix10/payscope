import { RecoveryOutcomeStats } from '../domain/contracts';

// Deterministic posterior exploration heuristic — deterministic, no LLM mutation.
// Uses Beta-Binomial posterior with configurable global prior; hash-seeded exploration.
// Called "Thompson-inspired" — not true Beta sampling, but deterministic and reproducible.

const DEFAULT_PRIOR_RATE = 0.18;
const PSEUDO_COUNT = 20;

function getPriorRate(): number {
  const raw = process.env.PAYSCOPE_RECOVERY_PRIOR_RATE?.trim();
  if (!raw) return DEFAULT_PRIOR_RATE;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : DEFAULT_PRIOR_RATE;
}
function priorAlpha(): number { return getPriorRate() * PSEUDO_COUNT; }
function priorBeta(): number { return (1 - getPriorRate()) * PSEUDO_COUNT; }

export type StrategyScoreInput = {
  baseScore: number;
  historical: RecoveryOutcomeStats | null;
  amountPaise: number;
  confidence: number;
  customerAdjustment: number;
};

export type ScoredStrategy = {
  recoveryValueScore: number;
  heuristicRecoveryEstimatePaise: number;
  posteriorRate: number;
  exploration: boolean;
  rationale: string;
};

// Deterministic hash for Thompson tie-break (no Math.random in ranking path)
function hashToUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 0xffffffff;
}

// Deterministic posterior sample — hash-seeded normal approximation of Beta (not true Beta sampling).
// Reproducible per incident:strategy, with 5% epsilon using sampled vs posterior mean.
function deterministicPosteriorSample(alpha: number, beta: number, seed: string): number {
  // Use hash to drive a uniform, then approximate via Wilson-like sampling.
  // For small α,β this is approximate but deterministic and sufficient for ranking.
  const u = hashToUnit(seed + ':' + alpha + ':' + beta);
  // Approximate Beta mean-variance with normal clamp
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / ((alpha + beta) * (alpha + beta) * (alpha + beta + 1));
  const std = Math.sqrt(variance);
  // Box-Muller via two hashes
  const u2 = hashToUnit(seed + ':2');
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, u))) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.min(1, mean + z * std));
}

export function scoreStrategy(input: StrategyScoreInput, explorationSeed: string): ScoredStrategy {
  const safeBase = Number.isFinite(input.baseScore) ? Math.max(0, Math.min(100, input.baseScore)) : 50;
  const safeAmount = Number.isSafeInteger(input.amountPaise) && input.amountPaise >= 0 ? input.amountPaise : 0;
  const safeConfidence = Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 0.5;
  const safeAdj = Number.isFinite(input.customerAdjustment) ? Math.max(-30, Math.min(30, input.customerAdjustment)) : 0;
  const historical = input.historical;
  const attempts = Number.isSafeInteger(historical?.attempts) && (historical?.attempts ?? 0) >= 0 ? historical!.attempts : 0;
  const paidRaw = Number.isSafeInteger(historical?.paid) && (historical?.paid ?? 0) >= 0 ? historical!.paid : 0;
  const paid = Math.min(paidRaw, attempts);
  const alpha = priorAlpha() + paid;
  const beta = priorBeta() + (attempts - paid);
  const posteriorRate = alpha / (alpha + beta);
  const sampledRate = deterministicPosteriorSample(alpha, beta, explorationSeed || 'default');
  // 5% epsilon: use sampled rate, otherwise MAP (posterior mean)
  const isExploration = hashToUnit((explorationSeed || 'default') + ':explore') < 0.05;
  const effectiveRate = isExploration ? sampledRate : posteriorRate;
  const rawScore = safeBase * 0.5 + effectiveRate * 100 * 0.5 + safeAdj;
  const recoveryValueScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const heuristicRecoveryEstimatePaise = Math.round(effectiveRate * safeConfidence * safeAmount);
  const priorRate = getPriorRate();
  const rationale = historical
    ? `posterior ${(posteriorRate * 100).toFixed(1)}% (n=${attempts}, paid=${paid})${isExploration ? ' [exploration]' : ''}`
    : `prior ${(priorRate * 100).toFixed(1)}% (cold start, configurable via PAYSCOPE_RECOVERY_PRIOR_RATE)`;
  return { recoveryValueScore, heuristicRecoveryEstimatePaise, posteriorRate: effectiveRate, exploration: isExploration, rationale };
}

export function wilsonInterval(paid: number, attempts: number, z = 1.96): { lower: number; upper: number } {
  if (attempts === 0) return { lower: 0, upper: 1 };
  const p = paid / attempts;
  const denom = 1 + (z * z) / attempts;
  const centre = p + (z * z) / (2 * attempts);
  const delta = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * attempts)) / attempts);
  return { lower: Math.max(0, (centre - delta) / denom), upper: Math.min(1, (centre + delta) / denom) };
}
