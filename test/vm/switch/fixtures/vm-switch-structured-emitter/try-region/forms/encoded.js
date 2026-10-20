var CONSTANTS = [/* 0 */1, /* 1 */"window", /* 2 */"TEST_OUTPUT", /* 3 */0, /* 4 */"length", /* 5 */2, /* 6 */undefined, /* 7 */"value", /* 8 */"thrown", /* 9 */"message", /* 10 */"push", /* 11 */"f", /* 12 */"Error", /* 13 */"g:", /* 14 */3, /* 15 */4, /* 16 */5, /* 17 */6, /* 18 */"re", /* 19 */7, /* 20 */"inner", /* 21 */9, /* 22 */"outer", /* 23 */11, /* 24 */"fin", /* 25 */10, /* 26 */41, /* 27 */42, /* 28 */null, /* 29 */"definitely_missing_global", /* 30 */"name", /* 31 */"ReferenceError", /* 32 */100];
var BYTECODE = [4, 1, 47, 31, 500, 1, 7, 1, 0, 1, 2, 5, 3, 31, 47, 31, 553, 1, 7, 1, 0, 1, 2, 5, 4, 31, 47, 31, 586, 1, 7, 2, 0, 1, 3, 1, 4, 5, 5, 31, 47, 31, 620, 1, 8, 2, 0, 1, 3, 1, 4, 5, 6, 31, 47, 31, 691, 1, 7, 2, 0, 1, 3, 1, 4, 5, 7, 31, 47, 31, 737, 1, 6, 1, 0, 1, 3, 5, 8, 31, 47, 31, 771, 1, 7, 2, 0, 1, 3, 1, 4, 5, 9, 31, 47, 31, 813, 1, 8, 2, 0, 1, 3, 1, 4, 5, 10, 31, 47, 31, 885, 1, 8, 2, 0, 1, 3, 1, 4, 5, 11, 31, 47, 31, 945, 1, 7, 2, 0, 1, 3, 1, 4, 5, 12, 31, 47, 31, 1017, 1, 8, 2, 0, 1, 3, 1, 4, 5, 13, 31, 47, 31, 1072, 1, 8, 2, 0, 1, 3, 1, 4, 5, 14, 31, 47, 31, 1126, 1, 9, 2, 0, 1, 3, 1, 4, 5, 15, 31, 47, 31, 1196, 1, 7, 2, 0, 1, 16, 1, 4, 5, 17, 31, 47, 31, 1231, 1, 7, 1, 0, 1, 4, 5, 18, 31, 47, 31, 1267, 1, 9, 1, 0, 1, 4, 5, 19, 31, 47, 31, 1317, 1, 8, 0, 0, 5, 20, 31, 47, 31, 1371, 1, 11, 1, 0, 1, 3, 5, 21, 31, 47, 31, 1518, 1, 10, 1, 0, 1, 3, 5, 22, 31, 47, 31, 1632, 1, 10, 1, 0, 1, 3, 5, 23, 31, 47, 31, 1734, 1, 10, 1, 0, 1, 3, 5, 24, 31, 48, 31, 0, 5, 2, 31, 0, 31, 0, 0, 5, 16, 31, 48, 31, 19, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20, 17, 18, 19, 21, 22, 23, 24, 5, 25, 31, 2, 31, 1, 0, 0, 32, 2, 0, 48, 33, 0, 9, 31, 32, 33, 0, 31, 3, 0, 5, 26, 31, 0, 31, 4, 0, 8, 32, 25, 31, 0, 31, 5, 0, 13, 33, 32, 31, 22, 31, 26, 33, 40, 31, 494, 0, 31, 0, 0, 20, 32, 26, 31, 5, 27, 32, 0, 31, 0, 0, 16, 32, 26, 31, 0, 31, 0, 0, 26, 33, 32, 31, 5, 28, 33, 48, 31, 0, 5, 2, 31, 0, 29, 6, 0, 54, 425, 30, 0, 31, 7, 0, 8, 32, 25, 27, 43, 33, 25, 32, 1, 28, 48, 32, 2, 31, 33, 5, 29, 32, 55, 39, 445, 0, 31, 8, 0, 0, 32, 9, 0, 8, 33, 30, 32, 48, 32, 2, 31, 33, 5, 29, 32, 2, 31, 1, 0, 0, 32, 2, 0, 8, 33, 31, 32, 0, 31, 10, 0, 8, 32, 33, 31, 48, 31, 4, 27, 28, 29, 2, 43, 34, 33, 32, 1, 31, 5, 31, 26, 0, 31, 0, 0, 11, 32, 26, 31, 5, 26, 32, 39, 334, 0, 31, 6, 0, 45, 31, 4, 2, 3, 3, 0, 0, 4, 10, 0, 8, 5, 3, 4, 0, 4, 11, 0, 43, 6, 3, 5, 1, 4, 40, 0, 541, 2, 3, 12, 0, 0, 4, 11, 0, 44, 5, 3, 1, 4, 46, 5, 0, 3, 0, 0, 45, 3, 0, 3, 6, 0, 45, 3, 4, 2, 3, 3, 0, 0, 4, 10, 0, 8, 5, 3, 4, 0, 4, 13, 0, 11, 6, 4, 0, 43, 4, 3, 5, 1, 6, 0, 3, 6, 0, 45, 3, 4, 2, 54, 602, 3, 3, 4, 0, 42, 5, 4, 1, 0, 55, 39, 602, 3, 4, 1, 0, 5, 0, 0, 42, 6, 4, 1, 5, 0, 4, 6, 0, 45, 4, 4, 2, 0, 5, 3, 0, 5, 3, 5, 54, 643, 4, 3, 5, 0, 42, 6, 5, 1, 0, 55, 39, 677, 0, 5, 0, 0, 5, 3, 5, 0, 5, 0, 0, 11, 6, 3, 5, 5, 3, 6, 3, 5, 1, 0, 6, 9, 0, 8, 7, 4, 6, 42, 6, 5, 1, 7, 3, 5, 1, 42, 6, 5, 1, 3, 0, 5, 6, 0, 45, 5, 4, 2, 54, 707, 3, 3, 4, 0, 42, 5, 4, 1, 0, 55, 39, 719, 3, 4, 1, 0, 5, 14, 0, 42, 6, 4, 1, 5, 3, 4, 1, 0, 5, 15, 0, 42, 6, 4, 1, 5, 0, 4, 6, 0, 45, 4, 4, 2, 54, 753, 3, 3, 4, 0, 42, 5, 4, 1, 0, 55, 39, 759, 0, 4, 16, 0, 45, 4, 0, 4, 17, 0, 45, 4, 0, 4, 6, 0, 45, 4, 4, 2, 54, 787, 3, 3, 4, 0, 42, 5, 4, 1, 0, 55, 39, 801, 3, 4, 1, 0, 5, 18, 0, 42, 6, 4, 1, 5, 46, 3, 0, 4, 19, 0, 45, 4, 0, 4, 6, 0, 45, 4, 4, 2, 0, 5, 3, 0, 5, 3, 5, 54, 836, 4, 3, 5, 0, 42, 6, 5, 1, 0, 55, 39, 871, 0, 5, 9, 0, 8, 6, 4, 5, 0, 5, 11, 0, 26, 7, 6, 5, 40, 7, 864, 0, 5, 0, 0, 5, 3, 5, 39, 871, 0, 5, 5, 0, 5, 3, 5, 3, 5, 1, 42, 6, 5, 1, 3, 0, 5, 6, 0, 45, 5, 4, 2, 54, 901, 3, 3, 5, 0, 42, 6, 5, 1, 0, 55, 39, 927, 54, 915, 4, 3, 5, 0, 42, 6, 5, 1, 0, 55, 39, 927, 3, 5, 1, 0, 6, 20, 0, 42, 7, 5, 1, 6, 3, 5, 1, 0, 6, 21, 0, 42, 7, 5, 1, 6, 0, 5, 6, 0, 45, 5, 4, 2, 54, 987, 3, 54, 964, 3, 3, 4, 0, 42, 5, 4, 1, 0, 55, 39, 976, 3, 4, 1, 0, 5, 20, 0, 42, 6, 4, 1, 5, 3, 4, 0, 42, 5, 4, 1, 0, 55, 39, 999, 3, 4, 1, 0, 5, 22, 0, 42, 6, 4, 1, 5, 3, 4, 1, 0, 5, 23, 0, 42, 6, 4, 1, 5, 0, 4, 6, 0, 45, 4, 4, 2, 59, 1038, 3, 4, 1052, 3, 5, 0, 42, 6, 5, 1, 0, 55, 1, 3, 1054, 39, 1038, 3, 5, 1, 0, 6, 24, 0, 42, 7, 5, 1, 6, 58, 3, 46, 4, 3, 5, 1, 0, 6, 5, 0, 42, 7, 5, 1, 6, 0, 5, 6, 0, 45, 5, 4, 2, 59, 1102, 3, 4, 1116, 3, 5, 0, 42, 6, 5, 1, 0, 5, 4, 6, 1, 3, 1118, 55, 39, 1102, 55, 1, 3, 1120, 39, 1102, 3, 5, 1, 0, 6, 24, 0, 42, 7, 5, 1, 6, 58, 3, 46, 4, 45, 4, 0, 5, 6, 0, 45, 5, 4, 2, 0, 7, 3, 0, 5, 3, 7, 59, 1167, 5, 6, 1180, 54, 1154, 4, 3, 7, 0, 42, 8, 7, 1, 0, 55, 39, 1161, 0, 7, 0, 0, 5, 3, 7, 55, 1, 5, 1182, 39, 1167, 0, 7, 25, 0, 11, 8, 3, 7, 5, 3, 8, 58, 5, 46, 6, 3, 7, 1, 42, 8, 7, 1, 3, 0, 7, 6, 0, 45, 7, 4, 2, 54, 1207, 3, 3, 4, 0, 55, 39, 1214, 0, 4, 26, 0, 7, 0, 4, 3, 4, 1, 3, 5, 0, 42, 6, 4, 1, 5, 0, 4, 6, 0, 45, 4, 4, 2, 0, 5, 5, 0, 5, 3, 5, 54, 1246, 4, 55, 39, 1253, 0, 5, 27, 0, 5, 3, 5, 3, 5, 0, 42, 6, 5, 1, 3, 0, 5, 6, 0, 45, 5, 4, 2, 0, 6, 14, 0, 5, 3, 6, 59, 1287, 4, 5, 1301, 55, 1, 4, 1303, 39, 1287, 3, 6, 0, 0, 7, 24, 0, 42, 8, 6, 1, 7, 58, 4, 46, 5, 3, 6, 0, 42, 7, 6, 1, 3, 0, 6, 6, 0, 45, 6, 4, 2, 0, 5, 28, 0, 5, 3, 5, 54, 1339, 4, 40, 0, 1336, 2, 5, 29, 0, 55, 39, 1363, 0, 5, 30, 0, 8, 6, 4, 5, 2, 5, 31, 0, 31, 7, 4, 5, 48, 5, 2, 6, 7, 5, 3, 5, 45, 3, 0, 5, 6, 0, 45, 5, 4, 2, 0, 7, 3, 0, 5, 3, 7, 0, 7, 3, 0, 5, 4, 7, 0, 7, 15, 0, 22, 8, 4, 7, 40, 8, 1510, 59, 1475, 5, 6, 1488, 0, 7, 0, 0, 26, 8, 4, 7, 40, 8, 1420, 1, 5, 1490, 55, 39, 1475, 0, 7, 14, 0, 26, 8, 4, 7, 40, 8, 1437, 1, 5, 1492, 55, 39, 1475, 3, 7, 0, 5, 8, 0, 40, 8, 1457, 0, 9, 5, 0, 26, 10, 4, 9, 5, 8, 10, 42, 9, 7, 1, 8, 11, 7, 3, 4, 5, 3, 7, 55, 1, 5, 1494, 39, 1475, 0, 7, 25, 0, 11, 8, 3, 7, 5, 3, 8, 58, 5, 46, 6, 39, 1494, 39, 1510, 5, 7, 4, 0, 7, 0, 0, 11, 8, 4, 7, 5, 4, 8, 39, 1387, 45, 3, 0, 7, 6, 0, 45, 7, 4, 2, 0, 6, 3, 0, 5, 3, 6, 0, 6, 3, 0, 5, 4, 6, 0, 6, 15, 0, 22, 7, 4, 6, 40, 7, 1624, 54, 1597, 5, 0, 6, 14, 0, 26, 7, 4, 6, 40, 7, 1562, 55, 39, 1624, 3, 6, 0, 5, 7, 0, 40, 7, 1582, 0, 8, 0, 0, 26, 9, 4, 8, 5, 7, 9, 42, 8, 6, 1, 7, 11, 6, 3, 4, 5, 3, 6, 55, 39, 1608, 0, 6, 32, 0, 11, 7, 3, 6, 5, 3, 7, 5, 6, 4, 0, 6, 0, 0, 11, 7, 4, 6, 5, 4, 7, 39, 1534, 45, 3, 0, 6, 6, 0, 45, 6, 4, 2, 0, 6, 3, 0, 5, 3, 6, 0, 6, 3, 0, 5, 4, 6, 0, 6, 15, 0, 22, 7, 4, 6, 40, 7, 1726, 54, 1697, 5, 3, 6, 0, 5, 7, 0, 40, 7, 1682, 0, 8, 5, 0, 26, 9, 4, 8, 5, 7, 9, 42, 8, 6, 1, 7, 11, 6, 3, 4, 5, 3, 6, 55, 39, 1710, 0, 6, 32, 0, 11, 7, 3, 6, 5, 3, 7, 39, 1726, 5, 6, 4, 0, 6, 0, 0, 11, 7, 4, 6, 5, 4, 7, 39, 1648, 45, 3, 0, 6, 6, 0, 45, 6, 4, 2, 0, 6, 3, 0, 5, 3, 6, 0, 6, 3, 0, 5, 4, 6, 54, 1788, 5, 3, 6, 0, 5, 7, 0, 40, 7, 1773, 0, 8, 0, 0, 26, 9, 4, 8, 5, 7, 9, 42, 8, 6, 1, 7, 11, 6, 3, 4, 5, 3, 6, 55, 39, 1799, 0, 6, 32, 0, 11, 7, 3, 6, 5, 3, 7, 5, 6, 4, 0, 6, 0, 0, 11, 7, 4, 6, 5, 4, 7, 0, 6, 14, 0, 22, 7, 4, 6, 40, 7, 1826, 39, 1750, 45, 3, 0, 6, 6, 0, 45, 6];
var MAIN_START_PC = 0;
var MAIN_REG_COUNT = 35;
var ENCODE_BYTECODE = false;
var TIMING_CHECKS = false;
var OP = {
  LOAD_CONST: 0,
  LOAD_INT: 1,
  LOAD_GLOBAL: 2,
  LOAD_UPVALUE: 3,
  LOAD_THIS: 4,
  MOVE: 5,
  STORE_GLOBAL: 6,
  STORE_UPVALUE: 7,
  GET_PROP: 8,
  SET_PROP: 9,
  DELETE_PROP: 10,
  ADD: 11,
  SUB: 12,
  MUL: 13,
  DIV: 14,
  MOD: 15,
  EXP: 60,
  BAND: 16,
  BOR: 17,
  BXOR: 18,
  SHL: 19,
  SHR: 20,
  USHR: 21,
  LT: 22,
  GT: 23,
  LTE: 24,
  GTE: 25,
  EQ: 26,
  NEQ: 27,
  LOOSE_EQ: 28,
  LOOSE_NEQ: 29,
  IN: 30,
  INSTANCEOF: 31,
  UNARY_NEG: 32,
  UNARY_POS: 33,
  UNARY_NOT: 34,
  UNARY_BITNOT: 35,
  TYPEOF: 36,
  VOID: 37,
  TYPEOF_SAFE: 38,
  JUMP: 39,
  JUMP_IF_FALSE: 40,
  JUMP_IF_TRUE: 41,
  CALL: 42,
  CALL_METHOD: 43,
  NEW: 44,
  RETURN: 45,
  THROW: 46,
  MAKE_CLOSURE: 47,
  BUILD_ARRAY: 48,
  BUILD_OBJECT: 49,
  DEFINE_GETTER: 50,
  DEFINE_SETTER: 51,
  FOR_IN_SETUP: 52,
  FOR_IN_NEXT: 53,
  TRY_SETUP: 54,
  TRY_END: 55,
  PATCH: 56,
  DEBUGGER: 57,
  JUMP_REG: 58,
  FINALLY_SETUP: 59
};
var SENTINELS = {
  CALL_SPREAD: 65535
};
var SLOTS = {
  PC: 0,
  CALLER: 1,
  RET_DST: 2,
  THIS: 3,
  CLOSURE: 4,
  HANDLERS: 5,
  FRAME_SIZE: 6,
  REG_BASE: 7
};
var HEADER_SIZE = 8;
var FRAME_START = 1;
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
function decodeBytecode(s) {
  if (!ENCODE_BYTECODE) return s;
  var b = base64ToBytes(s);
  // Each slot is a u32 stored as 4 little-endian bytes.
  var r = new Uint32Array(b.length / 4);
  for (var i = 0; i < r.length; i++) r[i] = (b[i * 4] | b[i * 4 + 1] << 8 | b[i * 4 + 2] << 16 | b[i * 4 + 3] << 24) >>> 0;
  return r;
}

// Closure map
// Maps shell functions -> inner Closure so the VM can fast-path instead of going through a sub-VM on internal calls.
// A WeakMap is used over a Symbol to prevent leaking information to debuggers
var CLOSURE_MAP = new WeakMap();

// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)
function Upvalue(regs, absSlot) {
  this._regs = regs; // shared reference to VM._regs flat array
  this._absSlot = absSlot; // absolute index; stable as long as frame is alive
  this._closed = false;
  this._value = undefined;
}
Upvalue.prototype._read = function () {
  return this._closed ? this._value : this._regs[this._absSlot];
};
Upvalue.prototype._write = function (v) {
  if (this._closed) this._value = v;else this._regs[this._absSlot] = v;
};
Upvalue.prototype._close = function () {
  this._value = this._regs[this._absSlot];
  this._closed = true;
};

// Closure & Frame
function Closure(fn) {
  this.fn = fn;
  this.upvalues = [];
  this.prototype = {}; // <- default prototype object for `new`
}

// VM
// There is no Frame object and no frame stack. A frame is a block of slots in
// the flat array `_regs`: HEADER_SIZE header slots (see utils/frame-layout.ts) followed
// by the frame's registers. `_f` — the only piece of live execution state the VM
// object exposes — is the current frame's base offset, and each frame's CALLER
// slot points at the one that called it, so the call stack is an implicit linked
// list with nothing to enumerate.
function VM(bytecode, constants, globals) {
  this.bytecode = bytecode;
  this.constants = constants;
  this.globals = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this._openUpvalues = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this._regs = [];
  this._regsTop = FRAME_START;
  this._f = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
VM.prototype._operand = function () {
  return this.bytecode[this._regs[this._f + SLOTS.PC]++];
};

// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
VM.prototype._pushFrame = function (closure, args, thisVal, retDst) {
  var fn = closure.fn;
  var regs = this._regs;
  var fp = this._regsTop;
  var size = HEADER_SIZE + fn.regCount;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + HEADER_SIZE;
  regs[fp + SLOTS.PC] = fn.startPc;
  regs[fp + SLOTS.CALLER] = this._f;
  regs[fp + SLOTS.RET_DST] = retDst;
  regs[fp + SLOTS.THIS] = thisVal;
  regs[fp + SLOTS.CLOSURE] = closure;
  regs[fp + SLOTS.FRAME_SIZE] = size;
  regs[fp + SLOTS.REG_BASE] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof SLOTS.NOISE_END === "number") regs[fp + SLOTS.NOISE_END] = end;
  if (typeof SLOTS.NOISE_PARAMS === "number") regs[fp + SLOTS.NOISE_PARAMS] = fn.paramCount;
  if (typeof SLOTS.NOISE_ARGS === "number") regs[fp + SLOTS.NOISE_ARGS] = args;
  if (typeof SLOTS.NOISE_PC === "number") regs[fp + SLOTS.NOISE_PC] = fn.startPc;
  if (typeof SLOTS.NOISE_COUNTER === "number") regs[fp + SLOTS.NOISE_COUNTER] = 0;
  this._regsTop = end;
  if (args) {
    if (fn.hasRest) {
      var restSlot = fn.paramCount - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.regCount; a++) regs[base + a] = args[a];
    }
    if (fn.paramCount < fn.regCount) regs[base + fn.paramCount] = args;
  }
  this._f = fp;
};
VM.prototype.captureUpvalue = function (fp, slot) {
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this._regs[fp + SLOTS.REG_BASE] + slot;
  var uvs = this._openUpvalues || (this._openUpvalues = []);
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(this._regs, absSlot));
};

// Reads and decodes a constant from the pool.
// idx: pool index (first operand of the constant pair emitted by resolveConstants).
// key: conceal key (second operand). 0 means no concealment.
//
// For integers:  stored value is (original ^ key) with the full u32 key; XOR
//                again to recover (JS `^` is int32, so this is symmetric).
// For strings:   stored value is a base64 string containing u16 LE byte pairs.
//                Mirrors decodeBytecode: base64 → bytes → u16 LE → XOR with a
//                position-based Weyl keystream seeded by the full u32 key.
// idxIn, keyIn are passed in from specializedOpcodes when the operands are determined at compile time.
VM.prototype._constant = function (idxIn, keyIn) {
  var idx = idxIn ?? this._operand();
  var key = keyIn ?? this._operand();
  var v = this.constants[idx];
  if (!key) return v;
  if (typeof v === "number") return v ^ key;
  if (typeof v !== "string") return v;

  // String: base64-decode to u16 LE byte pairs, then XOR each code with a
  // 16-bit keystream word derived from the full 32-bit key + position.
  var b = base64ToBytes(v);
  var out = "";
  var k = key;
  for (var i = 0; i < b.length / 2; i++) {
    k = k + 0x9e3779b9 | 0; // 32-bit Weyl step (position-based)
    var ks = (k ^ k >>> 13) & 0xffff; // 16-bit keystream word
    var code = b[i * 2] | b[i * 2 + 1] << 8; // u16 LE
    out += String.fromCharCode(code ^ ks);
  }
  return out;
};
VM.prototype._closeUpvaluesFor = function (fp) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this._openUpvalues;
  if (!uvs) return; // nothing in this program ever captured a local
  var regs = this._regs;
  var hi = fp + regs[fp + SLOTS.FRAME_SIZE];
  for (var i = regs[fp + SLOTS.REG_BASE]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv._close();
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
VM.prototype.run = function (closure, thisVal, args) {
  var now = () => {
    return performance.now();
  };
  var lastTime = now();
  this._pushFrame(closure, args, thisVal, 0);
  while (true) {
    var fp = this._f;
    var regs = this._regs;
    var bc = this.bytecode;
    var pc = regs[fp + SLOTS.PC];
    if (pc >= bc.length) break;
    regs[fp + SLOTS.PC] = pc + 1;
    var op = this.bytecode[pc];
    // var opcode = this.bytecode[pc];
    // console.log(`[run] pc=${pc}, opcode=${opcode}, name=${Object.keys(OP).find((key) => OP[key] === opcode)}`);

    // Churn the decoy header slots so the real PC isn't the only slot moving
    /* @NOISE */
    if (typeof SLOTS.NOISE_PC === "number") regs[fp + SLOTS.NOISE_PC] = (regs[fp + SLOTS.NOISE_PC] + 1) % bc.length;
    if (typeof SLOTS.NOISE_COUNTER === "number") regs[fp + SLOTS.NOISE_COUNTER]++;
    if (typeof SLOTS.NOISE_MIRROR === "number") regs[fp + SLOTS.NOISE_MIRROR] = op;
    if (typeof SLOTS.NOISE_ACC === "number") regs[fp + SLOTS.NOISE_ACC] = regs[fp + SLOTS.NOISE_ACC] ^ pc | 0;

    // Debugging protection: Detects debugger by checking for >1s pauses which can only happen from debugger; or extremely slow sync tasks
    if (TIMING_CHECKS) {
      var currentTime = now();
      var isTamper = currentTime - lastTime > TIMING_CHECKS;
      lastTime = currentTime;
      if (isTamper) {
        // Poison the bytecode
        for (var i = 0; i < this.bytecode.length; i++) this.bytecode[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this._regsTop; i2++) this._regs[i2] = undefined;
        op = OP.JUMP;
        regs[fp + SLOTS.PC] = this.bytecode.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + SLOTS.REG_BASE];

      /* @SWITCH */
      switch (op) {
        case OP.LOAD_CONST:
          {
            var dst = this._operand();
            regs[base + dst] = this._constant();
            break;
          }
        case OP.LOAD_INT:
          {
            var dst = this._operand();
            regs[base + dst] = this._operand();
            break;
          }
        case OP.LOAD_GLOBAL:
          {
            var dst = this._operand();
            var globalName = this._constant();
            if (!(globalName in this.globals)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.globals[globalName];
            break;
          }
        case OP.LOAD_UPVALUE:
          {
            var dst = this._operand();
            regs[base + dst] = regs[fp + SLOTS.CLOSURE].upvalues[this._operand()]._read();
            break;
          }
        case OP.LOAD_THIS:
          {
            var dst = this._operand();
            regs[base + dst] = regs[fp + SLOTS.THIS];
            break;
          }
        case OP.MOVE:
          {
            var dst = this._operand();
            regs[base + dst] = regs[base + this._operand()];
            break;
          }
        case OP.STORE_GLOBAL:
          {
            // globals[globalName] = regs[src]
            this.globals[this._constant()] = regs[base + this._operand()];
            break;
          }
        case OP.STORE_UPVALUE:
          {
            var uvIdx = this._operand();
            regs[fp + SLOTS.CLOSURE].upvalues[uvIdx]._write(regs[base + this._operand()]);
            break;
          }
        case OP.GET_PROP:
          {
            // dst = regs[obj][regs[key]]
            var dst = this._operand();
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            regs[base + dst] = obj[key];
            break;
          }
        case OP.SET_PROP:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            var val = regs[base + this._operand()];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case OP.DELETE_PROP:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this._operand();
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case OP.ADD:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a + regs[base + this._operand()];
            break;
          }
        case OP.SUB:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a - regs[base + this._operand()];
            break;
          }
        case OP.MUL:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a * regs[base + this._operand()];
            break;
          }
        case OP.DIV:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a / regs[base + this._operand()];
            break;
          }
        case OP.MOD:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a % regs[base + this._operand()];
            break;
          }
        case OP.EXP:
          {
            // Math.pow instead of `**`
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = Math.pow(a, regs[base + this._operand()]);
            break;
          }
        case OP.BAND:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a & regs[base + this._operand()];
            break;
          }
        case OP.BOR:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a | regs[base + this._operand()];
            break;
          }
        case OP.BXOR:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a ^ regs[base + this._operand()];
            break;
          }
        case OP.SHL:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a << regs[base + this._operand()];
            break;
          }
        case OP.SHR:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a >> regs[base + this._operand()];
            break;
          }
        case OP.USHR:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a >>> regs[base + this._operand()];
            break;
          }

        // Comparison  (dst, src1, src2)
        case OP.LT:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a < regs[base + this._operand()];
            break;
          }
        case OP.GT:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a > regs[base + this._operand()];
            break;
          }
        case OP.LTE:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a <= regs[base + this._operand()];
            break;
          }
        case OP.GTE:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a >= regs[base + this._operand()];
            break;
          }
        case OP.EQ:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a === regs[base + this._operand()];
            break;
          }
        case OP.NEQ:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a !== regs[base + this._operand()];
            break;
          }
        case OP.LOOSE_EQ:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a == regs[base + this._operand()];
            break;
          }
        case OP.LOOSE_NEQ:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a != regs[base + this._operand()];
            break;
          }
        case OP.IN:
          {
            var dst = this._operand();
            var a = regs[base + this._operand()];
            regs[base + dst] = a in regs[base + this._operand()];
            break;
          }
        case OP.INSTANCEOF:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this._operand();
            var obj = regs[base + this._operand()];
            regs[base + dst] = obj instanceof regs[base + this._operand()];
            break;
          }

        // Unary  (dst, src)
        case OP.UNARY_NEG:
          {
            var dst = this._operand();
            regs[base + dst] = -regs[base + this._operand()];
            break;
          }
        case OP.UNARY_POS:
          {
            var dst = this._operand();
            regs[base + dst] = +regs[base + this._operand()];
            break;
          }
        case OP.UNARY_NOT:
          {
            var dst = this._operand();
            regs[base + dst] = !regs[base + this._operand()];
            break;
          }
        case OP.UNARY_BITNOT:
          {
            var dst = this._operand();
            regs[base + dst] = ~regs[base + this._operand()];
            break;
          }
        case OP.TYPEOF:
          {
            var dst = this._operand();
            regs[base + dst] = typeof regs[base + this._operand()];
            break;
          }
        case OP.VOID:
          {
            var dst = this._operand();
            this._operand(); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case OP.TYPEOF_SAFE:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this._operand();
            var name = this._constant();
            var val = Object.prototype.hasOwnProperty.call(this.globals, name) ? this.globals[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case OP.JUMP:
          regs[fp + SLOTS.PC] = this._operand();
          break;
        case OP.JUMP_IF_FALSE:
          {
            var src = this._operand();
            var target = this._operand();
            if (!regs[base + src]) regs[fp + SLOTS.PC] = target;
            break;
          }
        case OP.JUMP_IF_TRUE:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this._operand();
            var target = this._operand();
            if (regs[base + src]) regs[fp + SLOTS.PC] = target;
            break;
          }

        // Calls
        case OP.CALL:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this._operand();
            var callee = regs[base + this._operand()];
            var argc = this._operand();
            var args;
            if (argc === SENTINELS.CALL_SPREAD) {
              args = regs[base + this._operand()];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this._operand()];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this._pushFrame(closure, args, this.globals, dst << 1);
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case OP.CALL_METHOD:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this._operand();
            var receiver = regs[base + this._operand()];
            var callee = regs[base + this._operand()];
            var argc = this._operand();
            var args;
            if (argc === SENTINELS.CALL_SPREAD) {
              args = regs[base + this._operand()];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this._operand()];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this._pushFrame(closure, args, receiver, dst << 1);
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case OP.NEW:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this._operand();
            var callee = regs[base + this._operand()];
            var argc = this._operand();
            var args;
            if (argc === SENTINELS.CALL_SPREAD) {
              args = regs[base + this._operand()];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this._operand()];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this._pushFrame(closure, args, Object.create(closure.prototype || null), dst << 1 | 1);
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case OP.RETURN:
          {
            var retVal = regs[base + this._operand()];
            this._closeUpvaluesFor(fp); // must happen before frame is abandoned

            var caller = regs[fp + SLOTS.CALLER];
            var retDst = regs[fp + SLOTS.RET_DST];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + SLOTS.THIS];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + SLOTS.FRAME_SIZE];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this._regsTop = fp;
            this._f = caller;

            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + SLOTS.REG_BASE] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case OP.THROW:
          throw regs[base + this._operand()];

        // Closures
        case OP.MAKE_CLOSURE:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this._operand();
            var startPc = this._operand();
            var paramCount = this._operand();
            var regCount = this._operand();
            var uvCount = this._operand();
            var hasRest = this._operand(); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this._operand();
              var uvIndex = this._operand();
              uvDescs[i] = {
                isLocal: isLocalRaw,
                _index: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              paramCount: paramCount,
              regCount: regCount,
              startPc: startPc,
              hasRest: hasRest
            };
            var closure = new Closure(fn);
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.isLocal) {
                closure.upvalues.push(this.captureUpvalue(fp, uvd._index));
              } else {
                closure.upvalues.push(regs[fp + SLOTS.CLOSURE].upvalues[uvd._index]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM(self.bytecode, self.constants, self.globals).run(c, this == null ? self.globals : this, Array.prototype.slice.call(arguments));
              };
            }(closure);
            CLOSURE_MAP.set(shell, closure);
            shell.prototype = closure.prototype; // unified prototype for new/instanceof
            regs[base + dst] = shell;
            break;
          }

        // Collections
        case OP.BUILD_ARRAY:
          {
            // dst, count, [elemReg...]
            var dst = this._operand();
            var count = this._operand();
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this._operand()];
            regs[base + dst] = elems;
            break;
          }
        case OP.BUILD_OBJECT:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this._operand();
            var pairCount = this._operand();
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this._operand()];
              var val = regs[base + this._operand()];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case OP.DEFINE_GETTER:
          {
            // obj, key, fn
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            var getterFn = regs[base + this._operand()];
            var existingDesc = Object.getOwnPropertyDescriptor(obj, key);
            var getDesc = {
              get: getterFn,
              configurable: true,
              enumerable: true
            };
            if (existingDesc && typeof existingDesc.set === "function") {
              getDesc.set = existingDesc.set;
            }
            Object.defineProperty(obj, key, getDesc);
            break;
          }
        case OP.DEFINE_SETTER:
          {
            // obj, key, fn
            var obj = regs[base + this._operand()];
            var key = regs[base + this._operand()];
            var setterFn = regs[base + this._operand()];
            var existingDesc = Object.getOwnPropertyDescriptor(obj, key);
            var setDesc = {
              set: setterFn,
              configurable: true,
              enumerable: true
            };
            if (existingDesc && typeof existingDesc.get === "function") {
              setDesc.get = existingDesc.get;
            }
            Object.defineProperty(obj, key, setDesc);
            break;
          }

        // ── For-in iteration ──────────────────────────────────────────────────
        case OP.FOR_IN_SETUP:
          {
            // dst, src — build iterator object from enumerable keys of regs[src]
            var dst = this._operand();
            var obj = regs[base + this._operand()];
            var keys = [];
            if (obj !== null && obj !== undefined) {
              var seen = Object.create(null);
              var cur = Object(obj); // box primitives
              while (cur !== null) {
                var ownNames = Object.getOwnPropertyNames(cur);
                for (var i = 0; i < ownNames.length; i++) {
                  var k = ownNames[i];
                  if (!(k in seen)) {
                    seen[k] = true;
                    var propDesc = Object.getOwnPropertyDescriptor(cur, k);
                    if (propDesc && propDesc.enumerable) {
                      keys.push(k);
                    }
                  }
                }
                cur = Object.getPrototypeOf(cur);
              }
            }
            regs[base + dst] = {
              _keys: keys,
              i: 0
            };
            break;
          }
        case OP.FOR_IN_NEXT:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this._operand();
            var iter = regs[base + this._operand()];
            var exitTarget = this._operand();
            if (iter.i >= iter._keys.length) {
              regs[fp + SLOTS.PC] = exitTarget;
            } else {
              regs[base + dst] = iter._keys[iter.i++];
            }
            break;
          }

        // ── Exception handling ────────────────────────────────────────────────
        case OP.TRY_SETUP:
          {
            // handlerPc, exceptionReg — push exception handler record onto current
            // frame. The handler stack lives in a header slot and is created on
            // first use, so frames that never try/catch carry nothing.
            var hs = regs[fp + SLOTS.HANDLERS];
            if (!hs) regs[fp + SLOTS.HANDLERS] = hs = [];
            hs.push({
              handlerPc: this._operand(),
              exceptionReg: this._operand()
            });
            break;
          }
        case OP.TRY_END:
          {
            // Normal exit from a try block — disarm the top handler record
            // (works for both catch and finally regions; they share the stack).
            regs[fp + SLOTS.HANDLERS].pop();
            break;
          }
        case OP.FINALLY_SETUP:
          {
            // finallyPc, contReg, payloadReg, throwPad
            // Arm a finalizer for the current region.  Unlike a catch record this
            // carries no exceptionReg; instead the continuation register (contReg)
            // receives the resume PC and payloadReg carries the in-flight value.
            var hs = regs[fp + SLOTS.HANDLERS];
            if (!hs) regs[fp + SLOTS.HANDLERS] = hs = [];
            hs.push({
              finallyPc: this._operand(),
              contReg: this._operand(),
              payloadReg: this._operand(),
              throwPad: this._operand()
            });
            break;
          }

        // Self-modifying bytecode
        case OP.PATCH:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this._operand();
            var sliceStart = this._operand();
            var sliceEnd = this._operand();
            var pk = this._operand() ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.bytecode[destPc + (pi - sliceStart)] = (this.bytecode[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case OP.JUMP_REG:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + SLOTS.PC] = regs[base + this._operand()];
            break;
          }
        case OP.DEBUGGER:
          {
            debugger;
            break;
          }
        default:
          throw new Error("Unknown opcode: " + op + " at pc " + (regs[fp + SLOTS.PC] - 1));
      }
    } catch (err) {
      // Exception handler unwinding
      // Walk the CALLER chain from the current frame until we find one holding an open exception handler (TRY_SETUP without a matching TRY_END).
      // For every frame we abandon along the way, close its captured upvalues and release its block.
      var handledFrame = 0;
      var searchFrame = this._f;
      while (searchFrame) {
        var handlers = regs[searchFrame + SLOTS.HANDLERS];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this._closeUpvaluesFor(searchFrame);
        this._regsTop = searchFrame;
        searchFrame = regs[searchFrame + SLOTS.CALLER];
        this._f = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + SLOTS.HANDLERS].pop();
      var hBase = regs[handledFrame + SLOTS.REG_BASE];
      if (h.exceptionReg !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.exceptionReg] = err;
        regs[handledFrame + SLOTS.PC] = h.handlerPc;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.contReg] = h.throwPad;
        regs[hBase + h.payloadReg] = err;
        regs[handledFrame + SLOTS.PC] = h.finallyPc;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this._regsTop = handledFrame + regs[handledFrame + SLOTS.FRAME_SIZE];
      this._f = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this._f) return this._regs[0];
  }
};

/* @BOOT */ // <- This comment can't be removed!
var globals = globalThis;
if (typeof window !== "undefined") {
  globals.window = window;
  globals.document = typeof document !== "undefined" ? document : undefined;
}
if (typeof module !== "undefined") {
  globals.module = module;
  globals.exports = typeof exports !== "undefined" ? exports : undefined;
}
var vm = new VM(decodeBytecode(BYTECODE), CONSTANTS, globals);
vm.run(new Closure({
  paramCount: 0,
  regCount: MAIN_REG_COUNT,
  startPc: MAIN_START_PC
}), undefined, null // no arguments object / parameter setup for the root frame
);