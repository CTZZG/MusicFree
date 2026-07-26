import { createRestrictedHttpClient } from "../restrictedHttpClient";

function response(
    data: unknown,
    responseURL = "https://example.com/resource",
) {
    return {
        data,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
        request: { responseURL },
    } as any;
}

describe("createRestrictedHttpClient", () => {
    it.each([
        "http://example.com/resource",
        "https://localhost/resource",
        "https://127.0.0.1/resource",
        "https://10.0.0.1/resource",
        "file:///tmp/resource",
    ])("rejects unsafe request URLs before transport: %s", async url => {
        const requester = jest.fn();
        const client = createRestrictedHttpClient({ requester });

        await expect(client.get(url)).rejects.toThrow();
        expect(requester).not.toHaveBeenCalled();
    });

    it("allows HTTP only for an explicitly opted-in client", async () => {
        const requester = jest.fn(async (url: string) =>
            response("ok", url));
        const defaultClient = createRestrictedHttpClient({ requester });
        const httpClient = createRestrictedHttpClient({
            allowHttp: true,
            requester,
        });

        await expect(
            defaultClient.get("http://example.com/resource"),
        ).rejects.toThrow("HTTPS");
        await expect(
            httpClient.get("http://example.com/resource"),
        ).resolves.toMatchObject({ data: "ok" });
        expect(requester).toHaveBeenCalledTimes(1);
    });


    it("forces bounded transport options and keeps the axios call shape", async () => {
        const requester = jest.fn(async (
            _url: string,
            _config: unknown,
        ) => response({ ok: true }));
        const client = createRestrictedHttpClient({ requester });

        await expect(client("https://example.com/resource", {
            method: "POST",
            timeout: 60_000,
            maxRedirects: 20,
            adapter: jest.fn(),
            data: "hello",
        })).resolves.toMatchObject({ data: { ok: true } });

        expect(requester).toHaveBeenCalledWith(
            "https://example.com/resource",
            expect.objectContaining({
                method: "POST",
                timeout: 15_000,
                maxRedirects: 0,
                withCredentials: false,
                adapter: "fetch",
                fetchOptions: {
                    redirect: "error",
                },
            }),
        );
        expect(
            (requester.mock.calls[0][1] as { adapter?: string }).adapter,
        ).toBe("fetch");
    });

    it("rejects oversized request and response bodies", async () => {
        const requester = jest.fn(async (
            _url: string,
            _config: unknown,
        ) => response("12345"));
        const client = createRestrictedHttpClient({
            requester,
            maxRequestBytes: 4,
            maxResponseBytes: 4,
        });

        await expect(
            client.post("https://example.com/resource", "12345"),
        ).rejects.toThrow("request body");
        expect(requester).not.toHaveBeenCalled();

        await expect(
            client.get("https://example.com/resource"),
        ).rejects.toThrow("response body");
    });

    it("limits concurrent transports", async () => {
        const releases: Array<() => void> = [];
        const requester = jest.fn((
            _url: string,
            _config: unknown,
        ) => new Promise<any>(resolve => {
            releases.push(() => resolve(response("ok")));
        }));
        const client = createRestrictedHttpClient({
            requester,
            maxConcurrency: 2,
        });

        const requests = [
            client.get("https://example.com/resource"),
            client.get("https://example.com/resource"),
            client.get("https://example.com/resource"),
        ];
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(requester).toHaveBeenCalledTimes(2);
        releases.shift()?.();
        await requests[0];
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(requester).toHaveBeenCalledTimes(3);
        releases.splice(0).forEach(release => release());
        await expect(Promise.all(requests)).resolves.toHaveLength(3);
    });

    it("keeps interceptors and defaults isolated between clients", async () => {
        const requester = jest.fn(async (
            _url: string,
            _config: unknown,
        ) => response("ok"));
        const first = createRestrictedHttpClient({ requester });
        const second = createRestrictedHttpClient({ requester });
        first.defaults.headers["x-plugin"] = "first";
        first.interceptors.request.use((config: any) => ({
            ...config,
            headers: { ...config.headers, "x-interceptor": "first" },
        }));

        await first.get("https://example.com/resource");
        await second.get("https://example.com/resource");

        expect((requester.mock.calls[0][1] as any).headers).toMatchObject({
            "x-plugin": "first",
            "x-interceptor": "first",
        });
        expect((requester.mock.calls[1][1] as any).headers).not.toHaveProperty(
            "x-plugin",
        );
    });

    // Regression: the final-URL check used to compare the response URL against
    // the request URL as a whole string. axios serializes `params` into the
    // query, so the reported final URL never matched and EVERY query request
    // -- built-in NetEase/LRCLIB lyric lookups included -- threw
    // "Unverified transport redirects are not allowed". The previous tests all
    // echoed the bare URL back, which hid it.
    it("accepts a final URL that differs only by serialized query params", async () => {
        const requester = jest.fn(async (url: string, config: any) => {
            const query = new URLSearchParams(config.params).toString();
            return response("ok", query ? `${url}?${query}` : url);
        });
        const client = createRestrictedHttpClient({ requester });

        await expect(
            client.get("https://example.com/resource", {
                params: { keyword: "music", page: 2 },
            }),
        ).resolves.toMatchObject({ data: "ok" });
        expect(requester).toHaveBeenCalledTimes(1);
    });

    it("still rejects a final URL on a different origin", async () => {
        const requester = jest.fn(async () =>
            response("ok", "https://evil.example.net/resource"));
        const client = createRestrictedHttpClient({ requester });

        await expect(
            client.get("https://example.com/resource"),
        ).rejects.toThrow("Unverified transport redirects are not allowed");
    });
});
