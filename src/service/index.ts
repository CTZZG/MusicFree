import TrackPlayer from "@/core/trackPlayer";
import PersistStatus from "@/utils/persistStatus";

let lastProgressPersistTime = 0;

module.exports = async function () {
    const playerAdapter = TrackPlayer.playerAdapter;

    playerAdapter.addEventListener("progress", evt => {
        const now = Date.now();
        if (now - lastProgressPersistTime < 1000) {
            return;
        }
        lastProgressPersistTime = now;
        PersistStatus.set("music.progress", evt.position);
    });
};
