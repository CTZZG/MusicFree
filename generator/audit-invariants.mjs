/**
 * 结构性不变量审计。
 *
 * 2026-07-26 合并自 audit-network-boundaries / audit-android-storage-security /
 * audit-secure-credentials / audit-track-player-listeners /
 * audit-track-player-immutability（合计 1012 行）。
 *
 * 那些脚本的绝大多数断言是「grep 我们自己刚写下的字符串」——只要实现改个写法
 * 断言就红，而真出了回归它们照样绿。本轮实测代价：一次把 `Dns.SYSTEM.lookup`
 * 重构成 `createPublicDns(Dns.SYSTEM)`，行为完全正确，两个门却全红；反过来，
 * 插件 HTTP 被全面拦死、crypto-js AES 被打死这些真回归，它们一个都没抓到。
 *
 * 这里只保留**能因真实回归而失败**的检查：
 *   1. AST 结构检查——绕过受限网络层的写法（裸 axios / 全局 fetch / 裸 webdav）。
 *   2. 明文 opt-in 白名单——防止有人在新文件里悄悄加 `allowHttp: true`。
 *   3. 构建产物检查——merged release manifest 的 targetSdk 与权限。
 *   4. 已回退组件的「保持删除」守卫——防止被重新引入。
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const failures = [];
const expect = (condition, message) => {
    if (!condition) failures.push(message);
};
const read = relativePath =>
    fs.readFileSync(path.join(root, relativePath), "utf8");

// --- 1/2. AST 结构检查 -------------------------------------------------------
function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return entry.name === "__tests__" ? [] : walk(absolute);
        }
        return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) &&
            !/\.(?:test|spec)\.[^.]+$/.test(entry.name)
            ? [absolute]
            : [];
    });
}

const rawAxiosImports = [];
const directFetchCalls = [];
const rawWebdavImports = [];
const explicitHttpOptIns = [];

for (const absolute of walk(path.join(root, "src"))) {
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    const source = fs.readFileSync(absolute, "utf8");

    for (const match of source.matchAll(/allowHttp:\s*true/g)) {
        const line = source.slice(0, match.index).split("\n").length;
        explicitHttpOptIns.push(`${relative}:${line}`);
    }

    const sourceFile = ts.createSourceFile(
        absolute,
        source,
        ts.ScriptTarget.Latest,
        true,
        absolute.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = node => {
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            const moduleName = node.moduleSpecifier.text;
            if (
                moduleName === "axios" &&
                node.importClause?.isTypeOnly !== true &&
                relative !== "src/utils/restrictedHttpClient.ts"
            ) {
                rawAxiosImports.push(relative);
            }
            if (moduleName === "webdav") {
                rawWebdavImports.push(relative);
            }
        }
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "fetch"
        ) {
            const line = sourceFile.getLineAndCharacterOfPosition(
                node.expression.getStart(sourceFile),
            ).line + 1;
            directFetchCalls.push(`${relative}:${line}`);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
}

expect(
    rawAxiosImports.length === 0,
    `raw axios imports bypass the restricted client: ${rawAxiosImports.join(", ")}`,
);
expect(
    directFetchCalls.length === 0,
    `direct global fetch calls bypass the restricted client: ${directFetchCalls.join(", ")}`,
);
expect(
    JSON.stringify(rawWebdavImports.sort()) === JSON.stringify([
        "src/core/pluginManager/plugin.ts",
        "src/core/pluginManager/webdavRuntime.ts",
    ]),
    `raw webdav imports escaped their adapters: ${rawWebdavImports.join(", ")}`,
);
// 明文只应由这四处显式开启：用户 WebDAV 门面、WebDAV 备份、URL 校验默认值、
// 封面地址策略。插件/LX 的明文走 basic.allowPluginInsecureHttp 开关（运行期
// 求值），不在此列。
//
// artworkSourcePolicy 放行明文是刻意的：封面是纯展示图片、不带凭据，而大量
// 音源只提供 http 封面，拒绝会让锁屏/通知/灵动岛退化成默认图标。真正的地址
// 风险（私有网段、回环、URL 内嵌凭据）仍由 validateRemoteNetworkUrl 拦住，
// 原生取图侧的 PublicHttpsNetworkPolicy 同样刻意不限制 scheme。
expect(
    JSON.stringify(
        [...new Set(explicitHttpOptIns.map(item => item.replace(/:\d+$/, "")))]
            .sort(),
    ) === JSON.stringify([
        "src/core/pluginManager/restrictedWebdav.ts",
        "src/core/webdavBackup.ts",
        "src/core/webdavUrl.ts",
        "src/utils/artworkSourcePolicy.ts",
    ]),
    `unexpected cleartext opt-in: ${explicitHttpOptIns.join(", ")}`,
);

// --- 3. 源码与构建产物：release manifest ------------------------------------
const sourceManifest = read("android/app/src/main/AndroidManifest.xml");
expect(
    !/<meta-data\b(?=[^>]*android:name="androidx\.work\.WorkManagerInitializer")(?=[^>]*tools:node="remove")[^>]*\/?>/s
        .test(sourceManifest),
    "app manifest must not remove WorkManagerInitializer while Nitro eagerly constructs DownloadManagerCore",
);

const mergedManifestPath = path.join(
    root,
    "android/app/build/intermediates/merged_manifest/release",
    "processReleaseMainManifest/AndroidManifest.xml",
);
if (fs.existsSync(mergedManifestPath)) {
    const mergedManifest = fs.readFileSync(mergedManifestPath, "utf8");
    expect(
        /targetSdkVersion="36"/.test(mergedManifest),
        "merged release manifest must target SDK 36",
    );
    expect(
        !/MANAGE_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|requestLegacyExternalStorage/
            .test(mergedManifest),
        "merged release manifest must not carry legacy/all-files storage permissions",
    );
    expect(
        /networkSecurityConfig="@xml\/network_security_config"/.test(
            mergedManifest,
        ),
        "merged release manifest must reference the network security config",
    );
    expect(
        /android:name="androidx\.work\.WorkManagerInitializer"/.test(
            mergedManifest,
        ),
        "merged release manifest must retain WorkManagerInitializer for Nitro DownloadManagerCore",
    );
} else {
    console.log(
        "  note: merged manifest absent (no release build yet); manifest checks skipped",
    );
}

// --- 4. 已回退组件必须保持删除 ----------------------------------------------
// 每一项都曾被写出来又因实测有害而回退，见计划第 10/11 节。重新引入必须是
// 一次显式决定，而不是某次「顺手加回来」。
for (const removed of [
    // 手写裸 socket WebDAV HTTP 栈（2237 行）
    "src/native/webdavHttpTransport/index.ts",
    "android/app/src/main/java/fun/upup/musicfree/webdavhttp/WebdavHttpTransportModule.kt",
    "ios/MusicFree/WebdavHttpTransport.mm",
    // G02 远程媒体拦截（约 1900 行）
    "android/app/src/main/java/fun/upup/musicfree/mpvplayer/MpvMediaProxy.kt",
    "android/app/src/main/java/fun/upup/musicfree/network/RemoteHostResolverModule.kt",
    "ios/MusicFree/RemoteHostResolver.mm",
    "src/native/remoteHostResolver/index.ts",
]) {
    expect(
        !fs.existsSync(path.join(root, removed)),
        `reverted component must stay deleted: ${removed}`,
    );
}

const mainApplication = read(
    "android/app/src/main/java/fun/upup/musicfree/MainApplication.kt",
);
expect(
    !/WebdavHttpTransportPackage|RemoteHostResolverPackage/.test(mainApplication),
    "reverted native packages must not be re-registered in MainApplication",
);
expect(
    !/MusicFreePublicHttpDataSource\.kt/.test(
        read("patches/react-native-nitro-player+1.5.0.patch"),
    ),
    "the reverted Nitro data source must not reappear in the patch",
);

// --- 结果 --------------------------------------------------------------------
if (failures.length) {
    console.error("Structural invariant audit failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}
console.log(
    "Structural invariant audit passed: no restricted-transport bypass, cleartext opt-in confined, release manifest hardened with WorkManager initialization, reverted components stay deleted.",
);
