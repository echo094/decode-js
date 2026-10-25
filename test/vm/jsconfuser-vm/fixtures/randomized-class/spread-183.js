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
var CONSTANTS = [/* 0 */2, /* 1 */5, /* 2 */"window", /* 3 */"TEST_OUTPUT", /* 4 */"concat", /* 5 */undefined];
// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)
function Upvalue(absSlot, fake_4, fake_2, fake_3, fake_1, regs) {
  this.e = fake_1;
  this.p = regs; // shared reference to VM._regs flat array
  this.n = fake_4;
  this.r = absSlot; // absolute index; stable as long as frame is alive
  this.g = false;
  this.ab = fake_3;
  this.y = fake_2;
  this.ag = undefined;
}
// Closure & Frame
function Closure(fn, fake_11) {
  this.z = fn;
  this.ad = [];
  this.prototype = {}; // <- default prototype object for `new`
  this.h = fake_11;
}

// VM
// There is no Frame object and no frame stack. A frame is a block of slots in
// the flat array `_regs`: HEADER_SIZE header slots (see utils/frame-layout.ts) followed
// by the frame's registers. `_f` — the only piece of live execution state the VM
// object exposes — is the current frame's base offset, and each frame's CALLER
// slot points at the one that called it, so the call stack is an implicit linked
// list with nothing to enumerate.
function VM(bytecode, constants, fake_12, globals) {
  this.b = bytecode;
  this.j = constants;
  this.f = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this.k = fake_12;
  this.U = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this.p = [];
  this.S = 7;
  this.m = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
var BYTECODE = [63827, 1, 63522, 4, 68, 2, 5, 0, 0, 25408, 2, 4, 1783, 4, 0, 0, 1783, 5, 1, 0, 57913, 6, 2, 4, 5, 25408, 3, 6, 38527, 4, 2, 0, 1783, 5, 3, 0, 57913, 6, 0, 1783, 7, 4, 0, 1227, 8, 6, 7, 6030, 7, 6, 8, 1, 3, 45847, 6, 2, 2617719534, 7, 42057, 4, 5, 6, 1783, 4, 5, 0, 4387, 4, 63827, 3, 60230, 4, 0, 1, 4387, 4, 1783, 4, 5, 0, 4387, 4];
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
var CLOSURE_MAP = new WeakMap();
VM.prototype.a = function (fake_16, fake_13, fake_14, fake_15) {
  return this.b[this.p[this.m + 4]++];
  this.c = [fake_13, fake_16];
  this.J = [fake_15, fake_14];
};

// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
VM.prototype.Q = function (retDst, fake_19, thisVal, fake_17, args, closure, fake_18) {
  var fn = closure.z;
  var regs = this.p;
  var fp = this.S;
  var size = 16 + fn.l;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + 16;
  regs[fp + 4] = fn.H;
  regs[fp + 13] = this.m;
  regs[fp + 2] = retDst;
  regs[fp + 3] = thisVal;
  this.af = fake_17 || fake_18;
  regs[fp + 8] = closure;
  regs[fp + 15] = size;
  regs[fp + 10] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  this.L = fake_19;
  if (typeof 12 === "number") regs[fp + 12] = end;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.V;
  if (typeof 7 === "number") regs[fp + 7] = args;
  if (typeof 1 === "number") regs[fp + 1] = fn.H;
  if (typeof 9 === "number") regs[fp + 9] = 0;
  this.S = end;
  if (args) {
    if (fn.ae) {
      var restSlot = fn.V - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.l; a++) regs[base + a] = args[a];
    }
    if (fn.V < fn.l) regs[base + fn.V] = args;
  }
  this.m = fp;
};
Upvalue.prototype.t = function (fake_7, fake_9, fake_10, fake_8) {
  this.F = fake_10;
  this.ag = this.p[this.r];
  this.g = true;
  this.R = fake_7;
  this.ac = fake_8;
  this.D = fake_9;
};
VM.prototype.P = function (fake_25, fake_26, fp) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this.U;
  if (!uvs) return; // nothing in this program ever captured a local
  this.T = fake_25 && fake_26;
  var regs = this.p;
  var hi = fp + regs[fp + 15];
  for (var i = regs[fp + 10]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv.t("x", undefined, undefined, 53);
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
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
VM.prototype.G = function (fake_23, keyIn, fake_24, idxIn) {
  var idx = idxIn ?? this.a(62, 27, null, "k");
  var key = keyIn ?? this.a({}, {}, "y", undefined);
  var v = this.j[idx];
  if (!key) return v;
  if (typeof v === "number") return v ^ key;
  if (typeof v !== "string") return v;

  // String: base64-decode to u16 LE byte pairs, then XOR each code with a
  // 16-bit keystream word derived from the full 32-bit key + position.
  var b = base64ToBytes(v);
  this.M = fake_24;
  var out = "";
  this.E = fake_23;
  var k = key;
  for (var i = 0; i < b.length / 2; i++) {
    k = k + 0x9e3779b9 | 0; // 32-bit Weyl step (position-based)
    var ks = (k ^ k >>> 13) & 0xffff; // 16-bit keystream word
    var code = b[i * 2] | b[i * 2 + 1] << 8; // u16 LE
    out += String.fromCharCode(code ^ ks);
  }
  return out;
};
Upvalue.prototype.i = function (fake_5) {
  return this.g ? this.ag : this.p[this.r];
  this.v = fake_5;
};
VM.prototype.W = function (slot, fake_21, fake_20, fake_22, fp) {
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this.p[fp + 10] + slot;
  this.u = fake_21;
  var uvs = this.U || (this.U = []);
  this.Z = fake_22 && fake_20;
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(absSlot, 24, undefined, null, [], this.p));
};
Upvalue.prototype.B = function (v, fake_6) {
  if (this.g) this.ag = v;else this.p[this.r] = v;
  this.d = fake_6;
};
VM.prototype.I = function (closure, fake_28, thisVal, fake_27, fake_29, fake_30, args) {
  var now = () => {
    return performance.now();
  };
  this.X = [fake_27, fake_29];
  this.K = fake_28;
  var lastTime = now();
  this.Q(0, undefined, thisVal, [], args, closure, {});
  while (true) {
    var fp = this.m;
    var regs = this.p;
    var bc = this.b;
    var pc = regs[fp + 4];
    if (pc >= bc.length) break;
    regs[fp + 4] = pc + 1;
    var op = this.b[pc];
    // var opcode = this.bytecode[pc];
    // console.log(`[run] pc=${pc}, opcode=${opcode}, name=${Object.keys(OP).find((key) => OP[key] === opcode)}`);

    // Churn the decoy header slots so the real PC isn't the only slot moving
    /* @NOISE */
    if (typeof 1 === "number") regs[fp + 1] = (regs[fp + 1] + 1) % bc.length;
    if (typeof 9 === "number") regs[fp + 9]++;
    if (typeof void 0 === "number") regs[fp + void 0] = op;
    if (typeof void 0 === "number") regs[fp + void 0] = regs[fp + void 0] ^ pc | 0;

    // Debugging protection: Detects debugger by checking for >1s pauses which can only happen from debugger; or extremely slow sync tasks
    if (false) {
      var currentTime = now();
      var isTamper = currentTime - lastTime > false;
      lastTime = currentTime;
      if (isTamper) {
        // Poison the bytecode
        for (var i = 0; i < this.b.length; i++) this.b[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this.S; i2++) this.p[i2] = undefined;
        op = 19772;
        regs[fp + 4] = this.b.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + 10];

      /* @SWITCH */
      switch (op) {
        case 1783:
          {
            var dst = this.a([], [], [], null);
            regs[base + dst] = this.G();
            break;
          }
        case 36363:
          {
            var dst = this.a(undefined, "k", [], null);
            regs[base + dst] = this.a(undefined, {}, null, {});
            break;
          }
        case 38527:
          {
            var dst = this.a([], "k", "z", {});
            var globalName = this.G();
            if (!(globalName in this.f)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.f[globalName];
            break;
          }
        case 41838:
          {
            var dst = this.a(undefined, [], null, null);
            regs[base + dst] = regs[fp + 8].ad[this.a("y", "k", null, 93)].i(42);
            break;
          }
        case 63827:
          {
            var dst = this.a(34, [], {}, []);
            regs[base + dst] = regs[fp + 3];
            break;
          }
        case 25408:
          {
            var dst = this.a(undefined, {}, null, 4);
            regs[base + dst] = regs[base + this.a([], null, {}, {})];
            break;
          }
        case 51321:
          {
            // globals[globalName] = regs[src]
            this.f[this.G()] = regs[base + this.a({}, "k", {}, "y")];
            break;
          }
        case 53456:
          {
            var uvIdx = this.a("y", undefined, undefined, null);
            regs[fp + 8].ad[uvIdx].B(regs[base + this.a({}, "q", null, [])], null);
            break;
          }
        case 1227:
          {
            // dst = regs[obj][regs[key]]
            var dst = this.a(null, [], undefined, null);
            var obj = regs[base + this.a({}, "y", {}, "k")];
            var key = regs[base + this.a({}, [], "z", null)];
            regs[base + dst] = obj[key];
            break;
          }
        case 42057:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this.a(83, {}, {}, null)];
            var key = regs[base + this.a([], [], [], 70)];
            var val = regs[base + this.a(undefined, undefined, undefined, null)];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 65260:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this.a(undefined, "q", null, undefined);
            var obj = regs[base + this.a(76, undefined, 41, 95)];
            var key = regs[base + this.a([], undefined, null, [])];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case 60230:
          {
            var dst = this.a(undefined, {}, {}, []);
            var a = regs[base + this.a({}, 19, undefined, "x")];
            regs[base + dst] = a + regs[base + this.a([], "k", undefined, {})];
            break;
          }
        case 3760:
          {
            var dst = this.a({}, 28, [], null);
            var a = regs[base + this.a({}, {}, undefined, {})];
            regs[base + dst] = a - regs[base + this.a(undefined, {}, [], [])];
            break;
          }
        case 56749:
          {
            var dst = this.a({}, 37, 45, []);
            var a = regs[base + this.a(null, undefined, "z", 43)];
            regs[base + dst] = a * regs[base + this.a(undefined, undefined, 5, [])];
            break;
          }
        case 35397:
          {
            var dst = this.a([], "y", 34, "z");
            var a = regs[base + this.a("k", 54, "z", undefined)];
            regs[base + dst] = a / regs[base + this.a(65, 43, undefined, "x")];
            break;
          }
        case 38326:
          {
            var dst = this.a(null, {}, {}, 56);
            var a = regs[base + this.a(undefined, [], 89, undefined)];
            regs[base + dst] = a % regs[base + this.a(null, null, 91, {})];
            break;
          }
        case 52601:
          {
            // Math.pow instead of `**`
            var dst = this.a("q", null, 3, 16);
            var a = regs[base + this.a("q", "q", [], {})];
            regs[base + dst] = Math.pow(a, regs[base + this.a(43, {}, undefined, 79)]);
            break;
          }
        case 7156:
          {
            var dst = this.a(null, "x", 43, {});
            var a = regs[base + this.a(null, 42, {}, null)];
            regs[base + dst] = a & regs[base + this.a("q", 14, "y", undefined)];
            break;
          }
        case 33721:
          {
            var dst = this.a(null, "k", null, []);
            var a = regs[base + this.a(20, null, undefined, 75)];
            regs[base + dst] = a | regs[base + this.a(undefined, null, null, "y")];
            break;
          }
        case 40723:
          {
            var dst = this.a(undefined, null, null, []);
            var a = regs[base + this.a("z", 84, null, undefined)];
            regs[base + dst] = a ^ regs[base + this.a("z", [], "y", null)];
            break;
          }
        case 46661:
          {
            var dst = this.a(null, "x", "y", undefined);
            var a = regs[base + this.a({}, 39, {}, undefined)];
            regs[base + dst] = a << regs[base + this.a(undefined, undefined, {}, [])];
            break;
          }
        case 9322:
          {
            var dst = this.a(null, {}, undefined, []);
            var a = regs[base + this.a({}, [], 20, {})];
            regs[base + dst] = a >> regs[base + this.a([], [], 2, null)];
            break;
          }
        case 64414:
          {
            var dst = this.a(62, "q", undefined, []);
            var a = regs[base + this.a(null, 78, 36, {})];
            regs[base + dst] = a >>> regs[base + this.a(undefined, null, null, [])];
            break;
          }

        // Comparison  (dst, src1, src2)
        case 41605:
          {
            var dst = this.a("x", null, 72, "q");
            var a = regs[base + this.a(undefined, undefined, null, "q")];
            regs[base + dst] = a < regs[base + this.a(undefined, undefined, "x", 64)];
            break;
          }
        case 5756:
          {
            var dst = this.a(null, null, {}, null);
            var a = regs[base + this.a(undefined, "z", null, {})];
            regs[base + dst] = a > regs[base + this.a(undefined, [], undefined, {})];
            break;
          }
        case 40098:
          {
            var dst = this.a(null, [], [], 97);
            var a = regs[base + this.a(undefined, undefined, "x", 56)];
            regs[base + dst] = a <= regs[base + this.a(71, undefined, "z", "y")];
            break;
          }
        case 171:
          {
            var dst = this.a(null, [], [], []);
            var a = regs[base + this.a("z", undefined, "x", undefined)];
            regs[base + dst] = a >= regs[base + this.a("x", {}, {}, null)];
            break;
          }
        case 11047:
          {
            var dst = this.a(null, 58, "k", null);
            var a = regs[base + this.a({}, undefined, null, {})];
            regs[base + dst] = a === regs[base + this.a([], {}, [], null)];
            break;
          }
        case 38434:
          {
            var dst = this.a(undefined, {}, 58, null);
            var a = regs[base + this.a(null, undefined, {}, undefined)];
            regs[base + dst] = a !== regs[base + this.a(null, {}, "z", null)];
            break;
          }
        case 23794:
          {
            var dst = this.a(undefined, undefined, {}, null);
            var a = regs[base + this.a(4, 80, "y", "k")];
            regs[base + dst] = a == regs[base + this.a("y", [], {}, [])];
            break;
          }
        case 52535:
          {
            var dst = this.a(null, [], null, null);
            var a = regs[base + this.a(78, {}, [], undefined)];
            regs[base + dst] = a != regs[base + this.a(76, "y", null, "x")];
            break;
          }
        case 12233:
          {
            var dst = this.a(null, undefined, [], []);
            var a = regs[base + this.a({}, "k", 47, undefined)];
            regs[base + dst] = a in regs[base + this.a(undefined, "q", "k", null)];
            break;
          }
        case 5881:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this.a({}, {}, [], 56);
            var obj = regs[base + this.a(55, {}, null, 1)];
            regs[base + dst] = obj instanceof regs[base + this.a(undefined, {}, {}, 98)];
            break;
          }

        // Unary  (dst, src)
        case 23545:
          {
            var dst = this.a({}, {}, 88, {});
            regs[base + dst] = -regs[base + this.a({}, 78, undefined, null)];
            break;
          }
        case 42420:
          {
            var dst = this.a([], "z", undefined, 46);
            regs[base + dst] = +regs[base + this.a(85, null, undefined, undefined)];
            break;
          }
        case 25347:
          {
            var dst = this.a({}, 70, null, "x");
            regs[base + dst] = !regs[base + this.a({}, {}, {}, null)];
            break;
          }
        case 7367:
          {
            var dst = this.a({}, "k", 74, []);
            regs[base + dst] = ~regs[base + this.a([], undefined, [], {})];
            break;
          }
        case 42831:
          {
            var dst = this.a(8, {}, undefined, []);
            regs[base + dst] = typeof regs[base + this.a(undefined, 51, [], [])];
            break;
          }
        case 41502:
          {
            var dst = this.a([], null, [], null);
            this.a(80, "q", [], undefined); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case 62003:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this.a([], undefined, [], "y");
            var name = this.G();
            var val = Object.prototype.hasOwnProperty.call(this.f, name) ? this.f[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case 19772:
          regs[fp + 4] = this.a(undefined, null, 53, undefined);
          break;
        case 55595:
          {
            var src = this.a(null, undefined, "q", undefined);
            var target = this.a("q", [], {}, {});
            if (!regs[base + src]) regs[fp + 4] = target;
            break;
          }
        case 25181:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this.a([], 30, "k", 23);
            var target = this.a({}, [], {}, undefined);
            if (regs[base + src]) regs[fp + 4] = target;
            break;
          }

        // Calls
        case 45847:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this.a("k", null, [], null);
            var callee = regs[base + this.a(null, [], "k", {})];
            var argc = this.a([], [], [], null);
            var args;
            if (argc === 2617719534) {
              args = regs[base + this.a(null, 94, "k", {})];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.a([], 39, null, {})];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.Q(dst << 1, [], this.f, 91, args, closure, "y");
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case 6030:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.a({}, [], "k", 15);
            var receiver = regs[base + this.a(null, "k", [], 45)];
            var callee = regs[base + this.a(null, null, "z", null)];
            var argc = this.a(80, [], null, undefined);
            var args;
            if (argc === 2617719534) {
              args = regs[base + this.a(undefined, "z", "x", [])];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.a(null, undefined, 58, undefined)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.Q(dst << 1, 40, receiver, {}, args, closure, {});
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case 51590:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.a({}, "k", {}, null);
            var callee = regs[base + this.a(null, {}, [], 98)];
            var argc = this.a("z", "z", {}, {});
            var args;
            if (argc === 2617719534) {
              args = regs[base + this.a(58, "z", undefined, null)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.a(undefined, {}, "q", "x")];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this.Q(dst << 1 | 1, 70, Object.create(closure.prototype || null), null, args, closure, null);
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case 4387:
          {
            var retVal = regs[base + this.a(undefined, undefined, null, {})];
            this.P(96, "y", fp); // must happen before frame is abandoned

            var caller = regs[fp + 13];
            var retDst = regs[fp + 2];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + 15];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this.S = fp;
            this.m = caller;

            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + 10] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 6897:
          throw regs[base + this.a(undefined, null, "y", {})];

        // Closures
        case 63522:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this.a({}, [], "k", 56);
            var startPc = this.a(null, 73, {}, {});
            var paramCount = this.a(48, 32, null, []);
            var regCount = this.a(undefined, {}, 94, null);
            var uvCount = this.a({}, undefined, [], undefined);
            var hasRest = this.a(null, undefined, {}, "z"); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this.a(null, {}, 55, 41);
              var uvIndex = this.a([], null, [], null);
              uvDescs[i] = {
                s: isLocalRaw,
                o: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              V: paramCount,
              l: regCount,
              H: startPc,
              ae: hasRest
            };
            var closure = new Closure(fn, 68);
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.s) {
                closure.ad.push(this.W(uvd.o, [], null, undefined, fp));
              } else {
                closure.ad.push(regs[fp + 8].ad[uvd.o]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM(self.b, self.j, null, self.f).I(c, undefined, this == null ? self.f : this, null, [], "y", Array.prototype.slice.call(arguments));
              };
            }(closure);
            CLOSURE_MAP.set(shell, closure);
            shell.prototype = closure.prototype; // unified prototype for new/instanceof
            regs[base + dst] = shell;
            break;
          }

        // Collections
        case 57913:
          {
            // dst, count, [elemReg...]
            var dst = this.a(undefined, {}, "x", null);
            var count = this.a(undefined, [], undefined, []);
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this.a({}, null, null, [])];
            regs[base + dst] = elems;
            break;
          }
        case 51230:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this.a(34, "x", null, null);
            var pairCount = this.a([], null, "y", []);
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this.a(54, [], "y", 15)];
              var val = regs[base + this.a(undefined, 8, "x", null)];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case 50853:
          {
            // obj, key, fn
            var obj = regs[base + this.a(40, {}, undefined, {})];
            var key = regs[base + this.a(89, null, "q", undefined)];
            var getterFn = regs[base + this.a([], "q", {}, {})];
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
        case 9477:
          {
            // obj, key, fn
            var obj = regs[base + this.a({}, {}, "y", 10)];
            var key = regs[base + this.a("y", {}, {}, {})];
            var setterFn = regs[base + this.a({}, [], "k", "y")];
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
        case 48242:
          {
            // dst, src — build iterator object from enumerable keys of regs[src]
            var dst = this.a(undefined, "y", [], {});
            var obj = regs[base + this.a({}, "q", null, {})];
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
              x: keys,
              O: 0
            };
            break;
          }
        case 39882:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this.a(undefined, [], {}, undefined);
            var iter = regs[base + this.a(44, 1, [], [])];
            var exitTarget = this.a(4, [], [], "y");
            if (iter.O >= iter.x.length) {
              regs[fp + 4] = exitTarget;
            } else {
              regs[base + dst] = iter.x[iter.O++];
            }
            break;
          }

        // ── Exception handling ────────────────────────────────────────────────
        case 60503:
          {
            // handlerPc, exceptionReg — push exception handler record onto current
            // frame. The handler stack lives in a header slot and is created on
            // first use, so frames that never try/catch carry nothing.
            var hs = regs[fp + 5];
            if (!hs) regs[fp + 5] = hs = [];
            hs.push({
              Y: this.a({}, "y", undefined, []),
              aa: this.a(97, 10, [], [])
            });
            break;
          }
        case 10682:
          {
            // Normal exit from a try block — disarm the top handler record
            // (works for both catch and finally regions; they share the stack).
            regs[fp + 5].pop();
            break;
          }
        case 34663:
          {
            // finallyPc, contReg, payloadReg, throwPad
            // Arm a finalizer for the current region.  Unlike a catch record this
            // carries no exceptionReg; instead the continuation register (contReg)
            // receives the resume PC and payloadReg carries the in-flight value.
            var hs = regs[fp + 5];
            if (!hs) regs[fp + 5] = hs = [];
            hs.push({
              A: this.a({}, {}, 52, null),
              C: this.a(95, [], 72, "q"),
              q: this.a(6, [], "x", null),
              N: this.a({}, {}, {}, null)
            });
            break;
          }

        // Self-modifying bytecode
        case 19927:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this.a("k", undefined, 79, undefined);
            var sliceStart = this.a(null, {}, undefined, undefined);
            var sliceEnd = this.a("y", 66, {}, {});
            var pk = this.a([], undefined, null, undefined) ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.b[destPc + (pi - sliceStart)] = (this.b[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case 41819:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + 4] = regs[base + this.a({}, undefined, [], 97)];
            break;
          }
        case 49100:
          {
            debugger;
            break;
          }
        default:
          throw new Error("Unknown opcode: " + op + " at pc " + (regs[fp + 4] - 1));
      }
    } catch (err) {
      // Exception handler unwinding
      // Walk the CALLER chain from the current frame until we find one holding an open exception handler (TRY_SETUP without a matching TRY_END).
      // For every frame we abandon along the way, close its captured upvalues and release its block.
      var handledFrame = 0;
      var searchFrame = this.m;
      while (searchFrame) {
        var handlers = regs[searchFrame + 5];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this.P("z", undefined, searchFrame);
        this.S = searchFrame;
        searchFrame = regs[searchFrame + 13];
        this.m = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + 5].pop();
      var hBase = regs[handledFrame + 10];
      if (h.aa !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.aa] = err;
        regs[handledFrame + 4] = h.Y;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.C] = h.N;
        regs[hBase + h.q] = err;
        regs[handledFrame + 4] = h.A;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this.S = handledFrame + regs[handledFrame + 15];
      this.m = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this.m) return this.p[0];
  }
  this.w = fake_30;
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
var vm = new VM(decodeBytecode(BYTECODE), CONSTANTS, undefined, globals);
vm.I(new Closure({
  V: 0,
  l: 9,
  H: 0
}, {}), null, undefined, null, undefined, [], null // no arguments object / parameter setup for the root frame
);