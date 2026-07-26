import type { PlayerAdapterSubscription } from "@/core/playerAdapter";
import ListenerSubscriptionRegistry from "./listenerSubscriptionRegistry";

export default class BackendListenerLifecycle {
    private readonly subscriptions = new ListenerSubscriptionRegistry();
    private initialized = false;

    begin() {
        if (this.initialized) {
            return false;
        }
        this.subscriptions.clear();
        return true;
    }

    add(factory: () => PlayerAdapterSubscription) {
        try {
            this.subscriptions.add(factory());
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    addCleanup(factory: () => () => void) {
        this.add(() => ({ remove: factory() }));
    }

    commit() {
        this.initialized = true;
    }

    dispose() {
        this.subscriptions.clear();
        this.initialized = false;
    }

    get isInitialized() {
        return this.initialized;
    }

    get size() {
        return this.subscriptions.size;
    }
}
