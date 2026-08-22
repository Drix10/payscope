export type GroundTruthLabel = 'fraud' | 'not_fraud';
export type EvaluationCase = { id: string; groundTruth: GroundTruthLabel; predictedFraud: boolean; amountPaise: number };
export type MetricValue = number | 'not_available';
export type EvaluationMetrics = {
  truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number;
  precision: MetricValue; recall: MetricValue; f1: MetricValue; falsePositiveCostPaise: number;
};

/** Computes only fixture metrics. Division by zero is never presented as zero. */
export function calculateEvaluationMetrics(cases: readonly EvaluationCase[]): EvaluationMetrics {
  for (const item of cases) if (!Number.isSafeInteger(item.amountPaise) || item.amountPaise < 0) throw new Error('Fixture amountPaise must be a non-negative safe integer');
  const truePositive = cases.filter(item => item.predictedFraud && item.groundTruth === 'fraud').length;
  const falsePositive = cases.filter(item => item.predictedFraud && item.groundTruth === 'not_fraud').length;
  const falseNegative = cases.filter(item => !item.predictedFraud && item.groundTruth === 'fraud').length;
  const trueNegative = cases.length - truePositive - falsePositive - falseNegative;
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const f1 = typeof precision === 'number' && typeof recall === 'number' ? ratio(2 * precision * recall, precision + recall) : 'not_available';
  return { truePositive, falsePositive, trueNegative, falseNegative, precision, recall, f1, falsePositiveCostPaise: falsePositive * median(cases.map(item => item.amountPaise)) };
}

function ratio(numerator: number, denominator: number): MetricValue { return denominator === 0 ? 'not_available' : numerator / denominator; }
function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
