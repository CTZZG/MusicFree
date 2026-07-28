package `fun`.upup.musicfree.qmc

import java.io.Closeable
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class QmcSessionRegistryTest {
    @Test
    fun idleSessionsExpireWithoutSleeping() {
        var now = 0L
        val registry = QmcSessionRegistry<String>(
            maxSessions = 2,
            idleTimeoutMs = 100L,
            now = { now },
        )
        registry.register("first", "value")

        now = 99L
        assertEquals(0, registry.evictIdle())
        assertTrue(registry.contains("first"))
        now = 100L
        assertEquals(1, registry.evictIdle())
        assertFalse(registry.contains("first"))
    }

    @Test
    fun activeLeaseProtectsSessionUntilItBecomesIdleAgain() {
        var now = 0L
        val registry = QmcSessionRegistry<String>(
            maxSessions = 1,
            idleTimeoutMs = 100L,
            now = { now },
        )
        registry.register("active", "stream")
        val lease = registry.acquire("active")
        assertNotNull(lease)

        now = 1_000L
        assertEquals(0, registry.evictIdle())
        assertTrue(registry.contains("active"))
        lease!!.close()
        lease.close()
        now = 1_099L
        assertEquals(0, registry.evictIdle())
        now = 1_100L
        assertEquals(1, registry.evictIdle())
    }

    @Test
    fun capacityEvictsOnlyTheOldestInactiveSession() {
        var now = 0L
        val registry = QmcSessionRegistry<String>(
            maxSessions = 2,
            idleTimeoutMs = 10_000L,
            now = { now },
        )
        registry.register("active", "a")
        val activeLease = registry.acquire("active")!!
        now = 1L
        registry.register("old", "b")
        now = 2L
        registry.register("new", "c")

        assertTrue(registry.contains("active"))
        assertFalse(registry.contains("old"))
        assertTrue(registry.contains("new"))
        assertEquals(2, registry.size)
        activeLease.close()
    }

    @Test
    fun registrationFailsRatherThanEvictingAnActiveSession() {
        val registry = QmcSessionRegistry<String>(
            maxSessions = 1,
            idleTimeoutMs = 100L,
        )
        registry.register("active", "a")
        val lease = registry.acquire("active")!!

        try {
            registry.register("new", "b")
            fail("expected busy capacity rejection")
        } catch (error: IllegalStateException) {
            assertTrue(error.message!!.contains("capacity is busy"))
        } finally {
            lease.close()
        }
        assertTrue(registry.contains("active"))
        assertFalse(registry.contains("new"))
    }

    @Test
    fun clearingRegistryClosesAnActiveResponseBodyExactlyOnce() {
        val registry = QmcSessionRegistry<String>(
            maxSessions = 1,
            idleTimeoutMs = 100L,
        )
        registry.register("active", "stream")
        val lease = registry.acquire("active")!!
        val closeCount = AtomicInteger()
        lease.attach(Closeable {
            closeCount.incrementAndGet()
            lease.close()
        })

        registry.clear()
        registry.clear()
        lease.close()

        assertEquals(1, closeCount.get())
        assertEquals(0, registry.size)
        assertFalse(registry.contains("active"))
    }
}
