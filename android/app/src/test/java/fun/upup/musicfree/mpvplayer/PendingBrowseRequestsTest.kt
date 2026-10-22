package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingBrowseRequestsTest {
    @Test
    fun onlyTheFirstRequestForAListAsksJs() {
        val pending = PendingBrowseRequests<String>()
        assertTrue(pending.add("library/favorite", "a"))
        assertFalse(pending.add("library/favorite", "b"))
        assertTrue(pending.add("library/recent", "c"))

        assertEquals(listOf("a", "b"), pending.take("library/favorite"))
        // 答复过就没人在等了，迟到的答复或超时什么也不做
        assertEquals(emptyList<String>(), pending.take("library/favorite"))
        // 再打开一次重新去要
        assertTrue(pending.add("library/favorite", "d"))
    }

    @Test
    fun everythingWaitingCanBeReleasedAtOnce() {
        val pending = PendingBrowseRequests<String>()
        pending.add("library/favorite", "a")
        pending.add("library/recent", "b")
        assertEquals(setOf("a", "b"), pending.takeAll().toSet())
        assertEquals(emptyList<String>(), pending.takeAll())
    }
}
