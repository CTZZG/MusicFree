package `fun`.upup.musicfree.mpvplayer

import org.junit.Assert.*
import org.junit.Test

class MpvFileEventsTest {
    @Test fun exactLongIdsAndErrorReasonsSurvive() {
        val events = MpvFileEvents<String>()
        val id = 9007199254740993L
        events.replace(id, "video-A", "mv")
        val end = events.end(events.epoch, id, 4, -13, 0, 0)!!
        assertEquals(id, end.file.id)
        assertEquals("video-A", end.file.owner)
        assertEquals(MpvFileEvents.Reason.ERROR, end.reason)
        assertEquals(-13, end.error)
        assertNull(events.end(events.epoch, id, 0, 0, 0, 0))
    }

    @Test fun everyReasonIsClassifiedWithoutGuessingEof() {
        val expected = mapOf(0 to MpvFileEvents.Reason.EOF, 2 to MpvFileEvents.Reason.STOP,
            3 to MpvFileEvents.Reason.QUIT, 4 to MpvFileEvents.Reason.ERROR, 99 to MpvFileEvents.Reason.UNKNOWN)
        for ((reason, classification) in expected) {
            val events = MpvFileEvents<String>()
            events.replace(1, "A", "mv")
            assertEquals(classification, events.end(events.epoch, 1, reason, 0, 0, 0)!!.reason)
        }
    }

    @Test fun errorCodeCannotBeDowngradedToEof() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "mv")
        assertEquals(MpvFileEvents.Reason.ERROR, events.end(events.epoch, 1, 0, -20, 0, 0)!!.reason)
    }

    @Test fun oldInstancesAndUnknownEntriesCannotEndTheCurrentFile() {
        val events = MpvFileEvents<String>()
        val oldEpoch = events.epoch
        events.replace(1, "A", "mv")
        events.reset()
        events.replace(1, "B", "audio")
        assertNull(events.end(oldEpoch, 1, 4, -13, 0, 0))
        assertNull(events.end(events.epoch, 999, 0, 0, 0, 0))
        assertEquals("B", events.start(1)!!.owner)
    }

    @Test fun identicalUrlsOrOwnersDoNotMakeDifferentEntriesInterchangeable() {
        val events = MpvFileEvents<String>()
        events.replace(1, "same-url", "mv")
        events.replace(2, "same-url", "mv")
        assertNull(events.end(events.epoch, 1, 0, 0, 0, 0))
        assertEquals(2L, events.end(events.epoch, 2, 0, 0, 0, 0)!!.file.id)
    }

    @Test fun automaticSuccessorsStayInTheirRootAndCanBeDiscarded() {
        val events = MpvFileEvents<String>()
        events.replace(1, "video-A", "mv")
        events.append(2, "audio-B", 1)
        events.append(3, "audio-C", 2)
        assertEquals(1L, events.get(3)!!.rootId)
        assertEquals(setOf(2L, 3L), events.discardPrepared())
        assertNull(events.start(2))
        assertEquals("video-A", events.get(1)!!.owner)
    }

    @Test fun aNewUserSelectionRevokesOldAutomaticSuccessors() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "mv")
        events.append(2, "B-auto", 1)
        events.replace(3, "B-user", "audio")
        assertNull(events.end(events.epoch, 1, 4, -13, 0, 0))
        assertNull(events.start(2))
        assertEquals("B-user", events.start(3)!!.owner)
    }

    @Test fun promotedAudioSurvivesClearingTheNextPreparedRunway() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "audio")
        events.append(2, "B", 1)
        events.end(events.epoch, 1, 0, 0, 0, 0)
        assertEquals("B", events.promotePrepared(2, 2)!!.owner)
        events.append(3, "C", 2)
        assertEquals(setOf(3L), events.discardPrepared())
        assertEquals("B", events.loaded(2)!!.owner)
        assertFalse(events.get(2)!!.prepared)
    }

    @Test fun redirectedPreparedEntryPromotesByExactLineageInsteadOfUrl() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "audio")
        events.append(2, "B", 1)
        events.end(events.epoch, 2, 5, 0, 40, 1)
        assertEquals("B", events.preparedEntry(40, 2)!!.owner)
        assertEquals(40L, events.promotePrepared(40, 2)!!.id)
        events.discardPrepared()
        assertEquals("B", events.loaded(40)!!.owner)
    }

    @Test fun preparedPromotionCannotBorrowAnotherOwnersEntry() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "audio")
        events.append(2, "B", 1)
        events.append(3, "C", 1)
        assertNull(events.promotePrepared(3, 2))
        events.replace(4, "B", "audio")
        assertNull(events.promotePrepared(4, 2))
    }

    @Test fun redirectChildrenRetainOwnershipWithoutNaturalEnd() {
        val events = MpvFileEvents<String>()
        events.replace(1, "playlist-A", "mv")
        assertEquals(MpvFileEvents.Reason.REDIRECT, events.end(events.epoch, 1, 5, 0, 40, 2)!!.reason)
        assertEquals("playlist-A", events.start(41)!!.owner)
        assertEquals(1L, events.get(40)!!.rootId)
        assertNull(events.start(1))
    }

    @Test fun malformedRedirectFailsClosed() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "mv")
        assertEquals(MpvFileEvents.Reason.ERROR, events.end(events.epoch, 1, 5, 0, Long.MAX_VALUE, 20)!!.reason)
    }

    @Test fun eachRedirectChildNeedsItsOwnLoadedAndPlaybackRestart() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "mv")
        events.loaded(1); events.restarted(1)
        assertNotNull(events.ready(1))
        events.end(events.epoch, 1, 5, 0, 40, 1)
        assertNull(events.ready(1))
        events.start(40); events.loaded(40)
        assertNull(events.ready(40))
        events.restarted(40)
        assertEquals("A", events.ready(40)!!.owner)
    }

    @Test fun restartAloneAndLateCallbacksCannotMakeAnUnloadedOrEndedEntryReady() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "audio")
        events.restarted(1)
        assertNull(events.ready(1))
        events.loaded(1)
        assertNotNull(events.ready(1))
        events.end(events.epoch, 1, 4, -13, 0, 0)
        assertNull(events.restarted(1))
        assertNull(events.loaded(1))
        assertNull(events.ready(1))
    }

    @Test fun redirectCollisionCannotRegisterAPartialChildSet() {
        val events = MpvFileEvents<String>()
        events.replace(1, "A", "mv")
        events.append(41, "B", 1)
        assertEquals(MpvFileEvents.Reason.ERROR, events.end(events.epoch, 1, 5, 0, 40, 2)!!.reason)
        assertNull(events.get(40))
    }

    @Test fun stopClearsEntriesWithoutInvalidatingTheLiveInstanceObserverEpoch() {
        val events = MpvFileEvents<String>()
        val epoch = events.epoch
        events.replace(1, "A", "mv")
        events.clear()
        events.replace(2, "B", "audio")
        assertEquals(epoch, events.epoch)
        assertNull(events.start(1))
        assertEquals("B", events.start(2)!!.owner)
    }

    @Test fun completedHistoryIsBoundedWithoutDroppingTheActiveSuccessor() {
        val events = MpvFileEvents<Int>()
        events.replace(1, 1, "audio")
        for (id in 2L..600L) {
            events.append(id, id.toInt(), id - 1)
            events.end(events.epoch, id - 1, 0, 0, 0, 0)
        }
        assertEquals(600, events.start(600)!!.owner)
    }
}
