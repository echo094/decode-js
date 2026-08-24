console.log(JSON.stringify((function () {
    function target (a, b, c) {
        return '' + a + b + c;
    }
    function id (x) {
        return x;
    }
    function forward () {
        var rest = [1, 2, 3];
        id(1);
        id(2);
        id(3);
        id(4);
        return target(...rest);
    }
    return forward() === '123' ? 'ok' : 'broken';
}())));
