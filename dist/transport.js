import { APIError } from "./errors.js";
export class Transport {
    baseURL;
    apiKey;
    apiKeyResolver;
    fetchImpl;
    constructor(opts) {
        if (!opts.apiKey && !opts.apiKeyResolver) {
            throw new Error("RunJobs: pass either `apiKey` or `apiKeyResolver` when constructing the client");
        }
        this.baseURL = opts.baseURL.replace(/\/+$/, "");
        this.apiKey = opts.apiKey;
        this.apiKeyResolver = opts.apiKeyResolver;
        // Bind to globalThis when using the platform's native fetch.
        // Without binding, `this.fetchImpl(...)` invokes with `this`
        // pointing at the Transport instance, and the browser's
        // `Window.fetch` rejects that with "Illegal invocation".
        // Caller-supplied `fetchImpl` is used as-is — they're responsible
        // for any binding their wrapper needs.
        this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    }
    /** Resolve the bearer token for the next request. */
    async resolveToken() {
        if (this.apiKeyResolver)
            return await this.apiKeyResolver();
        return this.apiKey ?? "";
    }
    /** POST JSON body; parse JSON response. */
    async postJSON(path, body, init) {
        const resp = await this.fetchImpl(this.baseURL + path, {
            method: "POST",
            headers: await this.jsonHeaders(),
            body: JSON.stringify(body),
            signal: init?.signal,
        });
        if (!resp.ok) {
            throw await this.parseError(resp);
        }
        return (await resp.json());
    }
    /** GET path; parse JSON response. */
    async getJSON(path, init) {
        const resp = await this.fetchImpl(this.baseURL + path, {
            method: "GET",
            headers: await this.authHeaders(),
            signal: init?.signal,
        });
        if (!resp.ok) {
            throw await this.parseError(resp);
        }
        return (await resp.json());
    }
    /** GET path; return raw bytes + content-type (for video/audio downloads). */
    async getRaw(path, init) {
        const resp = await this.fetchImpl(this.baseURL + path, {
            method: "GET",
            headers: await this.authHeaders(),
            signal: init?.signal,
        });
        if (!resp.ok) {
            throw await this.parseError(resp);
        }
        const buf = new Uint8Array(await resp.arrayBuffer());
        const contentType = resp.headers.get("content-type") ?? "";
        return { data: buf, contentType };
    }
    /** POST a multipart/form-data body. Used by audio.transcribe and image.edit. */
    async postMultipart(path, form, init) {
        const resp = await this.fetchImpl(this.baseURL + path, {
            method: "POST",
            headers: await this.authHeaders(), // do NOT set Content-Type — fetch sets it with boundary
            body: form,
            signal: init?.signal,
        });
        if (!resp.ok) {
            throw await this.parseError(resp);
        }
        return (await resp.json());
    }
    /**
     * POST JSON body; return the raw streaming Response. Used by chat
     * streaming. Caller is responsible for consuming the SSE body.
     */
    async postJSONStream(path, body, init) {
        const resp = await this.fetchImpl(this.baseURL + path, {
            method: "POST",
            headers: {
                ...(await this.jsonHeaders()),
                "Accept-Encoding": "identity", // SSE lines arrive immediately, no gzip
            },
            body: JSON.stringify(body),
            signal: init?.signal,
        });
        if (!resp.ok) {
            throw await this.parseError(resp);
        }
        return resp;
    }
    /** PUT raw bytes with caller-supplied content type and headers. */
    async putBytes(path, body, opts) {
        const headers = {
            ...(await this.authHeaders()),
            "Content-Type": opts?.contentType ?? "application/octet-stream",
        };
        if (opts?.headers)
            Object.assign(headers, opts.headers);
        const resp = await this.fetchImpl(this.baseURL + path, {
            method: "PUT",
            headers,
            body,
            signal: opts?.signal,
        });
        if (!resp.ok)
            throw await this.parseError(resp);
        if (opts?.parse === "none")
            return undefined;
        return (await resp.json());
    }
    /** DELETE path; parse JSON response (or no body). */
    async deletePath(path, init) {
        const resp = await this.fetchImpl(this.baseURL + path, {
            method: "DELETE",
            headers: await this.authHeaders(),
            signal: init?.signal,
        });
        if (!resp.ok)
            throw await this.parseError(resp);
        if (init?.parse === "none")
            return undefined;
        return (await resp.json());
    }
    /** HEAD path; surface status + selected response headers.  Used by
     *  exists / stat where the body would just be an opaque blob. */
    async head(path, init) {
        const resp = await this.fetchImpl(this.baseURL + path, {
            method: "HEAD",
            headers: await this.authHeaders(),
            signal: init?.signal,
        });
        return { status: resp.status, headers: resp.headers };
    }
    async jsonHeaders() {
        return {
            "Content-Type": "application/json",
            Authorization: `Bearer ${await this.resolveToken()}`,
        };
    }
    async authHeaders() {
        return { Authorization: `Bearer ${await this.resolveToken()}` };
    }
    async parseError(resp) {
        const text = await resp.text();
        let type = "error";
        let message = text || resp.statusText;
        try {
            const parsed = JSON.parse(text);
            if (parsed.type)
                type = parsed.type;
            if (parsed.message)
                message = parsed.message;
        }
        catch {
            // Body wasn't JSON — fall back to raw text.
        }
        return new APIError(resp.status, type, message);
    }
}
//# sourceMappingURL=transport.js.map