var result = [];
try { throw "boom"; } catch (error) { result.push({ type: typeof error, value: error }); }
try { throw new Error("bad"); } catch (error) { result.push({ type: error.name, message: error.message }); }
throw { kind: "uncaught", caught: result };
