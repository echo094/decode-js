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
var CLOSURE_MAP = new WeakMap();

// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)

// Closure & Frame
function Closure(fn, fake_6) {
  this.B = fn;
  this.E = [];
  this.prototype = {}; // <- default prototype object for `new`
  this.O = fake_6;
}

// VM
// There is no Frame object and no frame stack. A frame is a block of slots in
// the flat array `_regs`: HEADER_SIZE header slots (see utils/frame-layout.ts) followed
// by the frame's registers. `_f` — the only piece of live execution state the VM
// object exposes — is the current frame's base offset, and each frame's CALLER
// slot points at the one that called it, so the call stack is an implicit linked
// list with nothing to enumerate.
var CONSTANTS = [/* 0 */2, /* 1 */5, /* 2 */"window", /* 3 */"TEST_OUTPUT", /* 4 */"concat", /* 5 */undefined];
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
function VM(bytecode, fake_7, globals, constants) {
  this.J = bytecode;
  this.A = constants;
  this.U = fake_7;
  this.d = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this.W = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this.T = [];
  this.u = 8;
  this.o = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
function Upvalue(absSlot, fake_1, regs) {
  this.e = fake_1;
  this.T = regs; // shared reference to VM._regs flat array
  this.f = absSlot; // absolute index; stable as long as frame is alive
  this.p = false;
  this.j = undefined;
}
var BYTECODE = [49294, 1, 10642, 4, 68, 2, 5, 0, 0, 12815, 2, 4, 63273, 4, 0, 0, 63273, 5, 1, 0, 49940, 6, 2, 4, 5, 12815, 3, 6, 44053, 4, 2, 0, 63273, 5, 3, 0, 49940, 6, 0, 63273, 7, 4, 0, 55279, 8, 6, 7, 27168, 7, 6, 8, 1, 3, 39948, 6, 2, 1404279311, 7, 5872, 4, 5, 6, 63273, 4, 5, 0, 13431, 4, 49294, 3, 38978, 4, 0, 1, 13431, 4, 63273, 4, 5, 0, 13431, 4];
Upvalue.prototype.i = function (fake_2) {
  this.Y = fake_2;
  return this.p ? this.j : this.T[this.f];
};
Upvalue.prototype.s = function (fake_4, fake_5) {
  this.j = this.T[this.f];
  this.r = fake_5;
  this.p = true;
  this.a = fake_4;
};
VM.prototype.H = function (fp, fake_17) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this.W;
  this.N = fake_17;
  if (!uvs) return; // nothing in this program ever captured a local
  var regs = this.T;
  var hi = fp + regs[fp + 4];
  for (var i = regs[fp + 0]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv.s(65, undefined);
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
Upvalue.prototype.y = function (fake_3, v) {
  if (this.p) this.j = v;else this.T[this.f] = v;
  this.k = fake_3;
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
VM.prototype.c = function (fake_16, keyIn, idxIn) {
  var idx = idxIn ?? this.L(27, null, null);
  var key = keyIn ?? this.L("y", {}, undefined);
  this.g = fake_16;
  var v = this.A[idx];
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
VM.prototype.V = function (fake_15, fake_13, fp, fake_14, slot) {
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this.T[fp + 0] + slot;
  var uvs = this.W || (this.W = []);
  this.w = fake_13;
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(absSlot, undefined, this.T));
  this.t = [fake_15, fake_14];
};
VM.prototype.L = function (fake_10, fake_9, fake_8) {
  this.n = fake_8;
  this.m = fake_9 && fake_10;
  return this.J[this.T[this.o + 7]++];
};

// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
VM.prototype.I = function (retDst, args, fake_11, fake_12, closure, thisVal) {
  var fn = closure.B;
  var regs = this.T;
  var fp = this.u;
  var size = 10 + fn.C;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + 10;
  regs[fp + 7] = fn.F;
  this.G = [fake_11, fake_12];
  regs[fp + 2] = this.o;
  regs[fp + 1] = retDst;
  regs[fp + 3] = thisVal;
  regs[fp + 6] = closure;
  regs[fp + 4] = size;
  regs[fp + 0] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof 8 === "number") regs[fp + 8] = end;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.X;
  if (typeof void 0 === "number") regs[fp + void 0] = args;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.F;
  if (typeof void 0 === "number") regs[fp + void 0] = 0;
  this.u = end;
  if (args) {
    if (fn.z) {
      var restSlot = fn.X - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.C; a++) regs[base + a] = args[a];
    }
    if (fn.X < fn.C) regs[base + fn.X] = args;
  }
  this.o = fp;
};
VM.prototype.q = function (args, fake_18, fake_19, closure, thisVal, fake_20) {
  var now = () => {
    return performance.now();
  };
  var lastTime = now();
  this.h = [fake_19, fake_20];
  this.I(0, args, 42, {}, closure, thisVal);
  while (true) {
    var fp = this.o;
    var regs = this.T;
    var bc = this.J;
    var pc = regs[fp + 7];
    if (pc >= bc.length) break;
    regs[fp + 7] = pc + 1;
    var op = this.J[pc];
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
        for (var i = 0; i < this.J.length; i++) this.J[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this.u; i2++) this.T[i2] = undefined;
        op = 7297;
        regs[fp + 7] = this.J.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + 0];

      /* @SWITCH */
      switch (op) {
        case 63273:
          {
            var dst = this.L("x", "k", {});
            regs[base + dst] = this.c();
            break;
          }
        case 2068:
          {
            var dst = this.L({}, undefined, 52);
            regs[base + dst] = this.L(null, undefined, "k");
            break;
          }
        case 44053:
          {
            var dst = this.L({}, undefined, undefined);
            var globalName = this.c();
            if (!(globalName in this.d)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.d[globalName];
            break;
          }
        case 41765:
          {
            var dst = this.L(null, null, undefined);
            regs[base + dst] = regs[fp + 6].E[this.L(81, null, "x")].i([]);
            break;
          }
        case 49294:
          {
            var dst = this.L({}, "z", null);
            regs[base + dst] = regs[fp + 3];
            break;
          }
        case 12815:
          {
            var dst = this.L(null, "k", {});
            regs[base + dst] = regs[base + this.L(null, "k", "z")];
            break;
          }
        case 28556:
          {
            // globals[globalName] = regs[src]
            this.d[this.c()] = regs[base + this.L({}, {}, null)];
            break;
          }
        case 55066:
          {
            var uvIdx = this.L(77, null, null);
            regs[fp + 6].E[uvIdx].y(44, regs[base + this.L(undefined, 31, 81)]);
            break;
          }
        case 55279:
          {
            // dst = regs[obj][regs[key]]
            var dst = this.L("q", [], 51);
            var obj = regs[base + this.L(undefined, {}, "y")];
            var key = regs[base + this.L(10, 37, [])];
            regs[base + dst] = obj[key];
            break;
          }
        case 5872:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this.L({}, undefined, null)];
            var key = regs[base + this.L(undefined, "z", [])];
            var val = regs[base + this.L(75, 6, {})];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 63910:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this.L(null, null, "q");
            var obj = regs[base + this.L(null, null, null)];
            var key = regs[base + this.L(null, undefined, {})];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case 38978:
          {
            var dst = this.L(85, "k", undefined);
            var a = regs[base + this.L(null, 85, null)];
            regs[base + dst] = a + regs[base + this.L([], {}, null)];
            break;
          }
        case 1702:
          {
            var dst = this.L("k", undefined, []);
            var a = regs[base + this.L(null, {}, {})];
            regs[base + dst] = a - regs[base + this.L("y", undefined, 28)];
            break;
          }
        case 59734:
          {
            var dst = this.L("z", "y", undefined);
            var a = regs[base + this.L(27, undefined, undefined)];
            regs[base + dst] = a * regs[base + this.L(null, [], null)];
            break;
          }
        case 65274:
          {
            var dst = this.L("k", 61, null);
            var a = regs[base + this.L(84, null, {})];
            regs[base + dst] = a / regs[base + this.L(undefined, [], {})];
            break;
          }
        case 11271:
          {
            var dst = this.L(undefined, 27, {});
            var a = regs[base + this.L([], "q", null)];
            regs[base + dst] = a % regs[base + this.L("x", undefined, undefined)];
            break;
          }
        case 18230:
          {
            // Math.pow instead of `**`
            var dst = this.L(80, 33, 73);
            var a = regs[base + this.L(45, [], 41)];
            regs[base + dst] = Math.pow(a, regs[base + this.L([], undefined, [])]);
            break;
          }
        case 21828:
          {
            var dst = this.L(null, 49, "z");
            var a = regs[base + this.L(undefined, [], {})];
            regs[base + dst] = a & regs[base + this.L("x", 35, "x")];
            break;
          }
        case 32609:
          {
            var dst = this.L(null, 78, null);
            var a = regs[base + this.L(null, 35, undefined)];
            regs[base + dst] = a | regs[base + this.L("q", {}, {})];
            break;
          }
        case 15560:
          {
            var dst = this.L(null, {}, []);
            var a = regs[base + this.L({}, {}, null)];
            regs[base + dst] = a ^ regs[base + this.L(undefined, undefined, "z")];
            break;
          }
        case 51471:
          {
            var dst = this.L(undefined, {}, undefined);
            var a = regs[base + this.L(undefined, "q", {})];
            regs[base + dst] = a << regs[base + this.L({}, undefined, "z")];
            break;
          }
        case 50846:
          {
            var dst = this.L({}, undefined, {});
            var a = regs[base + this.L({}, undefined, [])];
            regs[base + dst] = a >> regs[base + this.L("k", "q", 47)];
            break;
          }
        case 44691:
          {
            var dst = this.L(9, {}, null);
            var a = regs[base + this.L(null, undefined, {})];
            regs[base + dst] = a >>> regs[base + this.L(null, undefined, null)];
            break;
          }

        // Comparison  (dst, src1, src2)
        case 11714:
          {
            var dst = this.L(62, undefined, 0);
            var a = regs[base + this.L(9, 38, undefined)];
            regs[base + dst] = a < regs[base + this.L({}, {}, null)];
            break;
          }
        case 28433:
          {
            var dst = this.L(91, null, "k");
            var a = regs[base + this.L(61, [], "k")];
            regs[base + dst] = a > regs[base + this.L({}, [], undefined)];
            break;
          }
        case 4517:
          {
            var dst = this.L(null, undefined, undefined);
            var a = regs[base + this.L([], undefined, undefined)];
            regs[base + dst] = a <= regs[base + this.L(undefined, [], 65)];
            break;
          }
        case 59488:
          {
            var dst = this.L("x", "q", null);
            var a = regs[base + this.L(null, undefined, undefined)];
            regs[base + dst] = a >= regs[base + this.L({}, null, 72)];
            break;
          }
        case 64647:
          {
            var dst = this.L(undefined, 4, 52);
            var a = regs[base + this.L({}, null, undefined)];
            regs[base + dst] = a === regs[base + this.L({}, undefined, {})];
            break;
          }
        case 13217:
          {
            var dst = this.L("q", "z", "q");
            var a = regs[base + this.L("k", null, "x")];
            regs[base + dst] = a !== regs[base + this.L({}, undefined, 12)];
            break;
          }
        case 45154:
          {
            var dst = this.L({}, [], {});
            var a = regs[base + this.L({}, 69, "k")];
            regs[base + dst] = a == regs[base + this.L({}, "q", "q")];
            break;
          }
        case 44273:
          {
            var dst = this.L(52, 27, {});
            var a = regs[base + this.L(null, undefined, null)];
            regs[base + dst] = a != regs[base + this.L([], null, null)];
            break;
          }
        case 23801:
          {
            var dst = this.L({}, [], 25);
            var a = regs[base + this.L([], [], 96)];
            regs[base + dst] = a in regs[base + this.L("x", undefined, [])];
            break;
          }
        case 1968:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this.L(null, "q", 63);
            var obj = regs[base + this.L({}, undefined, "k")];
            regs[base + dst] = obj instanceof regs[base + this.L([], 72, null)];
            break;
          }

        // Unary  (dst, src)
        case 23038:
          {
            var dst = this.L([], undefined, {});
            regs[base + dst] = -regs[base + this.L(undefined, [], "x")];
            break;
          }
        case 2315:
          {
            var dst = this.L(undefined, null, "x");
            regs[base + dst] = +regs[base + this.L({}, undefined, null)];
            break;
          }
        case 54482:
          {
            var dst = this.L(undefined, 22, undefined);
            regs[base + dst] = !regs[base + this.L("x", {}, null)];
            break;
          }
        case 19322:
          {
            var dst = this.L(12, undefined, null);
            regs[base + dst] = ~regs[base + this.L(53, {}, undefined)];
            break;
          }
        case 20202:
          {
            var dst = this.L(85, 49, null);
            regs[base + dst] = typeof regs[base + this.L({}, "k", "k")];
            break;
          }
        case 49339:
          {
            var dst = this.L([], {}, undefined);
            this.L("q", {}, {}); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case 11916:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this.L(37, 30, "z");
            var name = this.c();
            var val = Object.prototype.hasOwnProperty.call(this.d, name) ? this.d[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case 7297:
          regs[fp + 7] = this.L({}, "x", "q");
          break;
        case 64871:
          {
            var src = this.L(undefined, [], "x");
            var target = this.L(undefined, undefined, []);
            if (!regs[base + src]) regs[fp + 7] = target;
            break;
          }
        case 17601:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this.L(undefined, {}, "x");
            var target = this.L("k", undefined, 0);
            if (regs[base + src]) regs[fp + 7] = target;
            break;
          }

        // Calls
        case 39948:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this.L("q", null, {});
            var callee = regs[base + this.L(undefined, "k", {})];
            var argc = this.L([], [], null);
            var args;
            if (argc === 1404279311) {
              args = regs[base + this.L({}, undefined, "y")];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.L([], undefined, 3)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.I(dst << 1, args, {}, null, closure, this.d);
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case 27168:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.L([], "q", "z");
            var receiver = regs[base + this.L(undefined, 30, [])];
            var callee = regs[base + this.L(33, null, {})];
            var argc = this.L({}, [], {});
            var args;
            if (argc === 1404279311) {
              args = regs[base + this.L("q", {}, undefined)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.L(null, 57, "x")];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.I(dst << 1, args, null, [], closure, receiver);
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case 58650:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.L([], undefined, null);
            var callee = regs[base + this.L("z", null, {})];
            var argc = this.L({}, null, []);
            var args;
            if (argc === 1404279311) {
              args = regs[base + this.L("k", undefined, {})];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.L(25, "x", "y")];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this.I(dst << 1 | 1, args, [], {}, closure, Object.create(closure.prototype || null));
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case 13431:
          {
            var retVal = regs[base + this.L(undefined, {}, [])];
            this.H(fp, 53); // must happen before frame is abandoned

            var caller = regs[fp + 2];
            var retDst = regs[fp + 1];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + 4];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this.u = fp;
            this.o = caller;

            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + 0] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 56258:
          throw regs[base + this.L(undefined, null, [])];

        // Closures
        case 10642:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this.L(undefined, "y", "k");
            var startPc = this.L(11, null, undefined);
            var paramCount = this.L("x", undefined, "x");
            var regCount = this.L({}, undefined, []);
            var uvCount = this.L("q", null, {});
            var hasRest = this.L([], [], {}); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this.L({}, "q", {});
              var uvIndex = this.L([], 91, undefined);
              uvDescs[i] = {
                l: isLocalRaw,
                D: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              X: paramCount,
              C: regCount,
              F: startPc,
              z: hasRest
            };
            var closure = new Closure(fn, []);
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.l) {
                closure.E.push(this.V([], undefined, fp, [], uvd.D));
              } else {
                closure.E.push(regs[fp + 6].E[uvd.D]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM(self.J, [], self.d, self.A).q(Array.prototype.slice.call(arguments), [], "k", c, this == null ? self.d : this, 82);
              };
            }(closure);
            CLOSURE_MAP.set(shell, closure);
            shell.prototype = closure.prototype; // unified prototype for new/instanceof
            regs[base + dst] = shell;
            break;
          }

        // Collections
        case 49940:
          {
            // dst, count, [elemReg...]
            var dst = this.L(24, undefined, {});
            var count = this.L({}, null, "q");
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this.L("k", "q", null)];
            regs[base + dst] = elems;
            break;
          }
        case 64668:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this.L(null, null, 25);
            var pairCount = this.L({}, {}, 2);
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this.L([], undefined, [])];
              var val = regs[base + this.L([], null, [])];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case 24330:
          {
            // obj, key, fn
            var obj = regs[base + this.L({}, [], null)];
            var key = regs[base + this.L([], null, undefined)];
            var getterFn = regs[base + this.L("y", "x", undefined)];
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
        case 64651:
          {
            // obj, key, fn
            var obj = regs[base + this.L(14, {}, [])];
            var key = regs[base + this.L(undefined, 75, [])];
            var setterFn = regs[base + this.L(46, 47, null)];
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
        case 65017:
          {
            // dst, src — build iterator object from enumerable keys of regs[src]
            var dst = this.L(null, 71, []);
            var obj = regs[base + this.L(null, {}, [])];
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
              P: keys,
              S: 0
            };
            break;
          }
        case 10020:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this.L({}, "q", {});
            var iter = regs[base + this.L("z", 63, 5)];
            var exitTarget = this.L({}, {}, "k");
            if (iter.S >= iter.P.length) {
              regs[fp + 7] = exitTarget;
            } else {
              regs[base + dst] = iter.P[iter.S++];
            }
            break;
          }

        // ── Exception handling ────────────────────────────────────────────────
        case 19519:
          {
            // handlerPc, exceptionReg — push exception handler record onto current
            // frame. The handler stack lives in a header slot and is created on
            // first use, so frames that never try/catch carry nothing.
            var hs = regs[fp + 9];
            if (!hs) regs[fp + 9] = hs = [];
            hs.push({
              R: this.L(undefined, {}, undefined),
              b: this.L([], 72, 56)
            });
            break;
          }
        case 13991:
          {
            // Normal exit from a try block — disarm the top handler record
            // (works for both catch and finally regions; they share the stack).
            regs[fp + 9].pop();
            break;
          }
        case 40589:
          {
            // finallyPc, contReg, payloadReg, throwPad
            // Arm a finalizer for the current region.  Unlike a catch record this
            // carries no exceptionReg; instead the continuation register (contReg)
            // receives the resume PC and payloadReg carries the in-flight value.
            var hs = regs[fp + 9];
            if (!hs) regs[fp + 9] = hs = [];
            hs.push({
              x: this.L(undefined, 66, 29),
              M: this.L({}, [], 64),
              K: this.L("q", 39, {}),
              v: this.L(null, [], null)
            });
            break;
          }

        // Self-modifying bytecode
        case 1001:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this.L([], [], 2);
            var sliceStart = this.L("z", {}, {});
            var sliceEnd = this.L(59, [], {});
            var pk = this.L([], null, undefined) ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.J[destPc + (pi - sliceStart)] = (this.J[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case 24210:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + 7] = regs[base + this.L([], 90, "x")];
            break;
          }
        case 27223:
          {
            debugger;
            break;
          }
        default:
          throw new Error("Unknown opcode: " + op + " at pc " + (regs[fp + 7] - 1));
      }
    } catch (err) {
      // Exception handler unwinding
      // Walk the CALLER chain from the current frame until we find one holding an open exception handler (TRY_SETUP without a matching TRY_END).
      // For every frame we abandon along the way, close its captured upvalues and release its block.
      var handledFrame = 0;
      var searchFrame = this.o;
      while (searchFrame) {
        var handlers = regs[searchFrame + 9];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this.H(searchFrame, 59);
        this.u = searchFrame;
        searchFrame = regs[searchFrame + 2];
        this.o = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + 9].pop();
      var hBase = regs[handledFrame + 0];
      if (h.b !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.b] = err;
        regs[handledFrame + 7] = h.R;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.M] = h.v;
        regs[hBase + h.K] = err;
        regs[handledFrame + 7] = h.x;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this.u = handledFrame + regs[handledFrame + 4];
      this.o = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this.o) return this.T[0];
  }
  this.Q = fake_18;
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
var vm = new VM(decodeBytecode(BYTECODE), null, globals, CONSTANTS);
vm.q(null // no arguments object / parameter setup for the root frame
, {}, {}, new Closure({
  X: 0,
  C: 9,
  F: 0
}, undefined), undefined, null);