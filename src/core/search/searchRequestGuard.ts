export interface ISearchRequestToken {
    key: string;
    id: number;
    signature?: string;
}

/**
 * 搜索请求的身份登记。
 *
 * - key（类型 + 来源）：同一个 key 只有最近一次 begin 的请求是当前请求，
 *   旧请求返回时应丢弃结果和错误；
 * - signature（key + 页码 + 关键词）：识别完全相同且仍在进行中的请求，避免重复发起。
 */
export class SearchRequestGuard {
    private nextId = 0;
    private activeRequests = new Map<string, number>();
    private inFlightRequests = new Map<string, number>();

    begin(key: string, signature?: string): ISearchRequestToken {
        const id = ++this.nextId;
        this.activeRequests.set(key, id);
        if (signature) {
            this.inFlightRequests.set(signature, id);
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
        // reset 之后同一个 signature 可能已被新请求登记，只清理自己登记的那一份
        if (
            token.signature &&
            this.inFlightRequests.get(token.signature) === token.id
        ) {
            this.inFlightRequests.delete(token.signature);
        }
    }

    /** 让之前登记的全部请求失效。id 不回绕，旧 token 不会与之后的请求撞号。 */
    reset() {
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
