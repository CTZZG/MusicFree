package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingBrowseRequestsTest {
    @Test
    fun onlyTheFirstRequestForAListAsksJs() {
        val pending = PendingBrowseRequests<String>()
        val first = requireNotNull(pending.add("library/favorite", "a"))
        assertNull(pending.add("library/favorite", "b"))
        assertNotNull(pending.add("library/recent", "c"))

        assertEquals(listOf("a", "b"), pending.take("library/favorite", first))
        // 答复过就没人在等了，迟到的答复或超时什么也不做
        assertEquals(emptyList<String>(), pending.take("library/favorite", first))
        // 再打开一次重新去要
        assertNotNull(pending.add("library/favorite", "d"))
    }

    @Test
    fun anExpiredAnswerOrTimeoutCannotConsumeTheNextRequestForTheSameList() {
        val pending = PendingBrowseRequests<String>()
        val expired = requireNotNull(pending.add("library/favorite", "old car request"))
        assertEquals(listOf("old car request"), pending.take("library/favorite", expired))
        val current = requireNotNull(pending.add("library/favorite", "new car request"))
        assertNotEquals(expired, current)
        // JS is delayed past the five-second deadline. Its old answer arrives after reopening.
        assertTrue(pending.take("library/favorite", expired).isEmpty())
        // The late answer must not remove the new timeout or the new waiters.
        assertEquals(listOf("new car request"), pending.take("library/favorite", current))
    }

    @Test
    fun repliesFromADestroyedBrowserCannotMatchItsReplacement() {
        val before = PendingBrowseRequests<String>()
        val oldId = requireNotNull(before.add("library/recent", "old"))
        before.takeAll()
        val after = PendingBrowseRequests<String>()
        val newId = requireNotNull(after.add("library/recent", "new"))
        assertNotEquals(oldId, newId)
        assertTrue(after.take("library/recent", oldId).isEmpty())
        assertEquals(listOf("new"), after.take("library/recent", newId))
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
