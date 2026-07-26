import pathConst from "@/constants/pathConst";
import { checkAndCreateDir } from "@/utils/fileUtils";

type EnsureDirectory = (path: string) => Promise<unknown>;

export async function setupAppFolders(
    ensureDirectory: EnsureDirectory = checkAndCreateDir,
) {
    await Promise.all([
        ensureDirectory(pathConst.dataPath),
        ensureDirectory(pathConst.logPath),
        ensureDirectory(pathConst.cachePath),
        ensureDirectory(pathConst.pluginPath),
        ensureDirectory(pathConst.lrcCachePath),
        ensureDirectory(pathConst.downloadCachePath),
        ensureDirectory(pathConst.localLrcPath),
        ensureDirectory(pathConst.downloadPath).then(() =>
            ensureDirectory(pathConst.downloadMusicPath),
        ),
    ]);
}
