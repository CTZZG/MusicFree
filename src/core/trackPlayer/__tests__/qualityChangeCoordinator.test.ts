import QualityChangeCoordinator, {
    commitQualitySourcePair,
} from "../qualityChangeCoordinator";

describe("quality change coordinator", () => {
    it("skips a resolved request after a newer request begins", async () => {
        const coordinator = new QualityChangeCoordinator();
        const staleToken = coordinator.begin();
        const latestToken = coordinator.begin();
        const staleCommit = jest.fn().mockResolvedValue("stale");
        const latestCommit = jest.fn().mockResolvedValue("latest");

        await expect(
            coordinator.runLatest(staleToken, staleCommit),
        ).resolves.toEqual({ executed: false });
        await expect(
            coordinator.runLatest(latestToken, latestCommit),
        ).resolves.toEqual({ executed: true, value: "latest" });
        expect(staleCommit).not.toHaveBeenCalled();
        expect(latestCommit).toHaveBeenCalledTimes(1);
    });

    it("serializes an active commit so the latest request commits last", async () => {
        const coordinator = new QualityChangeCoordinator();
        const order: string[] = [];
        let committedSource = "initial";
        let releaseFirst!: () => void;
        const firstToken = coordinator.begin();
        const first = coordinator.runLatest(firstToken, async () => {
            order.push("first:start");
            await new Promise<void>(resolve => {
                releaseFirst = resolve;
            });
            committedSource = "first";
            order.push("first:end");
            return "first";
        });

        await Promise.resolve();
        await Promise.resolve();
        const latestToken = coordinator.begin();
        const latest = coordinator.runLatest(latestToken, async () => {
            committedSource = "latest";
            order.push("latest");
            return "latest";
        });

        expect(order).toEqual(["first:start"]);
        releaseFirst();
        await expect(first).resolves.toEqual({
            executed: true,
            value: "first",
        });
        await expect(latest).resolves.toEqual({
            executed: true,
            value: "latest",
        });
        expect(order).toEqual(["first:start", "first:end", "latest"]);
        expect(committedSource).toBe("latest");
    });

    it("supersedes a started commit and lets the latest quality replace its source", async () => {
        const coordinator = new QualityChangeCoordinator();
        let backendQuality = "standard";
        let stateQuality = "standard";
        let releaseSource!: () => void;
        const applySource = jest.fn(async (resumePosition: number) => {
            expect(resumePosition).toBe(73);
            backendQuality = "high";
            await new Promise<void>(resolve => {
                releaseSource = resolve;
            });
        });
        const firstToken = coordinator.begin();
        const first = coordinator.runLatest(firstToken, () =>
            commitQualitySourcePair({
                resumePosition: 73,
                applySource,
                isTargetCurrent: () => true,
                isRequestActive: () =>
                    coordinator.isActive(firstToken),
                applyQuality: () => {
                    stateQuality = "high";
                },
            }),
        );

        await Promise.resolve();
        await Promise.resolve();
        const latestToken = coordinator.begin();
        const latest = coordinator.runLatest(latestToken, () =>
            commitQualitySourcePair({
                resumePosition: 73,
                applySource: async () => {
                    backendQuality = "standard";
                },
                isTargetCurrent: () => true,
                isRequestActive: () =>
                    coordinator.isActive(latestToken),
                applyQuality: () => {
                    stateQuality = "standard";
                },
            }),
        );

        expect(coordinator.isActive(firstToken)).toBe(false);
        expect(coordinator.isActive(latestToken)).toBe(true);
        expect(coordinator.hasPendingCommit()).toBe(true);
        expect(backendQuality).toBe("high");
        expect(stateQuality).toBe("standard");
        releaseSource();
        await expect(first).resolves.toEqual({
            executed: true,
            value: false,
        });
        await expect(latest).resolves.toEqual({
            executed: true,
            value: true,
        });
        expect(applySource).toHaveBeenCalledTimes(1);
        expect(backendQuality).toBe("standard");
        expect(stateQuality).toBe("standard");
        expect(coordinator.hasPendingCommit()).toBe(false);
    });

    it("does not apply an old quality after the target track changes", async () => {
        let isTargetCurrent = true;
        const applyQuality = jest.fn();

        await expect(
            commitQualitySourcePair({
                resumePosition: 12,
                applySource: async () => {
                    isTargetCurrent = false;
                },
                isTargetCurrent: () => isTargetCurrent,
                isRequestActive: () => true,
                applyQuality,
            }),
        ).resolves.toBe(false);
        expect(applyQuality).not.toHaveBeenCalled();
    });

    it("continues the commit queue after an operation rejects", async () => {
        const coordinator = new QualityChangeCoordinator();
        const failedToken = coordinator.begin();
        const failed = coordinator.runLatest(failedToken, async () => {
            throw new Error("backend failed");
        });
        await expect(failed).rejects.toThrow("backend failed");

        const latestToken = coordinator.begin();
        await expect(
            coordinator.runLatest(latestToken, async () => "recovered"),
        ).resolves.toEqual({ executed: true, value: "recovered" });
    });
});
