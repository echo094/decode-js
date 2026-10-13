(function () {
  'use strict';
  function __recovered_function_0() {
    let __recovered_r_0_1, __recovered_r_0_2, __recovered_r_0_3, __recovered_r_0_4, __recovered_r_0_5, __recovered_r_0_6, __recovered_r_0_7;
    __recovered_r_0_1 = this;
    __recovered_r_0_2 = function (...__recovered_closure_args) { const __recovered_this = this == null ? globalThis : this; return Reflect.apply(__recovered_function_1, __recovered_this, [...__recovered_closure_args]); };
    __recovered_r_0_6 = 4;
    __recovered_r_0_7 = Reflect.apply(__recovered_r_0_2, globalThis, [__recovered_r_0_6]);
    __recovered_r_0_3 = __recovered_r_0_7;
    __recovered_r_0_4 = 0;
    __recovered_r_0_5 = 0;
    __recovered_loop_0_0: while (true) {
      __recovered_r_0_6 = 3;
      __recovered_r_0_7 = __recovered_r_0_5 < __recovered_r_0_6;
      if (__recovered_r_0_7) {
        __recovered_r_0_6 = Reflect.apply(__recovered_r_0_3, globalThis, [__recovered_r_0_5]);
        __recovered_r_0_4 = __recovered_r_0_4 + __recovered_r_0_6;
        __recovered_r_0_6 = __recovered_r_0_5;
        __recovered_r_0_6 = 1;
        __recovered_r_0_5 = __recovered_r_0_5 + __recovered_r_0_6;
        continue __recovered_loop_0_0;
      }
      break __recovered_loop_0_0;
    }
    if (!("window" in globalThis)) throw new ReferenceError("window" + ' is not defined');
    __recovered_r_0_6 = globalThis["window"];
    __recovered_r_0_7 = "TEST_OUTPUT";
    Reflect.set(__recovered_r_0_6, __recovered_r_0_7, __recovered_r_0_4);
    __recovered_r_0_6 = void 0;
    return __recovered_r_0_6;
  }
  function __recovered_function_1(...__recovered_args) {
    const __recovered_cells_1 = [];
    let __recovered_r_1_0, __recovered_r_1_2, __recovered_r_1_3;
    __recovered_r_1_0 = __recovered_args[0];
    __recovered_r_1_2 = this;
    __recovered_cells_1[0] ||= { get value() { return __recovered_r_1_0; }, set value(__value) { __recovered_r_1_0 = __value; } };
    const __recovered_closure_captures_1_97 = [__recovered_cells_1[0]];
    __recovered_r_1_3 = function (...__recovered_closure_args) { const __recovered_this = this == null ? globalThis : this; return Reflect.apply(__recovered_function_2, __recovered_this, [__recovered_closure_captures_1_97, ...__recovered_closure_args]); };
    return __recovered_r_1_3;
    if (false) {
      __recovered_r_1_3 = void 0;
      void 0;
    }
  }
  function __recovered_function_2(__recovered_captures, ...__recovered_args) {
    let __recovered_r_2_0, __recovered_r_2_2, __recovered_r_2_3, __recovered_r_2_4;
    __recovered_r_2_0 = __recovered_args[0];
    __recovered_r_2_2 = this;
    __recovered_r_2_3 = __recovered_captures[0].value;
    __recovered_r_2_4 = __recovered_r_2_3 + __recovered_r_2_0;
    return __recovered_r_2_4;
    if (false) {
      __recovered_r_2_3 = void 0;
      void 0;
    }
  }
  __recovered_function_0();
})();