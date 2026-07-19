export type WebdavUrlValidation =
    | { ok: true; url: string }
    | { ok: false; reason: string };

/**
 * WebDAV credentials are configured separately, so the endpoint must use
 * encrypted transport and must not embed another credential pair in the URL.
 */
export function validateWebdavUrl(input: string): WebdavUrlValidation {
    let parsed: URL;
    try {
        parsed = new URL(input.trim());
    } catch {
        return { ok: false, reason: "WebDAV URL 格式无效" };
    }

    if (parsed.protocol !== "https:") {
        return { ok: false, reason: "WebDAV 仅允许使用 HTTPS" };
    }
    if (parsed.username || parsed.password) {
        return {
            ok: false,
            reason: "WebDAV URL 中不能包含用户名或密码",
        };
    }
    if (!parsed.hostname) {
        return { ok: false, reason: "WebDAV URL 缺少主机名" };
    }

    return { ok: true, url: parsed.toString().replace(/#.*$/, "") };
}
