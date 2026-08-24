console['log']('browser-no-eval-decline-condition'), function () {
  var c = typeof window !== 'undefined' ? window : typeof process === 'object' && typeof require === 'object' && typeof global === 'object' ? global : this;
}();
