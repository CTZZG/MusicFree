package `fun`.upup.musicfree.qmc

import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

internal const val QMC_OUTPUT_TEMP_SUFFIX = ".qmc-temp"
internal const val QMC_OUTPUT_BACKUP_SUFFIX = ".qmc-backup"

internal object QmcFileDecoder {
    private const val BUFFER_SIZE = 128 * 1024
    private const val OUTPUT_LOCK_COUNT = 32
    private val outputLocks = Array(OUTPUT_LOCK_COUNT) { Any() }

    fun decrypt(
        inputPath: String,
        outputPath: String,
        ekey: String?,
    ): QmcStreamInfo {
        val inputFile = File(inputPath)
        require(inputFile.isFile) { "encrypted QMC file does not exist" }
        val outputFile = File(outputPath)
        require(inputFile.canonicalPath != outputFile.canonicalPath) {
            "QMC input and output paths must be different"
        }
        val outputLock = outputLocks[
            (outputFile.canonicalPath.hashCode() and Int.MAX_VALUE) % OUTPUT_LOCK_COUNT
        ]
        return synchronized(outputLock) {
            decryptLocked(inputFile, outputFile, ekey)
        }
    }

    private fun decryptLocked(
        inputFile: File,
        outputFile: File,
        ekey: String?,
    ): QmcStreamInfo {
        outputFile.parentFile?.let { parent ->
            require(parent.isDirectory || parent.mkdirs()) {
                "unable to create the QMC output directory"
            }
        }
        val tempFile = File(outputFile.path + QMC_OUTPUT_TEMP_SUFFIX)
        val backupFile = File(outputFile.path + QMC_OUTPUT_BACKUP_SUFFIX)
        recoverInterruptedReplacement(tempFile, backupFile, outputFile)

        try {
            val info = RandomAccessFile(inputFile, "r").use { input ->
                val source = FileSource(input)
                val decoder = QmcDecoder.discover(source, ekey)
                FileOutputStream(tempFile).use { output ->
                    val buffer = ByteArray(BUFFER_SIZE)
                    var absoluteOffset = 0L
                    while (absoluteOffset < decoder.info.audioSize) {
                        val requested = minOf(
                            buffer.size.toLong(),
                            decoder.info.audioSize - absoluteOffset,
                        ).toInt()
                        input.seek(absoluteOffset)
                        val read = input.read(buffer, 0, requested)
                        require(read > 0) { "encrypted QMC file ended before its audio payload" }
                        decoder.decrypt(buffer, 0, read, absoluteOffset)
                        output.write(buffer, 0, read)
                        absoluteOffset += read
                    }
                    output.fd.sync()
                }
                decoder.info
            }

            replaceOutput(tempFile, backupFile, outputFile)
            return info
        } catch (error: Throwable) {
            tempFile.delete()
            throw error
        }
    }

    private fun recoverInterruptedReplacement(
        tempFile: File,
        backupFile: File,
        outputFile: File,
    ) {
        if (tempFile.exists()) {
            check(tempFile.delete()) { "unable to remove stale QMC temporary output" }
        }
        if (!backupFile.exists()) return
        if (outputFile.exists()) {
            check(backupFile.delete()) { "unable to remove stale QMC output backup" }
        } else {
            check(backupFile.renameTo(outputFile)) {
                "unable to restore an interrupted QMC output replacement"
            }
        }
    }

    private fun replaceOutput(
        tempFile: File,
        backupFile: File,
        outputFile: File,
    ) {
        if (!outputFile.exists()) {
            check(tempFile.renameTo(outputFile)) {
                "unable to move the decrypted QMC output into place"
            }
            return
        }

        check(outputFile.renameTo(backupFile)) {
            "unable to preserve the existing QMC output before replacement"
        }
        if (!tempFile.renameTo(outputFile)) {
            check(backupFile.renameTo(outputFile)) {
                "unable to restore the existing QMC output; it remains at ${backupFile.path}"
            }
            throw IllegalStateException("unable to move the decrypted QMC output into place")
        }
        check(backupFile.delete()) {
            "decrypted QMC output installed but its backup could not be removed"
        }
    }

    private class FileSource(
        private val file: RandomAccessFile,
    ) : QmcRandomAccessSource {
        override val size: Long = file.length()

        override fun readAt(offset: Long, length: Int): ByteArray {
            require(offset >= 0L && length >= 0 && offset <= size - length) {
                "QMC file read range is invalid"
            }
            return ByteArray(length).also { output ->
                file.seek(offset)
                file.readFully(output)
            }
        }
    }
}
