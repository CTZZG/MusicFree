import { createLxRequest } from "../runtime";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";

jest.mock("react-native-url-polyfill", () => ({
    URL,
    URLSearchParams,
}));

jest.mock("react-native-device-info", () => ({
    __esModule: true,
    default: {
        getVersion: () => "0.0.0-test",
    },
}));

jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
}));

describe("LX runtime request boundary", () => {
    it("rejects private URLs before invoking transport", async () => {
        const requester = jest.fn();
        const request = createLxRequest(
            createRestrictedHttpClient({ requester }),
        );
        const callback = jest.fn();

        request("https://127.0.0.1/private", {}, callback);
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(requester).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalledWith(expect.any(Error));
    });

    it("preserves request.js callback response shape", async () => {
        const requester = jest.fn(async () => ({
            data: "body",
            status: 403,
            statusText: "Forbidden",
            headers: { "x-test": "yes" },
            config: {},
            request: { responseURL: "https://example.com/api" },
        }) as any);
        const request = createLxRequest(
            createRestrictedHttpClient({ requester }),
        );

        await new Promise<void>((resolve, reject) => {
            request(
                "https://example.com/api",
                { method: "post", body: "payload" },
                (error, response, body) => {
                    try {
                        expect(error).toBeNull();
                        expect(response).toEqual({
                            statusCode: 403,
                            status: 403,
                            headers: { "x-test": "yes" },
                            body: "body",
                        });
                        expect(body).toBe("body");
                        resolve();
                    } catch (assertionError) {
                        reject(assertionError);
                    }
                },
            );
        });
    });

    it("returns an abort function wired to the transport signal", async () => {
        let signal: AbortSignal | undefined;
        const requester = jest.fn((
            _url: string,
            config: any,
        ) => {
            signal = config.signal;
            return new Promise<any>(() => {});
        });
        const request = createLxRequest(
            createRestrictedHttpClient({ requester }),
        );

        const abort = request("https://example.com/api", {}, jest.fn());
        await new Promise(resolve => setTimeout(resolve, 0));
        abort();

        expect(signal?.aborted).toBe(true);
    });
});
