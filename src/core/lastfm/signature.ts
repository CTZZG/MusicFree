import CryptoJs from "crypto-js";

/**
 * Last.fm 的 api_sig 算法：把除 `format`/`callback`/`api_sig` 之外的全部参数
 * 按参数名字典序排好，依次拼成 `名1值1名2值2...`，末尾接上 api_secret，
 * 整串取 MD5 小写十六进制。
 *
 * 排序必须按 UTF-8 字节序而不是本地化排序——`buildScrobbleBatchParams` 会
 * 产出 `artist[0]`、`artist[10]` 这类带下标的键，用 localeCompare 可能把
 * `[` 和数字的相对顺序排出别的结果，签名就对不上了。
 */
const EXCLUDED_KEYS = new Set(["format", "callback", "api_sig"]);

export function buildSignatureBaseString(
    params: Record<string, string | number | undefined>,
): string {
    return Object.keys(params)
        .filter(key => !EXCLUDED_KEYS.has(key))
        .filter(key => params[key] !== undefined && params[key] !== null)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map(key => `${key}${params[key]}`)
        .join("");
}

export function buildApiSignature(
    params: Record<string, string | number | undefined>,
    apiSecret: string,
): string {
    const base = `${buildSignatureBaseString(params)}${apiSecret}`;
    return CryptoJs.MD5(base).toString(CryptoJs.enc.Hex);
}
