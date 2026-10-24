// 发布说明（GitHub Release 正文，即 docs/release-notes-v<版本>.md）在“检查更新”对话框里的显示方式。
// 当前版本说明的写法检查（src/utils/__tests__/releaseNotesPolicy.test.ts）也按这里的结果计算。

/** 对话框最多显示的行数，超出的部分直接截掉 */
export const MAX_CHANGELOG_LINES = 40;

function plainText(markdown: string) {
    return markdown
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .trim();
}

/**
 * 发布说明是 Markdown。“下载”一节说的是该下哪个文件，对话框里有下载按钮，
 * 不用显示；其余各节（升级前请注意、新功能、改进与修复）的标题和条目逐行显示。
 */
export function releaseNotesToLines(body: unknown): string[] {
    if (typeof body !== "string") {
        return [];
    }
    const lines: string[] = [];
    let skipping = false;
    for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (/^#\s/.test(line)) {
            // 一级标题是“MusicFree vX.Y.Z”，对话框标题里已经有版本号
            continue;
        }
        const heading = /^#{2,6}\s+(.*)$/.exec(line);
        if (heading) {
            const title = plainText(heading[1]);
            skipping = /^(下载|下載|downloads?)$/i.test(title);
            if (!skipping && title) {
                lines.push(`【${title}】`);
            }
            continue;
        }
        if (skipping || !line) {
            continue;
        }
        const bullet = /^[-*+]\s+(.*)$/.exec(line);
        lines.push(bullet ? `· ${plainText(bullet[1])}` : plainText(line));
    }
    return lines.slice(0, MAX_CHANGELOG_LINES);
}
