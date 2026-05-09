/**
 * Media helpers shared by image / video / chat-multimodal endpoints.
 *
 * The gateway accepts media payloads as `data:<mime>;base64,<payload>`
 * URIs on every `*_url` field — `encodeImageUrl` is the bridge from
 * raw bytes to that wire format. Replaces the deprecated `*_b64` SDK
 * fields, which were removed in favour of routing every payload
 * through `*_url`.
 */
/**
 * Wrap raw image bytes as a `data:<mime>;base64,<payload>` URI.
 *
 * MIME is sniffed from the magic bytes (PNG / JPEG / GIF / WebP). On
 * unrecognised input we default to `application/octet-stream` — most
 * upstreams accept and re-sniff server-side.
 *
 * @param bytes Image bytes — `Uint8Array`, `ArrayBuffer`, or `Blob`.
 * @returns A data: URI suitable for any `*_url` field on the gateway.
 *
 * @example
 * ```ts
 * import { encodeImageUrl } from "@runjobs/sdk";
 * const png = await fs.readFile("frame.png");
 * await client.video.generate("Veo 3.1", {
 *   prompt: "...",
 *   first_frame_url: encodeImageUrl(png),
 * });
 * ```
 */
export declare function encodeImageUrl(bytes: Uint8Array | ArrayBuffer | Blob): string;
/**
 * Resolve a media URL to raw bytes plus the declared mime label.
 *
 * Inverse of `encodeImageUrl`. Two transport modes handled:
 *   - "data:<mime>;base64,<payload>"  — decode the inline payload
 *   - "https://...", "http://..."     — `fetch()` + `.arrayBuffer()`,
 *                                       mime from the response's
 *                                       `Content-Type` header
 *
 * Returns `{bytes: Uint8Array, contentType: string}`. Pairs with
 * `encodeImageUrl` so callers can round-trip bytes through the gateway
 * without thinking about which transport mode the response chose.
 *
 * @example
 * ```ts
 * import { decodeMediaUrl } from "@runjobs/sdk";
 * const job = await client.image.generateAsync("Seedream 5.0", {...});
 * const { bytes, contentType } = await decodeMediaUrl(job.data[0].url);
 * await fs.writeFile("out.png", bytes);
 * ```
 */
export declare function decodeMediaUrl(url: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
}>;
//# sourceMappingURL=media.d.ts.map