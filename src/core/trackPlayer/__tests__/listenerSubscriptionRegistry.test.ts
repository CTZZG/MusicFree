import ListenerSubscriptionRegistry from "../listenerSubscriptionRegistry";

describe("ListenerSubscriptionRegistry", () => {
    it("removes every subscription once and is idempotent", () => {
        const registry = new ListenerSubscriptionRegistry();
        const firstRemove = jest.fn();
        const secondRemove = jest.fn();
        registry.add({ remove: firstRemove });
        registry.add({ remove: secondRemove });

        expect(registry.size).toBe(2);
        registry.clear();
        registry.clear();

        expect(firstRemove).toHaveBeenCalledTimes(1);
        expect(secondRemove).toHaveBeenCalledTimes(1);
        expect(registry.size).toBe(0);
    });

    it("continues cleanup when one subscription throws", () => {
        const registry = new ListenerSubscriptionRegistry();
        const survivingRemove = jest.fn();
        registry.add({ remove: survivingRemove });
        registry.add({
            remove() {
                throw new Error("native listener already gone");
            },
        });

        expect(() => registry.clear()).not.toThrow();
        expect(survivingRemove).toHaveBeenCalledTimes(1);
    });
});
