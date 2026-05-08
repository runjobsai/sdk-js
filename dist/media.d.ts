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
//# sourceMappingURL=media.d.ts.map