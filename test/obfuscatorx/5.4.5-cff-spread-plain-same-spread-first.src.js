console.log(JSON.stringify((function () {
    function target (a, b, c) {
        return '' + a + b + c;
    }
    function id (x) {
        return x;
    }
    function forward () {
        var rest = [1, 2, 3];
        var spreadValue = target(...rest);
        return spreadValue === '123' && id(1) === 1 ? 'ok' : 'broken';
    }
    return forward();
}())));
