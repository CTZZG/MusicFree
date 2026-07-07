import { escapeCharacter } from "./fileUtils";

/**
 * 预设模板映射表
 */
const PRESET_TEMPLATES: Record<IFileNaming.IPresetTemplate, string> = {
    歌曲名: "{title}",
    "歌曲名-歌手": "{title} - {artist}",
    "歌手-歌曲名": "{artist} - {title}",
    "歌曲名-歌手-音质": "{title} - {artist} - {quality}",
    "歌曲名-歌手-专辑": "{title} - {artist} - {album}",
    "歌手-专辑-歌曲名": "{artist} - {album} - {title}",
};

/**
 * 支持的模板变量及其描述
 */
export const TEMPLATE_VARIABLES = {
    "{title}": "歌曲名",
    "{artist}": "歌手",
    "{album}": "专辑",
    "{quality}": "音质",
    "{platform}": "平台",
    "{id}": "歌曲ID",
    "{alias}": "别名",
} as const;

/**
 * 默认文件命名配置
 */
export const DEFAULT_FILE_NAMING_CONFIG: IFileNaming.IFileNamingConfig = {
    type: "preset",
    preset: "歌曲名-歌手",
    maxLength: 200,
    keepExtension: true,
};

function escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 获取预设模板的实际模板字符串
 */
export function getPresetTemplate(preset: IFileNaming.IPresetTemplate): string {
    return PRESET_TEMPLATES[preset];
}

/**
 * 获取所有可用的预设模板
 */
export function getPresetTemplates(): IFileNaming.IPresetTemplate[] {
    return Object.keys(PRESET_TEMPLATES) as IFileNaming.IPresetTemplate[];
}

/**
 * 从音乐项目创建模板变量
 */
export function createTemplateVariables(
    musicItem: IMusic.IMusicItem,
    quality?: IMusic.IQualityKey,
): IFileNaming.ITemplateVariables {
    return {
        title: musicItem.title || "未知歌曲",
        artist: musicItem.artist || "未知歌手",
        album: musicItem.album || "未知专辑",
        quality: quality || "未知音质",
        platform: musicItem.platform || "未知平台",
        id: musicItem.id || "",
        alias: musicItem.alias || "",
    };
}

/**
 * 替换模板变量
 */
function replaceTemplateVariables(
    template: string,
    variables: IFileNaming.ITemplateVariables,
): string {
    let result = template;

    // 替换所有支持的变量
    Object.entries(variables).forEach(([key, value]) => {
        const placeholder = `{${key}}`;
        const escapedPlaceholder = escapeRegExp(placeholder);
        if (value) {
            result = result.replace(
                new RegExp(escapedPlaceholder, "g"),
                String(value),
            );
        } else {
            // 如果变量值为空，则删除占位符及其前后的连字符
            result = result.replace(
                new RegExp(`-?${escapedPlaceholder}-?`, "g"),
                "",
            );
        }
    });

    // 清理多余的连字符和空白，避免可选字段为空时留下尾随分隔符。
    result = result
        .replace(/\s*-\s*/g, " - ")
        .replace(/(?:^\s*-\s*|\s*-\s*$)/g, "")
        .trim();

    return result;
}

/**
 * 文件系统单个文件名的字节上限一般是 255（ext4/FAT/NTFS 按 UTF-8 计），
 * 预留扩展名（约 10 字节）和去重后缀 " (999)" 的余量。
 */
const MAX_FILENAME_BYTES = 230;

function utf8ByteLength(str: string): number {
    let bytes = 0;
    for (const ch of str) {
        const code = ch.codePointAt(0)!;
        bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    return bytes;
}

/** 按 UTF-8 字节数截断，不切断代理对 */
function truncateByBytes(str: string, maxBytes: number): string {
    let bytes = 0;
    let result = "";
    for (const ch of str) {
        const code = ch.codePointAt(0)!;
        const size =
            code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        if (bytes + size > maxBytes) {
            break;
        }
        bytes += size;
        result += ch;
    }
    return result;
}

/**
 * 截断文件名以符合长度限制：先按配置的字符数截断，
 * 再按文件系统的字节上限截断（中文等多字节字符按字符数算会超出 255 字节）。
 */
function truncateFilename(
    filename: string,
    maxLength: number,
    keepExtension: boolean,
): {filename: string; truncated: boolean} {
    const maxBytes = MAX_FILENAME_BYTES;
    if (filename.length <= maxLength && utf8ByteLength(filename) <= maxBytes) {
        return { filename, truncated: false };
    }

    if (keepExtension) {
        // 保留扩展名，只截断主文件名部分
        const lastDotIndex = filename.lastIndexOf(".");
        if (lastDotIndex > 0) {
            const name = filename.slice(0, lastDotIndex);
            const ext = filename.slice(lastDotIndex);
            const availableLength = maxLength - ext.length;
            const availableBytes = maxBytes - utf8ByteLength(ext);
            if (availableLength > 0 && availableBytes > 0) {
                return {
                    filename:
                        truncateByBytes(
                            name.slice(0, availableLength),
                            availableBytes,
                        ) + ext,
                    truncated: true,
                };
            }
        }
    }

    // 直接截断
    return {
        filename: truncateByBytes(filename.slice(0, maxLength), maxBytes),
        truncated: true,
    };
}

/**
 * 验证模板字符串
 */
export function validateTemplate(template: string): {
    valid: boolean;
    error?: string;
} {
    if (!template || typeof template !== "string") {
        return { valid: false, error: "模板不能为空" };
    }

    // 检查是否包含至少一个有效变量
    const hasValidVariable = Object.keys(TEMPLATE_VARIABLES).some(variable =>
        template.includes(variable),
    );

    if (!hasValidVariable) {
        return {
            valid: false,
            error:
                "模板必须包含至少一个有效变量：" +
                Object.keys(TEMPLATE_VARIABLES).join(", "),
        };
    }

    // 检查是否包含非法字符
    const invalidChars = /[/|\\?*"<>:]+/;
    if (invalidChars.test(template.replace(/\{[^}]+\}/g, ""))) {
        return {
            valid: false,
            error: "模板包含非法字符：/ | \\ ? * \" < > :",
        };
    }

    return { valid: true };
}

/**
 * 格式化文件名
 */
export function formatFilename(
    options: IFileNaming.IFormatOptions,
): IFileNaming.IFormatResult {
    const {
        template,
        variables,
        maxLength = 200,
        keepExtension = true,
    } = options;
    const originalLength = template.length;

    // 替换模板变量
    let filename = replaceTemplateVariables(template, variables);

    // 转义非法字符
    filename = escapeCharacter(filename);

    // 处理长度截断
    const { filename: finalFilename, truncated } = truncateFilename(
        filename,
        maxLength,
        keepExtension,
    );

    return {
        filename: finalFilename,
        truncated,
        originalLength,
    };
}

/**
 * 根据配置生成文件名
 */
export function generateFileNameFromConfig(
    musicItem: IMusic.IMusicItem,
    config: IFileNaming.IFileNamingConfig,
    quality?: IMusic.IQualityKey,
): IFileNaming.IFormatResult {
    // 确定使用的模板
    let template: string;
    if (config.type === "preset" && config.preset) {
        template = getPresetTemplate(config.preset);
    } else if (config.type === "custom" && config.custom) {
        template = config.custom;
    } else {
        // 使用默认模板
        template = getPresetTemplate("歌曲名-歌手");
    }

    // "文件名显示音质"开关：模板本身不含 {quality} 时追加音质后缀
    if (config.showQuality && !template.includes("{quality}")) {
        template = `${template} - {quality}`;
    }

    // 创建模板变量
    const variables = createTemplateVariables(musicItem, quality);

    // 格式化文件名
    return formatFilename({
        template,
        variables,
        maxLength: config.maxLength,
        keepExtension: config.keepExtension,
    });
}

/**
 * 预览文件名格式化结果（用于设置界面的实时预览）
 */
export function previewFilename(template: string): string {
    // 使用示例数据进行预览
    const sampleVariables: IFileNaming.ITemplateVariables = {
        title: "烟火里的尘埃",
        artist: "郁欢",
        album: "烟火里的尘埃",
        quality: "320k",
        platform: "QQ音乐",
        id: "204422126",
        alias: "",
    };

    const result = formatFilename({
        template,
        variables: sampleVariables,
        maxLength: 200,
        keepExtension: true,
    });

    return result.filename;
}
