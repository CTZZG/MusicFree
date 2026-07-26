import BackendListenerLifecycle from "../backendListenerLifecycle";

describe("BackendListenerLifecycle", () => {
    it("registers one listener set until it is disposed", () => {
        const lifecycle = new BackendListenerLifecycle();
        const remove = jest.fn();

        expect(lifecycle.begin()).toBe(true);
        lifecycle.add(() => ({ remove }));
        lifecycle.commit();

        expect(lifecycle.isInitialized).toBe(true);
        expect(lifecycle.size).toBe(1);
        expect(lifecycle.begin()).toBe(false);

        lifecycle.dispose();
        lifecycle.dispose();
        expect(remove).toHaveBeenCalledTimes(1);
        expect(lifecycle.isInitialized).toBe(false);
        expect(lifecycle.size).toBe(0);
    });

    it("supports init, dispose, and init without duplicate callbacks", () => {
        const lifecycle = new BackendListenerLifecycle();
        const listeners = new Set<() => void>();
        const callback = jest.fn();
        const register = () => {
            listeners.add(callback);
            return {
                remove() {
                    listeners.delete(callback);
                },
            };
        };

        lifecycle.begin();
        lifecycle.add(register);
        lifecycle.commit();
        listeners.forEach(listener => listener());

        lifecycle.dispose();
        listeners.forEach(listener => listener());

        lifecycle.begin();
        lifecycle.add(register);
        lifecycle.commit();
        listeners.forEach(listener => listener());

        expect(callback).toHaveBeenCalledTimes(2);
        expect(listeners.size).toBe(1);
    });

    it("rolls back earlier listeners when registration fails", () => {
        const lifecycle = new BackendListenerLifecycle();
        const remove = jest.fn();

        lifecycle.begin();
        lifecycle.add(() => ({ remove }));
        expect(() => lifecycle.add(() => {
            throw new Error("registration failed");
        })).toThrow("registration failed");

        expect(remove).toHaveBeenCalledTimes(1);
        expect(lifecycle.isInitialized).toBe(false);
        expect(lifecycle.size).toBe(0);
    });

    it("manages non-backend cleanup callbacks in the same transaction", () => {
        const lifecycle = new BackendListenerLifecycle();
        const cleanup = jest.fn();

        lifecycle.begin();
        lifecycle.addCleanup(() => cleanup);
        lifecycle.commit();
        lifecycle.dispose();

        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
