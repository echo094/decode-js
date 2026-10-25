var CONSTANTS = [/* 0 */"window", /* 1 */"TEST_OUTPUT", /* 2 */"values", /* 3 */"sum", /* 4 */"console", /* 5 */"log", /* 6 */"JSON", /* 7 */"stringify", /* 8 */0, /* 9 */1, /* 10 */undefined, /* 11 */16, /* 12 */21, /* 13 */3356898789, /* 14 */"Math", /* 15 */"imul", /* 16 */3153583793, /* 17 */31, /* 18 */409582081, /* 19 */226070299, /* 20 */2725810369, /* 21 */"length", /* 22 */"push", /* 23 */5, /* 24 */10];
var BYTECODE = [56, 5, 1003, 1068, 2418877890, 8, 1, 17, 20, 56, 890, 902, 903, 3191824374, 26, 2, 6, 10, 14, 9, 23, 2, 32, 11, 0, 55, 5, 18, 16, 21, 7, 1, 6, 32, 13, 24, 56, 1102, 880, 881, 3397930814, 16, 13, 13, 1, 25, 21, 2, 4, 23, 23, 20, 10, 25, 3, 24, 19, 56, 1148, 1152, 1153, 1681299661, 15, 2, 9, 16, 19, 1, 22, 16, 56, 75, 928, 970, 2861813923, 18, 17, 3, 3, 56, 877, 872, 877, 1144362781, 56, 819, 878, 892, 1870995828, 20, 15, 23, 3, 12, 12, 3, 19, 55, 17, 11, 21, 8, 8, 4, 0, 4, 13, 18, 0, 16, 56, 885, 799, 803, 538245800, 55, 43, 39, 284, 24, 20, 3, 20, 23, 23, 24, 7, 56, 132, 970, 1003, 2816895765, 56, 826, 819, 829, 1618789682, 56, 1094, 874, 887, 676717705, 26, 19, 16, 5, 23, 4, 17, 10, 56, 748, 882, 895, 1410980023, 20, 7, 21, 9, 56, 1113, 1092, 1096, 3346518666, 14, 56, 170, 908, 928, 3044495838, 56, 1121, 792, 794, 80945655, 8, 0, 5, 18, 56, 784, 809, 811, 2107129722, 56, 846, 1093, 1109, 903557224, 43, 39, 284, 2, 13, 0, 0, 0, 14, 1, 0, 0, 15, 2, 0, 0, 16, 3, 0, 49, 17, 2, 15, 4, 16, 5, 9, 13, 14, 17, 2, 13, 4, 0, 0, 14, 5, 0, 8, 15, 13, 14, 2, 14, 6, 0, 0, 16, 7, 0, 8, 17, 14, 16, 2, 16, 0, 0, 0, 18, 1, 0, 8, 19, 16, 18, 43, 16, 14, 17, 1, 19, 43, 14, 13, 15, 1, 16, 56, 272, 729, 733, 766248056, 25, 1, 23, 14, 45, 13, 32, 4, 23, 5, 5, 14, 56, 289, 786, 792, 3496742039, 20, 17, 10, 15, 55, 54, 56, 300, 906, 908, 3195138699, 55, 45, 47, 10, 586, 3, 10, 0, 0, 4, 2, 0, 13, 8, 0, 5, 3, 13, 0, 13, 9, 0, 5, 4, 13, 56, 330, 1068, 1072, 2853203043, 36, 5, 5, 8, 5, 5, 13, 22, 13, 5, 0, 34, 11, 13, 33, 11, 11, 1, 7, 1770665023, 1, 12, 3761099685, 12, 12, 12, 7, 13, 12, 12, 11, 11, 7, 7, 12, 1, 8, 8356, 1, 9, 50985, 39, 426, 11, 13, 3, 4, 5, 6, 13, 5, 3, 4, 5, 4, 6, 5, 13, 5, 0, 13, 9, 0, 11, 14, 5, 13, 5, 5, 14, 1, 7, 437768149, 1, 8, 24738, 1, 9, 29207, 39, 426, 36, 2, 16, 27, 23, 13, 9, 45, 3, 0, 13, 10, 0, 45, 13, 42, 7, 10, 3, 7, 8, 9, 58, 7, 4, 3, 0, 4, 11, 0, 19, 5, 1, 4, 0, 4, 11, 0, 21, 6, 1, 4, 17, 4, 5, 6, 0, 5, 8, 0, 21, 6, 4, 5, 5, 1, 6, 18, 4, 1, 0, 0, 5, 8, 0, 21, 6, 4, 5, 5, 1, 6, 0, 4, 12, 0, 21, 5, 1, 4, 18, 4, 1, 5, 0, 5, 8, 0, 21, 6, 4, 5, 5, 1, 6, 0, 4, 13, 0, 11, 5, 1, 4, 0, 4, 8, 0, 21, 6, 5, 4, 5, 1, 6, 35, 4, 1, 0, 5, 8, 0, 21, 6, 4, 5, 5, 1, 6, 2, 4, 14, 0, 0, 5, 15, 0, 8, 6, 4, 5, 0, 5, 16, 0, 43, 7, 4, 6, 2, 1, 5, 0, 4, 8, 0, 21, 5, 7, 4, 5, 1, 5, 45, 1, 0, 4, 10, 0, 45, 4, 56, 801, 874, 890, 2416914181, 4, 4, 0, 6, 11, 0, 19, 7, 2, 6, 17, 6, 1, 7, 0, 7, 8, 0, 21, 8, 6, 7, 5, 5, 8, 0, 6, 17, 0, 21, 7, 0, 6, 18, 6, 0, 7, 0, 7, 8, 0, 21, 8, 6, 7, 5, 0, 8, 0, 6, 18, 0, 12, 7, 0, 6, 0, 6, 8, 0, 21, 8, 7, 6, 5, 0, 8, 18, 6, 0, 5, 0, 7, 8, 0, 21, 8, 6, 7, 5, 0, 8, 0, 6, 19, 0, 11, 7, 0, 6, 0, 6, 8, 0, 21, 8, 7, 6, 5, 0, 8, 2, 6, 14, 0, 0, 7, 15, 0, 8, 8, 6, 7, 0, 7, 20, 0, 43, 9, 6, 8, 2, 0, 7, 0, 6, 8, 0, 21, 7, 9, 6, 5, 0, 7, 45, 0, 0, 6, 10, 0, 45, 6, 3420790842, 1780066304, 139603978, 2794248195, 24, 11, 24, 6, 56, 1102, 1141, 1153, 1231110896, 19, 2, 4, 18, 19, 2, 14, 23, 56, 864, 886, 898, 2194950245, 56, 813, 877, 881, 2446133565, 36, 5, 22, 16, 5, 3, 6, 32, 24, 5, 11, 7, 18, 22, 13, 20, 22, 8, 26, 23, 13, 20, 1, 9, 20231, 8, 1856041561, 215705592, 2870420088, 1229700823, 3884339793, 2243741123, 56, 822, 1135, 1149, 1324422306, 35, 4, 11, 12, 13, 20, 11, 19, 3, 23, 2, 26, 16, 9, 18, 13, 16, 8, 7, 56, 1084, 796, 799, 3104813082, 17, 1, 11, 8, 56, 881, 1125, 1130, 3954597906, 22, 9, 5, 4, 56, 1112, 893, 906, 2915529137, 32, 24, 9, 26, 6, 7, 22, 56, 758, 1140, 1151, 3388876845, 25, 1, 16, 17, 32, 13, 4, 12, 22, 14, 18, 56, 1083, 1130, 1145, 447809097, 5, 16, 13, 55, 16, 22, 3, 16, 32, 1, 12, 16, 15, 16, 11, 1, 11, 10600, 55, 25, 5, 3, 9, 12, 10, 12, 16, 4, 14, 12, 11, 15, 19, 56, 811, 809, 812, 72918945, 29, 1554745361, 4209455126, 1403803230, 4058106841, 2417573492, 777276145, 3431650937, 1791458786, 150725214, 2805343919, 1164489647, 3819245496, 2178777766, 537921197, 3192753564, 1551702627, 4205881073, 2565483131, 615616320, 3579529880, 1939261068, 1651996919, 1221135611, 3875929153, 2235439063, 594586689, 3249487044, 1608668213, 4263498805, 2622192833, 981912647, 3635959771, 1995816045, 355282166, 3009504328, 1369372142, 4023684141, 2383354882, 742622253, 3397127219, 1756535821, 115958813, 2770723864, 1129995277, 3783838961, 3201650765, 503208973, 3157511183, 3713201038, 4171424769, 2530749493, 890616890, 3545043995, 1904247808, 263912473, 2918487289, 1277891699, 3932667360, 2291936366, 651088937, 3305206817, 1664994343, 24527922, 2928393214, 1176491437, 3830611364, 2190003417, 549803089, 3204332506, 1563536499, 4218250487, 2577855561, 936906194, 3591871559, 1951073478, 310424626, 2964462666, 1324180698, 3978421322, 2337955281, 697617534, 3351954682, 1711752299, 71028695, 2725671950, 1084810285, 3739528230, 2098871337, 458331177, 3113026586, 1472396317, 4126151805, 2485884154, 845626381, 3499666444, 1859572761, 218985487, 778431627, 3432676819, 1792067037, 151733489, 2806496376, 1165503437, 3820381277, 2179792076, 539061322, 3193050513, 1552778444, 4206955883, 2566558687, 926184516, 3580620020, 1940348017, 299677172, 2954245206, 1313430742, 3968191534, 2327737384, 686873641, 3341757486, 1701028891, 60298262, 2714406116, 1074068605, 3728246768, 2088111132, 447593481, 3101762569, 1461642245, 4115954734, 2475674651, 834880516, 3489414185, 1848822808, 208229488, 2862999038, 1222274144, 3876101146, 2235773961, 595561515, 3249544224, 1609528369, 4263703581, 2623052880, 982658280, 3637359726, 1996575738, 356174972, 3010741461, 1370215507, 4024937923, 2384215108, 743351364, 3397479364, 1757281353, 116786395, 2770895939, 1130839549, 3785075824, 2144855275, 504063069, 3158765525, 1212523741, 3866645357, 2226323434, 586105727, 34, 4, 0, 56, 855, 885, 893, 2249968749, 23, 2, 15, 16, 56, 849, 746, 761, 3871796980, 13, 18, 6, 1, 16, 20, 21, 2, 22, 12, 9, 6, 20, 7, 5, 2, 12, 16, 0, 2, 26, 20, 24, 3, 56, 1143, 806, 811, 536411620, 14, 12, 9, 14, 23, 20, 11, 1, 5, 17, 7, 23, 55, 24, 13, 7, 22, 14, 8, 0, 23, 14, 19, 21, 22, 34, 16, 15, 27, 5, 6, 8, 55, 24, 4, 19, 9, 24];
var MAIN_START_PC = 0;
var MAIN_REG_COUNT = 20;
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