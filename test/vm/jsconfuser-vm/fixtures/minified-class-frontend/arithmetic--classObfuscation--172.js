var CONSTANTS = [/* 0 */"window", /* 1 */"TEST_OUTPUT", /* 2 */6, /* 3 */7, /* 4 */3, /* 5 */5, /* 6 */undefined];
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
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
var CLOSURE_MAP = new WeakMap();

// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)
function Upvalue(absSlot, fake_1, regs) {
  this.i = fake_1;
  this.g = regs; // shared reference to VM._regs flat array
  this.e = absSlot; // absolute index; stable as long as frame is alive
  this.I = false;
  this.P = undefined;
}
// VM
// There is no Frame object and no frame stack. A frame is a block of slots in
// the flat array `_regs`: HEADER_SIZE header slots (see utils/frame-layout.ts) followed
// by the frame's registers. `_f` — the only piece of live execution state the VM
// object exposes — is the current frame's base offset, and each frame's CALLER
// slot points at the one that called it, so the call stack is an implicit linked
// list with nothing to enumerate.
function VM(constants, fake_13, globals, bytecode) {
  this.q = bytecode;
  this.K = constants;
  this.u = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this.F = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this.W = fake_13;
  this.g = [];
  this.s = 1;
  this.n = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
// Closure & Frame
function Closure(fake_11, fake_9, fake_10, fake_12, fn) {
  this.t = fn;
  this.Z = [];
  this.E = [fake_10, fake_11];
  this.prototype = {}; // <- default prototype object for `new`
  this.aa = fake_9 || fake_12;
}
var BYTECODE = [4, 1, 2, 2, 0, 0, 0, 3, 1, 0, 0, 4, 2, 0, 0, 5, 3, 0, 13, 6, 4, 5, 0, 4, 4, 0, 11, 5, 6, 4, 0, 4, 5, 0, 15, 6, 5, 4, 9, 2, 3, 6, 0, 2, 6, 0, 45, 2];
VM.prototype.R = function (fp, fake_18, slot) {
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this.g[fp + 7] + slot;
  var uvs = this.F || (this.F = []);
  this.U = fake_18;
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(absSlot, null, this.g));
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
// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
VM.prototype.d = function (fake_16, closure, retDst, args, fake_17, thisVal) {
  var fn = closure.t;
  var regs = this.g;
  var fp = this.s;
  var size = 8 + fn.l;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + 8;
  regs[fp + 0] = fn.p;
  regs[fp + 1] = this.n;
  regs[fp + 2] = retDst;
  regs[fp + 3] = thisVal;
  regs[fp + 4] = closure;
  regs[fp + 6] = size;
  regs[fp + 7] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof void 0 === "number") regs[fp + void 0] = end;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.T;
  if (typeof void 0 === "number") regs[fp + void 0] = args;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.p;
  this.D = fake_17 && fake_16;
  if (typeof void 0 === "number") regs[fp + void 0] = 0;
  this.s = end;
  if (args) {
    if (fn.r) {
      var restSlot = fn.T - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.l; a++) regs[base + a] = args[a];
    }
    if (fn.T < fn.l) regs[base + fn.T] = args;
  }
  this.n = fp;
};
Upvalue.prototype.c = function (fake_4, v, fake_5, fake_3) {
  this.m = fake_5;
  if (this.I) this.P = v;else this.g[this.e] = v;
  this.z = fake_3 || fake_4;
};
VM.prototype.M = function (fake_20, idxIn, keyIn, fake_19) {
  var idx = idxIn ?? this.N("k", "z");
  var key = keyIn ?? this.N(undefined, null);
  var v = this.K[idx];
  this.Y = fake_20;
  this.S = fake_19;
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
VM.prototype.B = function (fp, fake_21, fake_22) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this.F;
  if (!uvs) return; // nothing in this program ever captured a local
  var regs = this.g;
  this.b = fake_21 || fake_22;
  var hi = fp + regs[fp + 6];
  for (var i = regs[fp + 7]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv.a("y", {}, null);
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
Upvalue.prototype.a = function (fake_6, fake_7, fake_8) {
  this.o = fake_6;
  this.P = this.g[this.e];
  this.I = true;
  this.Q = fake_7;
  this.h = fake_8;
};
Upvalue.prototype.w = function (fake_2) {
  this.j = fake_2;
  return this.I ? this.P : this.g[this.e];
};
VM.prototype.N = function (fake_15, fake_14) {
  this.L = fake_15 || fake_14;
  return this.q[this.g[this.n + 0]++];
};
VM.prototype.O = function (fake_23, fake_25, closure, args, thisVal, fake_24) {
  var now = () => {
    return performance.now();
  };
  var lastTime = now();
  this.G = fake_24;
  this.v = [fake_23, fake_25];
  this.d(null, closure, 0, args, "y", thisVal);
  while (true) {
    var fp = this.n;
    var regs = this.g;
    var bc = this.q;
    var pc = regs[fp + 0];
    if (pc >= bc.length) break;
    regs[fp + 0] = pc + 1;
    var op = this.q[pc];
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
        for (var i = 0; i < this.q.length; i++) this.q[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this.s; i2++) this.g[i2] = undefined;
        op = 39;
        regs[fp + 0] = this.q.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + 7];

      /* @SWITCH */
      switch (op) {
        case 0:
          {
            var dst = this.N(42, 53);
            regs[base + dst] = this.M();
            break;
          }
        case 1:
          {
            var dst = this.N(null, undefined);
            regs[base + dst] = this.N([], undefined);
            break;
          }
        case 2:
          {
            var dst = this.N([], null);
            var globalName = this.M();
            if (!(globalName in this.u)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.u[globalName];
            break;
          }
        case 3:
          {
            var dst = this.N({}, 55);
            regs[base + dst] = regs[fp + 4].Z[this.N("z", {})].w(undefined);
            break;
          }
        case 4:
          {
            var dst = this.N(undefined, "x");
            regs[base + dst] = regs[fp + 3];
            break;
          }
        case 5:
          {
            var dst = this.N(null, null);
            regs[base + dst] = regs[base + this.N({}, 7)];
            break;
          }
        case 6:
          {
            // globals[globalName] = regs[src]
            this.u[this.M()] = regs[base + this.N(undefined, [])];
            break;
          }
        case 7:
          {
            var uvIdx = this.N("z", 95);
            regs[fp + 4].Z[uvIdx].c(undefined, regs[base + this.N(50, [])], null, "z");
            break;
          }
        case 8:
          {
            // dst = regs[obj][regs[key]]
            var dst = this.N({}, []);
            var obj = regs[base + this.N("q", undefined)];
            var key = regs[base + this.N(undefined, undefined)];
            regs[base + dst] = obj[key];
            break;
          }
        case 9:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this.N({}, "k")];
            var key = regs[base + this.N(null, 58)];
            var val = regs[base + this.N(null, {})];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 10:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this.N([], {});
            var obj = regs[base + this.N(undefined, "q")];
            var key = regs[base + this.N({}, 90)];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case 11:
          {
            var dst = this.N(undefined, "k");
            var a = regs[base + this.N([], null)];
            regs[base + dst] = a + regs[base + this.N([], 53)];
            break;
          }
        case 12:
          {
            var dst = this.N([], "y");
            var a = regs[base + this.N({}, {})];
            regs[base + dst] = a - regs[base + this.N(undefined, null)];
            break;
          }
        case 13:
          {
            var dst = this.N(undefined, {});
            var a = regs[base + this.N(undefined, undefined)];
            regs[base + dst] = a * regs[base + this.N("z", "k")];
            break;
          }
        case 14:
          {
            var dst = this.N("x", 4);
            var a = regs[base + this.N({}, "q")];
            regs[base + dst] = a / regs[base + this.N(26, [])];
            break;
          }
        case 15:
          {
            var dst = this.N([], null);
            var a = regs[base + this.N([], undefined)];
            regs[base + dst] = a % regs[base + this.N({}, "q")];
            break;
          }
        case 60:
          {
            // Math.pow instead of `**`
            var dst = this.N({}, 75);
            var a = regs[base + this.N({}, 82)];
            regs[base + dst] = Math.pow(a, regs[base + this.N({}, null)]);
            break;
          }
        case 16:
          {
            var dst = this.N("z", []);
            var a = regs[base + this.N(null, {})];
            regs[base + dst] = a & regs[base + this.N(41, 80)];
            break;
          }
        case 17:
          {
            var dst = this.N({}, undefined);
            var a = regs[base + this.N("y", [])];
            regs[base + dst] = a | regs[base + this.N([], {})];
            break;
          }
        case 18:
          {
            var dst = this.N(null, 16);
            var a = regs[base + this.N("x", {})];
            regs[base + dst] = a ^ regs[base + this.N(null, null)];
            break;
          }
        case 19:
          {
            var dst = this.N(47, []);
            var a = regs[base + this.N("z", [])];
            regs[base + dst] = a << regs[base + this.N([], [])];
            break;
          }
        case 20:
          {
            var dst = this.N({}, 37);
            var a = regs[base + this.N(undefined, 53)];
            regs[base + dst] = a >> regs[base + this.N(10, {})];
            break;
          }
        case 21:
          {
            var dst = this.N({}, "x");
            var a = regs[base + this.N(undefined, [])];
            regs[base + dst] = a >>> regs[base + this.N(null, [])];
            break;
          }

        // Comparison  (dst, src1, src2)
        case 22:
          {
            var dst = this.N([], undefined);
            var a = regs[base + this.N(undefined, undefined)];
            regs[base + dst] = a < regs[base + this.N(null, 42)];
            break;
          }
        case 23:
          {
            var dst = this.N({}, null);
            var a = regs[base + this.N("x", undefined)];
            regs[base + dst] = a > regs[base + this.N(null, 16)];
            break;
          }
        case 24:
          {
            var dst = this.N(null, 26);
            var a = regs[base + this.N("x", 21)];
            regs[base + dst] = a <= regs[base + this.N("z", {})];
            break;
          }
        case 25:
          {
            var dst = this.N({}, 34);
            var a = regs[base + this.N({}, null)];
            regs[base + dst] = a >= regs[base + this.N(undefined, {})];
            break;
          }
        case 26:
          {
            var dst = this.N(91, null);
            var a = regs[base + this.N([], {})];
            regs[base + dst] = a === regs[base + this.N(null, {})];
            break;
          }
        case 27:
          {
            var dst = this.N(60, "x");
            var a = regs[base + this.N(10, {})];
            regs[base + dst] = a !== regs[base + this.N(3, null)];
            break;
          }
        case 28:
          {
            var dst = this.N(undefined, {});
            var a = regs[base + this.N({}, null)];
            regs[base + dst] = a == regs[base + this.N({}, "k")];
            break;
          }
        case 29:
          {
            var dst = this.N([], "z");
            var a = regs[base + this.N(52, "y")];
            regs[base + dst] = a != regs[base + this.N("z", 40)];
            break;
          }
        case 30:
          {
            var dst = this.N(11, null);
            var a = regs[base + this.N({}, null)];
            regs[base + dst] = a in regs[base + this.N("q", null)];
            break;
          }
        case 31:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this.N("x", []);
            var obj = regs[base + this.N(null, undefined)];
            regs[base + dst] = obj instanceof regs[base + this.N(1, null)];
            break;
          }

        // Unary  (dst, src)
        case 32:
          {
            var dst = this.N("y", []);
            regs[base + dst] = -regs[base + this.N(76, [])];
            break;
          }
        case 33:
          {
            var dst = this.N(undefined, undefined);
            regs[base + dst] = +regs[base + this.N(null, {})];
            break;
          }
        case 34:
          {
            var dst = this.N([], {});
            regs[base + dst] = !regs[base + this.N(91, 87)];
            break;
          }
        case 35:
          {
            var dst = this.N(null, "k");
            regs[base + dst] = ~regs[base + this.N(19, {})];
            break;
          }
        case 36:
          {
            var dst = this.N(44, 19);
            regs[base + dst] = typeof regs[base + this.N([], {})];
            break;
          }
        case 37:
          {
            var dst = this.N("q", "x");
            this.N("k", undefined); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case 38:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this.N("x", null);
            var name = this.M();
            var val = Object.prototype.hasOwnProperty.call(this.u, name) ? this.u[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case 39:
          regs[fp + 0] = this.N({}, 89);
          break;
        case 40:
          {
            var src = this.N(undefined, null);
            var target = this.N({}, []);
            if (!regs[base + src]) regs[fp + 0] = target;
            break;
          }
        case 41:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this.N({}, null);
            var target = this.N({}, null);
            if (regs[base + src]) regs[fp + 0] = target;
            break;
          }

        // Calls
        case 42:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this.N("k", undefined);
            var callee = regs[base + this.N({}, "z")];
            var argc = this.N([], 30);
            var args;
            if (argc === 65535) {
              args = regs[base + this.N([], [])];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.N(null, [])];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.d("q", closure, dst << 1, args, "q", this.u);
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case 43:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.N("k", []);
            var receiver = regs[base + this.N(null, "y")];
            var callee = regs[base + this.N([], "k")];
            var argc = this.N([], null);
            var args;
            if (argc === 65535) {
              args = regs[base + this.N([], null)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.N(31, {})];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.d("z", closure, dst << 1, args, "z", receiver);
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case 44:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.N([], "k");
            var callee = regs[base + this.N({}, 51)];
            var argc = this.N(63, []);
            var args;
            if (argc === 65535) {
              args = regs[base + this.N(undefined, 78)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.N(69, null)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this.d(undefined, closure, dst << 1 | 1, args, [], Object.create(closure.prototype || null));
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case 45:
          {
            var retVal = regs[base + this.N(null, "q")];
            this.B(fp, "k", []); // must happen before frame is abandoned

            var caller = regs[fp + 1];
            var retDst = regs[fp + 2];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + 6];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this.s = fp;
            this.n = caller;

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
          throw regs[base + this.N([], null)];

        // Closures
        case 47:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this.N("y", {});
            var startPc = this.N({}, null);
            var paramCount = this.N(55, "x");
            var regCount = this.N(12, 29);
            var uvCount = this.N([], "q");
            var hasRest = this.N(38, undefined); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this.N(null, undefined);
              var uvIndex = this.N({}, 2);
              uvDescs[i] = {
                J: isLocalRaw,
                y: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              T: paramCount,
              l: regCount,
              p: startPc,
              r: hasRest
            };
            var closure = new Closure(51, null, [], 59, fn);
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.J) {
                closure.Z.push(this.R(fp, {}, uvd.y));
              } else {
                closure.Z.push(regs[fp + 4].Z[uvd.y]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM(self.K, undefined, self.u, self.q).O([], {}, c, Array.prototype.slice.call(arguments), this == null ? self.u : this, 45);
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
            var dst = this.N([], undefined);
            var count = this.N(undefined, "y");
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this.N({}, [])];
            regs[base + dst] = elems;
            break;
          }
        case 49:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this.N({}, "z");
            var pairCount = this.N({}, null);
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this.N(null, 56)];
              var val = regs[base + this.N("k", undefined)];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case 50:
          {
            // obj, key, fn
            var obj = regs[base + this.N([], null)];
            var key = regs[base + this.N([], 72)];
            var getterFn = regs[base + this.N({}, [])];
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
            var obj = regs[base + this.N(82, undefined)];
            var key = regs[base + this.N([], null)];
            var setterFn = regs[base + this.N("z", 88)];
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
            var dst = this.N(22, null);
            var obj = regs[base + this.N(undefined, undefined)];
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
              X: 0
            };
            break;
          }
        case 53:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this.N(4, undefined);
            var iter = regs[base + this.N(58, "y")];
            var exitTarget = this.N("y", []);
            if (iter.X >= iter.x.length) {
              regs[fp + 0] = exitTarget;
            } else {
              regs[base + dst] = iter.x[iter.X++];
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
              H: this.N(2, []),
              V: this.N("k", [])
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
              k: this.N(undefined, 89),
              A: this.N([], {}),
              f: this.N("x", 31),
              C: this.N("x", {})
            });
            break;
          }

        // Self-modifying bytecode
        case 56:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this.N(null, undefined);
            var sliceStart = this.N(null, undefined);
            var sliceEnd = this.N(38, []);
            var pk = this.N({}, "k") ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.q[destPc + (pi - sliceStart)] = (this.q[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case 58:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + 0] = regs[base + this.N(59, null)];
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
      var searchFrame = this.n;
      while (searchFrame) {
        var handlers = regs[searchFrame + 5];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this.B(searchFrame, [], {});
        this.s = searchFrame;
        searchFrame = regs[searchFrame + 1];
        this.n = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + 5].pop();
      var hBase = regs[handledFrame + 7];
      if (h.V !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.V] = err;
        regs[handledFrame + 0] = h.H;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.A] = h.C;
        regs[hBase + h.f] = err;
        regs[handledFrame + 0] = h.k;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this.s = handledFrame + regs[handledFrame + 6];
      this.n = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this.n) return this.g[0];
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
var vm = new VM(CONSTANTS, "x", globals, decodeBytecode(BYTECODE));
vm.O("k", {}, new Closure(35, [], undefined, undefined, {
  T: 0,
  l: 7,
  p: 0
}), null // no arguments object / parameter setup for the root frame
, undefined, {});