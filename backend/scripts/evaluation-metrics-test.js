const assert = require('node:assert/strict');
const { calculateEvaluationMetrics } = require('../dist/evaluation/metrics');

const metrics = calculateEvaluationMetrics([
  { id: 'a', groundTruth: 'fraud', predictedFraud: true, amountPaise: 100 },
  { id: 'b', groundTruth: 'not_fraud', predictedFraud: true, amountPaise: 300 },
  { id: 'c', groundTruth: 'fraud', predictedFraud: false, amountPaise: 500 },
  { id: 'd', groundTruth: 'not_fraud', predictedFraud: false, amountPaise: 700 },
]);
assert.deepEqual(metrics, { truePositive: 1, falsePositive: 1, trueNegative: 1, falseNegative: 1, precision: 0.5, recall: 0.5, f1: 0.5, falsePositiveCostPaise: 400 });
const unavailable = calculateEvaluationMetrics([{ id: 'e', groundTruth: 'not_fraud', predictedFraud: false, amountPaise: 0 }]);
assert.equal(unavailable.precision, 'not_available'); assert.equal(unavailable.recall, 'not_available'); assert.equal(unavailable.f1, 'not_available');
console.log('Fixture evaluation metric checks passed.');
