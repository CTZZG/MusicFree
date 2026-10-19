import java.io.File;
import java.nio.file.Files;
import java.util.logging.Level;
import java.util.logging.Logger;
import fun.upup.musicfree.mp3Util.MediaTagFieldWriter;
import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.jaudiotagger.tag.images.ArtworkFactory;

public final class TaggingRoundTrip {
  public static void main(String[] args) throws Exception {
    Logger.getLogger("org.jaudiotagger").setLevel(Level.OFF);
    int failed = 0;
    for (int i = 1; i < args.length; ++i) {
      File file = new File(args[i]);
      try {
        AudioFile audio = AudioFileIO.read(file);
        Tag tag = audio.getTag();
        require("Before Title".equals(tag.getFirst(FieldKey.TITLE)), "initial title lost");
        MediaTagFieldWriter.setField(tag, FieldKey.TITLE, "After Title");
        MediaTagFieldWriter.setField(tag, FieldKey.ARTIST, "After Artist");
        MediaTagFieldWriter.setField(tag, FieldKey.ALBUM, "After Album");
        MediaTagFieldWriter.setField(tag, FieldKey.LYRICS, "[00:00.00]After lyric");
        tag.setField(ArtworkFactory.createArtworkFromFile(new File(args[0])));
        audio.commit();
        Tag read = AudioFileIO.read(file).getTag();
        require("After Title".equals(read.getFirst(FieldKey.TITLE)), "title not written");
        require("After Artist".equals(read.getFirst(FieldKey.ARTIST)), "artist not written");
        require("After Album".equals(read.getFirst(FieldKey.ALBUM)), "album not written");
        require("[00:00.00]After lyric".equals(read.getFirst(FieldKey.LYRICS)), "lyrics not written");
        require(java.util.Arrays.equals(Files.readAllBytes(new File(args[0]).toPath()), read.getFirstArtwork().getBinaryData()), "cover not written");
        System.out.println("PASS " + file.getName() + " read/write/title/artist/album/lyrics/cover");
      } catch (Throwable error) {
        failed++;
        System.out.println("FAIL " + file.getName() + " " + error);
        error.printStackTrace(System.out);
      }
    }
    if (failed != 0) throw new AssertionError(failed + " tagging paths failed");
  }
  static void require(boolean value, String message) {
    if (!value) throw new AssertionError(message);
  }
}
