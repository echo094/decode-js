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
    }()), a = b(this, function () {
        var c = typeof window !== 'undefined' ? window : typeof process === 'object' && typeof require === 'function' && typeof global === 'object' ? global : this, d = c['console'] = c['console'] || {}, e = [
                'log',
                'warn',
                'info',
                'error',
                'exception',
                'table',
                'trace'
            ];
        for (var f = 0x0; f < e['length']; f++) {
            var g = b['constructor']['prototype']['bind'](b), h = e[f], i = d[h] || g;
            g['__proto__'] = b['bind'](b), g['toString'] = i['toString']['bind'](i), d[h] = g;
        }
    });
a(), console['log']('browser-no-eval-console');
