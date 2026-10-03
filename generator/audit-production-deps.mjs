import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseNpmViewVersions} from './lib/npmView.mjs';

// 稳定版发布前的生产依赖审计，阻断标准与
// `npm audit --omit=dev --audit-level=high` 相同，但允许下面登记的例外。
//
// 例外只用于上游还没有可用修复版本的公告，并写明为什么在本项目中可以接受。
// 只要依赖方声明的版本范围内出现了不受影响的版本，审计就会失败，提醒升级并删除
// 对应例外；不能依赖 npm audit 的 fixAvailable——它会把“降级 expo 到 44”这类
// 方案也算作修复。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const registry = 'https://registry.npmjs.org';
const blockingSeverities = new Set(['high', 'critical']);

const imageSizeReason =
    'metro 只在打包时用它读取仓库自带图片资源的尺寸，不处理外部输入，也不打进 APK；修复只在 2.x，而 metro 依赖 ^1.0.2。';

const auditExceptions = [
    {
        advisory: 'GHSA-86w9-cpqp-85rv',
        packageName: 'node-forge',
        reason:
            '只用于 Expo CLI 的更新包代码签名（expo → @expo/cli → @expo/code-signing-certificates），本项目构建不签名，也不打进 APK。',
        reviewedOn: '2026-10-02',
    },
    {
        advisory: 'GHSA-5p2g-fcmc-qvqq',
        packageName: 'image-size',
        reason: imageSizeReason,
        reviewedOn: '2026-10-02',
    },
    {
        advisory: 'GHSA-w3rx-r6r6-pgpr',
        packageName: 'image-size',
        reason: imageSizeReason,
        reviewedOn: '2026-10-02',
    },
    {
        advisory: 'GHSA-vfj7-8cjw-p6xm',
        packageName: 'braces',
        reason:
            '只在打包时由 Expo CLI 的 Metro 文件监视匹配仓库自己的路径规则（expo → @expo/cli → @expo/metro-file-map → micromatch → braces），不处理外部输入，也不打进 APK；最新的 3.0.3 仍受影响，上游暂无修复版。',
        reviewedOn: '2026-10-03',
    },
];

const inGithubActions = process.env.GITHUB_ACTIONS === 'true';

function report(level, message) {
    const prefix = inGithubActions ? `::${level}::` : `${level.toUpperCase()}: `;
    console.log(`${prefix}${message}`);
}

function runNpm(args) {
    const options = {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    };
    // 经 npm run 运行时直接用当前 npm 的 CLI 脚本，避免在 Windows 上经 shell 转义参数
    const npmExecPath = process.env.npm_execpath;
    const result = npmExecPath
        ? spawnSync(process.execPath, [npmExecPath, ...args], options)
        : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
              ...options,
              shell: process.platform === 'win32',
          });
    if (result.error) {
        throw result.error;
    }
    return result;
}

function parseJson(text, description) {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `${description} did not return JSON:\n${String(text).slice(0, 2000)}`,
        );
    }
}

function runAudit() {
    const result = runNpm([
        'audit',
        '--omit=dev',
        '--json',
        `--registry=${registry}`,
    ]);
    // 有漏洞时 npm audit 的退出码非 0，结果仍以 JSON 输出
    const auditReport = parseJson(result.stdout, 'npm audit');
    if (auditReport.error) {
        throw new Error(
            `npm audit failed: ${auditReport.error.summary ?? JSON.stringify(auditReport.error)}`,
        );
    }
    return auditReport;
}

/** 公告本身；由其他包的公告传递出来的条目（via 为包名）不重复计算 */
function collectAdvisories(auditReport) {
    const advisories = new Map();
    for (const vulnerability of Object.values(auditReport.vulnerabilities ?? {})) {
        for (const via of vulnerability.via ?? []) {
            if (typeof via !== 'object' || via === null) {
                continue;
            }
            const id = String(via.url ?? via.source).split('/').pop();
            const key = `${via.name}:${id}`;
            if (!advisories.has(key)) {
                advisories.set(key, {
                    id,
                    packageName: via.name,
                    title: via.title,
                    severity: via.severity,
                    range: via.range,
                    url: via.url,
                });
            }
        }
    }
    return [...advisories.values()];
}

/** 查询失败时直接报错，不当成「没有修复版」，见 lib/npmView.mjs */
function listVersions(spec) {
    return parseNpmViewVersions(
        spec,
        runNpm(['view', spec, 'version', '--json', `--registry=${registry}`]),
    );
}

/** 生产依赖树中这个包已安装的版本，以及依赖方声明的版本范围（来自锁文件） */
function readProductionUsage(packageName) {
    const lockfile = parseJson(
        readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'),
        'package-lock.json',
    );
    const installed = new Set();
    const ranges = new Set();
    for (const [location, meta] of Object.entries(lockfile.packages ?? {})) {
        if (meta.dev) {
            continue;
        }
        if (location.endsWith(`node_modules/${packageName}`) && meta.version) {
            installed.add(meta.version);
        }
        for (const field of ['dependencies', 'optionalDependencies']) {
            const range = meta[field]?.[packageName];
            if (range) {
                range.split('||').forEach(part => ranges.add(part.trim() || '*'));
            }
        }
    }
    return {
        installed: [...installed],
        ranges: ranges.size ? [...ranges] : ['*'],
    };
}

/**
 * 可以升级到的修复版本：比已安装的版本新、在依赖方接受的范围内，
 * 并且不受这个包任何一条阻断级公告影响。
 */
function findUsableFixes(packageName, advisoryRanges) {
    const vulnerable = new Set(
        advisoryRanges.flatMap(range => listVersions(`${packageName}@${range}`)),
    );
    const {installed, ranges} = readProductionUsage(packageName);
    return ranges
        .map(range => {
            const inRange = listVersions(`${packageName}@${range}`);
            const installedInRange = installed.filter(version =>
                inRange.includes(version),
            );
            const newer = installedInRange.length
                ? listVersions(
                      `${packageName}@${installedInRange
                          .map(version => `>${version}`)
                          .join(' ')} ${range}`,
                  )
                : inRange;
            return {
                range,
                versions: newer.filter(version => !vulnerable.has(version)),
            };
        })
        .filter(item => item.versions.length);
}

const auditReport = runAudit();
const advisories = collectAdvisories(auditReport);
const exceptionFor = advisory =>
    auditExceptions.find(
        item =>
            item.advisory === advisory.id &&
            item.packageName === advisory.packageName,
    );

const blocking = advisories.filter(
    advisory =>
        blockingSeverities.has(advisory.severity) && !exceptionFor(advisory),
);
const excepted = advisories.filter(
    advisory =>
        blockingSeverities.has(advisory.severity) && exceptionFor(advisory),
);
const expired = [...new Set(excepted.map(advisory => advisory.packageName))]
    .map(packageName => ({
        packageName,
        ids: excepted
            .filter(advisory => advisory.packageName === packageName)
            .map(advisory => advisory.id),
        fixes: findUsableFixes(
            packageName,
            advisories
                .filter(
                    advisory =>
                        advisory.packageName === packageName &&
                        blockingSeverities.has(advisory.severity),
                )
                .map(advisory => advisory.range),
        ),
    }))
    .filter(item => item.fixes.length);
const stale = auditExceptions.filter(
    exception =>
        !advisories.some(
            advisory =>
                advisory.id === exception.advisory &&
                advisory.packageName === exception.packageName,
        ),
);

for (const advisory of excepted) {
    const exception = exceptionFor(advisory);
    console.log(
        `Allowed by exception (reviewed ${exception.reviewedOn}): ${advisory.packageName} ${advisory.id} [${advisory.severity}] ${advisory.title}\n  ${exception.reason}`,
    );
}
for (const exception of stale) {
    report(
        'warning',
        `Audit exception ${exception.advisory} (${exception.packageName}) no longer matches a finding; remove it from generator/audit-production-deps.mjs.`,
    );
}
for (const advisory of blocking) {
    report(
        'error',
        `${advisory.packageName} [${advisory.severity}] ${advisory.title} (affected ${advisory.range}) ${advisory.url}`,
    );
}
for (const {packageName, ids, fixes} of expired) {
    const available = fixes
        .map(fix => `${fix.range}: ${fix.versions.join(', ')}`)
        .join('; ');
    report(
        'error',
        `${packageName} now has an unaffected newer version within the ranges its dependents accept (${available}). Upgrade it and remove the audit exception for ${ids.join(', ')}.`,
    );
}

const counts = auditReport.metadata?.vulnerabilities ?? {};
console.log(
    `npm audit (production): critical ${counts.critical ?? 0}, high ${counts.high ?? 0}, moderate ${counts.moderate ?? 0}, low ${counts.low ?? 0}.`,
);

if (blocking.length || expired.length) {
    process.exit(1);
}
console.log(
    `Production dependency audit passed with ${excepted.length} documented exception(s).`,
);
