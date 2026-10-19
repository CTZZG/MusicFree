package fun.upup.musicfree.mp3Util;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import org.jaudiotagger.tag.FieldDataInvalidException;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.TagField;
import org.jaudiotagger.tag.asf.AsfTag;

public final class MediaTagFieldWriter {
    private MediaTagFieldWriter() {}

    public static void setField(Tag tag, FieldKey key, String value)
            throws FieldDataInvalidException {
        if (!(tag instanceof AsfTag)) {
            tag.setField(key, value);
            return;
        }

        // FFmpeg writes both the ASF content description and case-variant
        // extended fields ("title", "Author"). jaudiotagger's generic setter
        // updates only "TITLE"/"AUTHOR", leaving stale aliases that other
        // readers prefer. Remove only aliases of the field being replaced.
        TagField replacement = tag.createField(key, value);
        String canonicalId = replacement.getId();
        Set<String> aliases = new HashSet<>();
        Iterator<TagField> fields = tag.getFields();
        while (fields.hasNext()) {
            String id = fields.next().getId();
            if (!id.equals(canonicalId) && id.equalsIgnoreCase(canonicalId)) {
                aliases.add(id);
            }
        }
        tag.setField(replacement);
        for (String alias : aliases) {
            tag.deleteField(alias);
        }
    }
}
