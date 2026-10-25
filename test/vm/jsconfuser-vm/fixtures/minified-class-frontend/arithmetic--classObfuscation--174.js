function VM(constants, bytecode, fake_13, fake_15, fake_14, fake_12, globals) {
  this.G = bytecode;
  this.w = constants;
  this.Z = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this.E = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this.r = fake_14;
  this.O = [];
  this.z = fake_12 && fake_15;
  this.M = fake_13;
  this.L = 1;
  this.U = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
// Closure & Frame
function Closure(fake_10, fake_11, fn) {
  this.g = [fake_10, fake_11];
  this.l = fn;
  this.D = [];
  this.prototype = {}; // <- default prototype object for `new`
}
// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)
function Upvalue(fake_1, fake_2, regs, absSlot, fake_3) {
  this.O = regs; // shared reference to VM._regs flat array
  this.u = fake_2 || fake_3;
  this.j = fake_1;
  this.q = absSlot; // absolute index; stable as long as frame is alive
  this.b = false;
  this.a = undefined;
}
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
var BYTECODE = [4, 1, 2, 2, 0, 0, 0, 3, 1, 0, 0, 4, 2, 0, 0, 5, 3, 0, 13, 6, 4, 5, 0, 4, 4, 0, 11, 5, 6, 4, 0, 4, 5, 0, 15, 6, 5, 4, 9, 2, 3, 6, 0, 2, 6, 0, 45, 2];
var CONSTANTS = [/* 0 */"window", /* 1 */"TEST_OUTPUT", /* 2 */6, /* 3 */7, /* 4 */3, /* 5 */5, /* 6 */undefined];
Upvalue.prototype.V = function (fake_5, fake_4, fake_6) {
  return this.b ? this.a : this.O[this.q];
  this.C = fake_6;
  this.Y = fake_4;
  this.i = fake_5;
};
// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
VM.prototype.c = function (closure, fake_20, retDst, args, fake_19, thisVal, fake_18) {
  var fn = closure.l;
  var regs = this.O;
  var fp = this.L;
  var size = 8 + fn.n;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + 8;
  regs[fp + 0] = fn.aa;
  this.X = fake_20;
  regs[fp + 1] = this.U;
  regs[fp + 2] = retDst;
  regs[fp + 3] = thisVal;
  regs[fp + 4] = closure;
  regs[fp + 6] = size;
  regs[fp + 7] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof void 0 === "number") regs[fp + void 0] = end;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.h;
  this.W = fake_19;
  if (typeof void 0 === "number") regs[fp + void 0] = args;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.aa;
  this.B = fake_18;
  if (typeof void 0 === "number") regs[fp + void 0] = 0;
  this.L = end;
  if (args) {
    if (fn.R) {
      var restSlot = fn.h - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.n; a++) regs[base + a] = args[a];
    }
    if (fn.h < fn.n) regs[base + fn.h] = args;
  }
  this.U = fp;
};
VM.prototype.ab = function (fake_25, fp) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this.E;
  if (!uvs) return; // nothing in this program ever captured a local
  var regs = this.O;
  var hi = fp + regs[fp + 6];
  this.v = fake_25;
  for (var i = regs[fp + 7]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv.m(null, {});
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
VM.prototype.J = function (fp, fake_22, fake_21, slot) {
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this.O[fp + 7] + slot;
  var uvs = this.E || (this.E = []);
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(undefined, null, this.O, absSlot, []));
  this.H = [fake_22, fake_21];
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
VM.prototype.k = function (idxIn, fake_24, fake_23, keyIn) {
  var idx = idxIn ?? this.o(undefined, 53);
  var key = keyIn ?? this.o(null, "y");
  var v = this.w[idx];
  if (!key) return v;
  if (typeof v === "number") return v ^ key;
  if (typeof v !== "string") return v;

  // String: base64-decode to u16 LE byte pairs, then XOR each code with a
  // 16-bit keystream word derived from the full 32-bit key + position.
  this.d = [fake_24, fake_23];
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
Upvalue.prototype.F = function (fake_7, v) {
  this.K = fake_7;
  if (this.b) this.a = v;else this.O[this.q] = v;
};
Upvalue.prototype.m = function (fake_9, fake_8) {
  this.a = this.O[this.q];
  this.b = true;
  this.A = [fake_8, fake_9];
};
VM.prototype.o = function (fake_17, fake_16) {
  this.T = [fake_16, fake_17];
  return this.G[this.O[this.U + 0]++];
};
VM.prototype.t = function (thisVal, fake_26, args, fake_28, closure, fake_27) {
  var now = () => {
    return performance.now();
  };
  this.f = fake_26;
  var lastTime = now();
  this.c(closure, undefined, 0, args, "x", thisVal, undefined);
  while (true) {
    var fp = this.U;
    var regs = this.O;
    var bc = this.G;
    var pc = regs[fp + 0];
    if (pc >= bc.length) break;
    regs[fp + 0] = pc + 1;
    var op = this.G[pc];
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
        for (var i = 0; i < this.G.length; i++) this.G[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this.L; i2++) this.O[i2] = undefined;
        op = 39;
        regs[fp + 0] = this.G.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + 7];

      /* @SWITCH */
      switch (op) {
        case 0:
          {
            var dst = this.o([], {});
            regs[base + dst] = this.k();
            break;
          }
        case 1:
          {
            var dst = this.o([], 12);
            regs[base + dst] = this.o("y", null);
            break;
          }
        case 2:
          {
            var dst = this.o(undefined, undefined);
            var globalName = this.k();
            if (!(globalName in this.Z)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.Z[globalName];
            break;
          }
        case 3:
          {
            var dst = this.o(undefined, undefined);
            regs[base + dst] = regs[fp + 4].D[this.o([], 81)].V("q", "y", 9);
            break;
          }
        case 4:
          {
            var dst = this.o([], undefined);
            regs[base + dst] = regs[fp + 3];
            break;
          }
        case 5:
          {
            var dst = this.o("k", []);
            regs[base + dst] = regs[base + this.o(82, [])];
            break;
          }
        case 6:
          {
            // globals[globalName] = regs[src]
            this.Z[this.k()] = regs[base + this.o({}, "z")];
            break;
          }
        case 7:
          {
            var uvIdx = this.o(undefined, undefined);
            regs[fp + 4].D[uvIdx].F(57, regs[base + this.o(44, undefined)]);
            break;
          }
        case 8:
          {
            // dst = regs[obj][regs[key]]
            var dst = this.o({}, null);
            var obj = regs[base + this.o(undefined, undefined)];
            var key = regs[base + this.o([], 64)];
            regs[base + dst] = obj[key];
            break;
          }
        case 9:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this.o({}, null)];
            var key = regs[base + this.o("z", undefined)];
            var val = regs[base + this.o(null, {})];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 10:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this.o(85, undefined);
            var obj = regs[base + this.o(undefined, [])];
            var key = regs[base + this.o("q", 64)];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case 11:
          {
            var dst = this.o("z", []);
            var a = regs[base + this.o(70, [])];
            regs[base + dst] = a + regs[base + this.o([], 95)];
            break;
          }
        case 12:
          {
            var dst = this.o(null, {});
            var a = regs[base + this.o(null, 88)];
            regs[base + dst] = a - regs[base + this.o([], {})];
            break;
          }
        case 13:
          {
            var dst = this.o("x", []);
            var a = regs[base + this.o("k", {})];
            regs[base + dst] = a * regs[base + this.o(undefined, null)];
            break;
          }
        case 14:
          {
            var dst = this.o(null, undefined);
            var a = regs[base + this.o("z", 3)];
            regs[base + dst] = a / regs[base + this.o("k", 77)];
            break;
          }
        case 15:
          {
            var dst = this.o([], undefined);
            var a = regs[base + this.o(null, [])];
            regs[base + dst] = a % regs[base + this.o(null, "k")];
            break;
          }
        case 60:
          {
            // Math.pow instead of `**`
            var dst = this.o(undefined, 37);
            var a = regs[base + this.o("y", {})];
            regs[base + dst] = Math.pow(a, regs[base + this.o([], "x")]);
            break;
          }
        case 16:
          {
            var dst = this.o([], "x");
            var a = regs[base + this.o({}, "z")];
            regs[base + dst] = a & regs[base + this.o("y", 15)];
            break;
          }
        case 17:
          {
            var dst = this.o(null, 51);
            var a = regs[base + this.o([], [])];
            regs[base + dst] = a | regs[base + this.o(null, undefined)];
            break;
          }
        case 18:
          {
            var dst = this.o([], {});
            var a = regs[base + this.o({}, {})];
            regs[base + dst] = a ^ regs[base + this.o({}, [])];
            break;
          }
        case 19:
          {
            var dst = this.o(32, null);
            var a = regs[base + this.o(56, [])];
            regs[base + dst] = a << regs[base + this.o(87, {})];
            break;
          }
        case 20:
          {
            var dst = this.o([], null);
            var a = regs[base + this.o(74, [])];
            regs[base + dst] = a >> regs[base + this.o({}, "y")];
            break;
          }
        case 21:
          {
            var dst = this.o([], []);
            var a = regs[base + this.o({}, null)];
            regs[base + dst] = a >>> regs[base + this.o(undefined, 50)];
            break;
          }

        // Comparison  (dst, src1, src2)
        case 22:
          {
            var dst = this.o(null, []);
            var a = regs[base + this.o(undefined, 3)];
            regs[base + dst] = a < regs[base + this.o(undefined, "k")];
            break;
          }
        case 23:
          {
            var dst = this.o(59, null);
            var a = regs[base + this.o("y", 48)];
            regs[base + dst] = a > regs[base + this.o([], {})];
            break;
          }
        case 24:
          {
            var dst = this.o(null, 17);
            var a = regs[base + this.o([], 98)];
            regs[base + dst] = a <= regs[base + this.o("z", "k")];
            break;
          }
        case 25:
          {
            var dst = this.o(undefined, 82);
            var a = regs[base + this.o([], [])];
            regs[base + dst] = a >= regs[base + this.o(undefined, undefined)];
            break;
          }
        case 26:
          {
            var dst = this.o(null, {});
            var a = regs[base + this.o(undefined, "k")];
            regs[base + dst] = a === regs[base + this.o(74, [])];
            break;
          }
        case 27:
          {
            var dst = this.o(undefined, "k");
            var a = regs[base + this.o(null, {})];
            regs[base + dst] = a !== regs[base + this.o(3, null)];
            break;
          }
        case 28:
          {
            var dst = this.o({}, []);
            var a = regs[base + this.o(29, undefined)];
            regs[base + dst] = a == regs[base + this.o({}, "x")];
            break;
          }
        case 29:
          {
            var dst = this.o({}, []);
            var a = regs[base + this.o(null, "z")];
            regs[base + dst] = a != regs[base + this.o([], undefined)];
            break;
          }
        case 30:
          {
            var dst = this.o("k", "k");
            var a = regs[base + this.o([], 66)];
            regs[base + dst] = a in regs[base + this.o(null, null)];
            break;
          }
        case 31:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this.o(undefined, null);
            var obj = regs[base + this.o("q", null)];
            regs[base + dst] = obj instanceof regs[base + this.o(undefined, [])];
            break;
          }

        // Unary  (dst, src)
        case 32:
          {
            var dst = this.o([], 19);
            regs[base + dst] = -regs[base + this.o(undefined, 30)];
            break;
          }
        case 33:
          {
            var dst = this.o("x", {});
            regs[base + dst] = +regs[base + this.o(60, 97)];
            break;
          }
        case 34:
          {
            var dst = this.o([], null);
            regs[base + dst] = !regs[base + this.o(null, {})];
            break;
          }
        case 35:
          {
            var dst = this.o(6, null);
            regs[base + dst] = ~regs[base + this.o(null, undefined)];
            break;
          }
        case 36:
          {
            var dst = this.o("y", 22);
            regs[base + dst] = typeof regs[base + this.o({}, 11)];
            break;
          }
        case 37:
          {
            var dst = this.o({}, null);
            this.o("q", "x"); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case 38:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this.o(undefined, "q");
            var name = this.k();
            var val = Object.prototype.hasOwnProperty.call(this.Z, name) ? this.Z[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case 39:
          regs[fp + 0] = this.o("z", "z");
          break;
        case 40:
          {
            var src = this.o("y", undefined);
            var target = this.o([], undefined);
            if (!regs[base + src]) regs[fp + 0] = target;
            break;
          }
        case 41:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this.o("k", "q");
            var target = this.o(53, []);
            if (regs[base + src]) regs[fp + 0] = target;
            break;
          }

        // Calls
        case 42:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this.o([], null);
            var callee = regs[base + this.o({}, {})];
            var argc = this.o(undefined, []);
            var args;
            if (argc === 65535) {
              args = regs[base + this.o(null, null)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.o(null, undefined)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.c(closure, "x", dst << 1, args, [], this.Z, null);
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case 43:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.o(null, []);
            var receiver = regs[base + this.o({}, undefined)];
            var callee = regs[base + this.o(undefined, null)];
            var argc = this.o(null, null);
            var args;
            if (argc === 65535) {
              args = regs[base + this.o({}, null)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.o(null, "z")];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.c(closure, 57, dst << 1, args, [], receiver, {});
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case 44:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.o([], "y");
            var callee = regs[base + this.o([], "y")];
            var argc = this.o(null, "z");
            var args;
            if (argc === 65535) {
              args = regs[base + this.o(20, [])];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.o([], null)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this.c(closure, 30, dst << 1 | 1, args, "q", Object.create(closure.prototype || null), []);
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case 45:
          {
            var retVal = regs[base + this.o({}, 13)];
            this.ab(null, fp); // must happen before frame is abandoned

            var caller = regs[fp + 1];
            var retDst = regs[fp + 2];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + 6];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this.L = fp;
            this.U = caller;

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
          throw regs[base + this.o("y", null)];

        // Closures
        case 47:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this.o("q", undefined);
            var startPc = this.o(undefined, []);
            var paramCount = this.o("z", null);
            var regCount = this.o([], []);
            var uvCount = this.o(undefined, {});
            var hasRest = this.o(89, null); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this.o([], []);
              var uvIndex = this.o({}, []);
              uvDescs[i] = {
                I: isLocalRaw,
                Q: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              h: paramCount,
              n: regCount,
              aa: startPc,
              R: hasRest
            };
            var closure = new Closure(45, undefined, fn);
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.I) {
                closure.D.push(this.J(fp, 79, 73, uvd.Q));
              } else {
                closure.D.push(regs[fp + 4].D[uvd.Q]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM(self.w, self.G, 2, null, null, undefined, self.Z).t(this == null ? self.Z : this, 36, Array.prototype.slice.call(arguments), 66, c, 70);
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
            var dst = this.o({}, 67);
            var count = this.o(undefined, "x");
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this.o(null, 63)];
            regs[base + dst] = elems;
            break;
          }
        case 49:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this.o(91, undefined);
            var pairCount = this.o({}, null);
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this.o([], 79)];
              var val = regs[base + this.o("k", "x")];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case 50:
          {
            // obj, key, fn
            var obj = regs[base + this.o(null, "q")];
            var key = regs[base + this.o(undefined, undefined)];
            var getterFn = regs[base + this.o([], null)];
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
            var obj = regs[base + this.o(null, null)];
            var key = regs[base + this.o(undefined, {})];
            var setterFn = regs[base + this.o(93, null)];
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
            var dst = this.o(null, undefined);
            var obj = regs[base + this.o(null, null)];
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
              N: 0
            };
            break;
          }
        case 53:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this.o({}, undefined);
            var iter = regs[base + this.o({}, undefined)];
            var exitTarget = this.o({}, 25);
            if (iter.N >= iter.x.length) {
              regs[fp + 0] = exitTarget;
            } else {
              regs[base + dst] = iter.x[iter.N++];
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
              e: this.o(undefined, undefined),
              ac: this.o(null, 44)
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
              P: this.o(undefined, "q"),
              y: this.o(null, "y"),
              s: this.o(undefined, null),
              p: this.o(null, "z")
            });
            break;
          }

        // Self-modifying bytecode
        case 56:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this.o("q", {});
            var sliceStart = this.o({}, 5);
            var sliceEnd = this.o(26, null);
            var pk = this.o({}, []) ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.G[destPc + (pi - sliceStart)] = (this.G[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case 58:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + 0] = regs[base + this.o(undefined, undefined)];
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
      var searchFrame = this.U;
      while (searchFrame) {
        var handlers = regs[searchFrame + 5];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this.ab(undefined, searchFrame);
        this.L = searchFrame;
        searchFrame = regs[searchFrame + 1];
        this.U = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + 5].pop();
      var hBase = regs[handledFrame + 7];
      if (h.ac !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.ac] = err;
        regs[handledFrame + 0] = h.e;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.y] = h.p;
        regs[hBase + h.s] = err;
        regs[handledFrame + 0] = h.P;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this.L = handledFrame + regs[handledFrame + 6];
      this.U = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this.U) return this.O[0];
  }
  this.S = fake_28 || fake_27;
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
var vm = new VM(CONSTANTS, decodeBytecode(BYTECODE), "y", [], {}, [], globals);
vm.t(undefined, undefined, null // no arguments object / parameter setup for the root frame
, undefined, new Closure({}, "k", {
  h: 0,
  n: 7,
  aa: 0
}), null);