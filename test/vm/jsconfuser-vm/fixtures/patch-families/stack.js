var CONSTANTS = [/* 0 */5, /* 1 */"window", /* 2 */"TEST_OUTPUT", /* 3 */6, /* 4 */7, /* 5 */3, /* 6 */"GwUDm", /* 7 */undefined, /* 8 */62072, /* 9 */44867, /* 10 */"Dnqew1cI", /* 11 */14351, /* 12 */0];
var BYTECODE = [56, 5, 324, 332, 2103690502, 56, 312, 107, 110, 494315154, 36, 3, 16, 56, 18, 173, 209, 3220258786, 11, 0, 22, 17, 32, 23, 1, 17, 4, 16, 16, 18, 21, 19, 24, 21, 24, 13, 12, 5, 13, 10, 55, 56, 134, 135, 141, 3389204423, 15, 15, 22, 18, 34, 15, 11, 50, 56, 59, 153, 173, 2089660694, 56, 382, 451, 460, 1295014798, 55, 8, 8, 19, 14, 56, 381, 314, 318, 592580987, 26, 0, 5, 4, 32, 56, 84, 269, 270, 4214031348, 33, 56, 90, 270, 275, 538041785, 14, 24, 6, 13, 38, 56, 280, 387, 400, 448859617, 14, 1, 2, 5, 26, 6, 11, 4, 56, 131, 443, 455, 761258985, 25, 6, 10, 0, 21, 6, 1, 23, 17, 14, 18, 17, 56, 136, 278, 294, 3245231503, 56, 433, 300, 305, 3672113915, 23, 10, 8, 22, 56, 303, 277, 278, 11546470, 27, 18, 2, 10, 5, 5, 0, 4, 1, 449182854, 3103351667, 1463199736, 4117508941, 2477231341, 836437340, 3491005871, 1850346685, 209755299, 2864523175, 1223535453, 3877657835, 2237330790, 597116413, 3251363176, 1611025556, 4265293714, 2624627599, 984247478, 3638949051, 1579829416, 4234661926, 2593356270, 953082021, 3607107770, 1966977974, 326436954, 2980610259, 1340536917, 3994775939, 2354518130, 713793739, 3368298562, 1727717372, 87115846, 2741878980, 1101158456, 3755028558, 2114762962, 474357849, 3128684526, 1488416882, 4142569700, 2501902372, 861780457, 3516207142, 1875404846, 235069446, 2889836595, 1249103889, 3903830037, 2263105555, 622254204, 3276370160, 1636165690, 4290355213, 16, 5, 16, 15, 56, 439, 296, 310, 2869808688, 34, 13, 5, 5, 1, 19, 56, 414, 379, 392, 2583648503, 35, 23, 7, 4, 22, 13, 20, 14, 0, 17, 12, 3, 5, 36, 20, 0, 27, 1, 18, 17, 32, 7, 21, 15, 23, 7, 11, 13, 14, 5, 13, 34, 22, 0, 5, 12, 9, 55, 4, 4, 2573252156, 3192694175, 1552037204, 4206862028, 2565538750, 925272062, 22, 14, 7, 11, 23, 18, 15, 15, 18, 24, 12, 3, 16, 6, 9, 17, 16, 14, 5, 5, 11, 10, 15, 6, 56, 447, 116, 129, 1885507148, 12, 9, 23, 16, 21, 16, 21, 22, 13, 9, 18, 17, 17, 14, 11, 21, 34, 24, 15, 35, 463200805, 3117905569, 1476981309, 4131789225, 2491254304, 850463451, 3505299026, 1864165947, 19, 8, 23, 9, 21, 14, 0, 11, 15, 17, 6, 22, 56, 366, 405, 409, 661359168, 12, 15, 12, 9, 27, 22, 5, 8, 24, 12, 7, 16, 27, 20, 11, 2, 35, 7, 9, 36, 8, 17, 21, 19, 0, 22, 4, 12, 10, 56, 315, 275, 282, 3377722290, 24, 10, 0, 13, 32, 20, 23, 36, 11, 0, 13, 1, 6, 21, 56, 143, 439, 445, 2002891106, 34, 10, 24, 19, 15, 0, 11, 56, 432, 288, 293, 2165858660, 18, 24, 8, 9, 32, 10, 5, 56, 279, 100, 111, 2874137787, 27, 11, 12, 5, 56, 390, 386, 397, 2585180553, 25, 13, 18, 19, 21, 3, 16, 10, 19, 5, 8, 12, 27, 14, 23, 11, 56, 429, 308, 316, 2431941071, 35, 12, 16, 60];
var MAIN_START_PC = 0;
var MAIN_REG_COUNT = 12;
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
        case 64:
          {
            // LOAD_CONST_3_8_0 (specialized)
            var dst = 3;
            regs[base + dst] = this._constant(8, 0);
            break;
          }
        case 65:
          {
            // LOAD_CONST_5_9_0 (specialized)
            var dst = 5;
            regs[base + dst] = this._constant(9, 0);
            break;
          }
        case 66:
          {
            // LOAD_CONST_2_10_0 (specialized)
            var dst = 2;
            regs[base + dst] = this._constant(10, 0);
            break;
          }
        case 67:
          {
            // LOAD_CONST_4_11_0 (specialized)
            var dst = 4;
            regs[base + dst] = this._constant(11, 0);
            break;
          }
        case 68:
          {
            // LOAD_THIS_1 (specialized)
            var dst = 1;
            regs[base + dst] = regs[fp + SLOTS.THIS];
            break;
          }
        case 69:
          {
            // LOAD_GLOBAL_7_1_0 (specialized)
            var dst = 7;
            var globalName = this._constant(1, 0);
            if (!(globalName in this.globals)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.globals[globalName];
            break;
          }
        case 70:
          {
            // SET_PROP_7_8_11 (specialized)
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + 7];
            var key = regs[base + 8];
            var val = regs[base + 11];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 71:
          {
            // RETURN_7 (specialized)
            var retVal = regs[base + 7];
            this._closeUpvaluesFor(fp); // must happen before frame is abandoned

            // must happen before frame is abandoned

            var caller = regs[fp + SLOTS.CALLER];
            var retDst = regs[fp + SLOTS.RET_DST];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + SLOTS.THIS];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
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
            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + SLOTS.REG_BASE] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 72:
          {
            // LOAD_CONST,LOAD_CONST (macro)
            // LOAD_CONST
            var dst = this._operand();
            regs[base + dst] = this._constant();
            // LOAD_CONST
            var dst = this._operand();
            regs[base + dst] = this._constant();
            break;
          }
        case 73:
          {
            // ALIAS_LOAD_CONST_0_2_1 (order: [0,2,1])
            let _unsortedOperands = [this._operand(), this._operand(), this._operand()];
            let _operands = [_unsortedOperands[0], _unsortedOperands[2], _unsortedOperands[1]];
            var dst = _operands[0];
            regs[base + dst] = this._constant(_operands[1], _operands[2]);
            break;
          }
        case 61:
          {
            // ANTI_MUL_8_0_5_1_3_6_4_7_2 (order: [8,0,5,1,3,6,4,7,2])
            let _unsortedOperands = [this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand()];
            let _operands = [_unsortedOperands[1], _unsortedOperands[3], _unsortedOperands[8], _unsortedOperands[4], _unsortedOperands[6], _unsortedOperands[2], _unsortedOperands[5], _unsortedOperands[7], _unsortedOperands[0]];
            // EQ
            var dst = _operands[0];
            var a = regs[base + _operands[1]];
            regs[base + dst] = a === regs[base + _operands[2]];
            // LT
            var dst = _operands[3];
            var a = regs[base + _operands[4]];
            regs[base + dst] = a < regs[base + _operands[5]];
            // MUL
            var dst = _operands[6];
            var a = regs[base + _operands[7]];
            regs[base + dst] = a * regs[base + _operands[8]];
            break;
          }
        case 62:
          {
            // ANTI_ADD_6_5_3_7_0_2_4_1 (order: [6,5,3,7,0,2,4,1])
            let _unsortedOperands = [this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand()];
            let _operands = [_unsortedOperands[4], _unsortedOperands[7], _unsortedOperands[5], _unsortedOperands[2], _unsortedOperands[6], _unsortedOperands[1], _unsortedOperands[0], _unsortedOperands[3]];
            // ADD
            var dst = _operands[0];
            var a = regs[base + _operands[1]];
            regs[base + dst] = a + regs[base + _operands[2]];
            // JUMP_IF_FALSE
            var src = _operands[3];
            var target = _operands[4];
            if (!regs[base + src]) regs[fp + SLOTS.PC] = target;
            // TYPEOF_SAFE
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = _operands[5];
            var name = this._constant(_operands[6], _operands[7]);
            var val = Object.prototype.hasOwnProperty.call(this.globals, name) ? this.globals[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }
        case 63:
          {
            // ANTI_MOD_0_5_13_1_6_12_2_9_11_7_8_10_14_3_4 (order: [0,5,13,1,6,12,2,9,11,7,8,10,14,3,4])
            let _unsortedOperands = [this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand(), this._operand()];
            let _operands = [_unsortedOperands[0], _unsortedOperands[3], _unsortedOperands[6], _unsortedOperands[13], _unsortedOperands[14], _unsortedOperands[1], _unsortedOperands[4], _unsortedOperands[9], _unsortedOperands[10], _unsortedOperands[7], _unsortedOperands[11], _unsortedOperands[8], _unsortedOperands[5], _unsortedOperands[2], _unsortedOperands[12]];
            // MOD
            var dst = _operands[0];
            var a = regs[base + _operands[1]];
            regs[base + dst] = a % regs[base + _operands[2]];
            // LT
            var dst = _operands[3];
            var a = regs[base + _operands[4]];
            regs[base + dst] = a < regs[base + _operands[5]];
            // SHR
            var dst = _operands[6];
            var a = regs[base + _operands[7]];
            regs[base + dst] = a >> regs[base + _operands[8]];
            // EQ
            var dst = _operands[9];
            var a = regs[base + _operands[10]];
            regs[base + dst] = a === regs[base + _operands[11]];
            // ADD
            var dst = _operands[12];
            var a = regs[base + _operands[13]];
            regs[base + dst] = a + regs[base + _operands[14]];
            break;
          }
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