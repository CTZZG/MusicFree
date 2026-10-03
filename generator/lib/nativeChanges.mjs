/**
 * PR 检查里的 Android 单元测试要先配置整个 Gradle 工程，耗时几分钟，所以只在
 * 改动可能影响原生构建或原生测试时才跑。拿不准的情况（手动触发、新分支、
 * 比较失败）一律当作要跑：宁可多跑一次，也不能漏掉。
 */

// 会改变原生代码、原生依赖或这项检查本身的文件
const NATIVE_PATTERNS = [
    /^android\//,
    /^patches\//,
    /^package(-lock)?\.json$/,
    /^app\.json$/,
    /^\.github\/workflows\/ci\.yml$/,
    /^generator\/(lib\/nativeChanges|detect-native-changes)\.mjs$/,
];

/** @param {string[]} paths 仓库根目录下的相对路径 */
export function nativeRelatedPaths(paths) {
    return paths.filter(path =>
        NATIVE_PATTERNS.some(pattern => pattern.test(path)),
    );
}

const ZERO_SHA = /^0+$/;

/**
 * 选 git diff 的比较基准。
 * - pull_request：检出的是合并提交，第一个父提交就是目标分支，差异正好是 PR 的改动；
 * - push：推送前的提交；新建分支时它是全 0，没有可比的基准；
 * - 其它（手动触发等）：没有基准。
 *
 * @param {{eventName?: string, beforeSha?: string}} event
 * @returns {string | null} 基准；null 表示直接跑测试
 */
export function resolveDiffBase({eventName, beforeSha}) {
    if (eventName === 'pull_request') {
        return 'HEAD^1';
    }
    if (eventName === 'push' && beforeSha && !ZERO_SHA.test(beforeSha)) {
        return beforeSha;
    }
    return null;
}
