package `fun`.upup.musicfree.qmc

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class QmcProxyLifecycleTest {
    @Test
    fun `detaching an old owner keeps resources for a new owner`() {
        val lifecycle = QmcProxyLifecycle()
        val oldOwner = lifecycle.attachOwner()
        val newOwner = lifecycle.attachOwner()
        var cleanupCount = 0

        lifecycle.detachOwner(oldOwner) { cleanupCount += 1 }

        assertEquals("active", lifecycle.withActiveOwner(newOwner) { "active" })
        assertEquals(0, cleanupCount)

        lifecycle.detachOwner(newOwner) { cleanupCount += 1 }
        assertEquals(1, cleanupCount)
    }

    @Test
    fun `work from a detached owner is rejected`() {
        val lifecycle = QmcProxyLifecycle()
        val owner = lifecycle.attachOwner()
        lifecycle.detachOwner(owner) {}

        assertThrows(IllegalStateException::class.java) {
            lifecycle.withActiveOwner(owner) { "unexpected" }
        }
    }

    @Test
    fun `last owner cleanup waits for active registration`() {
        val lifecycle = QmcProxyLifecycle()
        val owner = lifecycle.attachOwner()
        val operationEntered = CountDownLatch(1)
        val releaseOperation = CountDownLatch(1)
        val cleanupCalled = AtomicBoolean(false)
        val executor = Executors.newFixedThreadPool(2)

        try {
            val operation = executor.submit {
                lifecycle.withActiveOwner(owner) {
                    operationEntered.countDown()
                    releaseOperation.await(10, TimeUnit.SECONDS)
                }
            }
            assertTrue(operationEntered.await(2, TimeUnit.SECONDS))

            val detach = executor.submit {
                lifecycle.detachOwner(owner) { cleanupCalled.set(true) }
            }
            assertThrows(TimeoutException::class.java) {
                detach.get(100, TimeUnit.MILLISECONDS)
            }
            assertFalse(cleanupCalled.get())

            releaseOperation.countDown()
            operation.get(2, TimeUnit.SECONDS)
            detach.get(2, TimeUnit.SECONDS)
            assertTrue(cleanupCalled.get())
        } finally {
            releaseOperation.countDown()
            executor.shutdownNow()
        }
    }
}
