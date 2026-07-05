export interface ISearchRequestToken {
    key: string;
    id: number;
    signature?: string;
}

export class SearchRequestGuard {
    private nextId = 0;
    private activeRequests = new Map<string, number>();
    private inFlightRequests = new Set<string>();

    begin(key: string, signature?: string): ISearchRequestToken {
        const id = ++this.nextId;
        this.activeRequests.set(key, id);
        if (signature) {
            this.inFlightRequests.add(signature);
        }
        return { key, id, signature };
    }

    isCurrent(token: ISearchRequestToken) {
        return this.activeRequests.get(token.key) === token.id;
    }

    isInFlight(signature: string) {
        return this.inFlightRequests.has(signature);
    }

    finish(token: ISearchRequestToken) {
        if (token.signature) {
            this.inFlightRequests.delete(token.signature);
        }
    }

    reset() {
        this.nextId = 0;
        this.activeRequests.clear();
        this.inFlightRequests.clear();
    }
}

export function getSearchRequestKey(
    type: ICommon.SupportMediaType,
    pluginHash: string,
) {
    return `${type}:${pluginHash}`;
}

export function getSearchRequestSignature(
    type: ICommon.SupportMediaType,
    pluginHash: string,
    query: string,
    page: number,
) {
    return `${getSearchRequestKey(type, pluginHash)}:${page}:${query}`;
}

export const searchRequestGuard = new SearchRequestGuard();
