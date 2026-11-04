package fun.upup.musicfree.e2e.mvprobe;

/** Reads the fixture's rendered frame number, independently of mpv's clock. */
final class FrameCode {
    interface Pixels { int get(int x, int y); }
    static final int FPS = 24;

    private static int sample(int width, int height, Pixels pixels, int x, int y) {
        double scale = Math.min(width / 1280.0, height / 720.0);
        int px = (int) Math.round((width - 1280 * scale) / 2 + x * scale);
        int py = (int) Math.round((height - 720 * scale) / 2 + y * scale);
        return pixels.get(px, py);
    }
    static int read(int width, int height, Pixels pixels) {
        if (width < 320 || height < 180) return -1;
        int left = sample(width, height, pixels, 372, 72);
        int right = sample(width, height, pixels, 680, 72);
        // Fixed magenta/cyan guards distinguish the code from arbitrary video colours.
        if (((left >> 16) & 255) < 160 || (left & 255) < 160 || ((left >> 8) & 255) > 90
                || ((right >> 8) & 255) < 160 || (right & 255) < 160 || ((right >> 16) & 255) > 90) return -1;
        int frame = 0;
        for (int bit = 0; bit < 10; bit++) {
            int rgb = sample(width, height, pixels, 404 + bit * 28, 72);
            int r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
            if (Math.min(r, Math.min(g, b)) > 170) frame |= 1 << bit;
            else if (Math.max(r, Math.max(g, b)) > 85) return -1;
        }
        return frame;
    }
}
