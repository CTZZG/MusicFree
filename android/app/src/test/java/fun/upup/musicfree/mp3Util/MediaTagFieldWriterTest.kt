package `fun`.upup.musicfree.mp3Util

import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.asf.AsfTag
import org.jaudiotagger.tag.asf.AsfTagTextField
import org.jaudiotagger.tag.id3.ID3v24Tag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class MediaTagFieldWriterTest {
    @Test fun replacesAsfTitleAndRemovesItsStaleExtendedAlias() {
        val tag = AsfTag().apply {
            setField(FieldKey.TITLE, "Before Title")
            addField(AsfTagTextField("title", "Before Title"))
        }

        MediaTagFieldWriter.setField(tag, FieldKey.TITLE, "新标题")

        assertEquals("新标题", tag.getFirst(FieldKey.TITLE))
        assertFalse(tag.hasField("title"))
    }

    @Test fun removesAllArtistCaseAliasesWithoutChangingTheTitle() {
        val tag = AsfTag().apply {
            setField(FieldKey.TITLE, "Original Title")
            setField(FieldKey.ARTIST, "Before Artist")
            addField(AsfTagTextField("Author", "Before Artist"))
            addField(AsfTagTextField("author", "Other stale artist"))
        }

        MediaTagFieldWriter.setField(tag, FieldKey.ARTIST, "New Artist")

        assertEquals("New Artist", tag.getFirst(FieldKey.ARTIST))
        assertFalse(tag.hasField("Author"))
        assertFalse(tag.hasField("author"))
        assertEquals("Original Title", tag.getFirst(FieldKey.TITLE))
    }

    @Test fun updatingAlbumPreservesOtherFieldsAndTheirAliases() {
        val tag = AsfTag().apply {
            setField(FieldKey.TITLE, "Before Title")
            addField(AsfTagTextField("title", "Before Title"))
            addField(AsfTagTextField("Custom/Note", "Keep me"))
        }

        MediaTagFieldWriter.setField(tag, FieldKey.ALBUM, "New Album")

        assertEquals("New Album", tag.getFirst(FieldKey.ALBUM))
        assertEquals("Before Title", tag.getFirst("title"))
        assertEquals("Before Title", tag.getFirst(FieldKey.TITLE))
        assertEquals("Keep me", tag.getFirst("Custom/Note"))
    }

    @Test fun keepsTheExistingNonAsfSetterBehavior() {
        val tag = ID3v24Tag().apply {
            setField(FieldKey.TITLE, "Before Title")
            setField(FieldKey.ARTIST, "Keep Artist")
        }

        MediaTagFieldWriter.setField(tag, FieldKey.TITLE, "After Title")

        assertEquals("After Title", tag.getFirst(FieldKey.TITLE))
        assertEquals("Keep Artist", tag.getFirst(FieldKey.ARTIST))
    }
}
