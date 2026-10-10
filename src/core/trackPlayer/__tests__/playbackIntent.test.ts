import { PlaybackIntent } from "../playbackIntent";

describe("PlaybackIntent", () => {
    it("lets playback start on its own at first", () => {
        expect(new PlaybackIntent().mayAutoPlay()).toBe(true);
    });

    it("keeps a user pause until the user plays again", () => {
        const intent = new PlaybackIntent();
        intent.pause();
        expect(intent.mayAutoPlay()).toBe(false);

        intent.play();
        expect(intent.mayAutoPlay()).toBe(true);
    });

    it("resumes after an interruption only when nobody paused", () => {
        const intent = new PlaybackIntent();
        intent.interrupt();
        expect(intent.mayAutoPlay()).toBe(false);

        expect(intent.endInterruption()).toBe(true);
        expect(intent.mayAutoPlay()).toBe(true);
    });

    it("stays paused after an interruption when the user paused before it", () => {
        const intent = new PlaybackIntent();
        intent.pause();
        intent.interrupt();

        expect(intent.endInterruption()).toBe(false);
        expect(intent.mayAutoPlay()).toBe(false);
    });

    it("stays paused after an interruption when the user paused during it", () => {
        const intent = new PlaybackIntent();
        intent.interrupt();
        intent.pause();

        expect(intent.endInterruption()).toBe(false);
        expect(intent.mayAutoPlay()).toBe(false);
    });

    it("ends the interruption early when the user plays during it", () => {
        const intent = new PlaybackIntent();
        intent.interrupt();
        intent.play();

        expect(intent.mayAutoPlay()).toBe(true);
        // 系统之后还回焦点，不算新的“接着放”
        expect(intent.endInterruption()).toBe(false);
    });
});
