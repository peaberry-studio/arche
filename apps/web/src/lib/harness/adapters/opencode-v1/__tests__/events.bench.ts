import { bench, describe } from 'vitest'

import { streamingFixture } from '@/lib/harness/adapters/opencode-v1/__tests__/fixtures/event-streams'
import { translateOpenCodeEvent } from '@/lib/harness/adapters/opencode-v1/events'

const samples: number[] = []
let cursor = 0

for (let run = 0; run < 20; run++) {
  for (const event of streamingFixture) {
    const start = performance.now()
    translateOpenCodeEvent(event)
    samples.push(performance.now() - start)
  }
}
samples.sort((a, b) => a - b)
const p50 = samples[Math.floor(samples.length * 0.5)]
const p99 = samples[Math.floor(samples.length * 0.99)]
console.log(`Translation per event: p50=${p50.toFixed(6)} ms p99=${p99.toFixed(6)} ms (${samples.length} samples)`)
if (p99 >= 0.5) throw new Error(`Translation p99 ${p99} ms exceeds 0.5 ms`)

describe('v1 event translation (2,000-event streaming replay)', () => {
  bench('translate 2,000 events', () => {
    for (const event of streamingFixture) translateOpenCodeEvent(event)
  })

  bench('translate one event', () => {
    translateOpenCodeEvent(streamingFixture[cursor++ % streamingFixture.length])
  })

})
