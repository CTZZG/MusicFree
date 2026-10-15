// patch-package 补丁改了 expo 模块的 Android 源码时，这个模块如果自带预编译 AAR
// （expo-module.config.json 里有 android.publication），expo 自动链接默认直接用
// local-maven-repo 里的 AAR，源码根本不编译：补丁装得上，却不起作用。
// 2026-10-15 expo-splash-screen 的补丁就这样在 Beta #148 里白打了一次。
// 这种模块要写进 package.json 的 expo.autolinking.android.buildFromSource；
// 那里是正则，整段匹配 Gradle 项目名（ExpoAutolinkingConfig.buildFromSourceRegex），
// 不带作用域的包，项目名就是包名。

/** patch-package 的补丁文件名 → 包名：name+版本.patch，带作用域的是 @scope+name+版本.patch */
export function packageNameOfPatch(fileName) {
    if (!fileName.endsWith('.patch') || fileName.includes('++')) {
        return null;
    }
    const parts = fileName.slice(0, -'.patch'.length).split('+');
    if (parts.length < 2) {
        return null;
    }
    parts.pop();
    return parts.join('/');
}

/** 补丁有没有改这个包的 Android 目录 */
export function touchesAndroidSources(patchText, packageName) {
    const prefix = ` a/node_modules/${packageName}/android/`;
    return patchText
        .split('\n')
        .some(line => line.startsWith('diff --git ') && line.includes(prefix));
}

/** buildFromSource 里有没有整段匹配这个 Gradle 项目名的正则 */
export function buildsFromSource(projectName, buildFromSource) {
    return (buildFromSource ?? []).some(pattern => {
        try {
            return new RegExp(`^(?:${pattern})$`).test(projectName);
        } catch {
            return false;
        }
    });
}

/**
 * 打了 Android 补丁、却会被链接成预编译 AAR 的 expo 模块。
 * @param {{patches: {fileName: string, text: string}[],
 *          moduleConfigOf: (packageName: string) => any,
 *          buildFromSource?: string[]}} input
 *   moduleConfigOf 返回包的 expo-module.config.json 内容，没有时返回 null
 * @returns {string[]} 每个问题一行
 */
export function ignoredPrebuiltPatches({patches, moduleConfigOf, buildFromSource}) {
    const problems = [];
    for (const {fileName, text} of patches) {
        const packageName = packageNameOfPatch(fileName);
        if (!packageName || !touchesAndroidSources(text, packageName)) {
            continue;
        }
        const publication = moduleConfigOf(packageName)?.android?.publication;
        if (publication && !buildsFromSource(packageName, buildFromSource)) {
            problems.push(
                `${fileName}: ${packageName} is linked from its prebuilt AAR ` +
                    `(${publication.artifactId}), so the Android patch is ignored; ` +
                    'add it to expo.autolinking.android.buildFromSource in package.json',
            );
        }
    }
    return problems;
}
