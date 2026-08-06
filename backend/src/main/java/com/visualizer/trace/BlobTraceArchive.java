package com.visualizer.trace;

import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

import com.azure.core.util.BinaryData;
import com.azure.core.util.Context;
import com.azure.storage.blob.BlobContainerClient;
import com.azure.storage.blob.models.BlobHttpHeaders;
import com.azure.storage.blob.models.BlobRequestConditions;
import com.azure.storage.blob.models.BlobStorageException;
import com.azure.storage.blob.options.BlobParallelUploadOptions;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * {@link TraceArchive} backed by an Azure Blob Storage container.
 *
 * One blob per trace, named for the content hash that already keys the cache --
 * so the addressing scheme is not adapted to blob storage, it simply *is* blob
 * storage: an immutable object under a name derived from its bytes.
 *
 * Two consequences of content-addressing worth naming, because they are why this
 * costs almost nothing to run:
 *
 * <ul>
 *   <li>A blob is never updated, only created. Rewriting a key with different
 *       content cannot happen without a SHA-256 collision, so uploads are
 *       conditional on absence and a re-run of the same snippet is a no-op
 *       rather than a billed write.</li>
 *   <li>Reads only happen on a process-local cache miss, which on a warm
 *       instance is rare. The bill here is dominated by storage of a few
 *       megabytes of JSON, not by transactions.</li>
 * </ul>
 */
public class BlobTraceArchive implements TraceArchive {

    private static final Logger log = LoggerFactory.getLogger(BlobTraceArchive.class);

    /**
     * Trace ids are SHA-256 hex and nothing else.
     *
     * This is a security check, not a tidiness one. The id reaches us straight
     * from a path variable on the share endpoint, and it is about to become a
     * blob name: without this, `..%2f` and friends address blobs outside the
     * intended prefix, and an absurd id becomes an absurd request to Azure.
     * Rejecting anything that is not 64 hex characters makes the entire class of
     * injection impossible rather than merely difficult.
     */
    private static final Pattern TRACE_ID = Pattern.compile("[0-9a-f]{64}");

    /** Tight enough that a slow storage account cannot noticeably delay a run. */
    private static final Duration READ_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration WRITE_TIMEOUT = Duration.ofSeconds(10);

    private final BlobContainerClient container;
    private final ObjectMapper mapper;

    /**
     * The container is created on first write rather than at startup. Cold start
     * on the free tier is already the worst number in this system; spending a
     * network round trip there to discover something that is almost always
     * already true would make it worse for no benefit.
     */
    private final AtomicBoolean containerChecked = new AtomicBoolean(false);

    public BlobTraceArchive(BlobContainerClient container, ObjectMapper mapper) {
        this.container = container;
        this.mapper = mapper;
    }

    public static boolean isValidId(String id) {
        return id != null && TRACE_ID.matcher(id).matches();
    }

    @Override
    public Optional<JsonNode> find(String key) {
        if (!isValidId(key)) {
            return Optional.empty();
        }
        try {
            BinaryData data = container.getBlobClient(blobName(key))
                    .downloadContentWithResponse(null, null, READ_TIMEOUT, Context.NONE)
                    .getValue();
            return Optional.of(mapper.readTree(data.toBytes()));
        } catch (BlobStorageException e) {
            // A miss is the ordinary case, not a problem worth logging.
            if (e.getStatusCode() != 404) {
                log.warn("Trace archive read failed for {}: {}", key, e.getMessage());
            }
            return Optional.empty();
        } catch (Exception e) {
            // Unreachable storage, a timeout, or a blob that is somehow not JSON.
            // None of these should cost the caller its trace.
            log.warn("Trace archive read failed for {}: {}", key, e.toString());
            return Optional.empty();
        }
    }

    @Override
    public void save(String key, JsonNode doc) {
        if (!isValidId(key) || doc == null) {
            return;
        }
        try {
            ensureContainer();
            byte[] bytes = mapper.writeValueAsBytes(doc);
            var options = new BlobParallelUploadOptions(BinaryData.fromBytes(bytes))
                    .setHeaders(new BlobHttpHeaders().setContentType("application/json"))
                    // Create-only. The name is a hash of the content, so an
                    // existing blob already holds exactly these bytes and the
                    // 409 below is success spelled differently.
                    .setRequestConditions(new BlobRequestConditions().setIfNoneMatch("*"));
            container.getBlobClient(blobName(key))
                    .uploadWithResponse(options, WRITE_TIMEOUT, Context.NONE);
        } catch (BlobStorageException e) {
            if (e.getStatusCode() != 409) {
                log.warn("Trace archive write failed for {}: {}", key, e.getMessage());
            }
        } catch (Exception e) {
            log.warn("Trace archive write failed for {}: {}", key, e.toString());
        }
    }

    @Override
    public boolean enabled() {
        return true;
    }

    /**
     * Flat namespace, no prefix sharding. Blob storage partitions by name range,
     * and these names are already uniformly distributed hashes, so the usual
     * reason to shard does not apply.
     */
    private String blobName(String key) {
        return key + ".json";
    }

    private void ensureContainer() {
        if (containerChecked.compareAndSet(false, true)) {
            try {
                container.createIfNotExists();
            } catch (Exception e) {
                // Most likely a credential scoped to an existing container, which
                // is fine -- the upload that follows will succeed or fail on its
                // own merits.
                log.debug("Container create check skipped: {}", e.toString());
            }
        }
    }
}
