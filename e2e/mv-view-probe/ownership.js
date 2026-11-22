// Diagnostic workflow ownership, not a second player or a product entry point.
let serial = 0;

function createProbeOwner(native) {
    const id = ++serial;
    let live = true;
    const isCurrent = () => live && serial === id;
    const check = () => {
        if (!isCurrent()) {
            const error = new Error("MV probe owner was superseded");
            error.code = "probe-owner-cancelled";
            throw error;
        }
    };
    const bridge = Object.fromEntries(Object.entries(native).map(([name, method]) => [
        name,
        typeof method === "function" ? (...args) => {
            check();
            return method.apply(native, args);
        } : method,
    ]));
    const until = async (test, message, timeout = 15000) => {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            check();
            const ready = await test();
            check();
            if (ready) return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        check();
        throw new Error(message);
    };
    return { id, bridge, check, isCurrent, until, dispose: () => {
        if (!live) return Promise.resolve();
        live = false;
        return Promise.resolve().then(() => {
            if (serial === id) return native.destroy();
        });
    } };
}

module.exports = { createProbeOwner };
