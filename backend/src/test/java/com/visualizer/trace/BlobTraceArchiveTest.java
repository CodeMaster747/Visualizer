package com.visualizer.trace;

import com.azure.core.util.BinaryData;
import com.azure.storage.blob.BlobClient;
import com.azure.storage.blob.BlobContainerClient;
import com.azure.storage.blob.models.BlobDownloadContentResponse;
import com.azure.storage.blob.models.BlobStorageException;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The archive's contract is mostly about what it refuses to do: never throw at
 * the caller, never let an id it did not vet reach Azure.
 */
class BlobTraceArchiveTest {

    private static final String ID = "a".repeat(64);

    private final ObjectMapper mapper = new ObjectMapper();
    private final BlobContainerClient container = mock(BlobContainerClient.class);
    private final BlobClient blob = mock(BlobClient.class);
    private final BlobTraceArchive archive = new BlobTraceArchive(container, mapper);

    /**
     * Build these into a local before passing them to `when(...)`. Stubbing one
     * mock inside the argument list of another's stubbing is what Mockito calls
     * UnfinishedStubbing, and it fails the test rather than the assertion.
     */
    private BlobStorageException status(int code) {
        var e = mock(BlobStorageException.class);
        when(e.getStatusCode()).thenReturn(code);
        return e;
    }

    @Test
    void acceptsOnlyLowercaseSha256Hex() {
        assertThat(BlobTraceArchive.isValidId(ID)).isTrue();
        assertThat(BlobTraceArchive.isValidId(ID.toUpperCase())).isFalse();
        assertThat(BlobTraceArchive.isValidId("a".repeat(63))).isFalse();
        assertThat(BlobTraceArchive.isValidId("a".repeat(65))).isFalse();
        assertThat(BlobTraceArchive.isValidId("../secrets")).isFalse();
        assertThat(BlobTraceArchive.isValidId("")).isFalse();
        assertThat(BlobTraceArchive.isValidId(null)).isFalse();
    }

    @Test
    void malformedIdNeverReachesStorage() {
        // The id arrives from a path variable and becomes a blob name. Rejecting
        // it before the client is touched is what makes traversal impossible
        // rather than dependent on how Azure happens to parse a name.
        assertThat(archive.find("../../etc/passwd")).isEmpty();
        archive.save("../../etc/passwd", mapper.createObjectNode());
        verify(container, never()).getBlobClient(anyString());
    }

    @Test
    void missingBlobIsAnEmptyResultNotAnError() {
        var notFound = status(404);
        when(container.getBlobClient(anyString())).thenReturn(blob);
        when(blob.downloadContentWithResponse(any(), any(), any(), any())).thenThrow(notFound);

        assertThat(archive.find(ID)).isEmpty();
    }

    @Test
    void unreachableStorageDegradesToAMiss() {
        // A run must survive its archive being down; the caller re-executes
        // rather than seeing a 500.
        when(container.getBlobClient(anyString())).thenReturn(blob);
        when(blob.downloadContentWithResponse(any(), any(), any(), any()))
                .thenThrow(new RuntimeException("connection reset"));

        assertThat(archive.find(ID)).isEmpty();
    }

    @Test
    void roundTripsAStoredDocument() {
        var doc = mapper.createObjectNode().put("status", "ok");
        var response = mock(BlobDownloadContentResponse.class);
        when(response.getValue()).thenReturn(BinaryData.fromBytes(doc.toString().getBytes()));
        when(container.getBlobClient(eq(ID + ".json"))).thenReturn(blob);
        when(blob.downloadContentWithResponse(any(), any(), any(), any())).thenReturn(response);

        assertThat(archive.find(ID)).contains(doc);
    }

    @Test
    void alreadyPresentBlobIsNotAnError() {
        // Content-addressed: a 409 means the identical bytes are already stored,
        // which is the desired end state, so it must not surface as a failure.
        var conflict = status(409);
        when(container.getBlobClient(anyString())).thenReturn(blob);
        when(blob.uploadWithResponse(any(), any(), any())).thenThrow(conflict);

        archive.save(ID, mapper.createObjectNode().put("status", "ok"));
    }

    @Test
    void failedWriteIsSwallowed() {
        when(container.getBlobClient(anyString())).thenReturn(blob);
        when(blob.uploadWithResponse(any(), any(), any()))
                .thenThrow(new RuntimeException("no route to host"));

        archive.save(ID, mapper.createObjectNode().put("status", "ok"));
    }

    @Test
    void disabledArchiveIsInert() {
        var off = TraceArchive.disabled();
        assertThat(off.enabled()).isFalse();
        assertThat(off.find(ID)).isEmpty();
        off.save(ID, mapper.createObjectNode());
    }
}
