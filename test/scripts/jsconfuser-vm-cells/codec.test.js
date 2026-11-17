// The record codec: lossless round trips and exact comparison.
import assert from "node:assert/strict";
import { test } from "vitest";
import {
  tagged,
  exactEqual,
  stringifyRecord,
  parseRecord,
} from "../../../scripts/jsconfuser-vm-cells/codec.mjs";

test("lossless codec separates undefined/null, holes and numeric exceptional values", () => {
  for (const [left, right] of [
    [[undefined], [null]],
    [{ x: undefined }, {}],
    [-0, 0],
    [NaN, null],
    [new Array(1), [undefined]],
  ])
    assert.equal(exactEqual(left, right), false);
  const value = {
    pool: [undefined, null, NaN, -0, Infinity, -Infinity],
    map: new Map([[undefined, 7n]]),
    set: new Set([null, undefined]),
    hole: new Array(1),
    tagShape: ["undefined"],
  };
  assert.equal(exactEqual(value, parseRecord(stringifyRecord(value))), true);
  assert.deepEqual(tagged(value.pool)[2][0][1], ["undefined"]);
  assert.throws(() => tagged(new Date()), /Opaque/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => tagged(cyclic), /Cyclic/);
});

test("codec retains all own data keys and collection extras without invoking accessors", () => {
  for (const value of [
    Object.defineProperty({}, "x", { value: undefined }),
    Object.assign(new Map([[1, undefined]]), { extra: -0 }),
    Object.assign(new Set([NaN]), { extra: null }),
    Object.assign([undefined], { extra: Infinity }),
  ]) {
    const restored = parseRecord(stringifyRecord(value));
    assert.equal(exactEqual(value, restored), true);
    assert.deepEqual(
      Object.getOwnPropertyNames(restored),
      Object.getOwnPropertyNames(value),
    );
    for (const key of Object.getOwnPropertyNames(value))
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(restored, key),
        Object.getOwnPropertyDescriptor(value, key),
      );
  }
  let reads = 0;
  const accessor = Object.defineProperty({}, "x", {
    get() {
      reads++;
      return 1;
    },
  });
  assert.throws(() => stringifyRecord(accessor), /Accessor/);
  assert.equal(reads, 0);
  assert.throws(
    () => tagged(Object.assign(new Map(), { [Symbol("x")]: 1 })),
    /Symbol/,
  );
});

test("lossless codec preserves nonenumerable own string keys", () => {
  const value = Object.defineProperty({}, "x", { value: undefined });
  assert.equal(exactEqual(value, {}), false);
  assert.deepEqual(
    Object.getOwnPropertyNames(parseRecord(stringifyRecord(value))),
    ["x"],
  );
});
