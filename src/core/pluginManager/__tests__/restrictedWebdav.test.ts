import { createRestrictedWebdavFacade } from "../restrictedWebdav";

function createModule() {
    const client = {
        copyFile: jest.fn(async () => true),
        createDirectory: jest.fn(async () => true),
        deleteFile: jest.fn(async () => true),
        exists: jest.fn(async () => true),
        getDirectoryContents: jest.fn(async () => []),
        getFileContents: jest.fn(async () => "content"),
        getQuota: jest.fn(async () => ({ used: 1, available: 2 })),
        moveFile: jest.fn(async () => true),
        putFileContents: jest.fn(async () => true),
        stat: jest.fn(async () => ({ type: "file" })),
        customRequest: jest.fn(async () => "raw"),
    };
    const patcher = {
        patch: jest.fn(),
    };
    const module = {
        AuthType: { Password: "password" },
        createClient: jest.fn((
            _url: string,
            _options?: Record<string, unknown>,
        ) => client),
        getPatcher: () => patcher,
    };
    return { client, module, patcher };
}

function transportResponse(
    url: string,
    status = 200,
    headers: Record<string, string> = {},
) {
    return {
        data: new ArrayBuffer(0),
        status,
        statusText: status >= 300 ? "Redirect" : "OK",
        headers,
        config: {},
        request: { url },
    } as any;
}

describe("restricted WebDAV facade", () => {
    it("rejects insecure and private origins before creating a client", () => {
        const { module } = createModule();
        const facade = createRestrictedWebdavFacade(module);

        expect(() => facade.createClient("http://example.com")).toThrow();
        expect(() => facade.createClient("https://127.0.0.1")).toThrow();
        expect(module.createClient).not.toHaveBeenCalled();
    });

    it("allows private and HTTP origins only for the user-configured facade", () => {
        const pluginModule = createModule().module;
        const userModule = createModule().module;

        const pluginFacade = createRestrictedWebdavFacade(pluginModule);
        const userFacade = createRestrictedWebdavFacade(userModule, {
            allowHttp: true,
            allowPrivateHosts: true,
            // HTTP 与 HTTPS 现在共用同一个 requester（专用原生桥已删除）。
            transportRequester: async url => transportResponse(url),
        });

        expect(() => pluginFacade.createClient(
            "https://192.168.1.20/dav",
        )).toThrow();
        expect(() => userFacade.createClient(
            "https://192.168.1.20/dav",
        )).not.toThrow();
        expect(() => pluginFacade.createClient(
            "http://dav.example.com/dav",
        )).toThrow();
        expect(() => userFacade.createClient(
            "http://192.168.1.20/dav",
        )).not.toThrow();
    });

    it("authorizes HTTP only for the matching user operation", async () => {
        const { client, module, patcher } = createModule();
        const requester = jest.fn(async (url: string) =>
            transportResponse(url));
        const resolveHostname = jest.fn(async () => ["192.168.1.20"]);
        const pluginFacade = createRestrictedWebdavFacade(module, {
            transportRequester: requester,
        });
        const userFacade = createRestrictedWebdavFacade(module, {
            allowHttp: true,
            allowPrivateHosts: true,
            transportRequester: requester,
        });
        const fetchTransport = patcher.patch.mock.calls[0][1];
        (client.exists as jest.Mock).mockImplementation(async (
            _path: string,
            operationOptions: { signal: AbortSignal },
        ) => fetchTransport(
            "http://nas.local/dav/music",
            {
                method: "PROPFIND",
                signal: operationOptions.signal,
            },
        ));

        const userClient = userFacade.createClient("http://nas.local/dav");
        await expect(userClient.exists("/music")).resolves.toMatchObject({
            ok: true,
        });
        expect(resolveHostname).not.toHaveBeenCalled();
        expect(() => pluginFacade.createClient(
            "http://nas.local/dav",
        )).toThrow();
        await expect(fetchTransport(
            "http://dav.example.com/dav",
            {
                method: "PROPFIND",
                signal: new AbortController().signal,
            },
        )).rejects.toThrow("not authorized");
    });

    it("exposes only bounded client methods and strips unsafe options", async () => {
        const { client, module } = createModule();
        const facade = createRestrictedWebdavFacade(module);
        const safeClient = facade.createClient("https://example.com/root", {
            username: "user",
            password: "secret",
            agent: { unsafe: true },
        });

        expect(safeClient).not.toHaveProperty("customRequest");
        expect(module.createClient).toHaveBeenCalledWith(
            "https://example.com/root",
            expect.objectContaining({
                username: "user",
                password: "secret",
                maxRedirects: 0,
                withCredentials: false,
            }),
        );
        expect(module.createClient.mock.calls[0][1]).not.toHaveProperty(
            "agent",
        );
        await expect(safeClient.exists("/music")).resolves.toBe(true);
        expect(client.exists).toHaveBeenCalledWith(
            "/music",
            expect.objectContaining({
                signal: expect.any(AbortSignal),
            }),
        );
    });

    it("rejects URL/path escape attempts and oversized content", async () => {
        const { module } = createModule();
        const facade = createRestrictedWebdavFacade(module, {
            maxRequestBytes: 4,
            maxResponseBytes: 4,
        });
        const client = facade.createClient("https://example.com");

        await expect(client.exists("https://internal/path")).rejects.toThrow(
            "absolute URL",
        );
        await expect(client.exists("/safe/../secret")).rejects.toThrow(
            "traversal",
        );
        await expect(
            client.putFileContents("/file", "12345"),
        ).rejects.toThrow("request body");
        await expect(client.getFileContents("/file")).rejects.toThrow(
            "response body",
        );
    });

    it("does not expose the raw module through default", () => {
        const { module } = createModule();
        const facade = createRestrictedWebdavFacade(module);

        expect(facade.default).toBe(facade);
        expect(facade).not.toHaveProperty("customRequest");
        expect(Object.isFrozen(facade)).toBe(true);
    });

    it.each([
        ["copyFile", ["/a", "/b"], 2],
        ["createDirectory", ["/a"], 1],
        ["deleteFile", ["/a"], 1],
        ["exists", ["/a"], 1],
        ["getDirectoryContents", ["/a"], 1],
        ["getFileContents", ["/a"], 1],
        ["getQuota", [], 0],
        ["moveFile", ["/a", "/b"], 2],
        ["putFileContents", ["/a", "body"], 2],
        ["stat", ["/a"], 1],
    ] as const)(
        "injects cancellation at the correct %s options index",
        async (method, args, optionsIndex) => {
            const { client, module } = createModule();
            const safeClient = createRestrictedWebdavFacade(module)
                .createClient("https://example.com");

            await safeClient[method](...args);

            const call = (client[method] as jest.Mock).mock.calls[0];
            expect(call[optionsIndex]).toEqual(expect.objectContaining({
                signal: expect.any(AbortSignal),
            }));
        },
    );

    it("times out even when the underlying client ignores abort", async () => {
        const { client, module } = createModule();
        client.exists.mockImplementation(
            () => new Promise<boolean>(() => undefined),
        );
        const safeClient = createRestrictedWebdavFacade(module, {
            maxTimeoutMs: 5,
        }).createClient("https://example.com");

        await expect(safeClient.exists("/music")).rejects.toThrow(
            "timed out",
        );
        const signal = (client.exists as jest.Mock).mock.calls[0][1]
            .signal as AbortSignal;
        expect(signal.aborted).toBe(true);
    });

    it("installs the restricted transport exactly once per patcher", () => {
        const { module, patcher } = createModule();

        createRestrictedWebdavFacade(module);
        createRestrictedWebdavFacade(module);

        expect(patcher.patch).toHaveBeenCalledTimes(1);
        expect(patcher.patch).toHaveBeenCalledWith(
            "fetch",
            expect.any(Function),
        );
    });

    it("executes public HTTPS through the installed transport", async () => {
        const { client, module, patcher } = createModule();
        const requester = jest.fn(async (url: string) =>
            transportResponse(url));

        const facade = createRestrictedWebdavFacade(module, {
            transportRequester: requester,
        });
        const fetchTransport = patcher.patch.mock.calls[0][1];
        (client.exists as jest.Mock).mockImplementation(async (
            _path: string,
            operationOptions: { signal: AbortSignal },
        ) => fetchTransport("https://dav.example.com/root/file.json", {
            method: "PROPFIND",
            signal: operationOptions.signal,
        }));

        const response = await facade
            .createClient("https://dav.example.com/root")
            .exists("/file.json");

        expect(response.ok).toBe(true);
        expect(requester).toHaveBeenCalledWith(
            "https://dav.example.com/root/file.json",
            expect.objectContaining({
                fetchOptions: { redirect: "manual" },
                method: "PROPFIND",
                withCredentials: false,
            }),
        );
    });

    it("follows only bounded same-origin HTTPS redirects", async () => {
        const { client, module, patcher } = createModule();
        const requester = jest.fn(async (url: string) =>
            url.endsWith("/dav")
                ? transportResponse(url, 301, { location: "/dav/" })
                : transportResponse(url));

        const facade = createRestrictedWebdavFacade(module, {
            transportRequester: requester,
        });
        const fetchTransport = patcher.patch.mock.calls[0][1];
        (client.exists as jest.Mock).mockImplementation(async (
            _path: string,
            operationOptions: { signal: AbortSignal },
        ) => fetchTransport("https://dav.example.com/dav", {
            method: "PROPFIND",
            signal: operationOptions.signal,
        }));

        await expect(
            facade
                .createClient("https://dav.example.com/dav")
                .exists("/music"),
        ).resolves.toMatchObject({ ok: true, status: 200 });
        expect(requester).toHaveBeenNthCalledWith(
            2,
            "https://dav.example.com/dav/",
            expect.any(Object),
        );
    });

    it("follows same-origin HTTP redirects only for a user operation", async () => {
        const { client, module, patcher } = createModule();
        const requester = jest.fn(async (url: string) =>
            url.endsWith("/dav")
                ? transportResponse(url, 301, { location: "/dav/" })
                : transportResponse(url));
        const userFacade = createRestrictedWebdavFacade(module, {
            allowHttp: true,
            allowPrivateHosts: true,
            transportRequester: requester,
        });
        const fetchTransport = patcher.patch.mock.calls[0][1];
        (client.exists as jest.Mock).mockImplementation(async (
            _path: string,
            operationOptions: { signal: AbortSignal },
        ) => fetchTransport("http://nas.local/dav", {
            method: "PROPFIND",
            signal: operationOptions.signal,
        }));

        const userClient = userFacade.createClient("http://nas.local/dav");
        await expect(userClient.exists("/music")).resolves.toMatchObject({
            ok: true,
            status: 200,
        });
        expect(requester).toHaveBeenNthCalledWith(
            2,
            "http://nas.local/dav/",
            expect.any(Object),
        );
    });

    it.each(["plugin-first", "user-first"])(
        "routes per-facade transports independently when %s installs",
        async installationOrder => {
            const { client, module, patcher } = createModule();
            const pluginRequester = jest.fn(async (url: string) =>
                transportResponse(url));
            const userHttpRequester = jest.fn(async (url: string) =>
                transportResponse(url));
            const createPluginFacade = () => createRestrictedWebdavFacade(
                module,
                {
                    transportRequester: pluginRequester,
                },
            );
            const createUserFacade = () => createRestrictedWebdavFacade(
                module,
                {
                    allowHttp: true,
                    allowPrivateHosts: true,
                    transportRequester: userHttpRequester,
                },
            );
            const pluginFacade = installationOrder === "plugin-first"
                ? createPluginFacade()
                : undefined;
            const userFacade = createUserFacade();
            const resolvedPluginFacade =
                pluginFacade ?? createPluginFacade();
            const fetchTransport = patcher.patch.mock.calls[0][1];
            (client.exists as jest.Mock).mockImplementation(async (
                path: string,
                operationOptions: { signal: AbortSignal },
            ) => fetchTransport(
                path === "/user"
                    ? "http://nas.local/dav/user"
                    : "https://dav.example.com/dav/plugin",
                {
                    method: "PROPFIND",
                    signal: operationOptions.signal,
                },
            ));

            await userFacade
                .createClient("http://nas.local/dav")
                .exists("/user");
            await resolvedPluginFacade
                .createClient("https://dav.example.com/dav")
                .exists("/plugin");

            expect(userHttpRequester).toHaveBeenCalledTimes(1);
            expect(userHttpRequester.mock.calls[0][0]).toBe(
                "http://nas.local/dav/user",
            );
            expect(pluginRequester).toHaveBeenCalledTimes(1);
            expect(pluginRequester.mock.calls[0][0]).toBe(
                "https://dav.example.com/dav/plugin",
            );
            expect(patcher.patch).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        "https://other.example.com/dav/",
        "http://dav.example.com/dav/",
    ])("rejects an unsafe WebDAV redirect to %s", async location => {
        const { client, module, patcher } = createModule();
        const requester = jest.fn(async (url: string) =>
            transportResponse(url, 302, { location }));

        const facade = createRestrictedWebdavFacade(module, {
            transportRequester: requester,
        });
        const fetchTransport = patcher.patch.mock.calls[0][1];
        (client.exists as jest.Mock).mockImplementation(async (
            _path: string,
            operationOptions: { signal: AbortSignal },
        ) => fetchTransport("https://dav.example.com/dav", {
            method: "PROPFIND",
            signal: operationOptions.signal,
        }));

        await expect(
            facade
                .createClient("https://dav.example.com/dav")
                .exists("/music"),
        ).rejects.toThrow("transport policy");
        expect(requester).toHaveBeenCalledTimes(1);
    });
});
