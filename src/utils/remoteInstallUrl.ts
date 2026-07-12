const PRIVATE_IPV4_RANGES = [
    /^10\./,
    /^127\./,
    /^169\.254\./,
    /^192\.168\./,
];

function isPrivateIpv4(hostname: string) {
    if (PRIVATE_IPV4_RANGES.some(pattern => pattern.test(hostname))) {
        return true;
    }

    const parts = hostname.split(".").map(Number);
    return parts.length === 4 &&
        parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) &&
        parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function isPrivateIpv6(hostname: string) {
    const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return normalized === "::1" ||
        normalized === "::" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("::ffff:") ||
        /^fe[89ab]/.test(normalized);
}

export type RemoteInstallUrlValidation =
    | { ok: true; url: string; hostname: string }
    | { ok: false; reason: string };

export function validateRemoteInstallUrl(input: string): RemoteInstallUrlValidation {
    let parsed: URL;
    try {
        parsed = new URL(input.trim());
    } catch {
        return { ok: false, reason: "链接格式无效" };
    }

    if (parsed.protocol !== "https:") {
        return { ok: false, reason: "仅允许使用 HTTPS 链接" };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, reason: "链接中不能包含用户名或密码" };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
        return { ok: false, reason: "不允许访问本机地址" };
    }
    if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
        return { ok: false, reason: "不允许访问环回、链路本地或私网地址" };
    }

    return { ok: true, url: parsed.toString(), hostname };
}
