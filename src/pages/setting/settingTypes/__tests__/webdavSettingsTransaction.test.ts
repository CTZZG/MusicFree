import {
    createWebdavSettingsTransaction,
    type WebdavSettingsTransactionDeps,
} from "../webdavSettingsTransaction";

function createDeps(
    overrides: Partial<WebdavSettingsTransactionDeps> = {},
) {
    const setConfig = jest.fn();
    const setPassword = jest.fn(async () => undefined);
    const deletePassword = jest.fn(async () => undefined);
    const onSuccess = jest.fn();
    return {
        deps: {
            currentUrl: undefined,
            deletePassword,
            hasStoredPassword: false,
            onSuccess,
            setConfig,
            setPassword,
            ...overrides,
        },
        deletePassword,
        onSuccess,
        setConfig,
        setPassword,
    };
}

describe("WebDAV settings transaction", () => {
    it("asks for confirmation before saving a new HTTP endpoint", () => {
        const { deps, setConfig, setPassword } = createDeps();

        const transaction = createWebdavSettingsTransaction(
            {
                password: "secret",
                url: "http://nas.local/dav",
                username: "user",
            },
            deps,
        );

        expect(transaction).toMatchObject({
            kind: "commit",
            requiresHttpConfirmation: true,
        });
        expect(setPassword).not.toHaveBeenCalled();
        expect(setConfig).not.toHaveBeenCalled();
    });

    it("does not save URL, username, or credentials when HTTP warning is cancelled", () => {
        const { deps, deletePassword, setConfig, setPassword } = createDeps();

        createWebdavSettingsTransaction(
            {
                password: "secret",
                url: "http://nas.local/dav",
                username: "user",
            },
            deps,
        );

        expect(setPassword).not.toHaveBeenCalled();
        expect(deletePassword).not.toHaveBeenCalled();
        expect(setConfig).not.toHaveBeenCalled();
    });

    it("saves a confirmed HTTP endpoint only once", async () => {
        const { deps, onSuccess, setConfig, setPassword } = createDeps();
        const transaction = createWebdavSettingsTransaction(
            {
                password: "secret",
                url: "http://nas.local/dav",
                username: "user",
            },
            deps,
        );

        if (transaction.kind !== "commit") {
            throw new Error("Expected a committable transaction");
        }
        await Promise.all([transaction.commit(), transaction.commit()]);
        await transaction.commit();

        expect(setPassword).toHaveBeenCalledTimes(1);
        expect(setPassword).toHaveBeenCalledWith("secret");
        expect(setConfig).toHaveBeenCalledTimes(2);
        expect(setConfig).toHaveBeenNthCalledWith(
            1,
            "webdav.url",
            "http://nas.local/dav",
        );
        expect(setConfig).toHaveBeenNthCalledWith(
            2,
            "webdav.username",
            "user",
        );
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it("does not repeat the HTTP warning for an unchanged existing endpoint", () => {
        const { deps } = createDeps({
            currentUrl: "http://nas.local/dav",
            hasStoredPassword: true,
        });

        const transaction = createWebdavSettingsTransaction(
            {
                password: "",
                url: "http://nas.local/dav",
                username: "user",
            },
            deps,
        );

        expect(transaction).toMatchObject({
            kind: "commit",
            requiresHttpConfirmation: false,
        });
    });

    it("saves HTTPS directly while preserving the stored password", async () => {
        const { deps, setConfig, setPassword } = createDeps({
            hasStoredPassword: true,
        });
        const transaction = createWebdavSettingsTransaction(
            {
                password: "",
                url: "https://dav.example.com/root",
                username: "user",
            },
            deps,
        );

        expect(transaction).toMatchObject({
            kind: "commit",
            requiresHttpConfirmation: false,
        });
        if (transaction.kind !== "commit") {
            throw new Error("Expected a committable transaction");
        }
        await transaction.commit();

        expect(setPassword).not.toHaveBeenCalled();
        expect(setConfig).toHaveBeenCalledWith(
            "webdav.url",
            "https://dav.example.com/root",
        );
        expect(setConfig).toHaveBeenCalledWith("webdav.username", "user");
    });

    it("clears WebDAV settings only when all fields are empty", async () => {
        const { deletePassword, deps, setConfig, setPassword } = createDeps({
            hasStoredPassword: true,
        });
        const transaction = createWebdavSettingsTransaction(
            {
                password: "",
                url: " ",
                username: " ",
            },
            deps,
        );

        if (transaction.kind !== "commit") {
            throw new Error("Expected a committable transaction");
        }
        await transaction.commit();

        expect(deletePassword).toHaveBeenCalledTimes(1);
        expect(setPassword).not.toHaveBeenCalled();
        expect(setConfig).toHaveBeenCalledWith("webdav.url", undefined);
        expect(setConfig).toHaveBeenCalledWith("webdav.username", undefined);
    });

    it("rejects incomplete settings without writing anything", () => {
        const { deps, setConfig, setPassword } = createDeps();

        const transaction = createWebdavSettingsTransaction(
            {
                password: "",
                url: "https://dav.example.com/root",
                username: "user",
            },
            deps,
        );

        expect(transaction).toEqual({
            kind: "invalid",
            reason: "incomplete",
        });
        expect(setPassword).not.toHaveBeenCalled();
        expect(setConfig).not.toHaveBeenCalled();
    });
});
