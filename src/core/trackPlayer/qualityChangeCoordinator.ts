export interface IQualityChangeRequestToken {
    readonly id: number;
}

export type LatestQualityCommitResult<T> =
    | { executed: false }
    | { executed: true; value: T };

interface IQualitySourceCommitOptions {
    resumePosition: number;
    applySource: (resumePosition: number) => Promise<void>;
    isTargetCurrent: () => boolean;
    isRequestActive: () => boolean;
    applyQuality: () => void;
}

export async function commitQualitySourcePair({
    resumePosition,
    applySource,
    isTargetCurrent,
    isRequestActive,
    applyQuality,
}: IQualitySourceCommitOptions) {
    if (!isTargetCurrent() || !isRequestActive()) {
        return false;
    }

    // Source loading cannot be cancelled, so a newer request may supersede this
    // commit while the backend is applying it.
    await applySource(resumePosition);
    if (!isTargetCurrent() || !isRequestActive()) {
        return false;
    }
    applyQuality();
    return true;
}

export default class QualityChangeCoordinator {
    private latestRequestId = 0;
    private commitTail: Promise<void> = Promise.resolve();
    private pendingCommitCount = 0;

    begin(): IQualityChangeRequestToken {
        return { id: ++this.latestRequestId };
    }

    isActive(token: IQualityChangeRequestToken) {
        return token.id === this.latestRequestId;
    }

    hasPendingCommit() {
        return this.pendingCommitCount > 0;
    }

    runLatest<T>(
        token: IQualityChangeRequestToken,
        operation: () => Promise<T>,
    ): Promise<LatestQualityCommitResult<T>> {
        this.pendingCommitCount += 1;
        const run = async (): Promise<LatestQualityCommitResult<T>> => {
            if (!this.isActive(token)) {
                return { executed: false };
            }
            return {
                executed: true,
                value: await operation(),
            };
        };
        const result = this.commitTail.then(run, run);
        const settledResult = result.then(
            value => {
                this.pendingCommitCount -= 1;
                return value;
            },
            error => {
                this.pendingCommitCount -= 1;
                throw error;
            },
        );
        this.commitTail = settledResult.then(
            () => undefined,
            () => undefined,
        );
        return settledResult;
    }
}
