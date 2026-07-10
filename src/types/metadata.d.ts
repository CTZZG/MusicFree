// 音乐元数据类型定义

/**
 * 基础音乐元数据接口
 */
export interface IMusicMetadata {
    /** 音乐标题 */
    title?: string;
    /** 艺术家 */
    artist?: string;
    /** 专辑名称 */
    album?: string;
    /** 歌词 */
    lyric?: string;
    /** 评论 */
    comment?: string;
    /** 专辑艺术家 */
    albumArtist?: string;
    /** 作曲者 */
    composer?: string;
    /** 年份 */
    year?: string;
    /** 音乐流派 */
    genre?: string;
    /** 音轨号 */
    trackNumber?: string;
    /** 总音轨数 */
    totalTracks?: string;
    /** 光盘号 */
    discNumber?: string;
    /** 总光盘数 */
    totalDiscs?: string;
    /** ISRC编码 */
    isrc?: string;
    /** 语言 */
    language?: string;
    /** 编码器信息 */
    encoder?: string;
    /** 每分钟节拍数 */
    bpm?: string;
    /** 情绪 */
    mood?: string;
    /** 评分 */
    rating?: string;
    /** 发行商 */
    publisher?: string;
    /** 原始艺术家 */
    originalArtist?: string;
    /** 原始专辑 */
    originalAlbum?: string;
    /** 原始年份 */
    originalYear?: string;
    /** 官方网站URL */
    url?: string;
    /** 是否为合辑 */
    compilation?: boolean;
}

/**
 * 歌词顺序类型
 */
export type LyricOrderItem = "original" | "translation" | "romanization";

/**
 * 下载音乐元数据写入配置
 */
export interface IDownloadMetadataConfig {
    /** 是否启用元数据写入 */
    enabled: boolean;
    /** 是否写入封面 */
    writeCover: boolean;
    /** 是否写入歌词 */
    writeLyric: boolean;
    /** 是否从插件获取扩展信息 */
    fetchExtendedInfo: boolean;
    /** 歌词内容顺序配置 */
    lyricOrder: LyricOrderItem[];
    /** 是否启用逐字歌词 */
    enableWordByWord: boolean;
    /** 是否下载独立歌词文件 */
    downloadLyricFile?: boolean;
    /** 独立歌词文件格式 */
    lyricFileFormat?: "lrc" | "txt";
}

/** 下载收尾阶段共享的歌词与封面结果 */
export interface IDownloadEnrichment {
    lyricContent?: string;
    coverUrl?: string;
}

/**
 * 下载任务元数据信息
 */
export interface IDownloadTaskMetadata {
    /** 音乐信息 */
    musicItem: IMusic.IMusicItem;
    /** 文件路径 */
    filePath: string;
    /** 封面URL */
    coverUrl?: string;
    /** 歌词信息 */
    lyricInfo?: ILyric.ILyricItem;
    /** 额外元数据 */
    metadata?: IMusicMetadata;
}
