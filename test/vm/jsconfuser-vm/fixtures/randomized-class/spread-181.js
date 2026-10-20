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

// VM
// There is no Frame object and no frame stack. A frame is a block of slots in
// the flat array `_regs`: HEADER_SIZE header slots (see utils/frame-layout.ts) followed
// by the frame's registers. `_f` — the only piece of live execution state the VM
// object exposes — is the current frame's base offset, and each frame's CALLER
// slot points at the one that called it, so the call stack is an implicit linked
// list with nothing to enumerate.
function VM(fake_14, bytecode, constants, fake_13, fake_15, globals) {
  this.v = bytecode;
  this.X = constants;
  this.ac = fake_14;
  this.Y = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this.N = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this.f = [];
  this.R = 11;
  this.F = fake_15 || fake_13;
  this.P = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
function Upvalue(absSlot, fake_3, regs, fake_2, fake_1) {
  this.n = fake_3;
  this.f = regs; // shared reference to VM._regs flat array
  this.r = fake_2;
  this.i = absSlot; // absolute index; stable as long as frame is alive
  this.J = false;
  this.o = undefined;
  this.M = fake_1;
}
var BYTECODE = [2151, 1, 18527, 4, 68, 2, 5, 0, 0, 21164, 2, 4, 26188, 4, 0, 0, 26188, 5, 1, 0, 28412, 6, 2, 4, 5, 21164, 3, 6, 56464, 4, 2, 0, 26188, 5, 3, 0, 28412, 6, 0, 26188, 7, 4, 0, 63110, 8, 6, 7, 15913, 7, 6, 8, 1, 3, 4545, 6, 2, 3847166315, 7, 45975, 4, 5, 6, 26188, 4, 5, 0, 62456, 4, 2151, 3, 37279, 4, 0, 1, 62456, 4, 26188, 4, 5, 0, 62456, 4];
// Closure & Frame
function Closure(fake_12, fake_11, fn) {
  this.l = fn;
  this.K = fake_12;
  this.C = [];
  this.prototype = {}; // <- default prototype object for `new`
  this.s = fake_11;
}
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
var CONSTANTS = [/* 0 */2, /* 1 */5, /* 2 */"window", /* 3 */"TEST_OUTPUT", /* 4 */"concat", /* 5 */undefined];
VM.prototype.aa = function (fake_20, fp, fake_23, fake_22, slot, fake_21) {
  this.p = fake_21 || fake_22;
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this.f[fp + 7] + slot;
  var uvs = this.N || (this.N = []);
  this.G = fake_23;
  this.Z = fake_20;
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue(absSlot, "y", this.f, {}, []));
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
VM.prototype.E = function (idxIn, fake_25, fake_24, keyIn) {
  this.w = [fake_24, fake_25];
  var idx = idxIn ?? this.S(undefined);
  var key = keyIn ?? this.S({});
  var v = this.X[idx];
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
Upvalue.prototype.O = function (fake_6, v, fake_7) {
  if (this.J) this.o = v;else this.f[this.i] = v;
  this.j = fake_7;
  this.H = fake_6;
};
Upvalue.prototype.u = function (fake_10, fake_8, fake_9) {
  this.af = fake_10;
  this.o = this.f[this.i];
  this.J = true;
  this.h = fake_9 || fake_8;
};
// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
VM.prototype.ag = function (fake_17, fake_18, fake_19, thisVal, retDst, args, closure) {
  var fn = closure.l;
  var regs = this.f;
  this.W = fake_17;
  var fp = this.R;
  var size = 13 + fn.q;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + 13;
  regs[fp + 1] = fn.ab;
  regs[fp + 10] = this.P;
  this.e = fake_18;
  regs[fp + 8] = retDst;
  regs[fp + 2] = thisVal;
  regs[fp + 3] = closure;
  regs[fp + 4] = size;
  regs[fp + 7] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof 9 === "number") regs[fp + 9] = end;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.U;
  if (typeof void 0 === "number") regs[fp + void 0] = args;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.ab;
  if (typeof void 0 === "number") regs[fp + void 0] = 0;
  this.d = fake_19;
  this.R = end;
  if (args) {
    if (fn.z) {
      var restSlot = fn.U - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.q; a++) regs[base + a] = args[a];
    }
    if (fn.U < fn.q) regs[base + fn.U] = args;
  }
  this.P = fp;
};
VM.prototype.S = function (fake_16) {
  this.k = fake_16;
  return this.v[this.f[this.P + 1]++];
};
VM.prototype.b = function (fake_27, fake_28, fake_29, fake_26, fp) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this.N;
  this.Q = fake_27;
  if (!uvs) return; // nothing in this program ever captured a local
  this.x = fake_29 && fake_26;
  var regs = this.f;
  this.g = fake_28;
  var hi = fp + regs[fp + 4];
  for (var i = regs[fp + 7]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv.u("q", null, undefined);
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
Upvalue.prototype.ah = function (fake_4, fake_5) {
  this.T = [fake_5, fake_4];
  return this.J ? this.o : this.f[this.i];
};
VM.prototype.t = function (closure, args, fake_31, thisVal, fake_30, fake_32) {
  this.A = fake_30 || fake_31;
  var now = () => {
    return performance.now();
  };
  var lastTime = now();
  this.ag(null, null, [], thisVal, 0, args, closure);
  this.a = fake_32;
  while (true) {
    var fp = this.P;
    var regs = this.f;
    var bc = this.v;
    var pc = regs[fp + 1];
    if (pc >= bc.length) break;
    regs[fp + 1] = pc + 1;
    var op = this.v[pc];
    // var opcode = this.bytecode[pc];
    // console.log(`[run] pc=${pc}, opcode=${opcode}, name=${Object.keys(OP).find((key) => OP[key] === opcode)}`);

    // Churn the decoy header slots so the real PC isn't the only slot moving
    /* @NOISE */
    if (typeof void 0 === "number") regs[fp + void 0] = (regs[fp + void 0] + 1) % bc.length;
    if (typeof void 0 === "number") regs[fp + void 0]++;
    if (typeof void 0 === "number") regs[fp + void 0] = op;
    if (typeof 0 === "number") regs[fp + 0] = regs[fp + 0] ^ pc | 0;

    // Debugging protection: Detects debugger by checking for >1s pauses which can only happen from debugger; or extremely slow sync tasks
    if (false) {
      var currentTime = now();
      var isTamper = currentTime - lastTime > false;
      lastTime = currentTime;
      if (isTamper) {
        // Poison the bytecode
        for (var i = 0; i < this.v.length; i++) this.v[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this.R; i2++) this.f[i2] = undefined;
        op = 39919;
        regs[fp + 1] = this.v.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + 7];

      /* @SWITCH */
      switch (op) {
        case 26188:
          {
            var dst = this.S([]);
            regs[base + dst] = this.E();
            break;
          }
        case 35667:
          {
            var dst = this.S(74);
            regs[base + dst] = this.S([]);
            break;
          }
        case 56464:
          {
            var dst = this.S("q");
            var globalName = this.E();
            if (!(globalName in this.Y)) {
              throw new ReferenceError(`${globalName} is not defined`);
            }
            regs[base + dst] = this.Y[globalName];
            break;
          }
        case 34526:
          {
            var dst = this.S("y");
            regs[base + dst] = regs[fp + 3].C[this.S({})].ah(null, undefined);
            break;
          }
        case 2151:
          {
            var dst = this.S(93);
            regs[base + dst] = regs[fp + 2];
            break;
          }
        case 21164:
          {
            var dst = this.S({});
            regs[base + dst] = regs[base + this.S({})];
            break;
          }
        case 4576:
          {
            // globals[globalName] = regs[src]
            this.Y[this.E()] = regs[base + this.S(undefined)];
            break;
          }
        case 43086:
          {
            var uvIdx = this.S({});
            regs[fp + 3].C[uvIdx].O(null, regs[base + this.S(67)], "y");
            break;
          }
        case 63110:
          {
            // dst = regs[obj][regs[key]]
            var dst = this.S(null);
            var obj = regs[base + this.S({})];
            var key = regs[base + this.S(75)];
            regs[base + dst] = obj[key];
            break;
          }
        case 45975:
          {
            // regs[obj][regs[key]] = regs[val]
            var obj = regs[base + this.S({})];
            var key = regs[base + this.S(23)];
            var val = regs[base + this.S("k")];
            // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
            Reflect.set(obj, key, val);
            break;
          }
        case 59697:
          {
            // regs[dst] = delete regs[obj][regs[key]]
            // The delete operator returns true if successful which is most cases
            var dst = this.S(null);
            var obj = regs[base + this.S(43)];
            var key = regs[base + this.S("z")];
            regs[base + dst] = delete obj[key];
            break;
          }

        // Arithmetic  (dst, src1, src2)
        case 37279:
          {
            var dst = this.S(undefined);
            var a = regs[base + this.S({})];
            regs[base + dst] = a + regs[base + this.S([])];
            break;
          }
        case 363:
          {
            var dst = this.S(undefined);
            var a = regs[base + this.S([])];
            regs[base + dst] = a - regs[base + this.S({})];
            break;
          }
        case 64040:
          {
            var dst = this.S([]);
            var a = regs[base + this.S(22)];
            regs[base + dst] = a * regs[base + this.S(null)];
            break;
          }
        case 64597:
          {
            var dst = this.S(undefined);
            var a = regs[base + this.S([])];
            regs[base + dst] = a / regs[base + this.S([])];
            break;
          }
        case 64807:
          {
            var dst = this.S(undefined);
            var a = regs[base + this.S({})];
            regs[base + dst] = a % regs[base + this.S("k")];
            break;
          }
        case 30314:
          {
            // Math.pow instead of `**`
            var dst = this.S("q");
            var a = regs[base + this.S({})];
            regs[base + dst] = Math.pow(a, regs[base + this.S(null)]);
            break;
          }
        case 24955:
          {
            var dst = this.S(45);
            var a = regs[base + this.S(null)];
            regs[base + dst] = a & regs[base + this.S("k")];
            break;
          }
        case 57871:
          {
            var dst = this.S(null);
            var a = regs[base + this.S("q")];
            regs[base + dst] = a | regs[base + this.S([])];
            break;
          }
        case 5417:
          {
            var dst = this.S(undefined);
            var a = regs[base + this.S("k")];
            regs[base + dst] = a ^ regs[base + this.S([])];
            break;
          }
        case 9866:
          {
            var dst = this.S([]);
            var a = regs[base + this.S("x")];
            regs[base + dst] = a << regs[base + this.S(null)];
            break;
          }
        case 12140:
          {
            var dst = this.S(30);
            var a = regs[base + this.S(null)];
            regs[base + dst] = a >> regs[base + this.S([])];
            break;
          }
        case 46998:
          {
            var dst = this.S(73);
            var a = regs[base + this.S(31)];
            regs[base + dst] = a >>> regs[base + this.S(undefined)];
            break;
          }

        // Comparison  (dst, src1, src2)
        case 18923:
          {
            var dst = this.S("q");
            var a = regs[base + this.S("z")];
            regs[base + dst] = a < regs[base + this.S(undefined)];
            break;
          }
        case 23357:
          {
            var dst = this.S([]);
            var a = regs[base + this.S(undefined)];
            regs[base + dst] = a > regs[base + this.S(null)];
            break;
          }
        case 64658:
          {
            var dst = this.S(null);
            var a = regs[base + this.S(27)];
            regs[base + dst] = a <= regs[base + this.S(undefined)];
            break;
          }
        case 29044:
          {
            var dst = this.S(48);
            var a = regs[base + this.S("q")];
            regs[base + dst] = a >= regs[base + this.S(86)];
            break;
          }
        case 25819:
          {
            var dst = this.S({});
            var a = regs[base + this.S({})];
            regs[base + dst] = a === regs[base + this.S(null)];
            break;
          }
        case 39164:
          {
            var dst = this.S(undefined);
            var a = regs[base + this.S({})];
            regs[base + dst] = a !== regs[base + this.S("z")];
            break;
          }
        case 8215:
          {
            var dst = this.S([]);
            var a = regs[base + this.S(undefined)];
            regs[base + dst] = a == regs[base + this.S([])];
            break;
          }
        case 31978:
          {
            var dst = this.S({});
            var a = regs[base + this.S(null)];
            regs[base + dst] = a != regs[base + this.S([])];
            break;
          }
        case 21914:
          {
            var dst = this.S(undefined);
            var a = regs[base + this.S(null)];
            regs[base + dst] = a in regs[base + this.S([])];
            break;
          }
        case 6605:
          {
            // regs[dst] = regs[obj] instanceof regs[ctor]
            // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
            var dst = this.S(94);
            var obj = regs[base + this.S(undefined)];
            regs[base + dst] = obj instanceof regs[base + this.S([])];
            break;
          }

        // Unary  (dst, src)
        case 57697:
          {
            var dst = this.S(undefined);
            regs[base + dst] = -regs[base + this.S([])];
            break;
          }
        case 23644:
          {
            var dst = this.S(undefined);
            regs[base + dst] = +regs[base + this.S(undefined)];
            break;
          }
        case 43518:
          {
            var dst = this.S(null);
            regs[base + dst] = !regs[base + this.S([])];
            break;
          }
        case 17920:
          {
            var dst = this.S([]);
            regs[base + dst] = ~regs[base + this.S({})];
            break;
          }
        case 39066:
          {
            var dst = this.S(null);
            regs[base + dst] = typeof regs[base + this.S(null)];
            break;
          }
        case 2548:
          {
            var dst = this.S(undefined);
            this.S(3); // consumes argument (intended)
            regs[base + dst] = undefined;
            break;
          }
        case 36661:
          {
            // regs[dst] = typeof window[name]
            // Never throws ReferenceError, instead returns undefined for undeclared variables
            var dst = this.S(undefined);
            var name = this.E();
            var val = Object.prototype.hasOwnProperty.call(this.Y, name) ? this.Y[name] : undefined;
            regs[base + dst] = typeof val;
            break;
          }

        // Control flow
        case 39919:
          regs[fp + 1] = this.S(undefined);
          break;
        case 37081:
          {
            var src = this.S(null);
            var target = this.S({});
            if (!regs[base + src]) regs[fp + 1] = target;
            break;
          }
        case 5524:
          {
            // || short-circuit: if truthy, jump over RHS.
            var src = this.S("k");
            var target = this.S(null);
            if (regs[base + src]) regs[fp + 1] = target;
            break;
          }

        // Calls
        case 4545:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
            var dst = this.S(null);
            var callee = regs[base + this.S(null)];
            var argc = this.S({});
            var args;
            if (argc === 3847166315) {
              args = regs[base + this.S(40)];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.S([])];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.ag({}, null, [], this.Y, dst << 1, args, closure);
            } else {
              regs[base + dst] = callee.apply(null, args);
            }
            break;
          }
        case 15913:
          {
            // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.S({});
            var receiver = regs[base + this.S(52)];
            var callee = regs[base + this.S(undefined)];
            var argc = this.S(17);
            var args;
            if (argc === 3847166315) {
              args = regs[base + this.S([])];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.S(59)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              this.ag(undefined, null, {}, receiver, dst << 1, args, closure);
            } else {
              regs[base + dst] = callee.apply(receiver, args);
            }
            break;
          }
        case 52616:
          {
            // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
            var dst = this.S(undefined);
            var callee = regs[base + this.S(32)];
            var argc = this.S(null);
            var args;
            if (argc === 3847166315) {
              args = regs[base + this.S({})];
            } else {
              args = new Array(argc);
              for (var i = 0; i < argc; i++) args[i] = regs[base + this.S(undefined)];
            }
            var closure = callee && CLOSURE_MAP.get(callee);
            if (closure) {
              // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
              // the frame as a constructor call so RETURN can fall back to it.
              this.ag(undefined, "y", {}, Object.create(closure.prototype || null), dst << 1 | 1, args, closure);
            } else {
              // Reflect.construct is required - Object.create+apply does NOT set
              // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
              regs[base + dst] = Reflect.construct(callee, args);
            }
            break;
          }
        case 62456:
          {
            var retVal = regs[base + this.S("k")];
            this.b({}, 41, undefined, "k", fp); // must happen before frame is abandoned

            var caller = regs[fp + 10];
            var retDst = regs[fp + 8];

            // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
            if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 2];

            // Zero out the callee's whole block (header included) to limit
            // exposing runtime values, then hand the slots back.
            var hi = fp + regs[fp + 4];
            for (var i = fp; i < hi; i++) regs[i] = undefined;
            this.R = fp;
            this.P = caller;

            // A caller of 0 is the root frame returning to the host: park the
            // value in slot 0 for run() to hand back. A bare `return retVal`
            // would only exit an extracted VM.prototype[op] handler function
            // (handlerTable option), not the loop. Keeping the sole `break`
            // trailing (no mid-body break/return) also lets the handlerTable
            // transform lift this body verbatim.
            regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
            break;
          }
        case 19563:
          throw regs[base + this.S(undefined)];

        // Closures
        case 18527:
          {
            // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
            var dst = this.S("k");
            var startPc = this.S("k");
            var paramCount = this.S(null);
            var regCount = this.S("z");
            var uvCount = this.S([]);
            var hasRest = this.S({}); // 1 if last param is a rest element

            var uvDescs = new Array(uvCount);
            for (var i = 0; i < uvCount; i++) {
              var isLocalRaw = this.S("x");
              var uvIndex = this.S(75);
              uvDescs[i] = {
                V: isLocalRaw,
                m: uvIndex
              };
            }

            // uvDescs is consumed by the capture loop below and then dropped — it
            // is deliberately NOT kept on the descriptor. A closure that carries
            // its capture plan around spells out the closure graph ("captures
            // local 2 of the parent frame") to anything that gets hold of it.
            var fn = {
              U: paramCount,
              q: regCount,
              ab: startPc,
              z: hasRest
            };
            var closure = new Closure("z", [], fn);
            for (var i = 0; i < uvDescs.length; i++) {
              var uvd = uvDescs[i];
              if (uvd.V) {
                closure.C.push(this.aa({}, fp, 23, [], uvd.m, []));
              } else {
                closure.C.push(regs[fp + 3].C[uvd.m]);
              }
            }

            // Wrap in a native callable shell so host code (array methods,
            // test assertions, setTimeout, etc.) can invoke VM closures.
            // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
            var self = this;
            var shell = function (c) {
              return function () {
                return new VM(21, self.v, self.X, [], {}, self.Y).t(c, Array.prototype.slice.call(arguments), null, this == null ? self.Y : this, "z", 93);
              };
            }(closure);
            CLOSURE_MAP.set(shell, closure);
            shell.prototype = closure.prototype; // unified prototype for new/instanceof
            regs[base + dst] = shell;
            break;
          }

        // Collections
        case 28412:
          {
            // dst, count, [elemReg...]
            var dst = this.S(null);
            var count = this.S({});
            var elems = new Array(count);
            for (var i = 0; i < count; i++) elems[i] = regs[base + this.S({})];
            regs[base + dst] = elems;
            break;
          }
        case 53382:
          {
            // dst, pairCount, [keyReg, valReg, ...]
            var dst = this.S([]);
            var pairCount = this.S(35);
            var o = {};
            for (var i = 0; i < pairCount; i++) {
              var key = regs[base + this.S({})];
              var val = regs[base + this.S(40)];
              o[key] = val;
            }
            regs[base + dst] = o;
            break;
          }

        // Object methods (getters / setters)
        case 1716:
          {
            // obj, key, fn
            var obj = regs[base + this.S(null)];
            var key = regs[base + this.S("x")];
            var getterFn = regs[base + this.S(null)];
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
        case 28189:
          {
            // obj, key, fn
            var obj = regs[base + this.S(undefined)];
            var key = regs[base + this.S(null)];
            var setterFn = regs[base + this.S(undefined)];
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
        case 52804:
          {
            // dst, src — build iterator object from enumerable keys of regs[src]
            var dst = this.S([]);
            var obj = regs[base + this.S([])];
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
              D: keys,
              c: 0
            };
            break;
          }
        case 8387:
          {
            // dst, iterReg, exitTarget
            // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
            var dst = this.S(undefined);
            var iter = regs[base + this.S([])];
            var exitTarget = this.S("y");
            if (iter.c >= iter.D.length) {
              regs[fp + 1] = exitTarget;
            } else {
              regs[base + dst] = iter.D[iter.c++];
            }
            break;
          }

        // ── Exception handling ────────────────────────────────────────────────
        case 50691:
          {
            // handlerPc, exceptionReg — push exception handler record onto current
            // frame. The handler stack lives in a header slot and is created on
            // first use, so frames that never try/catch carry nothing.
            var hs = regs[fp + 11];
            if (!hs) regs[fp + 11] = hs = [];
            hs.push({
              I: this.S("x"),
              L: this.S("y")
            });
            break;
          }
        case 40557:
          {
            // Normal exit from a try block — disarm the top handler record
            // (works for both catch and finally regions; they share the stack).
            regs[fp + 11].pop();
            break;
          }
        case 57952:
          {
            // finallyPc, contReg, payloadReg, throwPad
            // Arm a finalizer for the current region.  Unlike a catch record this
            // carries no exceptionReg; instead the continuation register (contReg)
            // receives the resume PC and payloadReg carries the in-flight value.
            var hs = regs[fp + 11];
            if (!hs) regs[fp + 11] = hs = [];
            hs.push({
              y: this.S(null),
              ae: this.S(69),
              B: this.S(undefined),
              ad: this.S(undefined)
            });
            break;
          }

        // Self-modifying bytecode
        case 32453:
          {
            // destPc, sliceStart, sliceEnd, key
            var destPc = this.S(undefined);
            var sliceStart = this.S("q");
            var sliceEnd = this.S(null);
            var pk = this.S([]) ^ destPc | 0;
            for (var pi = sliceStart; pi < sliceEnd; pi++) {
              pk = pk + 0x9e3779b9 | 0;
              // >>> 0: a negative slot would never match a case in the switch.
              this.v[destPc + (pi - sliceStart)] = (this.v[pi] ^ (pk ^ pk >>> 13)) >>> 0;
            }
            break;
          }
        case 13119:
          {
            // Indirect jump: allows VM to jump based on runtime values.
            regs[fp + 1] = regs[base + this.S([])];
            break;
          }
        case 54257:
          {
            debugger;
            break;
          }
        default:
          throw new Error("Unknown opcode: " + op + " at pc " + (regs[fp + 1] - 1));
      }
    } catch (err) {
      // Exception handler unwinding
      // Walk the CALLER chain from the current frame until we find one holding an open exception handler (TRY_SETUP without a matching TRY_END).
      // For every frame we abandon along the way, close its captured upvalues and release its block.
      var handledFrame = 0;
      var searchFrame = this.P;
      while (searchFrame) {
        var handlers = regs[searchFrame + 11];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this.b(null, [], [], undefined, searchFrame);
        this.R = searchFrame;
        searchFrame = regs[searchFrame + 10];
        this.P = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + 11].pop();
      var hBase = regs[handledFrame + 7];
      if (h.L !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.L] = err;
        regs[handledFrame + 1] = h.I;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.ae] = h.ad;
        regs[hBase + h.B] = err;
        regs[handledFrame + 1] = h.y;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this.R = handledFrame + regs[handledFrame + 4];
      this.P = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this.P) return this.f[0];
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
var vm = new VM(82, decodeBytecode(BYTECODE), CONSTANTS, 31, [], globals);
vm.t(new Closure(undefined, 90, {
  U: 0,
  q: 9,
  ab: 0
}), null // no arguments object / parameter setup for the root frame
, 45, undefined, [], 33);