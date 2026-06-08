/** 备份与恢复 */
/** 歌单、插件 */
import { compare } from "compare-versions";
import PluginManager from "./pluginManager";
import MusicSheet from "@/core/musicSheet";
import { ResumeMode } from "@/constants/commonConst.ts";
import LocalMusicSheet from "@/core/localMusicSheet";

/**
 * 结果：一份大的json文件
 * {
 *     musicSheets: [],
 *     plugins: [],
 * }
 */

interface IBackJson {
    musicSheets: IMusic.IMusicSheetItem[];
    localMusicSheet?: IMusic.IMusicItem[];
    starredMusicSheets?: IMusic.IMusicSheetItem[];
    plugins: Array<{ srcUrl: string; version: string }>;
}

function backup() {
    const musicSheets = MusicSheet.backupSheets();
    const localMusicSheet = LocalMusicSheet.getMusicList();
    const starredMusicSheets = MusicSheet.getStarredSheets();
    const plugins = PluginManager.getEnabledPlugins();
    const normalizedPlugins = plugins.map(_ => ({
        srcUrl: _.instance.srcUrl,
        version: _.instance.version,
    }));

    return JSON.stringify({
        musicSheets: musicSheets,
        localMusicSheet: localMusicSheet,
        starredMusicSheets: starredMusicSheets,
        plugins: normalizedPlugins,
    });
}

async function resume(
    raw: string | Object,
    resumeMode: ResumeMode = ResumeMode.Append,
) {
    let obj: IBackJson;
    if (typeof raw === "string") {
        obj = JSON.parse(raw);
    } else {
        obj = raw as IBackJson;
    }

    const { plugins, musicSheets, localMusicSheet, starredMusicSheets } =
        obj ?? {};
    /** 恢复插件 */
    const validPlugins = PluginManager.getEnabledPlugins();
    const resumePlugins = plugins?.map(_ => {
        // 校验是否安装过: 同源且本地版本更高就忽略掉
        if (
            validPlugins.find(
                plugin =>
                    plugin.instance.srcUrl === _.srcUrl &&
                    compare(
                        plugin.instance.version ?? "0.0.0",
                        _.version ?? "0.0.1",
                        ">=",
                    ),
            )
        ) {
            return;
        }
        return PluginManager.installPluginFromUrl(_.srcUrl);
    });

    /** 恢复歌单 */
    const resumeMusicSheets = MusicSheet.resumeSheets(musicSheets, resumeMode);
    const resumeLocalMusicSheet =
        LocalMusicSheet.resumeMusicList(localMusicSheet);
    const resumeStarredMusicSheets =
        MusicSheet.resumeStarredMusicSheets(starredMusicSheets);

    return Promise.all([
        ...(resumePlugins ?? []),
        resumeMusicSheets,
        resumeLocalMusicSheet,
        resumeStarredMusicSheets,
    ]);
}

const Backup = {
    backup,
    resume,
};
export default Backup;
