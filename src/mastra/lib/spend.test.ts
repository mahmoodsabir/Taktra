import assert from 'node:assert/strict';
import test from 'node:test';

import { costOf, isModelPriced, normaliseModel, transcriptionCostOf } from './spend.ts';

test('cached input is priced separately, or spend is wildly overstated', async () => {
  // Measured from real traffic: 75% of input tokens were cache reads. Charging them at
  // full rate would have made the product look several times more expensive than it is.
  const usage = { inputTokens: 100_000, cachedInputTokens: 75_000, outputTokens: 1_000 };

  const withCache = costOf('openai/gpt-5.6-terra', usage);
  const withoutCache = costOf('openai/gpt-5.6-terra', { ...usage, cachedInputTokens: 0 });

  assert.ok(withCache < withoutCache * 0.55, 'caching roughly halves it or better');
  // 25k uncached @ $2/M + 75k cached @ $0.20/M + 1k output @ $12/M
  assert.ok(Math.abs(withCache - (0.05 + 0.015 + 0.012)) < 1e-6);
});

test('a real month of one user is priced accurately', async () => {
  // The measured window: 66 terra turns, 4.54M input of which 3.43M cached, 45k output.
  const cost = costOf('openai/gpt-5.6-terra', {
    inputTokens: 4_544_253,
    cachedInputTokens: 3_427_355,
    outputTokens: 45_365,
  });
  assert.ok(cost > 3.4 && cost < 3.6, `expected ~3.46, got ${cost}`);
});

test('the provider prefix Mastra routes with does not break pricing', async () => {
  assert.equal(normaliseModel('openai/gpt-5.6-luna'), 'gpt-5.6-luna');
  assert.ok(costOf('openai/gpt-5.6-luna', { inputTokens: 1e6, outputTokens: 0 }) > 0);
});

test('an unknown model is free rather than fatal, and detectable', async () => {
  // A model added upstream must not crash a turn, but silently pricing it at zero would
  // hide real spend — so it is reportable.
  assert.equal(costOf('openai/gpt-7-unreleased', { inputTokens: 1e6, outputTokens: 1e6 }), 0);
  assert.equal(isModelPriced('openai/gpt-7-unreleased'), false);
  assert.equal(isModelPriced('openai/gpt-5.6-luna'), true);
});

test('voice notes are costed by duration', async () => {
  assert.ok(Math.abs(transcriptionCostOf('gpt-4o-mini-transcribe', 60) - 0.003) < 1e-9);
  assert.ok(Math.abs(transcriptionCostOf('whisper', 30) - 0.003) < 1e-9);
  assert.equal(transcriptionCostOf('whisper-local', 600), 0, 'self-hosted has no marginal cost');
});
