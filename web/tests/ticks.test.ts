import assert from "node:assert/strict"
import { test } from "node:test"
import { countTicks, evenTicks } from "../src/lib/ticks.ts"

test("x ticks are evenly spaced and always include the newest bucket", () => {
  const thirty = Array.from({ length: 30 }, (_, i) => i)
  const ticks = evenTicks(thirty, 7)
  assert.equal(ticks.at(-1), 29)
  const gaps = new Set(ticks.slice(1).map((t, i) => t - ticks[i]))
  assert.equal(gaps.size, 1)
  assert.ok(ticks.length <= 7)
  assert.deepEqual(evenTicks([1, 2, 3], 7), [1, 2, 3])
  assert.equal(
    evenTicks(
      Array.from({ length: 24 }, (_, i) => i),
      4
    ).length,
    4
  )
})

test("small counts get whole-number y ticks ending at the max", () => {
  assert.deepEqual(countTicks(0), [0, 1])
  assert.deepEqual(countTicks(1), [0, 1])
  assert.deepEqual(countTicks(3), [0, 1, 2, 3])
  assert.equal(countTicks(12), undefined)
})
