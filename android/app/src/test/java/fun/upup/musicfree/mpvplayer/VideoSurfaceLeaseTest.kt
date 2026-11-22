package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.*
import org.junit.Test

class VideoSurfaceLeaseTest {
    @Test fun oldViewCannotDetachOrReclaimNewOwner() {
        val lease = VideoSurfaceLease()
        assertTrue(lease.claim(1, 10))
        assertTrue(lease.claim(2, 10))
        assertFalse(lease.release(1))
        assertEquals(2L, lease.owner)
        assertFalse(lease.claim(1, 10))
        assertTrue(lease.release(2))
        assertFalse(lease.claim(1, 10))
    }
    @Test fun staleGenerationCannotClaimEvenWithNewerView() {
        val lease = VideoSurfaceLease()
        assertTrue(lease.claim(1, 11))
        assertFalse(lease.claim(3, 10))
        assertEquals(1L, lease.owner)
        assertTrue(lease.claim(3, 12))
        assertFalse(lease.release(1))
    }
}
