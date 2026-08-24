var b = (function () {
    var c = !![];
    return function (d, e) {
        var f = c ? function () {
            if (e) {
                var g = e['apply'](d, arguments);
                return e = null, g;
            }
        } : function () {
        };
        return c = ![], f;
    };
}());
(function () {
    b(this, function () {
        var c = new RegExp('function\x20*\x5c(\x20*\x5c)'), d = new RegExp('\x5c+\x5c+\x20*(?:[a-zA-Z_$][0-9a-zA-Z_$]*)', 'i'), e = a('init');
        !c['test'](e + 'chain') || !d['test'](e + 'input') ? e('0') : a();
    })();
}()), console['log']('browser-no-eval-decline-condition'), (function () {
    var c = typeof window !== 'undefined' ? window : typeof process === 'object' && typeof require === 'object' && typeof global === 'object' ? global : this;
    c['setInterval'](a, 0xfa0);
}());
function a(c) {
    function d(e) {
        if (typeof e === 'string') {
            var f = function () {
                while (!![]) {
                }
            };
            return f();
        } else {
            if (('' + e / e)['length'] !== 0x1 || e % 0x14 === 0x0)
                debugger;
            else
                debugger;
        }
        d(++e);
    }
    try {
        if (c)
            return d;
        else
            d(0x0);
    } catch (e) {
    }
}
