var BYTECODE = [4, 1, 2, 2, 0, 0, 0, 3, 1, 0, 0, 4, 2, 0, 0, 5, 3, 0, 13, 6, 4, 5, 0, 4, 4, 0, 11, 5, 6, 4, 0, 4, 5, 0, 15, 6, 5, 4, 9, 2, 3, 6, 0, 2, 6, 0, 45, 2];
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

// VM
// There is no Frame object and no frame stack. A frame is a block of slots in
// the flat array `_regs`: HEADER_SIZE header slots (see utils/frame-layout.ts) followed
// by the frame's registers. `_f` — the only piece of live execution state the VM
// object exposes — is the current frame's base offset, and each frame's CALLER
// slot points at the one that called it, so the call stack is an implicit linked
// list with nothing to enumerate.
function VM(constants, fake_14, globals, fake_13, bytecode) {
  this.r = bytecode;
  this.ad = fake_13;
  this.J = constants;
  this.I = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this.c = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this.U = [];
  this.ag = 1;
  this.G = 0;
  this.W = fake_14;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
var CLOSURE_MAP = new WeakMap();

// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)

// Closure & Frame
function Closure(fn, fake_11, fake_10, fake_12) {
  this.L = fake_12 && fake_11;
  this.o = fn;
  this.E = [];
  this.prototype = {}; // <- default prototype object for `new`
  this.q = fake_10;
}
function Upvalue(fake_3, fake_2, regs, fake_1, absSlot) {
  this.U = regs; // shared reference to VM._regs flat array
  this.u = fake_2;
  this.N = absSlot; // absolute index; stable as long as frame is alive
  this.H = fake_3;
  this.l = fake_1;
  this.Y = false;
  this.v = undefined;
}
var CONSTANTS = [/* 0 */"window", /* 1 */"TEST_OUTPUT", /* 2 */6, /* 3 */7, /* 4 */3, /* 5 */5, /* 6 */undefined];
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
VM.prototype.m = function (fp, fake_26) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this.c;
  if (!uvs) return; // nothing in this program ever captured a local
  this.S = fake_26;
  var regs = this.U;
  var hi = fp + regs[fp + 6];
  for (var i = regs[fp + 7]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv.w(undefined);
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
VM.prototype.y = function (fake_18, fake_20, retDst, fake_19, args, thisVal, closure, fake_17) {
  var fn = closure.o;
  var regs = this.U;
  this.s = fake_19;
  var fp = this.ag;
  var size = 8 + fn.M;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + 8;
  regs[fp + 0] = fn.X;
  regs[fp + 1] = this.G;
  regs[fp + 2] = retDst;
  regs[fp + 3] = thisVal;
  regs[fp + 4] = closure;
  regs[fp + 6] = size;
  regs[fp + 7] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof void 0 === "number") regs[fp + void 0] = end;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.b;
  if (typeof void 0 === "number") regs[fp + void 0] = args;
  this.Z = fake_17;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.X;
  if (typeof void 0 === "number") regs[fp + void 0] = 0;
  this.ag = end;
  this.n = [fake_18, fake_20];
  if (args) {
    if (fn.A) {
      var restSlot = fn.b - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.M; a++) regs[base + a] = args[a];
    }
    if (fn.b < fn.M) regs[base + fn.b] = args;
  }
  this.G = fp;
};
Upvalue.prototype.w = function (fake_9) {
  this.j = fake_9;
  this.v = this.U[this.N];
  this.Y = true;
};
Upvalue.prototype.ac = function (fake_4, fake_5) {
  return this.Y ? this.v : this.U[this.N];
  this.D = fake_5;
  this.af = fake_4;
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
VM.prototype.x = function (keyIn, fake_23, fake_24, fake_25, idxIn) {
  var idx = idxIn ?? this.Q({}, null);
  this.T = fake_23;
  var key = keyIn ?? this.Q({}, 95);
  var v = this.J[idx];
  if (!key) return v;
  if (typeof v === "number") return v ^ key;
  if (typeof v !== "string") return v;

  // String: base64-decode to u16 LE byte pairs, then XOR each code with a
  // 16-bit keystream word derived from the full 32-bit key + position.
  var b = base64ToBytes(v);
  this.R = fake_25;
  this.F = fake_24;
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
VM.prototype.Q = function (fake_15, fake_16) {
  this.ab = fake_16 && fake_15;
  return this.r[this.U[this.G + 0]++];
};
VM.prototype.i = function (slot, fake_21, fp, fake_22) {
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this.U[fp + 7] + slot;
  this.C = fake_22;
  var uvs = this.c || (this.c = []);
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(undefined, [], this.U, "k", absSlot));
  this.V = fake_21;
};
Upvalue.prototype.e = function (fake_8, fake_7, v, fake_6) {
  this.B = fake_8 || fake_6;
  this.t = fake_7;
  if (this.Y) this.v = v;else this.U[this.N] = v;
};
VM.prototype.k = function (closure, fake_29, thisVal, fake_28, fake_30, fake_27, args) {
  var now = () => {
    return performance.now();
  };
  var lastTime = now();
  this.a = [fake_28, fake_30];
  this.y({}, [], 0, {}, args, thisVal, closure, undefined);
  while (true) {
    var fp = this.G;
    var regs = this.U;
    var bc = this.r;
    var pc = regs[fp + 0];
    if (pc >= bc.length) break;
    regs[fp + 0] = pc + 1;
    var op = this.r[pc];
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
        for (var i = 0; i < this.r.length; i++) this.r[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this.ag; i2++) this.U[i2] = undefined;
        op = 39;
        regs[fp + 0] = this.r.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + 7];

      /* @SWITCH */
      switch (op) {
        case 0:
          {
            var dst = this.Q([], "q");
            regs[base + dst] = this.x();
            break;
          }
        case 1:
          {
            var dst = this.Q(undefined, 11);
            regs[base + dst] = this.Q("x", undefined);
            break;
          }
        case 2:
          {
            var dst = this.Q("z", "q");
            var globalName = this.x();
            if (!(globalName in this.I)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.I[globalName];
            break;
          }
        case 3:
          {
            var dst = this.Q([], {});
            regs[base + dst] = regs[fp + 4].E[this.Q(undefined, {})].ac({}, "q");
            break;
          }
        case 4:
          {
            var dst = this.Q([], undefined);
            regs[base + dst] = regs[fp + 3];
            break;
          }
        case 5:
          {
            var dst = this.Q(null, undefined);
            regs[base + dst] = regs[base + this.Q(null, [])];
            break;
          }
        case 6:
          {
            // globals[globalName] = regs[src]
            this.I[this.x()] = regs[base + this.Q(null, [])];
            break;
          }
        case 7:
          {
            var uvIdx = this.Q({}, undefined);
            regs[fp + 4].E[uvIdx].e({}, [], regs[base + this.Q([], {})], undefined);
            break;
          }
        case 8:
          {
            // dst = regs[obj][regs[key]]
            var dst = this.Q({}, []);
            var obj = regs[base + this.Q(null, {})];
            var key = regs[base + this.Q([], [])];
            regs[base + dst] = obj[key];
            break;
          }
        case 9:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this.Q(undefined, null)];
            var key = regs[base + this.Q(null, [])];
            var val = regs[base + this.Q({}, 67)];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 10:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this.Q([], {});
            var obj = regs[base + this.Q(null, "q")];
            var key = regs[base + this.Q(undefined, "z")];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case 11:
          {
            var dst = this.Q(undefined, {});
            var a = regs[base + this.Q([], 91)];
            regs[base + dst] = a + regs[base + this.Q({}, 90)];
            break;
          }
        case 12:
          {
            var dst = this.Q({}, null);
            var a = regs[base + this.Q(54, "x")];
            regs[base + dst] = a - regs[base + this.Q([], "q")];
            break;
          }
        case 13:
          {
            var dst = this.Q(null, "k");
            var a = regs[base + this.Q([], 91)];
            regs[base + dst] = a * regs[base + this.Q(null, {})];
            break;
          }
        case 14:
          {
            var dst = this.Q(null, 24);
            var a = regs[base + this.Q("q", {})];
            regs[base + dst] = a / regs[base + this.Q([], "z")];
            break;
          }
        case 15:
          {
            var dst = this.Q(30, undefined);
            var a = regs[base + this.Q([], [])];
            regs[base + dst] = a % regs[base + this.Q([], undefined)];
            break;
          }
        case 60:
          {
            // Math.pow instead of `**`
            var dst = this.Q(null, null);
            var a = regs[base + this.Q(null, 18)];
            regs[base + dst] = Math.pow(a, regs[base + this.Q({}, "z")]);
            break;
          }
        case 16:
          {
            var dst = this.Q([], 96);
            var a = regs[base + this.Q({}, "z")];
            regs[base + dst] = a & regs[base + this.Q({}, 4)];
            break;
          }
        case 17:
          {
            var dst = this.Q(undefined, 19);
            var a = regs[base + this.Q(24, "x")];
            regs[base + dst] = a | regs[base + this.Q({}, "y")];
            break;
          }
        case 18:
          {
            var dst = this.Q(undefined, "y");
            var a = regs[base + this.Q([], {})];
            regs[base + dst] = a ^ regs[base + this.Q(null, [])];
            break;
          }
        case 19:
          {
            var dst = this.Q("z", []);
            var a = regs[base + this.Q(undefined, [])];
            regs[base + dst] = a << regs[base + this.Q(24, "z")];
            break;
          }
        case 20:
          {
            var dst = this.Q("q", {});
            var a = regs[base + this.Q(undefined, 17)];
            regs[base + dst] = a >> regs[base + this.Q({}, undefined)];
            break;
          }
        case 21:
          {
            var dst = this.Q([], "y");
            var a = regs[base + this.Q("q", 0)];
            regs[base + dst] = a >>> regs[base + this.Q({}, {})];
            break;
          }

        // Comparison  (dst, src1, src2)
        case 22:
          {
            var dst = this.Q([], 58);
            var a = regs[base + this.Q(87, null)];
            regs[base + dst] = a < regs[base + this.Q("y", 60)];
            break;
          }
        case 23:
          {
            var dst = this.Q(60, "z");
            var a = regs[base + this.Q({}, 6)];
            regs[base + dst] = a > regs[base + this.Q(null, "q")];
            break;
          }
        case 24:
          {
            var dst = this.Q("z", "x");
            var a = regs[base + this.Q("x", [])];
            regs[base + dst] = a <= regs[base + this.Q({}, {})];
            break;
          }
        case 25:
          {
            var dst = this.Q(undefined, "k");
            var a = regs[base + this.Q({}, null)];
            regs[base + dst] = a >= regs[base + this.Q(undefined, 79)];
            break;
          }
        case 26:
          {
            var dst = this.Q([], 1);
            var a = regs[base + this.Q("y", [])];
            regs[base + dst] = a === regs[base + this.Q("k", null)];
            break;
          }
        case 27:
          {
            var dst = this.Q({}, {});
            var a = regs[base + this.Q({}, 83)];
            regs[base + dst] = a !== regs[base + this.Q([], null)];
            break;
          }
        case 28:
          {
            var dst = this.Q(undefined, 75);
            var a = regs[base + this.Q({}, undefined)];
            regs[base + dst] = a == regs[base + this.Q("y", "x")];
            break;
          }
        case 29:
          {
            var dst = this.Q(undefined, {});
            var a = regs[base + this.Q([], [])];
            regs[base + dst] = a != regs[base + this.Q({}, "z")];
            break;
          }
        case 30:
          {
            var dst = this.Q(null, "z");
            var a = regs[base + this.Q(null, [])];
            regs[base + dst] = a in regs[base + this.Q({}, "q")];
            break;
          }
        case 31:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this.Q(null, undefined);
            var obj = regs[base + this.Q({}, {})];
            regs[base + dst] = obj instanceof regs[base + this.Q(60, null)];
            break;
          }

        // Unary  (dst, src)
        case 32:
          {
            var dst = this.Q("y", "y");
            regs[base + dst] = -regs[base + this.Q(undefined, null)];
            break;
          }
        case 33:
          {
            var dst = this.Q({}, "y");
            regs[base + dst] = +regs[base + this.Q([], 82)];
            break;
          }
        case 34:
          {
            var dst = this.Q(null, "k");
            regs[base + dst] = !regs[base + this.Q("z", [])];
            break;
          }
        case 35:
          {
            var dst = this.Q({}, null);
            regs[base + dst] = ~regs[base + this.Q({}, 74)];
            break;
          }
        case 36:
          {
            var dst = this.Q("y", {});
            regs[base + dst] = typeof regs[base + this.Q({}, [])];
            break;
          }
        case 37:
          {
            var dst = this.Q("q", []);
            this.Q({}, undefined); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case 38:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this.Q({}, 50);
            var name = this.x();
            var val = Object.prototype.hasOwnProperty.call(this.I, name) ? this.I[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case 39:
          regs[fp + 0] = this.Q({}, 33);
          break;
        case 40:
          {
            var src = this.Q(67, undefined);
            var target = this.Q("q", undefined);
            if (!regs[base + src]) regs[fp + 0] = target;
            break;
          }
        case 41:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this.Q("q", null);
            var target = this.Q(null, {});
            if (regs[base + src]) regs[fp + 0] = target;
            break;
          }

        // Calls
        case 42:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this.Q({}, null);
            var callee = regs[base + this.Q(null, [])];
            var argc = this.Q(null, {});
            var args;
            if (argc === 65535) {
              args = regs[base + this.Q({}, 66)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.Q(undefined, 53)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.y(undefined, {}, dst << 1, [], args, this.I, closure, null);
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case 43:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.Q("z", 70);
            var receiver = regs[base + this.Q(10, null)];
            var callee = regs[base + this.Q({}, undefined)];
            var argc = this.Q(undefined, {});
            var args;
            if (argc === 65535) {
              args = regs[base + this.Q(1, [])];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.Q("z", [])];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.y({}, 20, dst << 1, 55, args, receiver, closure, []);
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case 44:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.Q(undefined, []);
            var callee = regs[base + this.Q(null, "x")];
            var argc = this.Q(76, {});
            var args;
            if (argc === 65535) {
              args = regs[base + this.Q({}, [])];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.Q(73, 28)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this.y("y", 0, dst << 1 | 1, {}, args, Object.create(closure.prototype || null), closure, 95);
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case 45:
          {
            var retVal = regs[base + this.Q([], undefined)];
            this.m(fp, []); // must happen before frame is abandoned

            var caller = regs[fp + 1];
            var retDst = regs[fp + 2];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + 6];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this.ag = fp;
            this.G = caller;

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
          throw regs[base + this.Q(null, [])];

        // Closures
        case 47:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this.Q(undefined, {});
            var startPc = this.Q({}, "z");
            var paramCount = this.Q([], null);
            var regCount = this.Q(undefined, undefined);
            var uvCount = this.Q({}, 48);
            var hasRest = this.Q(undefined, "q"); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this.Q(null, {});
              var uvIndex = this.Q(91, "y");
              uvDescs[i] = {
                K: isLocalRaw,
                z: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              b: paramCount,
              M: regCount,
              X: startPc,
              A: hasRest
            };
            var closure = new Closure(fn, null, null, {});
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.K) {
                closure.E.push(this.i(uvd.z, 74, fp, undefined));
              } else {
                closure.E.push(regs[fp + 4].E[uvd.z]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM(self.J, {}, self.I, 32, self.r).k(c, {}, this == null ? self.I : this, [], 52, {}, Array.prototype.slice.call(arguments));
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
            var dst = this.Q(null, []);
            var count = this.Q("z", undefined);
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this.Q("z", null)];
            regs[base + dst] = elems;
            break;
          }
        case 49:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this.Q([], 75);
            var pairCount = this.Q({}, null);
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this.Q(null, null)];
              var val = regs[base + this.Q("x", null)];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case 50:
          {
            // obj, key, fn
            var obj = regs[base + this.Q("z", undefined)];
            var key = regs[base + this.Q({}, 41)];
            var getterFn = regs[base + this.Q({}, [])];
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
            var obj = regs[base + this.Q(null, null)];
            var key = regs[base + this.Q([], undefined)];
            var setterFn = regs[base + this.Q({}, {})];
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
            var dst = this.Q(32, []);
            var obj = regs[base + this.Q(null, null)];
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
              aa: keys,
              p: 0
            };
            break;
          }
        case 53:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this.Q("z", "q");
            var iter = regs[base + this.Q({}, {})];
            var exitTarget = this.Q("x", "z");
            if (iter.p >= iter.aa.length) {
              regs[fp + 0] = exitTarget;
            } else {
              regs[base + dst] = iter.aa[iter.p++];
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
              O: this.Q(undefined, {}),
              f: this.Q(null, [])
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
              h: this.Q([], {}),
              g: this.Q("k", undefined),
              d: this.Q("z", {}),
              ae: this.Q(61, null)
            });
            break;
          }

        // Self-modifying bytecode
        case 56:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this.Q("q", []);
            var sliceStart = this.Q(null, 4);
            var sliceEnd = this.Q(75, "q");
            var pk = this.Q(undefined, null) ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.r[destPc + (pi - sliceStart)] = (this.r[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case 58:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + 0] = regs[base + this.Q([], null)];
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
      var searchFrame = this.G;
      while (searchFrame) {
        var handlers = regs[searchFrame + 5];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this.m(searchFrame, undefined);
        this.ag = searchFrame;
        searchFrame = regs[searchFrame + 1];
        this.G = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + 5].pop();
      var hBase = regs[handledFrame + 7];
      if (h.f !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.f] = err;
        regs[handledFrame + 0] = h.O;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.g] = h.ae;
        regs[hBase + h.d] = err;
        regs[handledFrame + 0] = h.h;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this.ag = handledFrame + regs[handledFrame + 6];
      this.G = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this.G) return this.U[0];
  }
  this.P = fake_27 || fake_29;
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
var vm = new VM(CONSTANTS, undefined, globals, "z", decodeBytecode(BYTECODE));
vm.k(new Closure({
  b: 0,
  M: 7,
  X: 0
}, null, undefined, null), 66, undefined, "z", undefined, null, null // no arguments object / parameter setup for the root frame
);