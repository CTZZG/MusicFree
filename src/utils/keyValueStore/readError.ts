/** A failed read must never be treated as an empty, writable store. */
export class StoreReadError extends Error {
    constructor(readonly storeId: string, readonly reason: string) {
        super(`Stored data could not be read (${storeId})`);
        this.name = "StoreReadError";
    }
}
