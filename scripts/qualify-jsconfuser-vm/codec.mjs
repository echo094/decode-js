export const CODEC_VERSION = "vm-qualification-lossless.v2";

export function tagged(value, active = new Set()) {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ["number", "NaN"];
    if (Object.is(value, -0)) return ["number", "-0"];
    if (!Number.isFinite(value)) return ["number", String(value)];
    return ["number", value];
  }
  if (["string", "boolean"].includes(typeof value))
    return [typeof value, value];
  if (typeof value === "bigint") return ["bigint", String(value)];
  if (typeof value !== "object")
    throw new TypeError("Unsupported qualification value");
  if (active.has(value)) throw new TypeError("Cyclic qualification value");
  active.add(value);
  const tag = (child) => tagged(child, active);
  if (Object.getOwnPropertySymbols(value).length)
    throw new TypeError("Symbol qualification key");
  const properties = Object.getOwnPropertyNames(value)
    .sort()
    .map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!Object.hasOwn(descriptor, "value"))
        throw new TypeError("Accessor qualification property");
      return [
        key,
        tag(descriptor.value),
        descriptor.enumerable,
        descriptor.writable,
        descriptor.configurable,
      ];
    });
  let result;
  if (Array.isArray(value)) result = ["array", value.length, properties];
  else if (Object.prototype.toString.call(value) === "[object Map]")
    result = [
      "map",
      [...value].map(([key, item]) => [tag(key), tag(item)]),
      properties,
    ];
  else if (Object.prototype.toString.call(value) === "[object Set]")
    result = ["set", [...value].map(tag), properties];
  else if (Object.prototype.toString.call(value) === "[object Object]") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && prototype.constructor?.name !== "Object")
      throw new TypeError("Opaque qualification prototype");
    result = ["object", properties, prototype === null];
  } else throw new TypeError("Opaque qualification value");
  active.delete(value);
  return result;
}

// Equality is the declared own-string-key/value grammar; frozen owned records
// and ordinary expected records compare by the same values. Serialization also
// preserves each supported data descriptor's attributes for exact readback.
function valueGrammar(record) {
  const [kind, payload, extra] = record;
  const properties = (items) =>
    items.map(([key, value]) => [key, valueGrammar(value)]);
  if (kind === "array") return [kind, payload, properties(extra)];
  if (kind === "object") return [kind, properties(payload), extra];
  if (kind === "map")
    return [
      kind,
      payload.map(([key, value]) => [valueGrammar(key), valueGrammar(value)]),
      properties(extra),
    ];
  if (kind === "set")
    return [kind, payload.map(valueGrammar), properties(extra)];
  return record;
}
export const exactEqual = (left, right) =>
  JSON.stringify(valueGrammar(tagged(left))) ===
  JSON.stringify(valueGrammar(tagged(right)));
export const stringifyRecord = (value) =>
  `${JSON.stringify({ codec: CODEC_VERSION, value: tagged(value) }, null, 2)}\n`;

export function untagged(value) {
  const [kind, payload] = value;
  if (kind === "undefined") return undefined;
  if (kind === "null") return null;
  if (kind === "number")
    return payload === "-0"
      ? -0
      : typeof payload === "number"
        ? payload
        : Number(payload);
  if (kind === "string" || kind === "boolean") return payload;
  if (kind === "bigint") return BigInt(payload);
  const restore = (object, properties) => {
    for (const [key, item, enumerable, writable, configurable] of properties)
      Object.defineProperty(object, key, {
        value: untagged(item),
        enumerable,
        writable,
        configurable,
      });
    return object;
  };
  if (kind === "array") return restore(new Array(payload), value[2]);
  if (kind === "object")
    return restore(value[2] ? Object.create(null) : {}, payload);
  if (kind === "map")
    return restore(
      new Map(payload.map(([key, item]) => [untagged(key), untagged(item)])),
      value[2],
    );
  if (kind === "set") return restore(new Set(payload.map(untagged)), value[2]);
  throw new TypeError("Unknown qualification tag");
}

export function parseRecord(text) {
  const envelope = JSON.parse(text);
  if (envelope.codec !== CODEC_VERSION)
    throw new TypeError("Unknown qualification codec");
  return untagged(envelope.value);
}
