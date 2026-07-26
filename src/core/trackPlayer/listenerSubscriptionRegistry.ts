import type { PlayerAdapterSubscription } from "@/core/playerAdapter";

export default class ListenerSubscriptionRegistry {
    private subscriptions: PlayerAdapterSubscription[] = [];

    add(subscription: PlayerAdapterSubscription) {
        this.subscriptions.push(subscription);
        return subscription;
    }

    clear() {
        const subscriptions = this.subscriptions;
        this.subscriptions = [];
        for (const subscription of subscriptions.reverse()) {
            try {
                subscription.remove();
            } catch {
                // Continue releasing the remaining listeners.
            }
        }
    }

    get size() {
        return this.subscriptions.length;
    }
}
