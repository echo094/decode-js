function decodeBytecode(s) {
  if (!false) return s;
  var b = base64ToBytes(s);
  // Each slot is a u32 stored as 4 little-endian bytes.
  var r = new Uint32Array(b.length / 4);
  for (var i = 0; i < r.length; i++) r[i] = (b[i * 4] | b[i * 4 + 1] << 8 | b[i * 4 + 2] << 16 | b[i * 4 + 3] << 24) >>> 0;
  return r;
}

// Closure map
// Maps shell functions -> inner Closure so the VM can fast-path instead of going through a sub-VM on internal calls.
// A WeakMap is used over a Symbol to prevent leaking information to debuggers
var BYTECODE = [4, 1, 2, 2, 0, 0, 0, 3, 1, 0, 0, 4, 2, 0, 0, 5, 3, 0, 13, 6, 4, 5, 0, 4, 4, 0, 11, 5, 6, 4, 0, 4, 5, 0, 15, 6, 5, 4, 9, 2, 3, 6, 0, 2, 6, 0, 45, 2];
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
// VM
// There is no Frame object and no frame stack. A frame is a block of slots in
// the flat array `_regs`: HEADER_SIZE header slots (see utils/frame-layout.ts) followed
// by the frame's registers. `_f` — the only piece of live execution state the VM
// object exposes — is the current frame's base offset, and each frame's CALLER
// slot points at the one that called it, so the call stack is an implicit linked
// list with nothing to enumerate.
function VM(fake_17, fake_15, globals, fake_16, bytecode, constants) {
  this.z = bytecode;
  this.r = constants;
  this.K = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this.e = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this.G = fake_16;
  this.A = [];
  this.w = fake_15;
  this.c = fake_17;
  this.n = 1;
  this.q = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
var CONSTANTS = [/* 0 */"window", /* 1 */"TEST_OUTPUT", /* 2 */6, /* 3 */7, /* 4 */3, /* 5 */5, /* 6 */undefined];
var CLOSURE_MAP = new WeakMap();

// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)

// Closure & Frame
function Closure(fake_14, fn) {
  this.ad = fn;
  this.C = [];
  this.m = fake_14;
  this.prototype = {}; // <- default prototype object for `new`
}
function Upvalue(absSlot, regs, fake_1) {
  this.H = fake_1;
  this.A = regs; // shared reference to VM._regs flat array
  this.p = absSlot; // absolute index; stable as long as frame is alive
  this.a = false;
  this.ab = undefined;
}
Upvalue.prototype.y = function (fake_6, fake_7, fake_9, v, fake_8) {
  if (this.a) this.ab = v;else this.A[this.p] = v;
  this.W = [fake_6, fake_9];
  this.D = fake_7 && fake_8;
};
VM.prototype.I = function (fake_18, fake_20, fake_19, fake_21) {
  this.J = fake_21;
  this.g = fake_20;
  this.f = fake_18;
  return this.z[this.A[this.q + 0]++];
  this.ae = fake_19;
};

// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).

VM.prototype.R = function (fake_33, fake_34, fake_32, fp) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this.e;
  this.X = fake_33;
  this.u = fake_34;
  if (!uvs) return; // nothing in this program ever captured a local
  this.ag = fake_32;
  var regs = this.A;
  var hi = fp + regs[fp + 6];
  for (var i = regs[fp + 7]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv.i("q", "z", {}, "q");
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
Upvalue.prototype.E = function (fake_3, fake_4, fake_2, fake_5) {
  this.o = fake_3 || fake_5;
  this.al = fake_2;
  return this.a ? this.ab : this.A[this.p];
  this.O = fake_4;
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
VM.prototype.l = function (keyIn, idxIn, fake_30, fake_31) {
  this.am = fake_30;
  var idx = idxIn ?? this.I({}, {}, [], "z");
  var key = keyIn ?? this.I(undefined, [], null, []);
  var v = this.r[idx];
  if (!key) return v;
  if (typeof v === "number") return v ^ key;
  if (typeof v !== "string") return v;

  // String: base64-decode to u16 LE byte pairs, then XOR each code with a
  // 16-bit keystream word derived from the full 32-bit key + position.
  var b = base64ToBytes(v);
  var out = "";
  this.S = fake_31;
  var k = key;
  for (var i = 0; i < b.length / 2; i++) {
    k = k + 0x9e3779b9 | 0; // 32-bit Weyl step (position-based)
    var ks = (k ^ k >>> 13) & 0xffff; // 16-bit keystream word
    var code = b[i * 2] | b[i * 2 + 1] << 8; // u16 LE
    out += String.fromCharCode(code ^ ks);
  }
  return out;
};
VM.prototype.h = function (thisVal, fake_22, fake_23, fake_24, closure, fake_25, args, retDst) {
  var fn = closure.ad;
  var regs = this.A;
  var fp = this.n;
  var size = 8 + fn.U;
  var end = fp + size;
  this.x = fake_24;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  this.Q = [fake_25, fake_22];
  this.V = fake_23;
  var base = fp + 8;
  regs[fp + 0] = fn.j;
  regs[fp + 1] = this.q;
  regs[fp + 2] = retDst;
  regs[fp + 3] = thisVal;
  regs[fp + 4] = closure;
  regs[fp + 6] = size;
  regs[fp + 7] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof void 0 === "number") regs[fp + void 0] = end;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.k;
  if (typeof void 0 === "number") regs[fp + void 0] = args;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.j;
  if (typeof void 0 === "number") regs[fp + void 0] = 0;
  this.n = end;
  if (args) {
    if (fn.ak) {
      var restSlot = fn.k - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.U; a++) regs[base + a] = args[a];
    }
    if (fn.k < fn.U) regs[base + fn.k] = args;
  }
  this.q = fp;
};
VM.prototype.t = function (fake_27, fake_26, fake_29, slot, fake_28, fp) {
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this.A[fp + 7] + slot;
  this.ah = fake_27 || fake_26;
  this.F = fake_28 && fake_29;
  var uvs = this.e || (this.e = []);
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(absSlot, this.A, []));
};
Upvalue.prototype.i = function (fake_13, fake_12, fake_11, fake_10) {
  this.ab = this.A[this.p];
  this.B = [fake_13, fake_12];
  this.a = true;
  this.Y = fake_11;
  this.L = fake_10;
};
VM.prototype.P = function (thisVal, fake_37, fake_35, fake_38, closure, fake_36, args) {
  var now = () => {
    return performance.now();
  };
  var lastTime = now();
  this.h(thisVal, [], null, undefined, closure, "x", args, 0);
  this.aa = fake_37;
  this.d = fake_38;
  while (true) {
    var fp = this.q;
    var regs = this.A;
    var bc = this.z;
    var pc = regs[fp + 0];
    if (pc >= bc.length) break;
    regs[fp + 0] = pc + 1;
    var op = this.z[pc];
    // var opcode = this.bytecode[pc];
    // console.log(`[run] pc=${pc}, opcode=${opcode}, name=${Object.keys(OP).find((key) => OP[key] === opcode)}`);

    // Churn the decoy header slots so the real PC isn't the only slot moving
    /* @NOISE */
    if (typeof void 0 === "number") regs[fp + void 0] = (regs[fp + void 0] + 1) % bc.length;
    if (typeof void 0 === "number") regs[fp + void 0]++;
    if (typeof void 0 === "number") regs[fp + void 0] = op;
    if (typeof void 0 === "number") regs[fp + void 0] = regs[fp + void 0] ^ pc | 0;

    // Debugging protection: Detects debugger by checking for >1s pauses which can only happen from debugger; or extremely slow sync tasks
    if (false) {
      var currentTime = now();
      var isTamper = currentTime - lastTime > false;
      lastTime = currentTime;
      if (isTamper) {
        // Poison the bytecode
        for (var i = 0; i < this.z.length; i++) this.z[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this.n; i2++) this.A[i2] = undefined;
        op = 39;
        regs[fp + 0] = this.z.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + 7];

      /* @SWITCH */
      switch (op) {
        case 0:
          {
            var dst = this.I({}, [], "x", 66);
            regs[base + dst] = this.l();
            break;
          }
        case 1:
          {
            var dst = this.I(4, {}, "y", "k");
            regs[base + dst] = this.I([], null, {}, 64);
            break;
          }
        case 2:
          {
            var dst = this.I("x", 5, undefined, 91);
            var globalName = this.l();
            if (!(globalName in this.K)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.K[globalName];
            break;
          }
        case 3:
          {
            var dst = this.I("y", null, undefined, {});
            regs[base + dst] = regs[fp + 4].C[this.I("y", [], undefined, undefined)].E(78, [], undefined, []);
            break;
          }
        case 4:
          {
            var dst = this.I([], {}, "k", "y");
            regs[base + dst] = regs[fp + 3];
            break;
          }
        case 5:
          {
            var dst = this.I([], undefined, [], "k");
            regs[base + dst] = regs[base + this.I(43, null, 67, [])];
            break;
          }
        case 6:
          {
            // globals[globalName] = regs[src]
            this.K[this.l()] = regs[base + this.I([], undefined, 65, null)];
            break;
          }
        case 7:
          {
            var uvIdx = this.I({}, null, undefined, []);
            regs[fp + 4].C[uvIdx].y([], {}, [], regs[base + this.I("y", undefined, 89, 54)], {});
            break;
          }
        case 8:
          {
            // dst = regs[obj][regs[key]]
            var dst = this.I(null, {}, [], "x");
            var obj = regs[base + this.I(29, [], 40, null)];
            var key = regs[base + this.I(8, "y", null, {})];
            regs[base + dst] = obj[key];
            break;
          }
        case 9:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this.I(undefined, undefined, {}, 35)];
            var key = regs[base + this.I({}, 55, null, [])];
            var val = regs[base + this.I([], [], 59, 84)];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 10:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this.I({}, {}, "k", "k");
            var obj = regs[base + this.I(null, "z", [], undefined)];
            var key = regs[base + this.I([], null, null, undefined)];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case 11:
          {
            var dst = this.I(null, undefined, 13, 74);
            var a = regs[base + this.I({}, null, "z", null)];
            regs[base + dst] = a + regs[base + this.I(null, null, null, 8)];
            break;
          }
        case 12:
          {
            var dst = this.I(4, null, {}, undefined);
            var a = regs[base + this.I([], null, {}, [])];
            regs[base + dst] = a - regs[base + this.I("k", [], [], undefined)];
            break;
          }
        case 13:
          {
            var dst = this.I(null, undefined, [], undefined);
            var a = regs[base + this.I(undefined, {}, 96, "q")];
            regs[base + dst] = a * regs[base + this.I(undefined, undefined, [], {})];
            break;
          }
        case 14:
          {
            var dst = this.I(undefined, {}, "q", []);
            var a = regs[base + this.I(74, 52, {}, 63)];
            regs[base + dst] = a / regs[base + this.I(undefined, "z", [], [])];
            break;
          }
        case 15:
          {
            var dst = this.I([], undefined, [], "k");
            var a = regs[base + this.I(34, 11, 14, [])];
            regs[base + dst] = a % regs[base + this.I([], "y", "k", undefined)];
            break;
          }
        case 60:
          {
            // Math.pow instead of `**`
            var dst = this.I("y", {}, [], undefined);
            var a = regs[base + this.I({}, 80, {}, {})];
            regs[base + dst] = Math.pow(a, regs[base + this.I(undefined, 78, {}, {})]);
            break;
          }
        case 16:
          {
            var dst = this.I(null, {}, 41, {});
            var a = regs[base + this.I(null, [], 45, 54)];
            regs[base + dst] = a & regs[base + this.I(null, 92, null, "x")];
            break;
          }
        case 17:
          {
            var dst = this.I(null, undefined, null, null);
            var a = regs[base + this.I(undefined, [], "k", [])];
            regs[base + dst] = a | regs[base + this.I([], [], 50, null)];
            break;
          }
        case 18:
          {
            var dst = this.I(44, [], null, {});
            var a = regs[base + this.I("x", undefined, null, null)];
            regs[base + dst] = a ^ regs[base + this.I(0, null, "q", {})];
            break;
          }
        case 19:
          {
            var dst = this.I(null, "k", null, {});
            var a = regs[base + this.I("k", undefined, "x", {})];
            regs[base + dst] = a << regs[base + this.I(null, 79, null, [])];
            break;
          }
        case 20:
          {
            var dst = this.I({}, null, undefined, undefined);
            var a = regs[base + this.I({}, "z", null, 82)];
            regs[base + dst] = a >> regs[base + this.I(null, 72, "q", null)];
            break;
          }
        case 21:
          {
            var dst = this.I(62, null, undefined, null);
            var a = regs[base + this.I([], undefined, null, "q")];
            regs[base + dst] = a >>> regs[base + this.I(null, "z", null, null)];
            break;
          }

        // Comparison  (dst, src1, src2)
        case 22:
          {
            var dst = this.I("k", {}, [], 22);
            var a = regs[base + this.I(null, undefined, undefined, 48)];
            regs[base + dst] = a < regs[base + this.I({}, "x", null, "z")];
            break;
          }
        case 23:
          {
            var dst = this.I(28, "k", {}, {});
            var a = regs[base + this.I(88, [], undefined, [])];
            regs[base + dst] = a > regs[base + this.I("z", "y", [], undefined)];
            break;
          }
        case 24:
          {
            var dst = this.I([], undefined, [], "x");
            var a = regs[base + this.I(89, [], "k", [])];
            regs[base + dst] = a <= regs[base + this.I([], "x", null, null)];
            break;
          }
        case 25:
          {
            var dst = this.I({}, [], {}, []);
            var a = regs[base + this.I(12, "q", null, {})];
            regs[base + dst] = a >= regs[base + this.I([], null, {}, null)];
            break;
          }
        case 26:
          {
            var dst = this.I(undefined, null, undefined, "y");
            var a = regs[base + this.I([], [], undefined, {})];
            regs[base + dst] = a === regs[base + this.I([], {}, {}, "z")];
            break;
          }
        case 27:
          {
            var dst = this.I({}, null, "x", undefined);
            var a = regs[base + this.I([], undefined, null, "y")];
            regs[base + dst] = a !== regs[base + this.I(14, "z", [], [])];
            break;
          }
        case 28:
          {
            var dst = this.I("z", null, 66, []);
            var a = regs[base + this.I({}, null, 88, 0)];
            regs[base + dst] = a == regs[base + this.I([], undefined, undefined, 67)];
            break;
          }
        case 29:
          {
            var dst = this.I([], "q", null, "z");
            var a = regs[base + this.I(null, null, undefined, "k")];
            regs[base + dst] = a != regs[base + this.I(null, {}, null, [])];
            break;
          }
        case 30:
          {
            var dst = this.I(undefined, [], {}, null);
            var a = regs[base + this.I(null, 97, undefined, 17)];
            regs[base + dst] = a in regs[base + this.I({}, undefined, 11, undefined)];
            break;
          }
        case 31:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this.I([], {}, "y", "k");
            var obj = regs[base + this.I([], "k", "k", [])];
            regs[base + dst] = obj instanceof regs[base + this.I("k", 69, null, 29)];
            break;
          }

        // Unary  (dst, src)
        case 32:
          {
            var dst = this.I("z", undefined, undefined, undefined);
            regs[base + dst] = -regs[base + this.I(39, {}, 96, null)];
            break;
          }
        case 33:
          {
            var dst = this.I([], [], 31, "x");
            regs[base + dst] = +regs[base + this.I({}, "y", "q", null)];
            break;
          }
        case 34:
          {
            var dst = this.I("y", "q", 59, null);
            regs[base + dst] = !regs[base + this.I(68, undefined, 75, [])];
            break;
          }
        case 35:
          {
            var dst = this.I(null, undefined, [], "x");
            regs[base + dst] = ~regs[base + this.I(71, "z", [], 1)];
            break;
          }
        case 36:
          {
            var dst = this.I(null, {}, undefined, null);
            regs[base + dst] = typeof regs[base + this.I({}, null, [], 44)];
            break;
          }
        case 37:
          {
            var dst = this.I("y", "q", {}, "y");
            this.I([], [], 42, "z"); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case 38:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this.I(undefined, [], null, "x");
            var name = this.l();
            var val = Object.prototype.hasOwnProperty.call(this.K, name) ? this.K[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case 39:
          regs[fp + 0] = this.I(40, undefined, 39, 28);
          break;
        case 40:
          {
            var src = this.I(undefined, {}, [], undefined);
            var target = this.I(undefined, {}, undefined, null);
            if (!regs[base + src]) regs[fp + 0] = target;
            break;
          }
        case 41:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this.I([], undefined, {}, null);
            var target = this.I(null, "k", 45, 6);
            if (regs[base + src]) regs[fp + 0] = target;
            break;
          }

        // Calls
        case 42:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this.I(undefined, {}, 26, undefined);
            var callee = regs[base + this.I(null, undefined, "z", [])];
            var argc = this.I({}, undefined, undefined, {});
            var args;
            if (argc === 65535) {
              args = regs[base + this.I([], 46, null, "q")];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.I("q", [], null, [])];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.h(this.K, [], 1, [], closure, 78, args, dst << 1);
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case 43:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.I("k", 76, 31, undefined);
            var receiver = regs[base + this.I("x", {}, undefined, {})];
            var callee = regs[base + this.I(39, undefined, 83, 76)];
            var argc = this.I(53, "y", undefined, "k");
            var args;
            if (argc === 65535) {
              args = regs[base + this.I(44, null, null, {})];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.I({}, [], {}, null)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.h(receiver, "x", 81, undefined, closure, [], args, dst << 1);
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case 44:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.I([], 86, {}, "k");
            var callee = regs[base + this.I("y", [], "x", null)];
            var argc = this.I("z", [], [], null);
            var args;
            if (argc === 65535) {
              args = regs[base + this.I("k", 32, [], 27)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.I(undefined, 95, null, 7)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this.h(Object.create(closure.prototype || null), {}, undefined, "z", closure, [], args, dst << 1 | 1);
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case 45:
          {
            var retVal = regs[base + this.I(undefined, [], [], null)];
            this.R({}, [], {}, fp); // must happen before frame is abandoned

            var caller = regs[fp + 1];
            var retDst = regs[fp + 2];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + 6];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this.n = fp;
            this.q = caller;

            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 46:
          throw regs[base + this.I("q", null, [], "k")];

        // Closures
        case 47:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this.I({}, "y", [], "q");
            var startPc = this.I([], undefined, [], []);
            var paramCount = this.I(17, 85, null, {});
            var regCount = this.I([], null, 15, 36);
            var uvCount = this.I([], [], undefined, undefined);
            var hasRest = this.I(null, 93, null, undefined); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this.I("z", {}, null, undefined);
              var uvIndex = this.I({}, "k", {}, null);
              uvDescs[i] = {
                s: isLocalRaw,
                N: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              k: paramCount,
              U: regCount,
              j: startPc,
              ak: hasRest
            };
            var closure = new Closure(73, fn);
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.s) {
                closure.C.push(this.t("y", 42, 61, uvd.N, undefined, fp));
              } else {
                closure.C.push(regs[fp + 4].C[uvd.N]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM("q", null, self.K, undefined, self.z, self.r).P(this == null ? self.K : this, 6, null, {}, c, {}, Array.prototype.slice.call(arguments));
              };
            }(closure);
            CLOSURE_MAP.set(shell, closure);
            shell.prototype = closure.prototype; // unified prototype for new/instanceof
            regs[base + dst] = shell;
            break;
          }

        // Collections
        case 48:
          {
            // dst, count, [elemReg...]
            var dst = this.I(91, [], undefined, undefined);
            var count = this.I({}, "k", [], undefined);
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this.I(3, "k", [], [])];
            regs[base + dst] = elems;
            break;
          }
        case 49:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this.I(undefined, null, {}, undefined);
            var pairCount = this.I([], "k", [], []);
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this.I({}, "q", undefined, "y")];
              var val = regs[base + this.I(undefined, {}, "q", [])];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case 50:
          {
            // obj, key, fn
            var obj = regs[base + this.I([], "k", [], null)];
            var key = regs[base + this.I(null, 59, [], 65)];
            var getterFn = regs[base + this.I([], "y", undefined, "y")];
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
        case 51:
          {
            // obj, key, fn
            var obj = regs[base + this.I([], "k", undefined, undefined)];
            var key = regs[base + this.I(null, null, {}, 42)];
            var setterFn = regs[base + this.I({}, [], 59, undefined)];
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
        case 52:
          {
            // dst, src — build iterator object from enumerable keys of regs[src]
            var dst = this.I("x", 55, null, 50);
            var obj = regs[base + this.I(69, undefined, 83, 55)];
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
              T: keys,
              ac: 0
            };
            break;
          }
        case 53:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this.I([], {}, null, "z");
            var iter = regs[base + this.I({}, undefined, undefined, [])];
            var exitTarget = this.I(null, 32, undefined, {});
            if (iter.ac >= iter.T.length) {
              regs[fp + 0] = exitTarget;
            } else {
              regs[base + dst] = iter.T[iter.ac++];
            }
            break;
          }

        // ── Exception handling ────────────────────────────────────────────────
        case 54:
          {
            // handlerPc, exceptionReg — push exception handler record onto current
            // frame. The handler stack lives in a header slot and is created on
            // first use, so frames that never try/catch carry nothing.
            var hs = regs[fp + 5];
            if (!hs) regs[fp + 5] = hs = [];
            hs.push({
              af: this.I([], {}, "y", "y"),
              b: this.I(undefined, 8, "k", null)
            });
            break;
          }
        case 55:
          {
            // Normal exit from a try block — disarm the top handler record
            // (works for both catch and finally regions; they share the stack).
            regs[fp + 5].pop();
            break;
          }
        case 59:
          {
            // finallyPc, contReg, payloadReg, throwPad
            // Arm a finalizer for the current region.  Unlike a catch record this
            // carries no exceptionReg; instead the continuation register (contReg)
            // receives the resume PC and payloadReg carries the in-flight value.
            var hs = regs[fp + 5];
            if (!hs) regs[fp + 5] = hs = [];
            hs.push({
              M: this.I(undefined, {}, "k", null),
              Z: this.I(undefined, {}, 95, null),
              v: this.I("z", 50, [], undefined),
              aj: this.I(undefined, null, 81, [])
            });
            break;
          }

        // Self-modifying bytecode
        case 56:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this.I(undefined, "y", {}, "x");
            var sliceStart = this.I({}, [], null, 46);
            var sliceEnd = this.I(undefined, {}, {}, "q");
            var pk = this.I({}, undefined, "x", []) ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.z[destPc + (pi - sliceStart)] = (this.z[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case 58:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + 0] = regs[base + this.I(undefined, {}, 58, 43)];
            break;
          }
        case 57:
          {
            debugger;
            break;
          }
        default:
          throw new Error("Unknown opcode: " + op + " at pc " + (regs[fp + 0] - 1));
      }
    } catch (err) {
      // Exception handler unwinding
      // Walk the CALLER chain from the current frame until we find one holding an open exception handler (TRY_SETUP without a matching TRY_END).
      // For every frame we abandon along the way, close its captured upvalues and release its block.
      var handledFrame = 0;
      var searchFrame = this.q;
      while (searchFrame) {
        var handlers = regs[searchFrame + 5];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this.R([], [], null, searchFrame);
        this.n = searchFrame;
        searchFrame = regs[searchFrame + 1];
        this.q = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + 5].pop();
      var hBase = regs[handledFrame + 7];
      if (h.b !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.b] = err;
        regs[handledFrame + 0] = h.af;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.Z] = h.aj;
        regs[hBase + h.v] = err;
        regs[handledFrame + 0] = h.M;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this.n = handledFrame + regs[handledFrame + 6];
      this.q = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this.q) return this.A[0];
  }
  this.ai = fake_36 || fake_35;
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
var vm = new VM({}, {}, globals, "z", decodeBytecode(BYTECODE), CONSTANTS);
vm.P(undefined, 38, 34, undefined, new Closure(null, {
  k: 0,
  U: 7,
  j: 0
}), "y", null // no arguments object / parameter setup for the root frame
);