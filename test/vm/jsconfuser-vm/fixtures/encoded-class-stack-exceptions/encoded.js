function VM(fake_14, fake_13, constants, bytecode, globals, fake_12, fake_15) {
  this.y = bytecode;
  this.T = constants;
  this.f = globals;
  // Open upvalues, keyed by absolute slot; created on the first capture so a
  // closure-free program never allocates it. See captureUpvalue().
  this.r = null;

  // Flat slot array (Lua-style register file, with the frame headers folded in).
  // _regsTop is the next free slot (= base of the hypothetical next frame).
  // On CALL:   newBase = _regsTop; _regsTop += HEADER_SIZE + fn.regCount
  // On RETURN: _regsTop = <returning frame's base>   (pop the whole block)
  // Slot 0 is never part of a frame: it holds the value run() hands back, and
  // doubles as the "no frame" sentinel for _f / CALLER.
  this.ad = fake_13;
  this.h = fake_12 || fake_15;
  this.j = [];
  this.z = fake_14;
  this.X = 1;
  this.C = 0;
}

// Consume the next slot from the flat bytecode stream and advance the PC.
// Called by opcode handlers to read each of their operands in order.
// The PC is a header slot, so no object anywhere holds a property containing it.
// Upvalue (Lua style)
// While the outer frame is alive: reads/writes go to vm._regs[_absSlot].
// After the outer frame returns (closed): reads/writes hit this._value.
// (_absSlot is an absolute index into the flat slot array, so it stays valid
// no matter where the owning frame's block sits.)
function Upvalue(fake_1, fake_2, regs, absSlot, fake_3) {
  this.M = fake_1 || fake_2;
  this.j = regs; // shared reference to VM._regs flat array
  this.V = fake_3;
  this.e = absSlot; // absolute index; stable as long as frame is alive
  this.c = false;
  this.K = undefined;
}
function base64ToBytes(s) {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64") : Uint8Array.from(atob(s), function (c) {
    return c.charCodeAt(0);
  });
}
// Closure map
// Maps shell functions -> inner Closure so the VM can fast-path instead of going through a sub-VM on internal calls.
// A WeakMap is used over a Symbol to prevent leaking information to debuggers
var CLOSURE_MAP = new WeakMap();
function decodeBytecode(s) {
  if (!true) return s;
  var b = base64ToBytes(s);
  // Each slot is a u32 stored as 4 little-endian bytes.
  var r = new Uint32Array(b.length / 4);
  for (var i = 0; i < r.length; i++) r[i] = (b[i * 4] | b[i * 4 + 1] << 8 | b[i * 4 + 2] << 16 | b[i * 4 + 3] << 24) >>> 0;
  return r;
}
// Closure & Frame
function Closure(fake_9, fn, fake_11, fake_10) {
  this.ae = fn;
  this.s = [];
  this.prototype = {}; // <- default prototype object for `new`
  this.E = fake_10;
  this.n = fake_11;
  this.A = fake_9;
}
var CONSTANTS = [/* 0 */-2073162450, /* 1 */"wFQzrKg9c5RsFA==", /* 2 */"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", /* 3 */"nTtKTqnaw0XazdlSl6bUIw==", /* 4 */"85XQ7eBi9+b/UwU/", /* 5 */-1858820092, /* 6 */925219696, /* 7 */undefined, /* 8 */1835943349, /* 9 */"58LiXv31y2X1HvSq7zfwmw==", /* 10 */"xJv+J+2o0FDPybBA", /* 11 */1904139107, /* 12 */"U5FReUyBUgs=", /* 13 */1641148362, /* 14 */"OT1PrQ7VZHN/zyBD", /* 15 */851055953, /* 16 */1649680259, /* 17 */-2090043355, /* 18 */"bD9Uq0pnuvxCDYuFNgVyj2AT", /* 19 */-1108910095, /* 20 */-604729469, /* 21 */"ykzCPNLX/WP4/CQVy5XZPLiMpRc=", /* 22 */-11817443, /* 23 */"V5mZMEevmWM=", /* 24 */"vBsUcL34", /* 25 */478907732, /* 26 */"LiipUWP4vUAU2KA3Dqiz4A==", /* 27 */284302430, /* 28 */"WfZcYkWqWjYjmpQP", /* 29 */"K7buIl1uaPJplgECnr0zFg==", /* 30 */453624958, /* 31 */"He+TVKvFxs2mXA==", /* 32 */578885406, /* 33 */-1600491895, /* 34 */"gRfg45l4U9A=", /* 35 */-1648727951, /* 36 */"vkWiNPvclWP759Uc7Yw=", /* 37 */2042846100, /* 38 */"p4sf/LhkTyR0vGJM", /* 39 */1354081998, /* 40 */"eEFmz4FzNdc=", /* 41 */"N0iC8XRYj6A6OKGXGAg=", /* 42 */1089604774, /* 43 */"dz5dqk4WWfo=", /* 44 */-1079536276, /* 45 */566575481, /* 46 */"TbNTJxGjZWmC8R0ZpIAEO4qX", /* 47 */375877287, /* 48 */"dyd1o3rZe3E=", /* 49 */"sEcN3IRs", /* 50 */1354458074, /* 51 */"gjbJgsoJyPGmGhWu", /* 52 */453611180, /* 53 */-1084635754, /* 54 */"ASGSqSgRnHgBA5+H", /* 55 */190360739, /* 56 */"pBYegrwNJpaJ+hturNsstoJK", /* 57 */"G9aLSTpCa9a9UwT+iGI3Fg==", /* 58 */-60248318, /* 59 */"qnUdnXorLLc=", /* 60 */-1435222112, /* 61 */-333277216, /* 62 */"Gee9k1IPrYI=", /* 63 */"fVle0Uy7TSdm6w==", /* 64 */1372212312, /* 65 */"FrGbSVbBX3+/0w==", /* 66 */1765640744, /* 67 */"ZHugzjlZgjEiqe5inOfpc4+e", /* 68 */"nK5dZaj1Ww2YgjMHKrM=", /* 69 */630742258, /* 70 */"GyOcpzUzy1w=", /* 71 */"rdscd67IIkFmyXsxOF8=", /* 72 */-615623766, /* 73 */"V9dDvYhN", /* 74 */1457399685, /* 75 */"tye7urvRplnFwpVO", /* 76 */-1493849001, /* 77 */"n8c5U7b+12XsJZ++", /* 78 */"cd1ddW71uF4dKw==", /* 79 */883686171, /* 80 */"M973QiD2tVMmLg==", /* 81 */true, /* 82 */"BNx/THc0bqQ1bID7EhSXjFg8", /* 83 */"IviYAeuY+zDBqw==", /* 84 */1628639794, /* 85 */1184566938, /* 86 */-1276567617, /* 87 */"nikVYZ76KG/U2+lGxErB0Q==", /* 88 */"pUoctireamJA5kSSSQ5wgg==", /* 89 */469534120, /* 90 */"LwaMcSXq4KYnOqGvwFo=", /* 91 */-1326671830, /* 92 */"/UC82MBxJ+nYIA==", /* 93 */805057574, /* 94 */2144651758, /* 95 */"b9eUa8zgPWmtkQ==", /* 96 */"oy4xstnX9kLA/uxV6tU=", /* 97 */-513239170, /* 98 */"KzmkoTUZ+PbiCw==", /* 99 */-1627639930, /* 100 */"U8ebShQ9i9UMZb/+DBOpl7kCC40=", /* 101 */-1974221178, /* 102 */"rGELKfW2+1vvz4R6", /* 103 */1608579406, /* 104 */-1977602421, /* 105 */"y4TIDfKdijTupNNfrOvKdA==", /* 106 */941704785, /* 107 */"Jwn9cQoZvKBjN7zT2kg=", /* 108 */2012834915, /* 109 */"9Z/J6/FmzNq+sQ==", /* 110 */1164232951, /* 111 */2018210491, /* 112 */"tm1W5U1T", /* 113 */1364563121, /* 114 */1142325123, /* 115 */"KyR3tLBNN9zERD/0a1wZJA==", /* 116 */"WeFid2nzGR9hgw==", /* 117 */1914526722, /* 118 */"mk0YxdNENU/608xk4ew=", /* 119 */1874141315, /* 120 */"W71PDQGVceN1b03TQLc=", /* 121 */-878513602, /* 122 */"gB1KtkIqct4=", /* 123 */-233847901, /* 124 */"pgc+gMwIB5COeSTgS1hqsAXISEA=", /* 125 */-2074790807, /* 126 */"2rfgKute0uUzcoQeQ4I=", /* 127 */-1231765908, /* 128 */"uCT13bVt8PTiRJnPBbSkVOzt", /* 129 */1283074257, /* 130 */-563849062, /* 131 */"XQ5gkkw6Ra4=", /* 132 */"0Vf5yAjAv0kk0Lx4COD7Fw==", /* 133 */"", /* 134 */"5wkokZ5+oePnV9Oy2c7oQej5", /* 135 */"q9QrT6b7Ukc=", /* 136 */"AF+2y8lGx9r9sdw5sKI/b4jzMAc=", /* 137 */"Kxq+9TJupKISJg==", /* 138 */"gk0DOqbGJUrh/+9q3iaBvWcS", /* 139 */"XmBu2HqwYkiQwWZI", /* 140 */"/HzaFcSl0zzirMxXP/uZTDfVnrUWLbKc", /* 141 */"ADGYWfTA9Ug=", /* 142 */-1905207214, /* 143 */"NXuL7HYl", /* 144 */1919955073, /* 145 */"bihqsGoIfoB6+Jtw", /* 146 */1837958513, /* 147 */"BY7K8QSaiS7Suw==", /* 148 */"fCWI7BZ7/oc=", /* 149 */"tshaQMX5EVA=", /* 150 */1726745434, /* 151 */"z7HeKj2fjutYd4Ua3oHCOfaSgm4=", /* 152 */"ZwlBkQ4/XKNFZ0rzcklhwQ==", /* 153 */190867527, /* 154 */"fgdUgdwJN5GsOCavr1s=", /* 155 */-1692715691, /* 156 */"LLaK2jBuSPZGkkIOC4JbFo6S", /* 157 */"YjBBqE3gPXiL8TSYqAA=", /* 158 */-1625502072, /* 159 */"duh9oEU4f7B0GDSAggg=", /* 160 */-217932412, /* 161 */"9wu38BgYvKEbOJVQfsiEQw==", /* 162 */-1771754138, /* 163 */"l2RGJce9CE2zxAN7", /* 164 */499332383, /* 165 */"k3vGzKNE4cXhzYlc0+TtY8qfuTQ=", /* 166 */1750094190, /* 167 */"F0Km1SSusjo=", /* 168 */103380037, /* 169 */"P6lOJxlbSs9feybBnkkmsZMo", /* 170 */"97rBJ+Lr6n7cig==", /* 171 */-44094637, /* 172 */"spl7ENu4pycx6K1w", /* 173 */"/VLoxplBMtnmNnyrgh8=", /* 174 */347566502, /* 175 */"F9rrTtL5", /* 176 */1153137641, /* 177 */"rvKdZdLd1So=", /* 178 */1018986824, /* 179 */-1925304118, /* 180 */"0dfvfN3M4lXuNcKs+Bzq97YL", /* 181 */-680680256, /* 182 */"DVKCxwtCs957Mg==", /* 183 */1479988760, /* 184 */"VfQSFNqNFDyFlB0UqH9u5A==", /* 185 */"pZ09BKS0ORw=", /* 186 */-1086568678, /* 187 */"YB9Lc2jl", /* 188 */-499836125, /* 189 */"s3B9iJkDJLiuEDlor+E=", /* 190 */852193666, /* 191 */"Eg/3mzw3gKp7Ye7paXHP3g==", /* 192 */1287323068, /* 193 */"B35Q6m6WTzpvgq4G", /* 194 */-1328267217, /* 195 */"Q41qHVG1oCQTX1nr", /* 196 */2081886677, /* 197 */1065317193, /* 198 */"0JbmM0yPoQIXednxrprkJvWr9V8=", /* 199 */"YeJDekcWSoo=", /* 200 */"FCWLWhDvmXsLxw==", /* 201 */"dHFk20JHYUtU32pp", /* 202 */"1VfDItKuqhUt+g==", /* 203 */"Ya2pNVKF", /* 204 */1909848166, /* 205 */"MxUnrb86K6ez6zV/nMoaRYu9Ky0=", /* 206 */-253617043, /* 207 */"cg1klWIjvK9j0zZ1SM1PXQ==", /* 208 */"w9PbLsGi2xXJjdz61IY=", /* 209 */"gKZSOkuSUwY=", /* 210 */1360137603, /* 211 */"XGJaFkaygA46gqN5He6SGjCm", /* 212 */"m98Zc2flWh0=", /* 213 */"/SMFpowyF14=", /* 214 */910127777, /* 215 */-1222956270, /* 216 */-1419858996, /* 217 */-904008098, /* 218 */"pHuQxi5Nob0=", /* 219 */1620251710, /* 220 */"uP4mU4gnEqOqLiiVtgUhjQ==", /* 221 */"0OneEDq3hwMNn5bwJGnG4eqo3zA=", /* 222 */"5STElKl9CIw=", /* 223 */"Um1V81hXPsM=", /* 224 */1249492429, /* 225 */"lEQixJ29HyyQ5Bpk", /* 226 */"S2ab6jlekMk2wpBeFvLQdw==", /* 227 */-1647230170, /* 228 */"/fLHZsrhMSqFtgbalE8=", /* 229 */"jxKjvs8l+eWgfjbLpkcGOw==", /* 230 */1338785824, /* 231 */"FYlAE3u3aCN0XwfxQ0lDwQ==", /* 232 */"UihDoFtoIfB0GCqA1DsXkA==", /* 233 */"gjs6VK3MJ3yj1TFU", /* 234 */"iWY/+oFvy9rwRvdN", /* 235 */"WmxV3AJES0xY3Gx0xuU=", /* 236 */"HV+Eyhh1q90YLaq2", /* 237 */"qoUzGkBufvplZlwqUL6sRQvC", /* 238 */866136413, /* 239 */"AEC1STHQqWg94JUbHbC5OA==", /* 240 */"ugt9n6xqqeEbWbiyMzeDQyTP", /* 241 */"E8GSeBXTqy8=", /* 242 */-916156610, /* 243 */"JZeba0r/jFQD1Ww9ak1F135zRO8=", /* 244 */-562426953, /* 245 */"PmuW/yRruNY=", /* 246 */"dwZb8kceYqZiKhle", /* 247 */"10ATyboxelk=", /* 248 */1482479932, /* 249 */"NhlvcUj5RoNWDw==", /* 250 */591457614, /* 251 */-581733409, /* 252 */-1008823052, /* 253 */"jhcmk4t+5OU9VbO+EcuGRw==", /* 254 */"zrz1FN5liv3nbMbU/UPNTw==", /* 255 */-1079491422, /* 256 */"IaSPLFbc", /* 257 */-730734530, /* 258 */"0qrB59F77Q4Mhb0FEI2HEg==", /* 259 */"0FXw/fps75SlOw==", /* 260 */-941580444, /* 261 */"RWN//18VaYVpPbyK", /* 262 */"XvhyYEEo", /* 263 */"kdZBu/xP2Nr6dg==", /* 264 */1035738694, /* 265 */"4QuMhOcc2K0xJbmkT+8="];
VM.prototype.N = function (fake_29, fp, fake_27, fake_28) {
  // Called on RETURN — close every upvalue captured from this frame's register
  // window [REG_BASE, end of the frame block) and free its table entry, so a
  // later frame reusing those slots starts with no captures.
  var uvs = this.r;
  if (!uvs) return; // nothing in this program ever captured a local
  this.Y = [fake_27, fake_28];
  var regs = this.j;
  var hi = fp + regs[fp + 6];
  this.F = fake_29;
  for (var i = regs[fp + 7]; i < hi; i++) {
    var uv = uvs[i];
    if (uv) {
      uv.W([], "k");
      uvs[i] = undefined;
    }
  }
};

// Executes `closure` to completion and returns its return value.
// The root frame's CALLER slot is 0 (the sentinel), so its RETURN parks the
// value in slot 0 and clears _f, which stops the loop below.
VM.prototype.ag = function (fake_19, fake_18, fake_16, fake_17) {
  this.k = [fake_18, fake_19];
  this.o = [fake_16, fake_17];
  return this.y[this.j[this.C + 0]++];
};

// Push a new frame block on top of the slot array and make it current.
// retDst encodes the caller's destination register as (reg << 1), with bit 0 set
// for a constructor call (`new`) — RETURN uses it to decide whether to hand back
// the THIS slot instead of the returned value.
// args === null skips parameter setup (used for the root frame).
Upvalue.prototype.S = function (fake_4) {
  this.d = fake_4;
  return this.c ? this.K : this.j[this.e];
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
VM.prototype.x = function (fake_26, idxIn, fake_25, keyIn) {
  var idx = idxIn ?? this.ag(89, null, {}, null);
  var key = keyIn ?? this.ag({}, {}, "z", "y");
  var v = this.T[idx];
  if (!key) return v;
  if (typeof v === "number") return v ^ key;
  if (typeof v !== "string") return v;

  // String: base64-decode to u16 LE byte pairs, then XOR each code with a
  // 16-bit keystream word derived from the full 32-bit key + position.
  this.ab = fake_25;
  var b = base64ToBytes(v);
  var out = "";
  var k = key;
  for (var i = 0; i < b.length / 2; i++) {
    k = k + 0x9e3779b9 | 0; // 32-bit Weyl step (position-based)
    var ks = (k ^ k >>> 13) & 0xffff; // 16-bit keystream word
    var code = b[i * 2] | b[i * 2 + 1] << 8; // u16 LE
    out += String.fromCharCode(code ^ ks);
  }
  this.J = fake_26;
  return out;
};
Upvalue.prototype.W = function (fake_8, fake_7) {
  this.K = this.j[this.e];
  this.c = true;
  this.B = [fake_7, fake_8];
};
VM.prototype.R = function (closure, retDst, args, fake_20, thisVal) {
  var fn = closure.ae;
  var regs = this.j;
  var fp = this.X;
  var size = 8 + fn.U;
  var end = fp + size;
  while (regs.length < end) regs.push(undefined);
  for (var i = fp; i < end; i++) regs[i] = undefined;
  var base = fp + 8;
  regs[fp + 0] = fn.G;
  regs[fp + 1] = this.C;
  regs[fp + 2] = retDst;
  regs[fp + 3] = thisVal;
  regs[fp + 4] = closure;
  regs[fp + 6] = size;
  regs[fp + 7] = base;

  // Seeds for the decoy header slots this build happens to have (see utils/frame-layout.ts)
  /* @NOISE */
  if (typeof void 0 === "number") regs[fp + void 0] = end;
  this.D = fake_20;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.m;
  if (typeof void 0 === "number") regs[fp + void 0] = args;
  if (typeof void 0 === "number") regs[fp + void 0] = fn.G;
  if (typeof void 0 === "number") regs[fp + void 0] = 0;
  this.X = end;
  if (args) {
    if (fn.w) {
      var restSlot = fn.m - 1;
      for (var p = 0; p < restSlot; p++) regs[base + p] = p < args.length ? args[p] : undefined;
      regs[base + restSlot] = args.slice(restSlot);
    } else {
      for (var a = 0; a < args.length && a < fn.U; a++) regs[base + a] = args[a];
    }
    if (fn.m < fn.U) regs[base + fn.m] = args;
  }
  this.C = fp;
};
VM.prototype.a = function (fake_22, slot, fake_24, fake_23, fp, fake_21) {
  this.u = fake_21;
  // Dedup by absolute slot — two closures capturing the same local share one
  // Upvalue. _openUpvalues is keyed BY absolute slot rather than being a list of
  // live captures, so this is a direct lookup instead of a scan, and closing a
  // frame's captures costs a walk of that frame's own window (below) instead of
  // a filter over every capture in the program. Entries are removed on close, so
  // anything found here is open by construction.
  var absSlot = this.j[fp + 7] + slot;
  var uvs = this.r || (this.r = []);
  return uvs[absSlot] || (uvs[absSlot] = new Upvalue("q", {}, this.j, absSlot, "z"));
  this.Q = [fake_22, fake_23];
  this.ac = fake_24;
};
Upvalue.prototype.g = function (fake_6, fake_5, v) {
  this.i = fake_6;
  if (this.c) this.K = v;else this.j[this.e] = v;
  this.v = fake_5;
};
VM.prototype.q = function (fake_30, fake_31, closure, fake_32, args, thisVal) {
  var now = () => {
    return performance.now();
  };
  this.L = fake_32;
  var lastTime = now();
  this.R(closure, 0, args, "z", thisVal);
  this.t = fake_31 && fake_30;
  while (true) {
    var fp = this.C;
    var regs = this.j;
    var bc = this.y;
    var pc = regs[fp + 0];
    if (pc >= bc.length) break;
    regs[fp + 0] = pc + 1;
    var op = this.y[pc];
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
        for (var i = 0; i < this.y.length; i++) this.y[i] = 0;
        // Break the current state
        for (var i2 = fp; i2 < this.X; i2++) this.j[i2] = undefined;
        op = 39;
        regs[fp + 0] = this.y.length; // jump past end to halt
      }
    }
    try {
      var base = regs[fp + 7];

      /* @SWITCH */
      this[op]();
    } catch (err) {
      // Exception handler unwinding
      // Walk the CALLER chain from the current frame until we find one holding an open exception handler (TRY_SETUP without a matching TRY_END).
      // For every frame we abandon along the way, close its captured upvalues and release its block.
      var handledFrame = 0;
      var searchFrame = this.C;
      while (searchFrame) {
        var handlers = regs[searchFrame + 5];
        if (handlers && handlers.length > 0) {
          handledFrame = searchFrame;
          break;
        }
        // No handler in this frame — abandon it and walk up.
        this.N(undefined, searchFrame, undefined, []);
        this.X = searchFrame;
        searchFrame = regs[searchFrame + 1];
        this.C = searchFrame;
      }
      if (!handledFrame) throw err; // if there's no handler, propagate back to host

      var h = regs[handledFrame + 5].pop();
      var hBase = regs[handledFrame + 7];
      if (h.H !== undefined) {
        // catch region — deliver the exception to the catch binding and run it.
        regs[hBase + h.H] = err;
        regs[handledFrame + 0] = h.aa;
      } else {
        // finally region: run the finalizer with the exception pending, then
        // resume at its throw pad (which re-raises and continues unwinding).
        regs[hBase + h.O] = h.p;
        regs[hBase + h.af] = err;
        regs[handledFrame + 0] = h.P;
      }
      // Walking the chain already released every frame pushed inside the
      // protected region; the handling frame is now the top of the stack again.
      this.X = handledFrame + regs[handledFrame + 6];
      this.C = handledFrame;
    }

    // RETURN of the root frame cleared _f — stop the loop and hand the value
    // back to run()'s caller (host code, or the sub-VM shell) from slot 0.
    if (!this.C) return this.j[0];
  }
};

/* @BOOT */ // <- This comment can't be removed!
var VMPrototype = VM.prototype;
VMPrototype[68] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_ADD_8_7_1_3_4_0_10_9_12_6_2_5_11 (order: [8,7,1,3,4,0,10,9,12,6,2,5,11])
  let _unsortedOperands = [this.ag(undefined, undefined, 47, undefined), this.ag(4, undefined, "x", "q"), this.ag([], {}, {}, "y"), this.ag("z", 61, undefined, undefined), this.ag(93, undefined, {}, "x"), this.ag(30, [], [], []), this.ag(77, "y", {}, "k"), this.ag(84, {}, null, []), this.ag(undefined, undefined, 37, []), this.ag(null, null, {}, []), this.ag(null, undefined, "k", 88), this.ag("y", undefined, undefined, "k"), this.ag([], null, [], "z")];
  let _operands = [_unsortedOperands[5], _unsortedOperands[2], _unsortedOperands[10], _unsortedOperands[3], _unsortedOperands[4], _unsortedOperands[11], _unsortedOperands[9], _unsortedOperands[1], _unsortedOperands[0], _unsortedOperands[7], _unsortedOperands[6], _unsortedOperands[12], _unsortedOperands[8]];
  // BOR
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a | regs[base + _operands[2]];
  // USHR
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a >>> regs[base + _operands[5]];
  // ADD
  var dst = _operands[6];
  var a = regs[base + _operands[7]];
  regs[base + dst] = a + regs[base + _operands[8]];
  // UNARY_NEG
  var dst = _operands[9];
  regs[base + dst] = -regs[base + _operands[10]];
  // UNARY_NOT
  var dst = _operands[11];
  regs[base + dst] = !regs[base + _operands[12]];
};
VMPrototype[70] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_BAND_0_7_9_6_8_3_4_2_5_11_1_12_10 (order: [0,7,9,6,8,3,4,2,5,11,1,12,10])
  let _unsortedOperands = [this.ag(undefined, {}, "x", undefined), this.ag("k", "z", undefined, "z"), this.ag(9, null, null, 91), this.ag({}, [], {}, []), this.ag(null, null, "x", undefined), this.ag(null, null, 65, []), this.ag(12, null, "q", 5), this.ag(null, null, {}, "k"), this.ag(undefined, [], null, "k"), this.ag([], 49, "x", []), this.ag([], null, "z", undefined), this.ag([], undefined, undefined, {}), this.ag(null, 19, [], {})];
  let _operands = [_unsortedOperands[0], _unsortedOperands[10], _unsortedOperands[7], _unsortedOperands[5], _unsortedOperands[6], _unsortedOperands[8], _unsortedOperands[3], _unsortedOperands[1], _unsortedOperands[4], _unsortedOperands[2], _unsortedOperands[12], _unsortedOperands[9], _unsortedOperands[11]];
  // MOVE
  var dst = _operands[0];
  regs[base + dst] = regs[base + _operands[1]];
  // SHR
  var dst = _operands[2];
  var a = regs[base + _operands[3]];
  regs[base + dst] = a >> regs[base + _operands[4]];
  // LOOSE_NEQ
  var dst = _operands[5];
  var a = regs[base + _operands[6]];
  regs[base + dst] = a != regs[base + _operands[7]];
  // MOVE
  var dst = _operands[8];
  regs[base + dst] = regs[base + _operands[9]];
  // BAND
  var dst = _operands[10];
  var a = regs[base + _operands[11]];
  regs[base + dst] = a & regs[base + _operands[12]];
};
VMPrototype[120] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_GLOBAL,LOAD_CONST,GET_PROP (macro)
  // LOAD_GLOBAL
  var dst = this.ag(14, {}, undefined, {});
  var globalName = this.x();
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
  // LOAD_CONST
  var dst = this.ag(undefined, 73, undefined, {});
  regs[base + dst] = this.x();
  // GET_PROP
  // dst = regs[obj][regs[key]]
  var dst = this.ag(null, "z", {}, null);
  var obj = regs[base + this.ag({}, [], undefined, {})];
  var key = regs[base + this.ag(undefined, 8, 35, null)];
  regs[base + dst] = obj[key];
};
VMPrototype[130] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_CONST,LOAD_CONST,LOAD_THIS (macro)
  // LOAD_CONST
  var dst = this.ag(null, 0, null, undefined);
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag(undefined, {}, null, 16);
  regs[base + dst] = this.x();
  // LOAD_THIS
  var dst = this.ag("z", [], [], undefined);
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[53] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // dst, iterReg, exitTarget
  // Advances iterator; writes next key to dst, or jumps to exitTarget when done.
  var dst = this.ag(2, 15, null, "k");
  var iter = regs[base + this.ag(undefined, {}, "z", 76)];
  var exitTarget = this.ag(null, "y", {}, 18);
  if (iter.I >= iter.b.length) {
    regs[fp + 0] = exitTarget;
  } else {
    regs[base + dst] = iter.b[iter.I++];
  }
};
VMPrototype[93] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // SET_PROP_14_3_16 (specialized)
  // regs[obj][regs[key]] = regs[val]
  var obj = regs[base + 14];
  var key = regs[base + 3];
  var val = regs[base + 16];
  // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
  // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
  Reflect.set(obj, key, val);
};
VMPrototype[113] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // JUMP_REG_73 (specialized)
  // Indirect jump: allows VM to jump based on runtime values.
  regs[fp + 0] = regs[base + 73];
};
VMPrototype[98] = function () {
  var fp = this.C;
  var regs = this.j;
  // FINALLY_SETUP_3607_4_5_2992 (specialized)
  // finallyPc, contReg, payloadReg, throwPad
  // Arm a finalizer for the current region.  Unlike a catch record this
  // carries no exceptionReg; instead the continuation register (contReg)
  // receives the resume PC and payloadReg carries the in-flight value.
  var hs = regs[fp + 5];
  if (!hs) regs[fp + 5] = hs = [];
  hs.push({
    P: 3607,
    O: 4,
    af: 5,
    p: 2992
  });
};
VMPrototype[100] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // SET_PROP_11_12_13 (specialized)
  // regs[obj][regs[key]] = regs[val]
  var obj = regs[base + 11];
  var key = regs[base + 12];
  var val = regs[base + 13];
  // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
  // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
  Reflect.set(obj, key, val);
};
VMPrototype[108] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // GET_PROP_98_98_101 (specialized)
  // dst = regs[obj][regs[key]]
  var dst = 98;
  var obj = regs[base + 98];
  var key = regs[base + 101];
  regs[base + dst] = obj[key];
};
VMPrototype[15] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(21, undefined, {}, undefined);
  var a = regs[base + this.ag("z", "x", "y", {})];
  regs[base + dst] = a % regs[base + this.ag(25, [], [], null)];
};
VMPrototype[85] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_THIS_1 (specialized)
  var dst = 1;
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[115] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_INT,LOAD_INT (macro)
  // LOAD_INT
  var dst = this.ag(undefined, 27, 57, []);
  regs[base + dst] = this.ag("y", undefined, {}, 98);
  // LOAD_INT
  var dst = this.ag("y", {}, null, undefined);
  regs[base + dst] = this.ag(66, "q", [], "y");
};
VMPrototype[17] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag([], 79, undefined, 26);
  var a = regs[base + this.ag([], undefined, [], "z")];
  regs[base + dst] = a | regs[base + this.ag(37, {}, null, 4)];
};
VMPrototype[33] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag("k", undefined, null, 83);
  regs[base + dst] = +regs[base + this.ag([], 31, 42, null)];
};
VMPrototype[60] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // Math.pow instead of `**`
  var dst = this.ag(null, null, 61, "y");
  var a = regs[base + this.ag({}, undefined, undefined, {})];
  regs[base + dst] = Math.pow(a, regs[base + this.ag(undefined, {}, null, {})]);
};
VMPrototype[55] = function () {
  var fp = this.C;
  var regs = this.j;
  // Normal exit from a try block — disarm the top handler record
  // (works for both catch and finally regions; they share the stack).
  regs[fp + 5].pop();
};
VMPrototype[25] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, [], {}, {});
  var a = regs[base + this.ag("q", 26, "y", 25)];
  regs[base + dst] = a >= regs[base + this.ag(undefined, undefined, "z", undefined)];
};
VMPrototype[122] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_GLOBAL,LOAD_CONST (macro)
  // LOAD_GLOBAL
  var dst = this.ag(null, 64, null, null);
  var globalName = this.x();
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
  // LOAD_CONST
  var dst = this.ag(null, [], null, "k");
  regs[base + dst] = this.x();
};
VMPrototype[56] = function () {
  // destPc, sliceStart, sliceEnd, key
  var destPc = this.ag(14, null, "k", undefined);
  var sliceStart = this.ag(null, null, 91, {});
  var sliceEnd = this.ag([], undefined, "y", "z");
  var pk = this.ag([], undefined, null, undefined) ^ destPc | 0;
  for (var pi = sliceStart; pi < sliceEnd; pi++) {
    pk = pk + 0x9e3779b9 | 0;
    // >>> 0: a negative slot would never match a case in the switch.
    this.y[destPc + (pi - sliceStart)] = (this.y[pi] ^ (pk ^ pk >>> 13)) >>> 0;
  }
};
VMPrototype[20] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, [], 68, []);
  var a = regs[base + this.ag(undefined, [], "k", "q")];
  regs[base + dst] = a >> regs[base + this.ag("z", null, "k", [])];
};
VMPrototype[106] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_GLOBAL_7_83_2327201105 (specialized)
  var dst = 7;
  var globalName = this.x([], 83, {}, 2327201105);
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
};
VMPrototype[36] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag("y", [], 69, 66);
  regs[base + dst] = typeof regs[base + this.ag(7, undefined, {}, [])];
};
VMPrototype[127] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_GLOBAL,LOAD_CONST,GET_PROP,LOAD_CONST (macro)
  // LOAD_GLOBAL
  var dst = this.ag({}, [], {}, "k");
  var globalName = this.x();
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
  // LOAD_CONST
  var dst = this.ag(22, "x", [], []);
  regs[base + dst] = this.x();
  // GET_PROP
  // dst = regs[obj][regs[key]]
  var dst = this.ag(undefined, "q", [], "x");
  var obj = regs[base + this.ag(undefined, [], {}, {})];
  var key = regs[base + this.ag("z", undefined, null, 34)];
  regs[base + dst] = obj[key];
  // LOAD_CONST
  var dst = this.ag(null, 20, 65, null);
  regs[base + dst] = this.x();
};
VMPrototype[49] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // dst, pairCount, [keyReg, valReg, ...]
  var dst = this.ag(undefined, 64, null, 13);
  var pairCount = this.ag(45, undefined, 68, "k");
  var o = {};
  for (var i = 0; i < pairCount; i++) {
    var key = regs[base + this.ag("q", 34, [], "x")];
    var val = regs[base + this.ag("k", 11, {}, "y")];
    o[key] = val;
  }
  regs[base + dst] = o;
};
VMPrototype[90] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST_15_5_2436147205 (specialized)
  var dst = 15;
  regs[base + dst] = this.x(null, 5, "y", 2436147205);
};
VMPrototype[133] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST,CALL_METHOD (macro)
  // LOAD_CONST
  var dst = this.ag(undefined, 83, {}, null);
  regs[base + dst] = this.x();
  // CALL_METHOD
  // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
  var dst = this.ag([], "z", {}, 48);
  var receiver = regs[base + this.ag(undefined, undefined, undefined, undefined)];
  var callee = regs[base + this.ag("q", 24, 36, "y")];
  var argc = this.ag([], "x", null, "k");
  var args;
  if (argc === 65535) {
    args = regs[base + this.ag(null, [], {}, null)];
  } else {
    args = new Array(argc);
    for (var i = 0; i < argc; i++) args[i] = regs[base + this.ag(null, {}, [], null)];
  }
  var closure = callee && CLOSURE_MAP.get(callee);
  if (closure) {
    this.R(closure, dst << 1, args, {}, receiver);
  } else {
    regs[base + dst] = callee.apply(receiver, args);
  }
};
VMPrototype[91] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_GLOBAL_16_4_3814006823 (specialized)
  var dst = 16;
  var globalName = this.x(undefined, 4, undefined, 3814006823);
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
};
VMPrototype[118] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST,GET_PROP (macro)
  // LOAD_CONST
  var dst = this.ag(undefined, 26, {}, {});
  regs[base + dst] = this.x();
  // GET_PROP
  // dst = regs[obj][regs[key]]
  var dst = this.ag({}, [], "x", {});
  var obj = regs[base + this.ag(64, undefined, {}, null)];
  var key = regs[base + this.ag([], "z", "x", "k")];
  regs[base + dst] = obj[key];
};
VMPrototype[88] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_INT_10_170 (specialized)
  var dst = 10;
  regs[base + dst] = 170;
};
VMPrototype[66] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_SUB_0_1_7_2_6_8_4_5_3 (order: [0,1,7,2,6,8,4,5,3])
  let _unsortedOperands = [this.ag({}, 78, [], {}), this.ag({}, null, null, {}), this.ag([], {}, 3, null), this.ag(21, {}, undefined, []), this.ag({}, null, "z", 4), this.ag([], [], {}, "x"), this.ag(27, [], [], "z"), this.ag("z", null, null, []), this.ag("q", "x", [], undefined)];
  let _operands = [_unsortedOperands[0], _unsortedOperands[1], _unsortedOperands[3], _unsortedOperands[8], _unsortedOperands[6], _unsortedOperands[7], _unsortedOperands[4], _unsortedOperands[2], _unsortedOperands[5]];
  // BAND
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a & regs[base + _operands[2]];
  // SUB
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a - regs[base + _operands[5]];
  // BUILD_ARRAY
  // dst, count, [elemReg...]
  var dst = _operands[6];
  var count = _operands[7];
  var elems = new Array(count);
  for (var i = 0; i < count; i++) elems[i] = regs[base + _operands[8]];
  regs[base + dst] = elems;
};
VMPrototype[54] = function () {
  var fp = this.C;
  var regs = this.j;
  // handlerPc, exceptionReg — push exception handler record onto current
  // frame. The handler stack lives in a header slot and is created on
  // first use, so frames that never try/catch carry nothing.
  var hs = regs[fp + 5];
  if (!hs) regs[fp + 5] = hs = [];
  hs.push({
    aa: this.ag(null, {}, undefined, "z"),
    H: this.ag(undefined, "y", [], undefined)
  });
};
VMPrototype[132] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_CONST,LOAD_THIS (macro)
  // LOAD_CONST
  var dst = this.ag(47, undefined, 69, "z");
  regs[base + dst] = this.x();
  // LOAD_THIS
  var dst = this.ag([], {}, null, []);
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[72] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_SHL_5_11_1_12_4_2_13_9_7_10_0_3_8_6 (order: [5,11,1,12,4,2,13,9,7,10,0,3,8,6])
  let _unsortedOperands = [this.ag([], null, "q", undefined), this.ag(80, null, "k", []), this.ag([], {}, "z", []), this.ag("q", [], null, []), this.ag({}, "x", null, 30), this.ag([], "z", null, "y"), this.ag({}, null, undefined, undefined), this.ag([], 14, null, 97), this.ag(49, "k", "k", undefined), this.ag([], {}, 50, null), this.ag(undefined, 91, {}, []), this.ag(null, null, "z", {}), this.ag([], undefined, undefined, []), this.ag({}, null, 68, 2)];
  let _operands = [_unsortedOperands[10], _unsortedOperands[2], _unsortedOperands[5], _unsortedOperands[11], _unsortedOperands[4], _unsortedOperands[0], _unsortedOperands[13], _unsortedOperands[8], _unsortedOperands[12], _unsortedOperands[7], _unsortedOperands[9], _unsortedOperands[1], _unsortedOperands[3], _unsortedOperands[6]];
  // BUILD_ARRAY
  // dst, count, [elemReg...]
  var dst = _operands[0];
  var count = _operands[1];
  var elems = new Array(count);
  for (var i = 0; i < count; i++) elems[i] = regs[base + _operands[2]];
  regs[base + dst] = elems;
  // MOVE
  var dst = _operands[3];
  regs[base + dst] = regs[base + _operands[4]];
  // LTE
  var dst = _operands[5];
  var a = regs[base + _operands[6]];
  regs[base + dst] = a <= regs[base + _operands[7]];
  // SHL
  var dst = _operands[8];
  var a = regs[base + _operands[9]];
  regs[base + dst] = a << regs[base + _operands[10]];
  // LT
  var dst = _operands[11];
  var a = regs[base + _operands[12]];
  regs[base + dst] = a < regs[base + _operands[13]];
};
VMPrototype[139] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ALIAS_LOAD_INT_1_0 (order: [1,0])
  let _unsortedOperands = [this.ag("k", "q", 60, undefined), this.ag([], [], [], undefined)];
  let _operands = [_unsortedOperands[1], _unsortedOperands[0]];
  var dst = _operands[0];
  regs[base + dst] = _operands[1];
};
VMPrototype[94] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // RETURN_14 (specialized)
  var retVal = regs[base + 14];
  this.N(undefined, fp, "k", null); // must happen before frame is abandoned

  // must happen before frame is abandoned

  var caller = regs[fp + 1];
  var retDst = regs[fp + 2];

  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  var hi = fp + regs[fp + 6];
  for (var i = fp; i < hi; i++) regs[i] = undefined;
  this.X = fp;
  this.C = caller;

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
  regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
};
VMPrototype[34] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, [], [], []);
  regs[base + dst] = !regs[base + this.ag(undefined, "k", "k", 85)];
};
VMPrototype[97] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // THROW_107 (specialized)
  throw regs[base + 107];
};
VMPrototype[14] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(65, {}, {}, 98);
  var a = regs[base + this.ag("x", "y", null, null)];
  regs[base + dst] = a / regs[base + this.ag("x", [], 1, [])];
};
VMPrototype[107] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_GLOBAL_11_4_3814006823 (specialized)
  var dst = 11;
  var globalName = this.x({}, 4, {}, 3814006823);
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
};
VMPrototype[69] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_EQ_4_0_1_2_7_5_6_3 (order: [4,0,1,2,7,5,6,3])
  let _unsortedOperands = [this.ag("y", null, {}, []), this.ag(83, [], 55, {}), this.ag(93, null, "z", []), this.ag({}, undefined, "q", undefined), this.ag(undefined, "y", [], undefined), this.ag([], "x", [], undefined), this.ag([], "y", 61, {}), this.ag([], "z", "y", null)];
  let _operands = [_unsortedOperands[1], _unsortedOperands[2], _unsortedOperands[3], _unsortedOperands[7], _unsortedOperands[0], _unsortedOperands[5], _unsortedOperands[6], _unsortedOperands[4]];
  // EQ
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a === regs[base + _operands[2]];
  // UNARY_BITNOT
  var dst = _operands[3];
  regs[base + dst] = ~regs[base + _operands[4]];
  // BAND
  var dst = _operands[5];
  var a = regs[base + _operands[6]];
  regs[base + dst] = a & regs[base + _operands[7]];
};
VMPrototype[138] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_CONST,LOAD_THIS,LOAD_CONST (macro)
  // LOAD_CONST
  var dst = this.ag("y", null, "y", {});
  regs[base + dst] = this.x();
  // LOAD_THIS
  var dst = this.ag(null, {}, null, {});
  regs[base + dst] = regs[fp + 3];
  // LOAD_CONST
  var dst = this.ag("y", "y", "z", {});
  regs[base + dst] = this.x();
};
VMPrototype[96] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // THROW_5 (specialized)
  throw regs[base + 5];
};
VMPrototype[105] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // GET_PROP_107_3_10 (specialized)
  // dst = regs[obj][regs[key]]
  var dst = 107;
  var obj = regs[base + 3];
  var key = regs[base + 10];
  regs[base + dst] = obj[key];
};
VMPrototype[18] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(undefined, {}, "k", {});
  var a = regs[base + this.ag({}, [], undefined, "k")];
  regs[base + dst] = a ^ regs[base + this.ag(null, [], "q", "z")];
};
VMPrototype[45] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  var retVal = regs[base + this.ag(null, "q", 49, "q")];
  this.N(79, fp, "y", undefined); // must happen before frame is abandoned

  // must happen before frame is abandoned

  var caller = regs[fp + 1];
  var retDst = regs[fp + 2];

  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  var hi = fp + regs[fp + 6];
  for (var i = fp; i < hi; i++) regs[i] = undefined;
  this.X = fp;
  this.C = caller;

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
  regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
};
VMPrototype[125] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_CONST,RETURN (macro)
  // LOAD_CONST
  var dst = this.ag({}, undefined, "k", undefined);
  regs[base + dst] = this.x();
  // RETURN
  var retVal = regs[base + this.ag({}, undefined, 72, 41)];
  this.N("x", fp, {}, {}); // must happen before frame is abandoned

  // must happen before frame is abandoned

  var caller = regs[fp + 1];
  var retDst = regs[fp + 2];

  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  var hi = fp + regs[fp + 6];
  for (var i = fp; i < hi; i++) regs[i] = undefined;
  this.X = fp;
  this.C = caller;

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
  regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
};
VMPrototype[11] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag("z", "q", [], "x");
  var a = regs[base + this.ag(null, {}, undefined, "z")];
  regs[base + dst] = a + regs[base + this.ag(undefined, [], null, undefined)];
};
VMPrototype[26] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, {}, "y", undefined);
  var a = regs[base + this.ag(1, {}, {}, null)];
  regs[base + dst] = a === regs[base + this.ag([], undefined, undefined, undefined)];
};
VMPrototype[46] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  throw regs[base + this.ag("x", undefined, {}, "k")];
};
VMPrototype[74] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_USHR_14_13_5_8_4_10_12_9_7_6_2_0_3_11_1 (order: [14,13,5,8,4,10,12,9,7,6,2,0,3,11,1])
  let _unsortedOperands = [this.ag(80, {}, {}, []), this.ag([], "k", 8, []), this.ag({}, 75, [], null), this.ag({}, [], null, {}), this.ag(null, "q", "k", null), this.ag({}, 14, [], {}), this.ag("q", [], {}, 37), this.ag(undefined, undefined, [], []), this.ag("y", undefined, {}, undefined), this.ag([], null, null, 13), this.ag(undefined, 48, 68, {}), this.ag(75, null, [], []), this.ag(66, "y", {}, undefined), this.ag(undefined, null, {}, 89), this.ag([], null, undefined, [])];
  let _operands = [_unsortedOperands[11], _unsortedOperands[14], _unsortedOperands[10], _unsortedOperands[12], _unsortedOperands[4], _unsortedOperands[2], _unsortedOperands[9], _unsortedOperands[8], _unsortedOperands[3], _unsortedOperands[7], _unsortedOperands[5], _unsortedOperands[13], _unsortedOperands[6], _unsortedOperands[1], _unsortedOperands[0]];
  // LOOSE_NEQ
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a != regs[base + _operands[2]];
  // DIV
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a / regs[base + _operands[5]];
  // DIV
  var dst = _operands[6];
  var a = regs[base + _operands[7]];
  regs[base + dst] = a / regs[base + _operands[8]];
  // USHR
  var dst = _operands[9];
  var a = regs[base + _operands[10]];
  regs[base + dst] = a >>> regs[base + _operands[11]];
  // LOAD_GLOBAL
  var dst = _operands[12];
  var globalName = this.x("k", _operands[13], "y", _operands[14]);
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
};
VMPrototype[67] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_MUL_3_9_4_6_5_7_2_10_0_8_1 (order: [3,9,4,6,5,7,2,10,0,8,1])
  let _unsortedOperands = [this.ag(null, "x", undefined, 41), this.ag(undefined, "x", "k", "q"), this.ag({}, undefined, 12, {}), this.ag(null, 92, null, undefined), this.ag({}, [], "x", "z"), this.ag(2, {}, "z", "z"), this.ag([], {}, [], []), this.ag(85, "k", {}, "x"), this.ag("q", 45, [], {}), this.ag(4, "k", {}, {}), this.ag([], {}, null, 74)];
  let _operands = [_unsortedOperands[8], _unsortedOperands[10], _unsortedOperands[6], _unsortedOperands[0], _unsortedOperands[2], _unsortedOperands[4], _unsortedOperands[3], _unsortedOperands[5], _unsortedOperands[9], _unsortedOperands[1], _unsortedOperands[7]];
  // LOAD_CONST
  var dst = _operands[0];
  regs[base + dst] = this.x([], _operands[1], "k", _operands[2]);
  // LT
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a < regs[base + _operands[5]];
  // MUL
  var dst = _operands[6];
  var a = regs[base + _operands[7]];
  regs[base + dst] = a * regs[base + _operands[8]];
  // UNARY_BITNOT
  var dst = _operands[9];
  regs[base + dst] = ~regs[base + _operands[10]];
};
VMPrototype[1] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, undefined, "x", []);
  regs[base + dst] = this.ag(9, undefined, {}, null);
};
VMPrototype[22] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag({}, {}, [], undefined);
  var a = regs[base + this.ag(undefined, 37, 16, null)];
  regs[base + dst] = a < regs[base + this.ag("z", "y", [], {})];
};
VMPrototype[9] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // regs[obj][regs[key]] = regs[val]
  var obj = regs[base + this.ag("k", "k", {}, null)];
  var key = regs[base + this.ag({}, null, [], 21)];
  var val = regs[base + this.ag(undefined, {}, [], null)];
  // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
  // Reflect.set performs [[Set]] without throwing on failure (non-strict mode behavior)
  Reflect.set(obj, key, val);
};
VMPrototype[111] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // RETURN_81 (specialized)
  var retVal = regs[base + 81];
  this.N("z", fp, "q", []); // must happen before frame is abandoned

  // must happen before frame is abandoned

  var caller = regs[fp + 1];
  var retDst = regs[fp + 2];

  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  var hi = fp + regs[fp + 6];
  for (var i = fp; i < hi; i++) regs[i] = undefined;
  this.X = fp;
  this.C = caller;

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
  regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
};
VMPrototype[61] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_MOVE_1_0_7_9_3_6_13_8_2_12_4_11_5_10 (order: [1,0,7,9,3,6,13,8,2,12,4,11,5,10])
  let _unsortedOperands = [this.ag("y", 47, null, {}), this.ag(11, "q", null, []), this.ag([], 84, {}, []), this.ag(undefined, 81, 93, null), this.ag(undefined, "y", undefined, "z"), this.ag("z", undefined, null, 48), this.ag({}, {}, "z", undefined), this.ag({}, "x", [], null), this.ag([], {}, [], {}), this.ag(undefined, {}, null, []), this.ag(undefined, "q", {}, null), this.ag(58, {}, null, "k"), this.ag(undefined, undefined, null, null), this.ag(null, null, {}, null)];
  let _operands = [_unsortedOperands[1], _unsortedOperands[0], _unsortedOperands[8], _unsortedOperands[4], _unsortedOperands[10], _unsortedOperands[12], _unsortedOperands[5], _unsortedOperands[2], _unsortedOperands[7], _unsortedOperands[3], _unsortedOperands[13], _unsortedOperands[11], _unsortedOperands[9], _unsortedOperands[6]];
  // ADD
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a + regs[base + _operands[2]];
  // SUB
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a - regs[base + _operands[5]];
  // ADD
  var dst = _operands[6];
  var a = regs[base + _operands[7]];
  regs[base + dst] = a + regs[base + _operands[8]];
  // TYPEOF_SAFE
  // regs[dst] = typeof window[name]
  // Never throws ReferenceError, instead returns undefined for undeclared variables
  var dst = _operands[9];
  var name = this.x(null, _operands[10], {}, _operands[11]);
  var val = Object.prototype.hasOwnProperty.call(this.f, name) ? this.f[name] : undefined;
  regs[base + dst] = typeof val;
  // MOVE
  var dst = _operands[12];
  regs[base + dst] = regs[base + _operands[13]];
};
VMPrototype[37] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag("k", "x", null, {});
  this.ag(null, 17, undefined, null); // consumes argument (intended)
  // consumes argument (intended)
  regs[base + dst] = undefined;
};
VMPrototype[137] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_CONST,LOAD_CONST,LOAD_THIS,LOAD_CONST (macro)
  // LOAD_CONST
  var dst = this.ag([], "x", [], "k");
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag(65, [], {}, {});
  regs[base + dst] = this.x();
  // LOAD_THIS
  var dst = this.ag([], {}, [], undefined);
  regs[base + dst] = regs[fp + 3];
  // LOAD_CONST
  var dst = this.ag(42, "y", undefined, "z");
  regs[base + dst] = this.x();
};
VMPrototype[31] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // regs[dst] = regs[obj] instanceof regs[ctor]
  // Since VM closures are wrapped in native function shells (MAKE_CLOSURE), the native operator works
  var dst = this.ag({}, 88, null, []);
  var obj = regs[base + this.ag([], [], "k", "z")];
  regs[base + dst] = obj instanceof regs[base + this.ag(null, 81, {}, null)];
};
VMPrototype[128] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST,GET_PROP,LOAD_CONST,CALL_METHOD (macro)
  // LOAD_CONST
  var dst = this.ag("k", {}, 4, null);
  regs[base + dst] = this.x();
  // GET_PROP
  // dst = regs[obj][regs[key]]
  var dst = this.ag(undefined, "q", {}, {});
  var obj = regs[base + this.ag(72, "q", "y", undefined)];
  var key = regs[base + this.ag(undefined, "x", 65, 26)];
  regs[base + dst] = obj[key];
  // LOAD_CONST
  var dst = this.ag(undefined, [], [], 69);
  regs[base + dst] = this.x();
  // CALL_METHOD
  // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
  var dst = this.ag(undefined, undefined, {}, {});
  var receiver = regs[base + this.ag(null, undefined, null, undefined)];
  var callee = regs[base + this.ag("z", null, 74, {})];
  var argc = this.ag(23, null, [], null);
  var args;
  if (argc === 65535) {
    args = regs[base + this.ag([], 27, 28, 61)];
  } else {
    args = new Array(argc);
    for (var i = 0; i < argc; i++) args[i] = regs[base + this.ag("y", {}, [], 6)];
  }
  var closure = callee && CLOSURE_MAP.get(callee);
  if (closure) {
    this.R(closure, dst << 1, args, {}, receiver);
  } else {
    regs[base + dst] = callee.apply(receiver, args);
  }
};
VMPrototype[84] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST_7_2_2002982425 (specialized)
  var dst = 7;
  regs[base + dst] = this.x(undefined, 2, null, 2002982425);
};
VMPrototype[44] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // dst, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
  var dst = this.ag({}, "q", null, 99);
  var callee = regs[base + this.ag(75, {}, undefined, undefined)];
  var argc = this.ag([], 51, null, []);
  var args;
  if (argc === 65535) {
    args = regs[base + this.ag("z", 85, {}, [])];
  } else {
    args = new Array(argc);
    for (var i = 0; i < argc; i++) args[i] = regs[base + this.ag("z", null, {}, {})];
  }
  var closure = callee && CLOSURE_MAP.get(callee);
  if (closure) {
    // The new object doubles as the frame's THIS; bit 0 of RET_DST marks
    // the frame as a constructor call so RETURN can fall back to it.
    this.R(closure, dst << 1 | 1, args, 65, Object.create(closure.prototype || null));
  } else {
    // Reflect.construct is required - Object.create+apply does NOT set
    // internal slots ([[NumberData]], [[StringData]], etc.) for built-ins.
    regs[base + dst] = Reflect.construct(callee, args);
  }
};
VMPrototype[5] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag("q", [], {}, 64);
  regs[base + dst] = regs[base + this.ag({}, null, {}, null)];
};
VMPrototype[40] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  var src = this.ag(undefined, undefined, "q", "x");
  var target = this.ag({}, [], [], {});
  if (!regs[base + src]) regs[fp + 0] = target;
};
VMPrototype[59] = function () {
  var fp = this.C;
  var regs = this.j;
  // finallyPc, contReg, payloadReg, throwPad
  // Arm a finalizer for the current region.  Unlike a catch record this
  // carries no exceptionReg; instead the continuation register (contReg)
  // receives the resume PC and payloadReg carries the in-flight value.
  var hs = regs[fp + 5];
  if (!hs) regs[fp + 5] = hs = [];
  hs.push({
    P: this.ag("k", 84, [], []),
    O: this.ag([], undefined, {}, {}),
    af: this.ag(null, 35, null, null),
    p: this.ag({}, null, "x", [])
  });
};
VMPrototype[112] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // GET_PROP_11_3_81 (specialized)
  // dst = regs[obj][regs[key]]
  var dst = 11;
  var obj = regs[base + 3];
  var key = regs[base + 81];
  regs[base + dst] = obj[key];
};
VMPrototype[135] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_INT,LOAD_INT,LOAD_INT,LOAD_INT (macro)
  // LOAD_INT
  var dst = this.ag(66, 69, "y", 88);
  regs[base + dst] = this.ag("x", 44, {}, 44);
  // LOAD_INT
  var dst = this.ag("y", {}, 77, undefined);
  regs[base + dst] = this.ag(30, undefined, "k", "x");
  // LOAD_INT
  var dst = this.ag([], {}, "z", {});
  regs[base + dst] = this.ag([], undefined, "z", {});
  // LOAD_INT
  var dst = this.ag(8, {}, [], "y");
  regs[base + dst] = this.ag([], [], null, 6);
};
VMPrototype[32] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(undefined, null, null, 22);
  regs[base + dst] = -regs[base + this.ag([], null, [], null)];
};
VMPrototype[109] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // JUMP_REG_98 (specialized)
  // Indirect jump: allows VM to jump based on runtime values.
  regs[fp + 0] = regs[base + 98];
};
VMPrototype[3] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  var dst = this.ag([], "k", undefined, 3);
  regs[base + dst] = regs[fp + 4].s[this.ag("z", 91, 63, null)].S(null);
};
VMPrototype[38] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // regs[dst] = typeof window[name]
  // Never throws ReferenceError, instead returns undefined for undeclared variables
  var dst = this.ag({}, undefined, null, "y");
  var name = this.x();
  var val = Object.prototype.hasOwnProperty.call(this.f, name) ? this.f[name] : undefined;
  regs[base + dst] = typeof val;
};
VMPrototype[104] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_THIS_2 (specialized)
  var dst = 2;
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[2] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(undefined, "x", null, null);
  var globalName = this.x();
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
};
VMPrototype[57] = function () {
  debugger;
};
VMPrototype[8] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // dst = regs[obj][regs[key]]
  var dst = this.ag(46, null, {}, null);
  var obj = regs[base + this.ag(undefined, [], {}, 74)];
  var key = regs[base + this.ag(undefined, null, undefined, undefined)];
  regs[base + dst] = obj[key];
};
VMPrototype[131] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // GET_PROP,LOAD_CONST,CALL_METHOD (macro)
  // GET_PROP
  // dst = regs[obj][regs[key]]
  var dst = this.ag(undefined, {}, {}, "x");
  var obj = regs[base + this.ag(undefined, null, 50, {})];
  var key = regs[base + this.ag({}, 35, undefined, "x")];
  regs[base + dst] = obj[key];
  // LOAD_CONST
  var dst = this.ag(undefined, {}, [], {});
  regs[base + dst] = this.x();
  // CALL_METHOD
  // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
  var dst = this.ag([], 78, null, {});
  var receiver = regs[base + this.ag(null, [], 62, "q")];
  var callee = regs[base + this.ag({}, undefined, 35, "q")];
  var argc = this.ag([], [], [], null);
  var args;
  if (argc === 65535) {
    args = regs[base + this.ag(27, {}, [], {})];
  } else {
    args = new Array(argc);
    for (var i = 0; i < argc; i++) args[i] = regs[base + this.ag(undefined, null, 73, null)];
  }
  var closure = callee && CLOSURE_MAP.get(callee);
  if (closure) {
    this.R(closure, dst << 1, args, {}, receiver);
  } else {
    regs[base + dst] = callee.apply(receiver, args);
  }
};
VMPrototype[143] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // ALIAS_LOAD_THIS_0 (order: [0])
  let _unsortedOperands = [this.ag(null, {}, null, null)];
  let _operands = [_unsortedOperands[0]];
  var dst = _operands[0];
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[117] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST,LOAD_INT (macro)
  // LOAD_CONST
  var dst = this.ag([], "z", null, []);
  regs[base + dst] = this.x();
  // LOAD_INT
  var dst = this.ag("y", undefined, "k", 45);
  regs[base + dst] = this.ag(null, [], null, 23);
};
VMPrototype[16] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag("k", [], 0, null);
  var a = regs[base + this.ag(undefined, {}, {}, null)];
  regs[base + dst] = a & regs[base + this.ag(null, "z", undefined, 88)];
};
VMPrototype[76] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_UNARY_BITNOT_8_7_6_4_12_10_3_5_2_9_0_13_1_11 (order: [8,7,6,4,12,10,3,5,2,9,0,13,1,11])
  let _unsortedOperands = [this.ag(1, [], null, 12), this.ag({}, "q", undefined, "k"), this.ag({}, "z", {}, 95), this.ag(18, [], 24, undefined), this.ag(undefined, [], null, null), this.ag("z", null, {}, "y"), this.ag([], 46, {}, "k"), this.ag({}, {}, undefined, undefined), this.ag(null, [], "k", undefined), this.ag("q", {}, {}, {}), this.ag([], undefined, "q", undefined), this.ag("y", "y", undefined, null), this.ag(undefined, "x", "y", undefined), this.ag(undefined, null, null, "y")];
  let _operands = [_unsortedOperands[10], _unsortedOperands[12], _unsortedOperands[8], _unsortedOperands[6], _unsortedOperands[3], _unsortedOperands[7], _unsortedOperands[2], _unsortedOperands[1], _unsortedOperands[0], _unsortedOperands[9], _unsortedOperands[5], _unsortedOperands[13], _unsortedOperands[4], _unsortedOperands[11]];
  // SHL
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a << regs[base + _operands[2]];
  // LT
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a < regs[base + _operands[5]];
  // ADD
  var dst = _operands[6];
  var a = regs[base + _operands[7]];
  regs[base + dst] = a + regs[base + _operands[8]];
  // UNARY_BITNOT
  var dst = _operands[9];
  regs[base + dst] = ~regs[base + _operands[10]];
  // NEQ
  var dst = _operands[11];
  var a = regs[base + _operands[12]];
  regs[base + dst] = a !== regs[base + _operands[13]];
};
VMPrototype[101] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // JUMP_REG_4 (specialized)
  // Indirect jump: allows VM to jump based on runtime values.
  regs[fp + 0] = regs[base + 4];
};
VMPrototype[114] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // JUMP_REG_84 (specialized)
  // Indirect jump: allows VM to jump based on runtime values.
  regs[fp + 0] = regs[base + 84];
};
VMPrototype[42] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // dst, calleeReg, argc, [argReg...]  (argc=-1 means next operand is spread-args array reg)
  var dst = this.ag({}, [], undefined, 72);
  var callee = regs[base + this.ag([], undefined, undefined, "x")];
  var argc = this.ag(undefined, {}, [], {});
  var args;
  if (argc === 65535) {
    args = regs[base + this.ag(undefined, {}, 77, null)];
  } else {
    args = new Array(argc);
    for (var i = 0; i < argc; i++) args[i] = regs[base + this.ag({}, "q", {}, [])];
  }
  var closure = callee && CLOSURE_MAP.get(callee);
  if (closure) {
    this.R(closure, dst << 1, args, null, this.f);
  } else {
    regs[base + dst] = callee.apply(null, args);
  }
};
VMPrototype[30] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, [], undefined, []);
  var a = regs[base + this.ag(null, "q", null, undefined)];
  regs[base + dst] = a in regs[base + this.ag(undefined, null, undefined, {})];
};
VMPrototype[65] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_UNARY_POS_3_1_6_5_4_7_0_2 (order: [3,1,6,5,4,7,0,2])
  let _unsortedOperands = [this.ag({}, [], 82, undefined), this.ag("z", 80, undefined, 64), this.ag(49, {}, undefined, undefined), this.ag([], [], [], {}), this.ag("y", undefined, {}, null), this.ag(87, [], undefined, null), this.ag(null, [], "x", null), this.ag([], "x", null, {})];
  let _operands = [_unsortedOperands[6], _unsortedOperands[1], _unsortedOperands[7], _unsortedOperands[0], _unsortedOperands[4], _unsortedOperands[3], _unsortedOperands[2], _unsortedOperands[5]];
  // UNARY_POS
  var dst = _operands[0];
  regs[base + dst] = +regs[base + _operands[1]];
  // USHR
  var dst = _operands[2];
  var a = regs[base + _operands[3]];
  regs[base + dst] = a >>> regs[base + _operands[4]];
  // ADD
  var dst = _operands[5];
  var a = regs[base + _operands[6]];
  regs[base + dst] = a + regs[base + _operands[7]];
};
VMPrototype[19] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, undefined, "z", undefined);
  var a = regs[base + this.ag(null, {}, null, [])];
  regs[base + dst] = a << regs[base + this.ag(27, [], 35, null)];
};
VMPrototype[80] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_INT_18_8 (specialized)
  var dst = 18;
  regs[base + dst] = 8;
};
VMPrototype[129] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST,LOAD_CONST,LOAD_CONST (macro)
  // LOAD_CONST
  var dst = this.ag([], null, 37, "x");
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag(undefined, undefined, null, null);
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag({}, null, null, []);
  regs[base + dst] = this.x();
};
VMPrototype[58] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // Indirect jump: allows VM to jump based on runtime values.
  regs[fp + 0] = regs[base + this.ag("z", undefined, {}, 78)];
};
VMPrototype[77] = function () {
  var fp = this.C;
  var regs = this.j;
  // JUMP_3638 (specialized)
  regs[fp + 0] = 3638;
};
VMPrototype[86] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_GLOBAL_14_4_3814006823 (specialized)
  var dst = 14;
  var globalName = this.x(89, 4, [], 3814006823);
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
};
VMPrototype[95] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_THIS_19 (specialized)
  var dst = 19;
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[141] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // ALIAS_RETURN_0 (order: [0])
  let _unsortedOperands = [this.ag(null, undefined, undefined, "x")];
  let _operands = [_unsortedOperands[0]];
  var retVal = regs[base + _operands[0]];
  this.N("x", fp, null, "y"); // must happen before frame is abandoned

  // must happen before frame is abandoned

  var caller = regs[fp + 1];
  var retDst = regs[fp + 2];

  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  var hi = fp + regs[fp + 6];
  for (var i = fp; i < hi; i++) regs[i] = undefined;
  this.X = fp;
  this.C = caller;

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
  regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
};
VMPrototype[64] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_UNARY_NOT_7_5_4_6_3_2_0_1 (order: [7,5,4,6,3,2,0,1])
  let _unsortedOperands = [this.ag(undefined, undefined, undefined, "z"), this.ag({}, undefined, {}, null), this.ag(undefined, "z", null, {}), this.ag(null, "q", [], 11), this.ag(null, {}, [], []), this.ag(null, 93, 33, undefined), this.ag("q", null, null, "q"), this.ag({}, "x", null, "q")];
  let _operands = [_unsortedOperands[6], _unsortedOperands[7], _unsortedOperands[5], _unsortedOperands[4], _unsortedOperands[2], _unsortedOperands[1], _unsortedOperands[3], _unsortedOperands[0]];
  // USHR
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a >>> regs[base + _operands[2]];
  // BXOR
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a ^ regs[base + _operands[5]];
  // UNARY_NOT
  var dst = _operands[6];
  regs[base + dst] = !regs[base + _operands[7]];
};
VMPrototype[43] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
  var dst = this.ag(null, {}, 46, null);
  var receiver = regs[base + this.ag(undefined, [], null, null)];
  var callee = regs[base + this.ag("z", "y", {}, [])];
  var argc = this.ag(91, undefined, undefined, 28);
  var args;
  if (argc === 65535) {
    args = regs[base + this.ag("q", [], undefined, undefined)];
  } else {
    args = new Array(argc);
    for (var i = 0; i < argc; i++) args[i] = regs[base + this.ag(null, [], "y", undefined)];
  }
  var closure = callee && CLOSURE_MAP.get(callee);
  if (closure) {
    this.R(closure, dst << 1, args, [], receiver);
  } else {
    regs[base + dst] = callee.apply(receiver, args);
  }
};
VMPrototype[82] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST_12_0_2221812181 (specialized)
  var dst = 12;
  regs[base + dst] = this.x([], 0, undefined, 2221812181);
};
VMPrototype[10] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // regs[dst] = delete regs[obj][regs[key]]
  // The delete operator returns true if successful which is most cases
  var dst = this.ag(9, 9, [], undefined);
  var obj = regs[base + this.ag({}, 6, undefined, [])];
  var key = regs[base + this.ag([], 67, [], null)];
  regs[base + dst] = delete obj[key];
};
VMPrototype[134] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_CONST,LOAD_CONST,LOAD_CONST,LOAD_THIS,LOAD_CONST (macro)
  // LOAD_CONST
  var dst = this.ag([], 64, null, null);
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag(13, "x", [], {});
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag(undefined, 58, 73, "y");
  regs[base + dst] = this.x();
  // LOAD_THIS
  var dst = this.ag("y", [], undefined, undefined);
  regs[base + dst] = regs[fp + 3];
  // LOAD_CONST
  var dst = this.ag(undefined, undefined, 79, undefined);
  regs[base + dst] = this.x();
};
VMPrototype[102] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // RETURN_107 (specialized)
  var retVal = regs[base + 107];
  this.N("x", fp, 3, []); // must happen before frame is abandoned

  // must happen before frame is abandoned

  var caller = regs[fp + 1];
  var retDst = regs[fp + 2];

  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  var hi = fp + regs[fp + 6];
  for (var i = fp; i < hi; i++) regs[i] = undefined;
  this.X = fp;
  this.C = caller;

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
  regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
};
VMPrototype[73] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_BOR_2_8_10_7_4_1_13_5_6_3_12_0_9_11 (order: [2,8,10,7,4,1,13,5,6,3,12,0,9,11])
  let _unsortedOperands = [this.ag([], null, "y", 38), this.ag(undefined, {}, undefined, 60), this.ag(94, {}, 46, []), this.ag([], {}, null, null), this.ag(undefined, "y", [], undefined), this.ag({}, {}, 97, {}), this.ag([], [], null, null), this.ag(67, null, 91, null), this.ag(undefined, 8, "x", undefined), this.ag(null, {}, [], 36), this.ag({}, {}, 87, "z"), this.ag(undefined, undefined, null, "z"), this.ag({}, [], {}, []), this.ag({}, undefined, "k", null)];
  let _operands = [_unsortedOperands[11], _unsortedOperands[5], _unsortedOperands[0], _unsortedOperands[9], _unsortedOperands[4], _unsortedOperands[7], _unsortedOperands[8], _unsortedOperands[3], _unsortedOperands[1], _unsortedOperands[12], _unsortedOperands[2], _unsortedOperands[13], _unsortedOperands[10], _unsortedOperands[6]];
  // MUL
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a * regs[base + _operands[2]];
  // NEQ
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a !== regs[base + _operands[5]];
  // BOR
  var dst = _operands[6];
  var a = regs[base + _operands[7]];
  regs[base + dst] = a | regs[base + _operands[8]];
  // TYPEOF_SAFE
  // regs[dst] = typeof window[name]
  // Never throws ReferenceError, instead returns undefined for undeclared variables
  var dst = _operands[9];
  var name = this.x(null, _operands[10], 77, _operands[11]);
  var val = Object.prototype.hasOwnProperty.call(this.f, name) ? this.f[name] : undefined;
  regs[base + dst] = typeof val;
  // TYPEOF
  var dst = _operands[12];
  regs[base + dst] = typeof regs[base + _operands[13]];
};
VMPrototype[81] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // RETURN_5 (specialized)
  var retVal = regs[base + 5];
  this.N({}, fp, null, null); // must happen before frame is abandoned

  // must happen before frame is abandoned

  var caller = regs[fp + 1];
  var retDst = regs[fp + 2];

  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  // NewExpression: When invoking from the 'new' keyword, the newly constructed object is returned instead (if the original function doesn't return an object)
  if (retDst & 1 && (typeof retVal !== "object" || retVal === null)) retVal = regs[fp + 3];

  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  // Zero out the callee's whole block (header included) to limit
  // exposing runtime values, then hand the slots back.
  var hi = fp + regs[fp + 6];
  for (var i = fp; i < hi; i++) regs[i] = undefined;
  this.X = fp;
  this.C = caller;

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
  regs[caller ? regs[caller + 7] + (retDst >> 1) : 0] = retVal;
};
VMPrototype[83] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST_13_1_3405358017 (specialized)
  var dst = 13;
  regs[base + dst] = this.x({}, 1, null, 3405358017);
};
VMPrototype[124] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // GET_PROP,LOAD_CONST (macro)
  // GET_PROP
  // dst = regs[obj][regs[key]]
  var dst = this.ag({}, [], undefined, "q");
  var obj = regs[base + this.ag(49, null, "x", [])];
  var key = regs[base + this.ag([], null, 88, null)];
  regs[base + dst] = obj[key];
  // LOAD_CONST
  var dst = this.ag(null, 3, [], "z");
  regs[base + dst] = this.x();
};
VMPrototype[28] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(undefined, 45, {}, []);
  var a = regs[base + this.ag({}, null, null, null)];
  regs[base + dst] = a == regs[base + this.ag([], [], undefined, "q")];
};
VMPrototype[63] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_NEQ_8_1_10_9_4_3_6_7_5_2_0 (order: [8,1,10,9,4,3,6,7,5,2,0])
  let _unsortedOperands = [this.ag(undefined, [], "x", {}), this.ag(undefined, "z", 8, []), this.ag("z", null, undefined, undefined), this.ag("y", "y", undefined, null), this.ag([], [], 68, {}), this.ag(null, 87, 87, {}), this.ag({}, undefined, "q", null), this.ag({}, null, undefined, null), this.ag({}, "q", 63, {}), this.ag({}, 1, {}, []), this.ag([], "x", {}, null)];
  let _operands = [_unsortedOperands[10], _unsortedOperands[1], _unsortedOperands[9], _unsortedOperands[5], _unsortedOperands[4], _unsortedOperands[8], _unsortedOperands[6], _unsortedOperands[7], _unsortedOperands[0], _unsortedOperands[3], _unsortedOperands[2]];
  // NEQ
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a !== regs[base + _operands[2]];
  // UNARY_POS
  var dst = _operands[3];
  regs[base + dst] = +regs[base + _operands[4]];
  // NEQ
  var dst = _operands[5];
  var a = regs[base + _operands[6]];
  regs[base + dst] = a !== regs[base + _operands[7]];
  // GT
  var dst = _operands[8];
  var a = regs[base + _operands[9]];
  regs[base + dst] = a > regs[base + _operands[10]];
};
VMPrototype[41] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // || short-circuit: if truthy, jump over RHS.
  var src = this.ag("k", {}, undefined, []);
  var target = this.ag(null, "y", "z", []);
  if (regs[base + src]) regs[fp + 0] = target;
};
VMPrototype[62] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_UNARY_NEG_5_0_3_2_7_6_4_1 (order: [5,0,3,2,7,6,4,1])
  let _unsortedOperands = [this.ag(null, null, [], 41), this.ag(20, undefined, 35, 10), this.ag(undefined, "x", [], []), this.ag({}, undefined, {}, "y"), this.ag("y", undefined, null, undefined), this.ag(undefined, {}, undefined, null), this.ag({}, null, {}, 52), this.ag(undefined, undefined, 48, 28)];
  let _operands = [_unsortedOperands[1], _unsortedOperands[7], _unsortedOperands[3], _unsortedOperands[2], _unsortedOperands[6], _unsortedOperands[0], _unsortedOperands[5], _unsortedOperands[4]];
  // EXP
  // Math.pow instead of `**`
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = Math.pow(a, regs[base + _operands[2]]);
  // UNARY_NEG
  var dst = _operands[3];
  regs[base + dst] = -regs[base + _operands[4]];
  // EXP
  // Math.pow instead of `**`
  var dst = _operands[5];
  var a = regs[base + _operands[6]];
  regs[base + dst] = Math.pow(a, regs[base + _operands[7]]);
};
VMPrototype[48] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // dst, count, [elemReg...]
  var dst = this.ag({}, {}, [], []);
  var count = this.ag({}, [], 3, "k");
  var elems = new Array(count);
  for (var i = 0; i < count; i++) elems[i] = regs[base + this.ag("y", 96, {}, {})];
  regs[base + dst] = elems;
};
VMPrototype[21] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag({}, {}, null, {});
  var a = regs[base + this.ag(undefined, undefined, 43, {})];
  regs[base + dst] = a >>> regs[base + this.ag(null, [], "x", undefined)];
};
VMPrototype[50] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // obj, key, fn
  var obj = regs[base + this.ag(undefined, {}, 72, "q")];
  var key = regs[base + this.ag(null, null, "k", null)];
  var getterFn = regs[base + this.ag("k", "x", null, 41)];
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
};
VMPrototype[119] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_INT,LOAD_INT,LOAD_INT (macro)
  // LOAD_INT
  var dst = this.ag(null, {}, "x", null);
  regs[base + dst] = this.ag(undefined, undefined, null, 45);
  // LOAD_INT
  var dst = this.ag({}, [], {}, {});
  regs[base + dst] = this.ag(undefined, "x", undefined, {});
  // LOAD_INT
  var dst = this.ag("y", undefined, [], null);
  regs[base + dst] = this.ag(22, null, undefined, {});
};
VMPrototype[142] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ALIAS_LOAD_GLOBAL_2_0_1 (order: [2,0,1])
  let _unsortedOperands = [this.ag([], undefined, 16, null), this.ag("z", undefined, null, 75), this.ag({}, "q", [], [])];
  let _operands = [_unsortedOperands[1], _unsortedOperands[2], _unsortedOperands[0]];
  var dst = _operands[0];
  var globalName = this.x([], _operands[1], {}, _operands[2]);
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
};
VMPrototype[79] = function () {
  var fp = this.C;
  var regs = this.j;
  // JUMP_6386 (specialized)
  regs[fp + 0] = 6386;
};
VMPrototype[35] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag({}, {}, undefined, {});
  regs[base + dst] = ~regs[base + this.ag(54, [], null, 47)];
};
VMPrototype[110] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_THIS_15 (specialized)
  var dst = 15;
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[29] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, undefined, 21, 8);
  var a = regs[base + this.ag("q", null, 96, 88)];
  regs[base + dst] = a != regs[base + this.ag("x", [], undefined, {})];
};
VMPrototype[13] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag("z", [], {}, "k");
  var a = regs[base + this.ag({}, [], [], {})];
  regs[base + dst] = a * regs[base + this.ag({}, undefined, null, [])];
};
VMPrototype[27] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(null, 11, {}, 42);
  var a = regs[base + this.ag([], undefined, "y", undefined)];
  regs[base + dst] = a !== regs[base + this.ag([], 67, undefined, 54)];
};
VMPrototype[121] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST,GET_PROP,LOAD_CONST (macro)
  // LOAD_CONST
  var dst = this.ag("k", undefined, null, null);
  regs[base + dst] = this.x();
  // GET_PROP
  // dst = regs[obj][regs[key]]
  var dst = this.ag([], {}, "k", undefined);
  var obj = regs[base + this.ag([], {}, undefined, null)];
  var key = regs[base + this.ag(undefined, null, "q", undefined)];
  regs[base + dst] = obj[key];
  // LOAD_CONST
  var dst = this.ag("q", [], "y", undefined);
  regs[base + dst] = this.x();
};
VMPrototype[52] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // dst, src — build iterator object from enumerable keys of regs[src]
  var dst = this.ag([], {}, {}, 37);
  var obj = regs[base + this.ag(null, undefined, undefined, [])];
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
    b: keys,
    I: 0
  };
};
VMPrototype[23] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(31, "x", [], "y");
  var a = regs[base + this.ag(75, null, null, {})];
  regs[base + dst] = a > regs[base + this.ag(undefined, "x", "q", {})];
};
VMPrototype[6] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // globals[globalName] = regs[src]
  this.f[this.x()] = regs[base + this.ag([], {}, 59, 72)];
};
VMPrototype[89] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_INT_11_11 (specialized)
  var dst = 11;
  regs[base + dst] = 11;
};
VMPrototype[39] = function () {
  var fp = this.C;
  var regs = this.j;
  regs[fp + 0] = this.ag([], undefined, [], {});
};
VMPrototype[87] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_INT_9_3998684061 (specialized)
  var dst = 9;
  regs[base + dst] = 3998684061;
};
VMPrototype[144] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ALIAS_GET_PROP_1_0_2 (order: [1,0,2])
  let _unsortedOperands = [this.ag([], {}, null, "q"), this.ag({}, [], undefined, null), this.ag(60, undefined, undefined, [])];
  let _operands = [_unsortedOperands[1], _unsortedOperands[0], _unsortedOperands[2]];
  // dst = regs[obj][regs[key]]
  var dst = _operands[0];
  var obj = regs[base + _operands[1]];
  var key = regs[base + _operands[2]];
  regs[base + dst] = obj[key];
};
VMPrototype[75] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_BXOR_11_2_13_1_7_10_9_3_8_5_4_6_12_0 (order: [11,2,13,1,7,10,9,3,8,5,4,6,12,0])
  let _unsortedOperands = [this.ag(undefined, [], [], {}), this.ag({}, null, 70, "q"), this.ag({}, [], {}, "x"), this.ag(40, undefined, undefined, {}), this.ag(50, undefined, undefined, undefined), this.ag([], [], undefined, {}), this.ag("k", [], [], []), this.ag([], null, {}, "q"), this.ag([], "y", "x", []), this.ag({}, [], [], []), this.ag([], {}, null, []), this.ag(null, {}, {}, 8), this.ag(undefined, undefined, "x", "k"), this.ag({}, [], "x", 42)];
  let _operands = [_unsortedOperands[13], _unsortedOperands[3], _unsortedOperands[1], _unsortedOperands[7], _unsortedOperands[10], _unsortedOperands[9], _unsortedOperands[11], _unsortedOperands[4], _unsortedOperands[8], _unsortedOperands[6], _unsortedOperands[5], _unsortedOperands[0], _unsortedOperands[12], _unsortedOperands[2]];
  // LTE
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a <= regs[base + _operands[2]];
  // BAND
  var dst = _operands[3];
  var a = regs[base + _operands[4]];
  regs[base + dst] = a & regs[base + _operands[5]];
  // BXOR
  var dst = _operands[6];
  var a = regs[base + _operands[7]];
  regs[base + dst] = a ^ regs[base + _operands[8]];
  // SHR
  var dst = _operands[9];
  var a = regs[base + _operands[10]];
  regs[base + dst] = a >> regs[base + _operands[11]];
  // MOVE
  var dst = _operands[12];
  regs[base + dst] = regs[base + _operands[13]];
};
VMPrototype[78] = function () {
  var fp = this.C;
  var regs = this.j;
  // JUMP_9717 (specialized)
  regs[fp + 0] = 9717;
};
VMPrototype[103] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_UPVALUE_14_0 (specialized)
  var dst = 14;
  regs[base + dst] = regs[fp + 4].s[0].S(undefined);
};
VMPrototype[140] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ALIAS_LOAD_CONST_1_0_2 (order: [1,0,2])
  let _unsortedOperands = [this.ag("y", null, undefined, "z"), this.ag(56, [], {}, []), this.ag(null, [], {}, 2)];
  let _operands = [_unsortedOperands[1], _unsortedOperands[0], _unsortedOperands[2]];
  var dst = _operands[0];
  regs[base + dst] = this.x(null, _operands[1], "q", _operands[2]);
};
VMPrototype[7] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  var uvIdx = this.ag(undefined, [], {}, undefined);
  regs[fp + 4].s[uvIdx].g(null, 10, regs[base + this.ag("z", null, "x", 12)]);
};
VMPrototype[51] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // obj, key, fn
  var obj = regs[base + this.ag(undefined, 2, 99, {})];
  var key = regs[base + this.ag(null, undefined, [], {})];
  var setterFn = regs[base + this.ag([], 85, 53, [])];
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
};
VMPrototype[116] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_CONST,LOAD_CONST (macro)
  // LOAD_CONST
  var dst = this.ag(null, {}, null, {});
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag([], {}, [], {});
  regs[base + dst] = this.x();
};
VMPrototype[0] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag([], [], undefined, {});
  regs[base + dst] = this.x();
};
VMPrototype[24] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(12, [], [], undefined);
  var a = regs[base + this.ag({}, "x", [], {})];
  regs[base + dst] = a <= regs[base + this.ag({}, {}, null, "y")];
};
VMPrototype[71] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // ANTI_LT_10_0_9_12_8_11_4_6_3_5_1_7_13_14_2 (order: [10,0,9,12,8,11,4,6,3,5,1,7,13,14,2])
  let _unsortedOperands = [this.ag(undefined, {}, 58, "z"), this.ag({}, 34, {}, 18), this.ag("z", "y", 64, []), this.ag(null, 35, {}, "q"), this.ag([], 8, "q", []), this.ag({}, [], null, {}), this.ag(null, 76, "y", {}), this.ag({}, "k", [], []), this.ag([], 95, undefined, "y"), this.ag([], null, 41, {}), this.ag("k", 64, {}, null), this.ag("q", null, 75, undefined), this.ag(null, null, 75, "y"), this.ag("q", null, null, null), this.ag({}, null, "z", {})];
  let _operands = [_unsortedOperands[1], _unsortedOperands[10], _unsortedOperands[14], _unsortedOperands[8], _unsortedOperands[6], _unsortedOperands[9], _unsortedOperands[7], _unsortedOperands[11], _unsortedOperands[4], _unsortedOperands[2], _unsortedOperands[0], _unsortedOperands[5], _unsortedOperands[3], _unsortedOperands[12], _unsortedOperands[13]];
  // LT
  var dst = _operands[0];
  var a = regs[base + _operands[1]];
  regs[base + dst] = a < regs[base + _operands[2]];
  // LOAD_CONST
  var dst = _operands[3];
  regs[base + dst] = this.x({}, _operands[4], undefined, _operands[5]);
  // LT
  var dst = _operands[6];
  var a = regs[base + _operands[7]];
  regs[base + dst] = a < regs[base + _operands[8]];
  // EXP
  // Math.pow instead of `**`
  var dst = _operands[9];
  var a = regs[base + _operands[10]];
  regs[base + dst] = Math.pow(a, regs[base + _operands[11]]);
  // NEQ
  var dst = _operands[12];
  var a = regs[base + _operands[13]];
  regs[base + dst] = a !== regs[base + _operands[14]];
};
VMPrototype[92] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // GET_PROP_18_16_4 (specialized)
  // dst = regs[obj][regs[key]]
  var dst = 18;
  var obj = regs[base + 16];
  var key = regs[base + 4];
  regs[base + dst] = obj[key];
};
VMPrototype[4] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  var dst = this.ag([], [], "q", []);
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[136] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_CONST,LOAD_CONST,LOAD_CONST,LOAD_THIS (macro)
  // LOAD_CONST
  var dst = this.ag(null, null, null, {});
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag({}, undefined, null, "k");
  regs[base + dst] = this.x();
  // LOAD_CONST
  var dst = this.ag([], null, 34, "k");
  regs[base + dst] = this.x();
  // LOAD_THIS
  var dst = this.ag(88, 12, [], {});
  regs[base + dst] = regs[fp + 3];
};
VMPrototype[12] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  var dst = this.ag(undefined, [], undefined, 8);
  var a = regs[base + this.ag({}, 88, {}, undefined)];
  regs[base + dst] = a - regs[base + this.ag("q", "z", [], undefined)];
};
VMPrototype[99] = function () {
  var fp = this.C;
  var regs = this.j;
  // TRY_SETUP_3279_3 (specialized)
  // handlerPc, exceptionReg — push exception handler record onto current
  // frame. The handler stack lives in a header slot and is created on
  // first use, so frames that never try/catch carry nothing.
  var hs = regs[fp + 5];
  if (!hs) regs[fp + 5] = hs = [];
  hs.push({
    aa: 3279,
    H: 3
  });
};
VMPrototype[126] = function () {
  var regs = this.j;
  var base = regs[this.C + 7];
  // LOAD_GLOBAL,LOAD_CONST,GET_PROP,LOAD_CONST,CALL_METHOD (macro)
  // LOAD_GLOBAL
  var dst = this.ag("z", [], null, {});
  var globalName = this.x();
  if (!(globalName in this.f)) {
    throw new ReferenceError(`${globalName} is not defined`);
  }
  regs[base + dst] = this.f[globalName];
  // LOAD_CONST
  var dst = this.ag({}, [], "z", 99);
  regs[base + dst] = this.x();
  // GET_PROP
  // dst = regs[obj][regs[key]]
  var dst = this.ag("x", "z", null, []);
  var obj = regs[base + this.ag([], 70, 14, {})];
  var key = regs[base + this.ag(98, {}, {}, null)];
  regs[base + dst] = obj[key];
  // LOAD_CONST
  var dst = this.ag("k", {}, "q", "x");
  regs[base + dst] = this.x();
  // CALL_METHOD
  // dst, receiverReg, calleeReg, argc, [argReg...]  (argc=SENTINELS.CALL_SPREAD means spread-args array reg)
  var dst = this.ag(null, [], {}, 83);
  var receiver = regs[base + this.ag([], [], {}, {})];
  var callee = regs[base + this.ag(null, undefined, {}, [])];
  var argc = this.ag([], null, undefined, []);
  var args;
  if (argc === 65535) {
    args = regs[base + this.ag(undefined, undefined, 58, 59)];
  } else {
    args = new Array(argc);
    for (var i = 0; i < argc; i++) args[i] = regs[base + this.ag(undefined, {}, "q", [])];
  }
  var closure = callee && CLOSURE_MAP.get(callee);
  if (closure) {
    this.R(closure, dst << 1, args, null, receiver);
  } else {
    regs[base + dst] = callee.apply(receiver, args);
  }
};
VMPrototype[47] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // dst, startPc, paramCount, regCount, uvCount, hasRest, [isLocal, idx, ...]
  var dst = this.ag({}, [], "k", {});
  var startPc = this.ag([], null, "q", undefined);
  var paramCount = this.ag([], {}, null, []);
  var regCount = this.ag(undefined, 57, {}, 45);
  var uvCount = this.ag(67, [], 29, 19);
  var hasRest = this.ag(57, {}, [], {}); // 1 if last param is a rest element

  // 1 if last param is a rest element

  var uvDescs = new Array(uvCount);
  for (var i = 0; i < uvCount; i++) {
    var isLocalRaw = this.ag([], {}, undefined, {});
    var uvIndex = this.ag("x", 80, 45, undefined);
    uvDescs[i] = {
      Z: isLocalRaw,
      l: uvIndex
    };
  }

  // uvDescs is consumed by the capture loop below and then dropped — it
  // is deliberately NOT kept on the descriptor. A closure that carries
  // its capture plan around spells out the closure graph ("captures
  // local 2 of the parent frame") to anything that gets hold of it.
  // uvDescs is consumed by the capture loop below and then dropped — it
  // is deliberately NOT kept on the descriptor. A closure that carries
  // its capture plan around spells out the closure graph ("captures
  // local 2 of the parent frame") to anything that gets hold of it.
  var fn = {
    m: paramCount,
    U: regCount,
    G: startPc,
    w: hasRest
  };
  var closure = new Closure(undefined, fn, "q", 81);
  for (var i = 0; i < uvDescs.length; i++) {
    var uvd = uvDescs[i];
    if (uvd.Z) {
      closure.s.push(this.a({}, uvd.l, [], [], fp, undefined));
    } else {
      closure.s.push(regs[fp + 4].s[uvd.l]);
    }
  }

  // Wrap in a native callable shell so host code (array methods,
  // test assertions, setTimeout, etc.) can invoke VM closures.
  // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
  // Wrap in a native callable shell so host code (array methods,
  // test assertions, setTimeout, etc.) can invoke VM closures.
  // CLOSURE_MAP lets VM-internal CALL/NEW bypass the sub-VM entirely.
  var self = this;
  var shell = function (c) {
    return function () {
      return new VM(undefined, [], self.T, self.y, self.f, "z", undefined).q(95, [], c, null, Array.prototype.slice.call(arguments), this == null ? self.f : this);
    };
  }(closure);
  CLOSURE_MAP.set(shell, closure);
  shell.prototype = closure.prototype; // unified prototype for new/instanceof
  // unified prototype for new/instanceof
  regs[base + dst] = shell;
};
VMPrototype[123] = function () {
  var fp = this.C;
  var regs = this.j;
  var base = regs[fp + 7];
  // LOAD_THIS,LOAD_CONST (macro)
  // LOAD_THIS
  var dst = this.ag("x", 31, null, {});
  regs[base + dst] = regs[fp + 3];
  // LOAD_CONST
  var dst = this.ag([], undefined, [], {});
  regs[base + dst] = this.x();
};
var globals = globalThis;
if (typeof window !== "undefined") {
  globals.window = window;
  globals.document = typeof document !== "undefined" ? document : undefined;
}
if (typeof module !== "undefined") {
  globals.module = module;
  globals.exports = typeof exports !== "undefined" ? exports : undefined;
}
var vm = new VM({}, "q", CONSTANTS, decodeBytecode("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TQAAAE8AAABzAAAASQAAAHmhf8NOAAAA36hgT0IAAABQAAAAUAAAAAEAAABQAAAAUAAAAFAAAABOAAAASQAAAE4AAABDAAAAUAAAAFAAAABQAAAATgAAAFAAAABNAAAAwkT8L08AAABPAAAATgAAAF0AAABEAAAATgAAAEkAAABQAAAATwAAAFAAAABQAAAATwAAAE8AAABQAAAASQAAAFAAAABQAAAATwAAAIsAAABHeDvcSgAAAE8AAABzAAAASQAAALxURflKAAAAk0iKek8AAACMAAAAXgAAABgAAACi4dR/RAAAABgAAAATAAAATwAAAE8AAABPAAAATwAAAFAAAABPAAAATwAAABkAAABPAAAATwAAAE8AAAA9AAAATwAAAFAAAABQAAAAUAAAAE8AAABPAAAAGQAAAFAAAABPAAAAEwAAAE8AAAAaQlmvTwAAAF8AAABFAAAATwAAABoAAAARAAAAEwAAAFAAAABQAAAAUAAAAFAAAABAAAAAGgAAAE8AAABPAAAATQAAAE8AAABQAAAATwAAAFAAAABBAAAAUAAAAE0AAABQAAAATwAAAE8AAABQAAAATQAAAE8AAABzAAAASQAAAG/ql3FOAAAA1fF4/UIAAABQAAAATwAAAAIAAABQAAAATwAAAE8AAABOAAAASQAAAE4AAABDAAAAUAAAAE8AAABQAAAATgAAAE8AAABOAAAAkEF+lE8AAABPAAAATQAAAGAAAABEAAAATgAAAEkAAABQAAAAUAAAAFAAAABQAAAATwAAAE8AAABPAAAASQAAAE8AAABQAAAATwAAAIsAAAAwOObJSgAAAE8AAABzAAAASQAAAIjerkpKAAAAwAhuNk8AAACMAAAAYQAAABsAAABJkmjhRAAAABsAAAATAAAATwAAAE8AAABPAAAATwAAAE8AAABPAAAATwAAABwAAABQAAAATwAAAE8AAAA9AAAATwAAAFAAAABPAAAAUAAAAE8AAABQAAAAHAAAAE8AAABPAAAAEwAAAE8AAADZVMQAUAAAAGIAAABFAAAAUAAAAB0AAAARAAAAEwAAAE8AAABQAAAAUAAAAFAAAABAAAAAHQAAAE8AAABQAAAATQAAAFAAAABPAAAAUAAAAE8AAABBAAAAUAAAAE0AAABQAAAATwAAAE8AAABPAAAATQAAAE8AAAA+AAAA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QAAAAC8AAABPAAAAUAAAAE0AAABQAAAATwAAAE8AAABQAAAAQQAAAE8AAABNAAAATwAAAE8AAABPAAAATwAAAE0AAABQAAAAcwAAAEkAAACi4NlcTgAAAAjouuhCAAAATwAAAE8AAAACAAAATwAAAE8AAABQAAAATgAAAEkAAABOAAAAQwAAAFAAAABQAAAATwAAAE4AAABPAAAATgAAABc2VVFPAAAATwAAAE0AAABxAAAARAAAAE4AAABJAAAAUAAAAFAAAABPAAAATwAAAE8AAABQAAAATwAAAEkAAABPAAAAUAAAAFAAAACLAAAA8vdoWEoAAABPAAAAcwAAAEkAAADevPJGSgAAALQV5g9PAAAAjAAAAHIAAAAwAAAASlAWREIAAABQAAAAUAAAAAAAAABPAAAAUAAAAFAAAAATAAAAMAAAADEAAAA9AAAAUAAAAFAAAABQAAAATwAAAE8AAABQAAAAMQAAAFAAAABPAAAAEwAAAFAAAADThTv9UAAAAHMAAABFAAAAUAAAADIAAAARAAAAEwAAAFAAAABPAAAAUAAAAFAAAABAAAAAMgAAAE8AAABPAAAATQAAAE8AAABQAAAATwAAAFAAAABBAAAAUAAAAE0AAABPAAAAUAAAAE8AAABQAAAATQAAAE8AAABzAAAASQAAANwSrx9OAAAAQhqQq0IAAABPAAAAUAAAAAAAAABQAAAATwAAAE8AAABOAAAASQAAAE4AAABDAAAATwAAAE8AAABPAAAATgAAAE8AAABOAAAAbUWQbU8AAABPAAAATQAAAHQAAABEAAAATgAAAEkAAABPAAAATwAAAE8AAABQAAAATwAAAFAAAABQAAAASQAAAE8AAABPAAAAUAAAAIsAAABTdGspSgAAAE8AAABzAAAASQAAANOY52JKAAAA130zK08AAACMAAAAdQAAADMAAACiWR1yRAAAADMAAAATAAAAUAAAAFAAAABQAAAAUAAAAFAAAABQAAAAUAAAADQAAABQAAAAUAAAAE8AAAA9AAAAUAAAAFAAAABQAAAATwAAAE8AAABQAAAANAAAAE8AAABQAAAAEwAAAFAAAAADl3LNUAAAAHYAAABFAAAATwAAADUAAAARAAAAEwAAAFAAAABPAAAATwAAAE8AAABAAAAANQAAAFAAAABQAAAATQAAAFAAAABPAAAA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EwAAAD8AAABAAAAAPQAAAE8AAABPAAAATwAAAFAAAABPAAAATwAAAEAAAABPAAAATwAAABMAAABPAAAA95Bq+U8AAAB+AAAARQAAAFAAAABBAAAAEQAAABMAAABQAAAATwAAAFAAAABQAAAAQAAAAEEAAABPAAAATwAAAE0AAABQAAAAUAAAAE8AAABPAAAAQQAAAE8AAABNAAAATwAAAE8AAABQAAAAUAAAAE0AAABPAAAAPgAAAFAAAABPAAAATQAAAE8AAABQAAAATwAAAE0AAABPAAAAcwAAAEkAAAC+rVoYTgAAACS1O6RCAAAAUAAAAE8AAAABAAAAUAAAAFAAAABPAAAATgAAAEkAAABOAAAARgAAAFAAAABPAAAAUAAAAE8AAABPAAAATwAAAFAAAABQAAAAUAAAAE4AAABQAAAATQAAAE4AAABEAAAATgAAAEkAAABQAAAAUAAAAFAAAABQAAAATwAAAE8AAABQAAAASQAAAFAAAABPAAAAUAAAAIsAAACvxIdgSgAAAE8AAABzAAAASQAAAE8o64NKAAAAoCCBJ08AAACMAAAAfwAAAEIAAAAC+JS2QgAAAE8AAABPAAAAAAAAAE8AAABPAAAAUAAAABMAAABCAAAAQwAAAD0AAABQAAAAUAAAAE8AAABQAAAATwAAAFAAAABDAAAAUAAAAFAAAAATAAAATwAAAOVvbBtPAAAAgAAAAEUAAABQAAAARAAAABEAAAATAAAATwAAAE8AAABPAAAATwAAAEAAAABEAAAATwAAAE8AAABNAAAATwAAAFAAAABPAAAATwAAAEEAAABPAAAATQAAAE8AAABPAAAATwAAAFAAAABNAAAAUAAAAHMAAABJAAAAzJgjwU4AAAAyoARNQgAAAFAAAABQAAAAAgAAAE8AAABPAAAATwAAAE4AAABJAAAATgAAAEMAAABPAAAAUAAAAFAAAABOAAAATwAAAE4AAAAFjXpMTwAAAE8AAABNAAAAgQAAAEQAAABOAAAASQAAAFAAAABQAAAATwAAAFAAAABQAAAATwAAAE8AAABJAAAAUAAAAFAAAABQAAAAiwAAADyIlktKAAAATwAAAHMAAABJAAAAB+2YbkoAAADI+KECTwAAAIwAAACCAAAARQAAAONfZN5CAAAAUAAAAFAAAAAAAAAATwAAAE8AAABQAAAA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INtCZkoAAABWwuVoTwAAAIsAAAB5BwAASAAAAEIAAABPAAAATwAAAAIAAABPAAAATwAAAE8AAAARAAAASAAAABEAAABzAAAASQAAAITwhxlKAAAA8qygtU8AAACPAAAAAgAAAI4AAADTN+bxUQAAAI0AAAAqAAAABgAAAFEAAAABAAAAAAAAAIsAAADJLwAASAAAAEIAAABQAAAAUAAAAAEAAABPAAAAUAAAAFAAAAARAAAASAAAABEAAABzAAAASQAAAJsBwCNKAAAA25toq08AAACMAAAAjgAAAFEAAABQ2HCORAAAAFEAAAAFAAAATwAAAE8AAABQAAAATwAAAFAAAABQAAAATwAAAFIAAABPAAAATwAAAE8AAAA9AAAATwAAAE8AAABPAAAATwAAAE8AAABQAAAAUgAAAFAAAABQAAAABQAAAE8AAABtUrW4TwAAAI8AAACLAAAAd6EAAEgAAABEAAAASAAAABEAAABPAAAATwAAAE8AAABPAAAATwAAAFAAAABQAAAAEQAAAE8AAABPAAAATwAAAHMAAABJAAAAoEBN10oAAADWXNv3TwAAAEQAAAANAAAABQAAAE8AAABQAAAAUAAAAE8AAABQAAAAUAAAAFAAAABRAAAATwAAAFAAAABQAAAAKwAAAAwAAAADAAAACwAAAAEAAABRAAAAdQAAAA4AAACQAAAAiTBwckgAAAA3BQAARAAAAEgAAAARAAAATwAAAFAAAABPAAAAUAAAAFAAAABQAAAAUAAAABEAAABQAAAATwAAAE8AAABzAAAASQAAAOBUxDNKAAAAlkhkm08AAACNAAAABAAAAHYAAABRAAAAkQAAACUmxBhSAAAAAwAAAFEAAABHAAAATwAAAFEAAABPAAAATwAAAE8AAABPAAAAkgAAAE8AAABPAAAA5hCNbQUAAABPAAAATwAAAE8AAABSAAAAQAAAAFEAAABPAAAATwAAAE0AAABQAAAAUAAAAFAAAABPAAAAQQAAAE8AAABNAAAAUAAAAE8AAABPAAAATwAAAE0AAABPAAAAPgAAAE8AAABQAAAATQAAAFAAAABPAAAATwAAAE0AAABPAAAAcwAAAEkAAABiVH02TgAAAJ9n31BCAAAATwAAAE8AAAAAAAAAUAAAAE8AAABPAAAATgAAAEkAAABOAAAARgAAAFAAAABPAAAA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"), globals, undefined, undefined);
vm.q([], "q", new Closure(undefined, {
  m: 0,
  U: 19,
  G: 0
}, "z", "z"), {}, null // no arguments object / parameter setup for the root frame
, undefined);