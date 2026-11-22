package `fun`.upup.musicfree.mpvplayer

import dev.jdtech.mpv.MPVLib
import org.junit.Assert.*
import org.junit.Test

class BridgeObserverCompatibilityTest {
    private open class Observer : MPVLib.EventObserver {
        val numeric = mutableListOf<Int>()
        override fun eventProperty(property: String) = Unit
        override fun eventProperty(property: String, value: Long) = Unit
        override fun eventProperty(property: String, value: Double) = Unit
        override fun eventProperty(property: String, value: Boolean) = Unit
        override fun eventProperty(property: String, value: String) = Unit
        override fun event(eventId: Int) { numeric.add(eventId) }
    }

    @Test fun legacyObserverReceivesExactlyOneNumericEvent() {
        val observer = Observer()
        observer.eventWithFile(6, 9007199254740993L)
        observer.eventEndFile(4, -13, 9007199254740993L, 0, 0)
        assertEquals(listOf(6, 7), observer.numeric)
    }

    @Test fun typedObserverIsNotAlsoSentTheLegacyEnd() {
        val payload = mutableListOf<Long>()
        val observer = object : Observer() {
            override fun eventEndFile(reason: Int, error: Int, entryId: Long, insertId: Long, insertCount: Int) {
                payload.add(entryId)
                assertEquals(4, reason)
                assertEquals(-13, error)
            }
        }
        observer.eventEndFile(4, -13, 9007199254740993L, 0, 0)
        assertEquals(listOf(9007199254740993L), payload)
        assertTrue(observer.numeric.isEmpty())
    }
}
