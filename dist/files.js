// Per-project file system at /v1/files/*.  Files are stored under
// (user, project) on the gateway and addressed by POSIX-style paths.
// Each FileObject's `url` is a stable public address — embed it
// directly in `<img src>`, share it, persist it.
//
// The bundle's RunJobs client uses `client.files` to access these
// endpoints; the underlying token must be a project-bound resource
// token (rrt_*) issued by the grant flow.
function pathToURL(p) {
    const trimmed = p.replace(/^\/+/, "");
    return "/v1/files/" + trimmed.split("/").map(encodeURIComponent).join("/");
}
export class FilesService {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    /**
     * Upload `body` to `path`.  Returns the resulting FileObject — its
     * `url` is the stable public address for that path.
     *
     * `body` accepts anything `fetch` accepts as a request body: Blob,
     * File, ArrayBuffer, ArrayBufferView, FormData (rare here),
     * ReadableStream, or a string.
     */
    async put(path, body, opts) {
        return this.transport.putBytes(pathToURL(path), body, {
            contentType: opts?.contentType,
            headers: opts?.ifNoneMatch ? { "If-None-Match": "*" } : undefined,
            signal: opts?.signal,
        });
    }
    /** Convenience: upload string content with sensible content-type. */
    async putString(path, content, opts) {
        return this.put(path, content, {
            ...opts,
            contentType: opts?.contentType ?? "text/plain; charset=utf-8",
        });
    }
    /**
     * Download the bytes at `path` as a Blob.  Use `URL.createObjectURL`
     * to get a temporary local URL, or persist the bytes elsewhere.
     * Bundles that just need to render an asset should use the FileObject's
     * `.url` directly instead — that's a stable public URL with no token.
     */
    async get(path, init) {
        const { data, contentType } = await this.transport.getRaw(pathToURL(path), init);
        return new Blob([new Uint8Array(data)], { type: contentType || "application/octet-stream" });
    }
    /** Stat: HEAD-only object metadata. */
    async stat(path, init) {
        const { status, headers } = await this.transport.head(pathToURL(path), init);
        if (status === 404) {
            throw Object.assign(new Error("not found"), { status: 404 });
        }
        if (status >= 400) {
            throw Object.assign(new Error("stat failed"), { status });
        }
        const size = parseInt(headers.get("content-length") ?? "0", 10);
        return {
            path: headers.get("x-file-path") ?? path,
            size,
            content_type: headers.get("content-type") ?? undefined,
            etag: (headers.get("etag") ?? "").replace(/"/g, "") || undefined,
            url: headers.get("x-file-url") ?? "",
        };
    }
    /** Returns true iff the path resolves to an existing object. */
    async exists(path, init) {
        const { status } = await this.transport.head(pathToURL(path), init);
        return status >= 200 && status < 400;
    }
    /** Delete the object at `path`.  Idempotent. */
    async del(path, init) {
        await this.transport.deletePath(pathToURL(path), init);
    }
    /** List objects.  Pass an empty / omitted prefix for the root. */
    async list(opts) {
        const params = new URLSearchParams();
        if (opts?.prefix)
            params.set("prefix", opts.prefix);
        if (opts?.cursor)
            params.set("cursor", opts.cursor);
        if (opts?.limit)
            params.set("limit", String(opts.limit));
        const qs = params.toString();
        return this.transport.getJSON("/v1/files" + (qs ? "?" + qs : ""), opts?.signal ? { signal: opts.signal } : undefined);
    }
    /** Atomic rename (copy + delete server-side). */
    async move(from, to, init) {
        return this.transport.postJSON("/v1/files/move", { from, to }, init);
    }
    /** Server-side copy. */
    async copy(from, to, init) {
        return this.transport.postJSON("/v1/files/copy", { from, to }, init);
    }
    /**
     * Ask the gateway to fetch `srcURL` and store the body at `path`.
     * Saves a round trip vs downloading then re-uploading.  `srcURL`
     * must be a public http(s) URL (private/loopback hosts rejected).
     */
    async putFromURL(path, srcURL, opts) {
        return this.transport.postJSON("/v1/files/put-url", {
            path,
            src_url: srcURL,
            content_type: opts?.contentType,
            if_none_match: opts?.ifNoneMatch,
        }, opts?.signal ? { signal: opts.signal } : undefined);
    }
    /**
     * Pipeline several file ops in one round trip.  Operations execute
     * sequentially server-side; one op failing does not abort the rest.
     * Inspect each result.ok individually.
     */
    async batch(ops, init) {
        const resp = await this.transport.postJSON("/v1/files/batch", { ops }, init);
        return resp.results;
    }
}
//# sourceMappingURL=files.js.map