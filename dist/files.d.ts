import type { Transport } from "./transport.js";
export interface FileObject {
    path: string;
    size: number;
    content_type?: string;
    etag?: string;
    last_modified?: string;
    url: string;
}
export interface FileListResult {
    files: FileObject[];
    next_cursor?: string;
}
export interface PutOptions {
    /** Override the MIME type guessed from the path extension. */
    contentType?: string;
    /** Refuse to overwrite an existing object (gateway returns 409). */
    ifNoneMatch?: boolean;
    signal?: AbortSignal;
}
export interface ListOptions {
    prefix?: string;
    cursor?: string;
    limit?: number;
    /**
     * Shell-style pattern, post-filtered after the underlying S3 list:
     *   *      any chars except `/`
     *   **     any chars including `/`
     *   ?      single non-slash char
     *   [abc]  character class
     *
     * Examples:
     *   client.files.list({ glob: "*.png" })
     *   client.files.list({ glob: "projects/*\/assets/*.png" })
     *   client.files.list({ prefix: "projects/", glob: "**\/*.wav" })
     *
     * S3 has no native glob — the gateway extracts the longest literal
     * head of the pattern as the underlying prefix scan, then filters
     * the rest in process.  Patterns must match the WHOLE path; no
     * implicit anchoring needed.
     */
    glob?: string;
    signal?: AbortSignal;
}
export interface PutFromURLOptions {
    contentType?: string;
    ifNoneMatch?: boolean;
    signal?: AbortSignal;
}
export type BatchOp = {
    op: "put_url";
    path: string;
    src_url: string;
    content_type?: string;
    if_none_match?: boolean;
} | {
    op: "del";
    path: string;
} | {
    op: "move";
    from: string;
    to: string;
} | {
    op: "copy";
    from: string;
    to: string;
} | {
    op: "exists";
    path: string;
} | {
    op: "stat";
    path: string;
};
export interface BatchResult {
    ok: boolean;
    error?: string;
    object?: FileObject;
    exists?: boolean;
}
export declare class FilesService {
    private readonly transport;
    constructor(transport: Transport);
    /**
     * Upload `body` to `path`.  Returns the resulting FileObject — its
     * `url` is the stable public address for that path.
     *
     * `body` accepts anything `fetch` accepts as a request body: Blob,
     * File, ArrayBuffer, ArrayBufferView, FormData (rare here),
     * ReadableStream, or a string.
     */
    put(path: string, body: BodyInit, opts?: PutOptions): Promise<FileObject>;
    /** Convenience: upload string content with sensible content-type. */
    putString(path: string, content: string, opts?: PutOptions): Promise<FileObject>;
    /**
     * Download the bytes at `path` as a Blob.  Use `URL.createObjectURL`
     * to get a temporary local URL, or persist the bytes elsewhere.
     * Bundles that just need to render an asset should use the FileObject's
     * `.url` directly instead — that's a stable public URL with no token.
     */
    get(path: string, init?: {
        signal?: AbortSignal;
    }): Promise<Blob>;
    /** Stat: HEAD-only object metadata. */
    stat(path: string, init?: {
        signal?: AbortSignal;
    }): Promise<FileObject>;
    /** Returns true iff the path resolves to an existing object. */
    exists(path: string, init?: {
        signal?: AbortSignal;
    }): Promise<boolean>;
    /** Delete the object at `path`.  Idempotent. */
    del(path: string, init?: {
        signal?: AbortSignal;
    }): Promise<void>;
    /** List objects.  Pass an empty / omitted prefix for the root. */
    list(opts?: ListOptions): Promise<FileListResult>;
    /**
     * Bulk delete: removes every object whose path starts with `prefix`
     * AND (when set) matches `glob`.  Returns the count of deleted
     * objects.  Refuses an empty prefix + empty glob — the caller must
     * be explicit about wiping the project namespace.
     *
     *   client.files.deleteMany({ prefix: "tmp/" })          // wipe a directory
     *   client.files.deleteMany({ glob: "**\/*.tmp" })       // wipe by pattern
     *   client.files.deleteMany({ prefix: "logs/", glob: "*.bak" })
     */
    deleteMany(opts: {
        prefix?: string;
        glob?: string;
    }, init?: {
        signal?: AbortSignal;
    }): Promise<{
        deleted: number;
    }>;
    /** Atomic rename (copy + delete server-side). */
    move(from: string, to: string, init?: {
        signal?: AbortSignal;
    }): Promise<FileObject>;
    /** Server-side copy. */
    copy(from: string, to: string, init?: {
        signal?: AbortSignal;
    }): Promise<FileObject>;
    /**
     * Ask the gateway to fetch `srcURL` and store the body at `path`.
     * Saves a round trip vs downloading then re-uploading.  `srcURL`
     * must be a public http(s) URL (private/loopback hosts rejected).
     */
    putFromURL(path: string, srcURL: string, opts?: PutFromURLOptions): Promise<FileObject>;
    /**
     * Pipeline several file ops in one round trip.  Operations execute
     * sequentially server-side; one op failing does not abort the rest.
     * Inspect each result.ok individually.
     */
    batch(ops: BatchOp[], init?: {
        signal?: AbortSignal;
    }): Promise<BatchResult[]>;
}
//# sourceMappingURL=files.d.ts.map