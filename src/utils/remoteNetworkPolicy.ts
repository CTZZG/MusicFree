const DEFAULT_MAX_URL_LENGTH = 16 * 1024;

export interface RemoteNetworkPolicyOptions {
    allowHttp?: boolean;
    allowPrivateHosts?: boolean;
    maxLength?: number;
    subject?: string;
}

export type RemoteNetworkUrlValidation =
    | {
        ok: true;
        url: string;
        hostname: string;
        protocol: "http:" | "https:";
    }
    | { ok: false; reason: string };

function parseIpv4(hostname: string) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
        return null;
    }
    const parts = hostname.split(".").map(Number);
    return parts.every(part => part >= 0 && part <= 255)
        ? parts
        : null;
}

function isBlockedIpv4(hostname: string) {
    const parts = parseIpv4(hostname);
    if (!parts) {
        return false;
    }

    const [a, b, c] = parts;
    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 0 && c === 0) ||
        (a === 192 && b === 0 && c === 2) ||
        (a === 192 && b === 88 && c === 99) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224
    );
}

function isBlockedIpv6(hostname: string) {
    if (!hostname.includes(":")) {
        return false;
    }
    const normalized = hostname
        .replace(/^\[|\]$/g, "")
        .split("%", 1)[0]
        .toLowerCase();

    let normalizedHex = normalized;
    const dottedTail = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
    if (dottedTail) {
        const ipv4 = parseIpv4(dottedTail);
        if (!ipv4) {
            return true;
        }
        normalizedHex = normalized.slice(0, -dottedTail.length) +
            `${(ipv4[0] * 256 + ipv4[1]).toString(16)}:${
                (ipv4[2] * 256 + ipv4[3]).toString(16)
            }`;
    }

    const compressionParts = normalizedHex.split("::");
    if (compressionParts.length > 2) {
        return true;
    }
    const left = compressionParts[0]
        ? compressionParts[0].split(":")
        : [];
    const right = compressionParts[1]
        ? compressionParts[1].split(":")
        : [];
    const missing = compressionParts.length === 2
        ? 8 - left.length - right.length
        : 0;
    if (missing < 0 || (compressionParts.length === 1 && left.length !== 8)) {
        return true;
    }
    const groups = [
        ...left,
        ...Array(missing).fill("0"),
        ...right,
    ].map(group => Number.parseInt(group || "0", 16));
    if (
        groups.length !== 8 ||
        groups.some(group => !Number.isInteger(group) || group < 0 || group > 0xffff)
    ) {
        return true;
    }

    const groupsToIpv4 = (g1: number, g2: number) =>
        `${Math.floor(g1 / 256)}.${g1 % 256}.${Math.floor(g2 / 256)}.${
            g2 % 256
        }`;
    const allZero = groups.every(group => group === 0);
    const loopback =
        groups.slice(0, 7).every(group => group === 0) &&
        groups[7] === 1;
    const uniqueLocal = groups[0] >= 0xfc00 && groups[0] <= 0xfdff;
    const linkLocal = groups[0] >= 0xfe80 && groups[0] <= 0xfebf;
    const siteLocal = groups[0] >= 0xfec0 && groups[0] <= 0xfeff;
    const multicast = groups[0] >= 0xff00;
    const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8;
    const discardOnly =
        groups[0] === 0x0100 &&
        groups[1] === 0 &&
        groups[2] === 0 &&
        groups[3] === 0;
    const ipv4Mapped =
        groups.slice(0, 5).every(group => group === 0) &&
        groups[5] === 0xffff;
    const mappedPrivate =
        ipv4Mapped && isBlockedIpv4(groupsToIpv4(groups[6], groups[7]));
    const nat64WellKnown =
        groups[0] === 0x0064 &&
        groups[1] === 0xff9b &&
        groups.slice(2, 6).every(group => group === 0) &&
        isBlockedIpv4(groupsToIpv4(groups[6], groups[7]));
    const nat64LocalUse =
        groups[0] === 0x0064 &&
        groups[1] === 0xff9b &&
        groups[2] === 0x0001;
    const sixToFour =
        groups[0] === 0x2002 &&
        isBlockedIpv4(groupsToIpv4(groups[1], groups[2]));

    return (
        allZero ||
        loopback ||
        uniqueLocal ||
        linkLocal ||
        siteLocal ||
        multicast ||
        documentation ||
        discardOnly ||
        mappedPrivate ||
        nat64WellKnown ||
        nat64LocalUse ||
        sixToFour
    );
}

export function isBlockedRemoteHostname(hostname: string) {
    const normalized = hostname.toLowerCase().replace(/\.$/, "");
    return (
        !normalized ||
        normalized === "localhost" ||
        normalized.endsWith(".localhost") ||
        normalized.endsWith(".local") ||
        isBlockedIpv4(normalized) ||
        isBlockedIpv6(normalized)
    );
}

export function validateRemoteNetworkUrl(
    input: unknown,
    options: RemoteNetworkPolicyOptions = {},
): RemoteNetworkUrlValidation {
    const subject = options.subject ?? "链接";
    if (typeof input !== "string") {
        return { ok: false, reason: `${subject}格式无效` };
    }

    const value = input.trim();
    if (!value || value.length > (options.maxLength ?? DEFAULT_MAX_URL_LENGTH)) {
        return { ok: false, reason: `${subject}为空或过长` };
    }

    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return { ok: false, reason: `${subject}格式无效` };
    }

    const protocol = parsed.protocol;
    const protocolAllowed =
        protocol === "https:" ||
        (options.allowHttp === true && protocol === "http:");
    if (!protocolAllowed) {
        return {
            ok: false,
            reason: options.allowHttp
                ? `${subject}仅允许使用 HTTP 或 HTTPS`
                : `${subject}仅允许使用 HTTPS`,
        };
    }
    if (parsed.username || parsed.password) {
        return {
            ok: false,
            reason: `${subject}中不能包含用户名或密码`,
        };
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (
        options.allowPrivateHosts !== true &&
        isBlockedRemoteHostname(hostname)
    ) {
        return {
            ok: false,
            reason: `${subject}不允许访问本机、私网或保留地址`,
        };
    }

    return {
        ok: true,
        url: parsed.toString(),
        hostname,
        protocol: protocol as "http:" | "https:",
    };
}
