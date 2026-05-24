import type {IPluginManager} from '@/types/core/pluginManager';
import type {
    IDownloadMetadataConfig,
    IDownloadTaskMetadata,
    IMusicMetadata,
} from '@/types/metadata';
import {removeFileScheme} from '@/utils/fileUtils';
import {formatLyricsByTimestamp} from '@/utils/lrcParser';
import {errorLog} from '@/utils/log';
import {autoDecryptLyric} from '@/utils/musicDecrypter';
import Mp3Util from '@/native/mp3Util';

type Mp3UtilWithOptionalCover = typeof Mp3Util & {
    setMediaCover?: (filePath: string, coverPath: string) => Promise<boolean>;
    setMediaTagWithCover?: (
        filePath: string,
        meta: IMusicMetadata,
        coverPath?: string,
    ) => Promise<boolean>;
};

const nativeMp3Util = Mp3Util as Mp3UtilWithOptionalCover;

class MusicMetadataManager {
    private pluginManager: IPluginManager | null = null;

    injectPluginManager(pluginManager: IPluginManager) {
        this.pluginManager = pluginManager;
    }

    isAvailable() {
        return !!nativeMp3Util?.setMediaTag;
    }

    private buildMetadataFromMusicItem(
        musicItem: IMusic.IMusicItem,
    ): IMusicMetadata {
        const metadata: IMusicMetadata = {
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
        };

        const comments: string[] = [];
        if (musicItem.alias) {
            comments.push(`别名: ${musicItem.alias}`);
        }
        if (musicItem.duration) {
            const minutes = Math.floor(musicItem.duration / 60);
            const seconds = Math.floor(musicItem.duration % 60);
            comments.push(
                `时长: ${minutes}:${seconds.toString().padStart(2, '0')}`,
            );
        }
        if (comments.length) {
            metadata.comment = comments.join(' | ');
        }

        return metadata;
    }

    private async getCoverUrl(
        musicItem: IMusic.IMusicItem,
    ): Promise<string | undefined> {
        if (typeof musicItem.artwork === 'string' && musicItem.artwork.trim()) {
            return musicItem.artwork;
        }

        const plugin = this.pluginManager?.getByMedia(musicItem);
        if (!plugin?.methods.getMusicInfo) {
            return undefined;
        }

        const fullMusicInfo = await plugin.methods
            .getMusicInfo(musicItem)
            .catch(() => null);
        return fullMusicInfo?.artwork || undefined;
    }

    private async getLyricContent(
        musicItem: IMusic.IMusicItem,
        config: IDownloadMetadataConfig,
    ): Promise<string | undefined> {
        const plugin = this.pluginManager?.getByMedia(musicItem);
        if (!plugin?.methods.getLyric) {
            return undefined;
        }

        const lyricSource = await plugin.methods.getLyric(musicItem);
        if (!lyricSource) {
            return undefined;
        }

        const rawLrc = lyricSource.rawLrc
            ? await autoDecryptLyric(
                  lyricSource.rawLrc,
                  config.enableWordByWord,
              )
            : lyricSource.rawLrc;
        const translation = lyricSource.translation
            ? await autoDecryptLyric(
                  lyricSource.translation,
                  config.enableWordByWord,
              )
            : lyricSource.translation;
        const romanization = lyricSource.romanization
            ? await autoDecryptLyric(
                  lyricSource.romanization,
                  config.enableWordByWord,
              )
            : lyricSource.romanization;

        if (!rawLrc) {
            if (lyricSource.lrc && !lyricSource.lrc.startsWith('http')) {
                return autoDecryptLyric(
                    lyricSource.lrc,
                    config.enableWordByWord,
                );
            }
            return undefined;
        }

        return (
            formatLyricsByTimestamp(
                rawLrc,
                translation,
                romanization,
                config.lyricOrder,
                {enableWordByWord: config.enableWordByWord},
            ) || rawLrc
        );
    }

    async writeMetadataForDownloadTask(
        taskInfo: IDownloadTaskMetadata,
        config: IDownloadMetadataConfig,
    ) {
        if (!config.enabled || !this.isAvailable()) {
            return false;
        }

        try {
            const cleanFilePath = removeFileScheme(taskInfo.filePath);
            const metadata = {
                ...this.buildMetadataFromMusicItem(taskInfo.musicItem),
                ...taskInfo.metadata,
            };

            if (config.writeLyric) {
                const lyric = await this.getLyricContent(
                    taskInfo.musicItem,
                    config,
                );
                if (lyric) {
                    metadata.lyric = lyric;
                }
            }

            const coverUrl = config.writeCover
                ? taskInfo.coverUrl ??
                  (await this.getCoverUrl(taskInfo.musicItem))
                : undefined;

            if (coverUrl && nativeMp3Util.setMediaTagWithCover) {
                return await nativeMp3Util.setMediaTagWithCover(
                    cleanFilePath,
                    metadata,
                    coverUrl,
                );
            }

            await nativeMp3Util.setMediaTag(cleanFilePath, metadata);
            return true;
        } catch (error) {
            errorLog('写入音乐元数据失败', {
                filePath: taskInfo.filePath,
                musicItem: {
                    title: taskInfo.musicItem.title,
                    artist: taskInfo.musicItem.artist,
                    platform: taskInfo.musicItem.platform,
                },
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    async writeCoverOnly(filePath: string, coverUrl: string) {
        if (!nativeMp3Util.setMediaCover) {
            return false;
        }

        try {
            return await nativeMp3Util.setMediaCover(
                removeFileScheme(filePath),
                coverUrl,
            );
        } catch (error) {
            errorLog('写入音乐封面失败', {filePath, coverUrl, error});
            return false;
        }
    }

    async writeLyricOnly(filePath: string, lyricContent: string) {
        if (!this.isAvailable()) {
            return false;
        }

        try {
            await nativeMp3Util.setMediaTag(removeFileScheme(filePath), {
                lyric: lyricContent,
            });
            return true;
        } catch (error) {
            errorLog('写入歌词失败', {filePath, error});
            return false;
        }
    }

    async readMetadata(filePath: string) {
        if (!nativeMp3Util?.getMediaTag) {
            return null;
        }

        try {
            return await nativeMp3Util.getMediaTag(removeFileScheme(filePath));
        } catch (error) {
            errorLog('读取音乐元数据失败', {filePath, error});
            return null;
        }
    }
}

const musicMetadataManager = new MusicMetadataManager();

export {musicMetadataManager};
export default musicMetadataManager;
