package `fun`.upup.musicfree.storageuri

import android.app.Activity
import android.app.RecoverableSecurityException
import android.content.ClipData
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import `fun`.upup.musicfree.bridge.CancelablePromise
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.ArrayDeque
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

class StorageUriModule(
    reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val MODULE_NAME = "StorageUri"
        private const val REQUEST_OPEN_DOCUMENT = 17401
        private const val REQUEST_CREATE_DOCUMENT = 17402
        private const val REQUEST_WRITE_ACCESS = 17403
        private const val REQUEST_OPEN_DIRECTORY = 17404
        private const val DEFAULT_MAX_TEXT_BYTES = 8 * 1024 * 1024
        private const val MAX_TEXT_BYTES = 32 * 1024 * 1024
        private const val MAX_DIRECTORY_ENTRIES = 50_000
        private const val MAX_DIRECTORY_DEPTH = 64
    }

    private sealed class PendingRequest(
        open val promise: CancelablePromise
    ) {
        data class Pick(
            override val promise: CancelablePromise
        ) : PendingRequest(promise)
        data class PickDirectory(
            override val promise: CancelablePromise
        ) : PendingRequest(promise)
        data class Export(
            override val promise: CancelablePromise,
            val sourceFile: File
        ) : PendingRequest(promise)
        data class WriteAccess(
            override val promise: CancelablePromise
        ) : PendingRequest(promise)
    }

    private data class DirectoryScanOperation(
        val promise: CancelablePromise,
        val cancellationSignal: CancellationSignal
    )

    private val ioExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "MusicFree-StorageUri").apply { isDaemon = true }
    }
    private val invalidated = AtomicBoolean(false)
    private val activePromises =
        ConcurrentHashMap.newKeySet<CancelablePromise>()
    private val pendingLock = Any()
    private var pendingRequest: PendingRequest? = null
    private val directoryScanLock = Any()
    private var activeDirectoryScan: DirectoryScanOperation? = null

    private inner class PendingIoTask(
        private val promise: CancelablePromise,
        private val action: () -> Unit
    ) : Runnable {
        override fun run() {
            if (invalidated.get()) {
                promise.cancel()
                return
            }
            try {
                action()
            } catch (error: Throwable) {
                promise.reject(
                    "E_STORAGE_URI_UNEXPECTED",
                    "Storage operation failed unexpectedly",
                    error
                )
            }
        }

        fun rejectCancelled() {
            promise.cancel()
        }
    }

    private fun controlledPromise(promise: Promise): CancelablePromise {
        if (promise is CancelablePromise) {
            if (!promise.isSettled) {
                activePromises.add(promise)
            }
            return promise
        }
        val controlled = CancelablePromise(
            promise,
            "E_STORAGE_URI_CANCELLED",
            "Storage operation was cancelled"
        ) {
            activePromises.remove(it)
        }
        activePromises.add(controlled)
        if (invalidated.get()) {
            controlled.cancel()
        }
        return controlled
    }

    private fun executeIo(
        promise: Promise,
        action: (CancelablePromise) -> Unit
    ) {
        val controlled = controlledPromise(promise)
        if (invalidated.get()) {
            controlled.cancel()
            return
        }
        val task = PendingIoTask(controlled) {
            action(controlled)
        }
        try {
            ioExecutor.execute(task)
        } catch (_: RejectedExecutionException) {
            task.rejectCancelled()
        }
    }

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(
            activity: Activity,
            requestCode: Int,
            resultCode: Int,
            data: Intent?
        ) {
            if (
                requestCode != REQUEST_OPEN_DOCUMENT &&
                requestCode != REQUEST_CREATE_DOCUMENT &&
                requestCode != REQUEST_WRITE_ACCESS &&
                requestCode != REQUEST_OPEN_DIRECTORY
            ) {
                return
            }
            val pending = synchronized(pendingLock) {
                pendingRequest.also { pendingRequest = null }
            } ?: return

            if (pending is PendingRequest.WriteAccess) {
                pending.promise.resolve(resultCode == Activity.RESULT_OK)
                return
            }
            if (resultCode != Activity.RESULT_OK || data == null) {
                pending.promise.resolve(
                    when (pending) {
                        is PendingRequest.Pick -> Arguments.createArray()
                        else -> null
                    }
                )
                return
            }

            when (pending) {
                is PendingRequest.Pick -> resolvePickedDocuments(
                    data,
                    pending.promise
                )
                is PendingRequest.PickDirectory -> resolvePickedDirectory(
                    data,
                    pending.promise
                )
                is PendingRequest.Export -> resolveDocumentExport(
                    data.data,
                    pending
                )
                is PendingRequest.WriteAccess -> Unit
            }
        }
    }

    init {
        reactContext.addActivityEventListener(activityEventListener)
    }

    override fun getName() = MODULE_NAME

    override fun invalidate() {
        if (!invalidated.compareAndSet(false, true)) {
            return
        }
        reactApplicationContext.removeActivityEventListener(
            activityEventListener
        )
        activePromises.toList().forEach { it.cancel() }
        ioExecutor.shutdownNow().forEach { task ->
            if (task is PendingIoTask) {
                task.rejectCancelled()
            }
        }
        synchronized(pendingLock) {
            pendingRequest?.promise?.cancel()
            pendingRequest = null
        }
        synchronized(directoryScanLock) {
            activeDirectoryScan?.promise?.cancel()
            activeDirectoryScan?.cancellationSignal?.cancel()
            activeDirectoryScan = null
        }
        super.invalidate()
    }

    private fun parseUri(value: String): Uri {
        require(value.isNotBlank()) { "Storage URI is empty" }
        return Uri.parse(value)
    }

    private fun localFile(value: String): File {
        val uri = parseUri(value)
        require(uri.scheme == null || uri.scheme.equals("file", true)) {
            "Storage location is not a file"
        }
        val path = if (uri.scheme.equals("file", true)) {
            uri.path
        } else {
            value
        }
        require(!path.isNullOrBlank()) { "File path is invalid" }
        return File(path)
    }

    private fun isAppScoped(file: File): Boolean {
        val canonicalPath = file.canonicalFile.path
        val context = reactApplicationContext
        val roots = listOfNotNull(
            context.filesDir,
            context.cacheDir,
            context.noBackupFilesDir,
            context.externalCacheDir,
            context.getExternalFilesDir(null)
        ).map { it.canonicalFile.path }
        return roots.any { root ->
            canonicalPath == root ||
                canonicalPath.startsWith("$root${File.separator}")
        }
    }

    private fun requireAppScoped(file: File): File {
        require(isAppScoped(file)) {
            "Destination must be inside app-scoped storage"
        }
        return file
    }

    private fun openInput(uriValue: String): InputStream {
        val uri = parseUri(uriValue)
        return if (uri.scheme.equals("content", true)) {
            reactApplicationContext.contentResolver.openInputStream(uri)
                ?: throw IllegalStateException("Unable to open content URI")
        } else {
            FileInputStream(localFile(uriValue))
        }
    }

    private fun queryContentMetadata(uri: Uri): WritableMap {
        var displayName: String? = null
        var size: Long? = null
        val resolver = reactApplicationContext.contentResolver
        resolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                displayName = cursor.optionalString(
                    OpenableColumns.DISPLAY_NAME
                )
                size = cursor.optionalLong(OpenableColumns.SIZE)
            }
        }
        if (size == null) {
            resolver.openAssetFileDescriptor(uri, "r")?.use {
                if (it.length >= 0) {
                    size = it.length
                }
            }
        }
        return Arguments.createMap().apply {
            putString("uri", uri.toString())
            putString("kind", "content-uri")
            putBoolean("exists", true)
            putNullableString("displayName", displayName)
            putNullableString("mimeType", resolver.getType(uri))
            putNullableDouble("size", size)
        }
    }

    private data class DirectoryDocument(
        val uri: Uri,
        val displayName: String,
        val mimeType: String?,
        val size: Long?
    )

    private data class DirectoryNode(
        val documentId: String,
        val depth: Int
    )

    private class DirectoryScanLimitException(message: String) :
        IllegalStateException(message)

    private fun fileMetadata(file: File, original: String): WritableMap {
        return Arguments.createMap().apply {
            putString("uri", original)
            putString("kind", "file-path")
            putBoolean("exists", file.exists())
            putNullableString("displayName", file.name.takeIf { it.isNotBlank() })
            putNullableString("mimeType", null)
            putNullableDouble("size", file.takeIf { it.exists() }?.length())
        }
    }

    private fun metadata(uriValue: String): WritableMap {
        val uri = parseUri(uriValue)
        return if (uri.scheme.equals("content", true)) {
            queryContentMetadata(uri)
        } else {
            fileMetadata(localFile(uriValue), uriValue)
        }
    }

    private fun WritableMap.putNullableString(key: String, value: String?) {
        if (value == null) putNull(key) else putString(key, value)
    }

    private fun WritableMap.putNullableDouble(key: String, value: Long?) {
        if (value == null) putNull(key) else putDouble(key, value.toDouble())
    }

    private fun Cursor.optionalString(columnName: String): String? {
        val index = getColumnIndex(columnName)
        return if (index >= 0 && !isNull(index)) getString(index) else null
    }

    private fun Cursor.optionalLong(columnName: String): Long? {
        val index = getColumnIndex(columnName)
        return if (index >= 0 && !isNull(index)) getLong(index) else null
    }

    private fun rejectStorageError(
        promise: Promise,
        code: String,
        message: String,
        error: Exception
    ) {
        val resolvedCode = if (
            error is SecurityException &&
            code == "E_STORAGE_URI_READ"
        ) {
            "E_URI_PERMISSION_REVOKED"
        } else {
            code
        }
        promise.reject(resolvedCode, message)
    }

    @ReactMethod
    fun getMetadata(uri: String, promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                operationPromise.resolve(metadata(uri))
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_READ",
                    "Unable to read storage metadata",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun exists(uri: String, promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                val parsed = parseUri(uri)
                if (parsed.scheme.equals("content", true)) {
                    reactApplicationContext.contentResolver
                        .openAssetFileDescriptor(parsed, "r")
                        ?.use { operationPromise.resolve(true) }
                        ?: operationPromise.resolve(false)
                } else {
                    operationPromise.resolve(localFile(uri).exists())
                }
            } catch (error: SecurityException) {
                operationPromise.reject(
                    "E_URI_PERMISSION_REVOKED",
                    "Storage permission is no longer available"
                )
            } catch (_: Exception) {
                operationPromise.resolve(false)
            }
        }
    }

    @ReactMethod
    fun readText(uri: String, maxBytes: Double, promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                val limit = maxBytes.toLong()
                    .takeIf { it > 0 }
                    ?.coerceAtMost(MAX_TEXT_BYTES.toLong())
                    ?: DEFAULT_MAX_TEXT_BYTES.toLong()
                openInput(uri).use { input ->
                    val output = ByteArrayOutputStream()
                    val buffer = ByteArray(32 * 1024)
                    var total = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        total += read
                        require(total <= limit) {
                            "Document exceeds the read limit"
                        }
                        output.write(buffer, 0, read)
                    }
                    operationPromise.resolve(
                        output.toString(Charsets.UTF_8.name())
                    )
                }
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_READ",
                    "Unable to read document",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun copyToApp(uri: String, destinationPath: String, promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                val destination = requireAppScoped(localFile(destinationPath))
                destination.parentFile?.mkdirs()
                val temporary = File(
                    destination.parentFile,
                    ".${destination.name}.${System.nanoTime()}.tmp"
                )
                try {
                    openInput(uri).use { input ->
                        temporary.outputStream().use { output ->
                            input.copyTo(output)
                            output.fd.sync()
                        }
                    }
                    check(temporary.renameTo(destination)) {
                        "Unable to commit copied document"
                    }
                } finally {
                    temporary.delete()
                }
                operationPromise.resolve(null)
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_COPY",
                    "Unable to copy document into app storage",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun delete(uri: String, promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                val parsed = parseUri(uri)
                val deleted = if (parsed.scheme.equals("content", true)) {
                    reactApplicationContext.contentResolver.delete(
                        parsed,
                        null,
                        null
                    ) > 0
                } else {
                    requireAppScoped(localFile(uri)).delete()
                }
                operationPromise.resolve(deleted)
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_DELETE",
                    "Unable to delete storage item",
                    error
                )
            }
        }
    }

    private fun beginRequest(request: PendingRequest): Boolean {
        synchronized(pendingLock) {
            if (invalidated.get()) {
                request.promise.cancel()
                return false
            }
            if (pendingRequest != null) {
                request.promise.reject(
                    "E_STORAGE_URI_BUSY",
                    "Another storage request is already active"
                )
                return false
            }
            pendingRequest = request
            return true
        }
    }

    @ReactMethod
    fun pickDocuments(
        mimeTypes: ReadableArray,
        allowMultiple: Boolean,
        promise: Promise
    ) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject(
                "E_STORAGE_URI_NO_ACTIVITY",
                "Document picker is unavailable"
            )
            return
        }
        val request = PendingRequest.Pick(controlledPromise(promise))
        if (!beginRequest(request)) {
            return
        }

        try {
            val requestedTypes = (0 until mimeTypes.size())
                .mapNotNull { mimeTypes.getString(it)?.trim() }
                .filter { it.isNotBlank() }
                .distinct()
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = requestedTypes.singleOrNull() ?: "*/*"
                if (requestedTypes.size > 1) {
                    putExtra(
                        Intent.EXTRA_MIME_TYPES,
                        requestedTypes.toTypedArray()
                    )
                }
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
            }
            activity.startActivityForResult(intent, REQUEST_OPEN_DOCUMENT)
        } catch (_: Exception) {
            synchronized(pendingLock) {
                pendingRequest = null
            }
            request.promise.reject(
                "E_STORAGE_URI_PICKER",
                "Unable to open document picker"
            )
        }
    }

    @ReactMethod
    fun pickDirectory(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject(
                "E_STORAGE_URI_NO_ACTIVITY",
                "Directory picker is unavailable"
            )
            return
        }
        val request = PendingRequest.PickDirectory(controlledPromise(promise))
        if (!beginRequest(request)) {
            return
        }

        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
                )
            }
            activity.startActivityForResult(intent, REQUEST_OPEN_DIRECTORY)
        } catch (_: Exception) {
            synchronized(pendingLock) {
                pendingRequest = null
            }
            request.promise.reject(
                "E_STORAGE_URI_PICKER",
                "Unable to open directory picker"
            )
        }
    }

    private fun collectPickedUris(data: Intent): List<Uri> {
        val uris = mutableListOf<Uri>()
        data.data?.let(uris::add)
        val clipData: ClipData? = data.clipData
        if (clipData != null) {
            for (index in 0 until clipData.itemCount) {
                clipData.getItemAt(index).uri?.let(uris::add)
            }
        }
        return uris.distinctBy(Uri::toString)
    }

    private fun persistReadGrant(uri: Uri, data: Intent): Boolean {
        val requestedFlags = data.flags and (
            Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        return try {
            reactApplicationContext.contentResolver
                .takePersistableUriPermission(
                    uri,
                    requestedFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun resolvePickedDirectory(data: Intent, promise: Promise) {
        val treeUri = data.data
        if (treeUri == null) {
            promise.resolve(null)
            return
        }
        executeIo(promise) { operationPromise ->
            try {
                require(DocumentsContract.isTreeUri(treeUri)) {
                    "Selected location is not a document tree"
                }
                val documentUri = DocumentsContract.buildDocumentUriUsingTree(
                    treeUri,
                    DocumentsContract.getTreeDocumentId(treeUri)
                )
                val item = queryContentMetadata(documentUri)
                item.putString("uri", treeUri.toString())
                item.putBoolean("persisted", persistReadGrant(treeUri, data))
                operationPromise.resolve(item)
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_READ",
                    "Unable to read selected directory",
                    error
                )
            }
        }
    }

    private fun normalizedExtensions(extensions: ReadableArray): Set<String> {
        return (0 until extensions.size())
            .mapNotNull { extensions.getString(it)?.trim() }
            .map { it.lowercase(Locale.ROOT) }
            .filter { it.matches(Regex("^\\.[a-z0-9]{1,12}$")) }
            .distinct()
            .take(64)
            .toSet()
            .also { require(it.isNotEmpty()) { "No file extensions selected" } }
    }

    private fun hasPersistedTreeReadGrant(treeUri: Uri): Boolean {
        return reactApplicationContext.contentResolver.persistedUriPermissions
            .any { permission ->
                permission.isReadPermission && permission.uri == treeUri
            }
    }

    private fun beginDirectoryScan(
        promise: Promise
    ): DirectoryScanOperation? {
        val operation = DirectoryScanOperation(
            controlledPromise(promise),
            CancellationSignal()
        )
        synchronized(directoryScanLock) {
            if (invalidated.get()) {
                operation.promise.cancel()
                return null
            }
            if (activeDirectoryScan?.promise?.isSettled == false) {
                operation.promise.reject(
                    "E_STORAGE_URI_BUSY",
                    "Another directory scan is already active"
                )
                return null
            }
            activeDirectoryScan = operation
        }
        return operation
    }

    private fun finishDirectoryScan(operation: DirectoryScanOperation) {
        synchronized(directoryScanLock) {
            if (activeDirectoryScan === operation) {
                activeDirectoryScan = null
            }
        }
    }

    @ReactMethod
    fun cancelDirectoryScan() {
        synchronized(directoryScanLock) {
            activeDirectoryScan?.promise?.cancel()
            activeDirectoryScan?.cancellationSignal?.cancel()
        }
    }

    @ReactMethod
    fun listDirectoryDocuments(
        treeUriValue: String,
        extensions: ReadableArray,
        promise: Promise
    ) {
        val scanOperation = beginDirectoryScan(promise) ?: return
        executeIo(scanOperation.promise) { operationPromise ->
            try {
                val treeUri = parseUri(treeUriValue)
                require(DocumentsContract.isTreeUri(treeUri)) {
                    "Storage location is not a document tree"
                }
                if (!hasPersistedTreeReadGrant(treeUri)) {
                    throw SecurityException(
                        "Persisted directory permission is unavailable"
                    )
                }
                val allowedExtensions = normalizedExtensions(extensions)
                val resolver = reactApplicationContext.contentResolver
                val queue = ArrayDeque<DirectoryNode>()
                val visitedDocumentIds = mutableSetOf<String>()
                val documents = mutableListOf<DirectoryDocument>()
                queue.add(
                    DirectoryNode(
                        DocumentsContract.getTreeDocumentId(treeUri),
                        0
                    )
                )
                var observedEntries = 0

                while (queue.isNotEmpty()) {
                    if (
                        invalidated.get() ||
                        operationPromise.isSettled ||
                        Thread.currentThread().isInterrupted
                    ) {
                        operationPromise.cancel()
                        return@executeIo
                    }
                    val directory = queue.removeFirst()
                    if (!visitedDocumentIds.add(directory.documentId)) {
                        continue
                    }
                    if (directory.depth > MAX_DIRECTORY_DEPTH) {
                        throw DirectoryScanLimitException(
                            "Selected directory is nested too deeply"
                        )
                    }
                    val childrenUri =
                        DocumentsContract.buildChildDocumentsUriUsingTree(
                            treeUri,
                            directory.documentId
                        )
                    resolver.query(
                        childrenUri,
                        arrayOf(
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE,
                            DocumentsContract.Document.COLUMN_SIZE
                        ),
                        null,
                        null,
                        null,
                        scanOperation.cancellationSignal
                    )?.use { cursor ->
                        while (cursor.moveToNext()) {
                            observedEntries += 1
                            if (observedEntries > MAX_DIRECTORY_ENTRIES) {
                                throw DirectoryScanLimitException(
                                    "Selected directory contains too many entries"
                                )
                            }
                            val documentId = cursor.optionalString(
                                DocumentsContract.Document.COLUMN_DOCUMENT_ID
                            ) ?: continue
                            val mimeType = cursor.optionalString(
                                DocumentsContract.Document.COLUMN_MIME_TYPE
                            )
                            if (
                                mimeType ==
                                DocumentsContract.Document.MIME_TYPE_DIR
                            ) {
                                queue.add(
                                    DirectoryNode(
                                        documentId,
                                        directory.depth + 1
                                    )
                                )
                                continue
                            }
                            val displayName = cursor.optionalString(
                                DocumentsContract.Document.COLUMN_DISPLAY_NAME
                            ) ?: continue
                            val normalizedName =
                                displayName.lowercase(Locale.ROOT)
                            if (
                                allowedExtensions.none(normalizedName::endsWith)
                            ) {
                                continue
                            }
                            documents.add(
                                DirectoryDocument(
                                    uri = DocumentsContract
                                        .buildDocumentUriUsingTree(
                                            treeUri,
                                            documentId
                                        ),
                                    displayName = displayName,
                                    mimeType = mimeType,
                                    size = cursor.optionalLong(
                                        DocumentsContract.Document.COLUMN_SIZE
                                    )
                                )
                            )
                        }
                    }
                }

                val result = Arguments.createArray()
                documents
                    .sortedWith(
                        compareBy<DirectoryDocument> {
                            it.displayName.lowercase(Locale.ROOT)
                        }.thenBy { it.uri.toString() }
                    )
                    .forEach { document ->
                        result.pushMap(
                            Arguments.createMap().apply {
                                putString("uri", document.uri.toString())
                                putString("kind", "content-uri")
                                putBoolean("exists", true)
                                putString("displayName", document.displayName)
                                putNullableString(
                                    "mimeType",
                                    document.mimeType
                                )
                                putNullableDouble("size", document.size)
                                putBoolean("persisted", true)
                            }
                        )
                    }
                operationPromise.resolve(result)
            } catch (error: DirectoryScanLimitException) {
                operationPromise.reject(
                    "E_STORAGE_URI_DIRECTORY_LIMIT",
                    error.message ?: "Selected directory is too large"
                )
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_READ",
                    "Unable to scan selected directory",
                    error
                )
            } finally {
                finishDirectoryScan(scanOperation)
            }
        }
    }

    private fun resolvePickedDocuments(data: Intent, promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                val result = Arguments.createArray()
                collectPickedUris(data).forEach { uri ->
                    val item = queryContentMetadata(uri)
                    item.putBoolean("persisted", persistReadGrant(uri, data))
                    result.pushMap(item)
                }
                operationPromise.resolve(result)
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_READ",
                    "Unable to read selected documents",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun exportDocument(
        sourcePath: String,
        mimeType: String,
        displayName: String,
        promise: Promise
    ) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject(
                "E_STORAGE_URI_NO_ACTIVITY",
                "Document export is unavailable"
            )
            return
        }
        val source = try {
            requireAppScoped(localFile(sourcePath)).also {
                require(it.isFile) { "Export source does not exist" }
            }
        } catch (_: Exception) {
            promise.reject(
                "E_STORAGE_URI_EXPORT_SOURCE",
                "Export source must be an app-scoped file"
            )
            return
        }
        val request = PendingRequest.Export(
            controlledPromise(promise),
            source
        )
        if (!beginRequest(request)) {
            return
        }

        try {
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mimeType.ifBlank { "application/octet-stream" }
                putExtra(Intent.EXTRA_TITLE, displayName)
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
            }
            activity.startActivityForResult(intent, REQUEST_CREATE_DOCUMENT)
        } catch (_: Exception) {
            synchronized(pendingLock) {
                pendingRequest = null
            }
            request.promise.reject(
                "E_STORAGE_URI_EXPORT",
                "Unable to open document export"
            )
        }
    }

    @ReactMethod
    fun requestWriteAccess(uriValue: String, promise: Promise) {
        val uri = try {
            parseUri(uriValue)
        } catch (_: Exception) {
            promise.reject(
                "E_STORAGE_URI_WRITE_ACCESS",
                "Storage URI is invalid"
            )
            return
        }
        if (!uri.scheme.equals("content", true)) {
            promise.resolve(false)
            return
        }

        try {
            reactApplicationContext.contentResolver
                .openFileDescriptor(uri, "rw")
                ?.use {
                    promise.resolve(true)
                    return
                }
        } catch (_: SecurityException) {
            // Continue with the platform consent flow.
        } catch (_: Exception) {
            // Some providers reject a probe but can still expose consent.
        }

        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject(
                "E_STORAGE_URI_NO_ACTIVITY",
                "Write permission request is unavailable"
            )
            return
        }

        val intentSender = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                MediaStore.createWriteRequest(
                    reactApplicationContext.contentResolver,
                    listOf(uri)
                ).intentSender
            } else if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
                try {
                    reactApplicationContext.contentResolver
                        .openFileDescriptor(uri, "rw")
                        ?.close()
                    promise.resolve(true)
                    return
                } catch (error: RecoverableSecurityException) {
                    error.userAction.actionIntent.intentSender
                }
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }

        if (intentSender == null) {
            promise.reject(
                "E_STORAGE_URI_WRITE_ACCESS",
                "The document provider did not grant write access"
            )
            return
        }
        val request = PendingRequest.WriteAccess(
            controlledPromise(promise)
        )
        if (!beginRequest(request)) {
            return
        }
        try {
            activity.startIntentSenderForResult(
                intentSender,
                REQUEST_WRITE_ACCESS,
                null,
                0,
                0,
                0
            )
        } catch (_: Exception) {
            synchronized(pendingLock) {
                pendingRequest = null
            }
            request.promise.reject(
                "E_STORAGE_URI_WRITE_ACCESS",
                "Unable to request document write access"
            )
        }
    }

    private fun resolveDocumentExport(
        destinationUri: Uri?,
        pending: PendingRequest.Export
    ) {
        if (destinationUri == null) {
            pending.promise.resolve(null)
            return
        }
        executeIo(pending.promise) { operationPromise ->
            try {
                reactApplicationContext.contentResolver
                    .openOutputStream(destinationUri, "w")
                    ?.use { output ->
                        pending.sourceFile.inputStream().use { input ->
                            input.copyTo(output)
                            output.flush()
                        }
                    }
                    ?: throw IllegalStateException(
                        "Unable to open export destination"
                    )
                val result = queryContentMetadata(destinationUri)
                result.putBoolean("persisted", false)
                operationPromise.resolve(result)
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_EXPORT",
                    "Unable to export document",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun queryAudioMediaStore(promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                val resolver = reactApplicationContext.contentResolver
                val projection = arrayOf(
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.DISPLAY_NAME,
                    MediaStore.Audio.Media.MIME_TYPE,
                    MediaStore.Audio.Media.SIZE,
                    MediaStore.Audio.Media.DURATION,
                    MediaStore.Audio.Media.TITLE,
                    MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM
                )
                val result = Arguments.createArray()
                resolver.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    "${MediaStore.Audio.Media.IS_MUSIC} != 0",
                    null,
                    "${MediaStore.Audio.Media.DATE_MODIFIED} DESC"
                )?.use { cursor ->
                    val idIndex = cursor.getColumnIndexOrThrow(
                        MediaStore.Audio.Media._ID
                    )
                    while (cursor.moveToNext()) {
                        val uri = Uri.withAppendedPath(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                            cursor.getLong(idIndex).toString()
                        )
                        val item = Arguments.createMap().apply {
                            putString("uri", uri.toString())
                            putString("kind", "content-uri")
                            putBoolean("exists", true)
                            putNullableString(
                                "displayName",
                                cursor.optionalString(
                                    MediaStore.Audio.Media.DISPLAY_NAME
                                )
                            )
                            putNullableString(
                                "mimeType",
                                cursor.optionalString(
                                    MediaStore.Audio.Media.MIME_TYPE
                                )
                            )
                            putNullableDouble(
                                "size",
                                cursor.optionalLong(
                                    MediaStore.Audio.Media.SIZE
                                )
                            )
                            putNullableDouble(
                                "duration",
                                cursor.optionalLong(
                                    MediaStore.Audio.Media.DURATION
                                )
                            )
                            putNullableString(
                                "title",
                                cursor.optionalString(
                                    MediaStore.Audio.Media.TITLE
                                )
                            )
                            putNullableString(
                                "artist",
                                cursor.optionalString(
                                    MediaStore.Audio.Media.ARTIST
                                )
                            )
                            putNullableString(
                                "album",
                                cursor.optionalString(
                                    MediaStore.Audio.Media.ALBUM
                                )
                            )
                        }
                        result.pushMap(item)
                    }
                }
                operationPromise.resolve(result)
            } catch (error: SecurityException) {
                operationPromise.reject(
                    "E_MEDIA_PERMISSION_REQUIRED",
                    "Audio library permission is required"
                )
            } catch (_: Exception) {
                operationPromise.reject(
                    "E_MEDIASTORE_QUERY",
                    "Unable to query the audio library"
                )
            }
        }
    }

    @ReactMethod
    fun openReadFileDescriptor(uri: String, promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                val parsed = parseUri(uri)
                val descriptor = if (parsed.scheme.equals("content", true)) {
                    reactApplicationContext.contentResolver
                        .openFileDescriptor(parsed, "r")
                } else {
                    ParcelFileDescriptor.open(
                        localFile(uri),
                        ParcelFileDescriptor.MODE_READ_ONLY
                    )
                } ?: throw IllegalStateException(
                    "Unable to open file descriptor"
                )
                var detachedFd = -1
                try {
                    descriptor.use {
                        detachedFd = it.detachFd()
                    }
                    if (!operationPromise.resolveIfPending(detachedFd)) {
                        ParcelFileDescriptor.adoptFd(detachedFd).close()
                        detachedFd = -1
                    }
                } catch (error: Exception) {
                    if (detachedFd >= 0) {
                        try {
                            ParcelFileDescriptor.adoptFd(detachedFd).close()
                        } catch (_: Exception) {
                        }
                    }
                    throw error
                }
            } catch (error: Exception) {
                rejectStorageError(
                    operationPromise,
                    "E_STORAGE_URI_READ",
                    "Unable to open storage item",
                    error
                )
            }
        }
    }

    @ReactMethod
    fun closeFileDescriptor(fd: Double, promise: Promise) {
        executeIo(promise) { operationPromise ->
            try {
                val descriptor = fd.toInt()
                require(descriptor >= 0 && descriptor.toDouble() == fd) {
                    "File descriptor is invalid"
                }
                ParcelFileDescriptor.adoptFd(descriptor).close()
                operationPromise.resolve(null)
            } catch (_: Exception) {
                operationPromise.reject(
                    "E_STORAGE_URI_FD",
                    "Unable to close file descriptor"
                )
            }
        }
    }
}
