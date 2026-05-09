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
export function encodeImageUrl(
  bytes: Uint8Array | ArrayBuffer | Blob,
): string {
  // Normalize to Uint8Array so the rest of the function is uniform.
  if (bytes instanceof Blob) {
    throw new Error(
      "encodeImageUrl: Blob input requires async; await blob.arrayBuffer() and pass the result instead",
    );
  }
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const mime = sniffImageMime(u8);

  // btoa(String.fromCharCode(...u8)) blows the stack on large arrays;
  // chunk to keep arg count bounded. 0x8000 is the conventional safe
  // limit on JS engines.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(u8.subarray(i, i + CHUNK)),
    );
  }
  // btoa is browser-native and shimmed in Node ≥ 16 globalThis.
  const b64 = (globalThis as { btoa?: (s: string) => string }).btoa
    ? (globalThis as { btoa: (s: string) => string }).btoa(binary)
    : Buffer.from(binary, "binary").toString("base64");

  return `data:${mime};base64,${b64}`;
}

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
export async function decodeMediaUrl(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (url.startsWith("data:")) {
    const rest = url.slice(5);
    const semi = rest.indexOf(";");
    const comma = rest.indexOf(",");
    if (semi === -1 || comma === -1 || comma < semi) {
      throw new Error("decodeMediaUrl: malformed data URI");
    }
    const mime = rest.slice(0, semi);
    const b64 = rest.slice(comma + 1);
    return { bytes: base64ToBytes(b64), contentType: mime };
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`decodeMediaUrl: upstream ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    return {
      bytes: new Uint8Array(buf),
      contentType: resp.headers.get("Content-Type") ?? "",
    };
  }
  throw new Error(`decodeMediaUrl: unsupported url scheme: ${url.slice(0, 32)}`);
}

/** Decode standard base64 to Uint8Array. Browser `atob` + Node `Buffer`
 *  fallback — same impl as the audio service uses internally. */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Sniff a small set of image mimes from magic bytes. Mirrors the
 * gateway's own sniff so encode / decode round-trip lands on the same
 * label.
 */
function sniffImageMime(b: Uint8Array): string {
  if (b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (b.length >= 6 &&
      b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
    return "image/gif";
  }
  if (b.length >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return "application/octet-stream";
}
