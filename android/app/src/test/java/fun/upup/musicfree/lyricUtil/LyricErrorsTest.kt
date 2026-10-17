package `fun`.upup.musicfree.lyricUtil

import org.junit.Assert.*
import org.junit.Test

class LyricErrorsTest {
    @Test fun onlyAMissingOverlayPermissionUsesThePermissionCode() {
        assertEquals("OVERLAY_PERMISSION", LyricErrors.code(OverlayPermissionException()))
        assertEquals(
            "OVERLAY_PERMISSION",
            LyricErrors.code(OverlayPermissionException(SecurityException("denied"))),
        )
        assertEquals("Exception", LyricErrors.code(IllegalArgumentException("View not attached")))
        assertEquals("Exception", LyricErrors.code(SecurityException("unwrapped")))
    }
}
