import { Transport } from "./transport.js";
import { ChatService } from "./chat.js";
import { ModelsService } from "./models.js";
import { ImageService } from "./image.js";
import { AudioService } from "./audio.js";
import { VideoService } from "./video.js";
import { ComputerService } from "./computer.js";

const DEFAULT_BASE_URL = "https://api.runjobs.ai";

export interface ClientOptions {
  /** Static gateway API key (typically prefixed `gw-` / `rj_` / `rrt_`).
   *  Required unless `apiKeyResolver` is supplied. */
  apiKey?: string;
  /**
   * Dynamic API key resolver. Use this when the bearer token is
   * short-lived and refreshed externally — e.g. running inside a
   * runjobs resource bundle that exposes
   * `https://www.runjobs.ai/api/auth.js`:
   *
   * ```html
   * <script src="https://www.runjobs.ai/api/auth.js"></script>
   * <script type="module">
   *   import { RunJobs } from "@runjobsai/sdk";
   *   const client = new RunJobs({
   *     apiKeyResolver: () => window.runjobs.getToken(),
   *     baseURL: "https://www.runjobs.ai",
   *   });
   * </script>
   * ```
   *
   * The resolver is awaited before EVERY request, so the caller is
   * free to return a Promise that hits a token endpoint. The auth.js
   * bridge caches its token internally; calls back-to-back are
   * sub-millisecond.
   *
   * Wins over `apiKey` when both are supplied.
   */
  apiKeyResolver?: () => string | Promise<string>;
  /** Override the default gateway base URL. Defaults to `https://api.runjobs.ai`. */
  baseURL?: string;
  /** Optional fetch override (e.g. node-fetch with custom agent). */
  fetch?: typeof fetch;
}

/**
 * Top-level RunJobs SDK client. Construct once, share across services.
 *
 * ```ts
 * import { RunJobs } from "@runjobsai/sdk";
 *
 * const client = new RunJobs({ apiKey: process.env.RUNJOBS_API_KEY! });
 *
 * const resp = await client.chat.create({
 *   model: "Claude Sonnet 4.6",
 *   messages: [{ role: "user", content: "Hello!" }],
 * });
 * console.log(resp.choices[0].message.content);
 * ```
 */
export class RunJobs {
  readonly chat: ChatService;
  readonly models: ModelsService;
  readonly image: ImageService;
  readonly audio: AudioService;
  readonly video: VideoService;
  readonly computer: ComputerService;

  constructor(options: ClientOptions) {
    if (!options.apiKey && !options.apiKeyResolver) {
      throw new Error("runjobs: pass either `apiKey` or `apiKeyResolver`");
    }
    const transport = new Transport({
      baseURL: options.baseURL ?? DEFAULT_BASE_URL,
      ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
      ...(options.apiKeyResolver !== undefined && {
        apiKeyResolver: options.apiKeyResolver,
      }),
      ...(options.fetch ? { fetchImpl: options.fetch } : {}),
    });
    this.chat = new ChatService(transport);
    this.models = new ModelsService(transport);
    this.image = new ImageService(transport);
    this.audio = new AudioService(transport);
    this.video = new VideoService(transport);
    this.computer = new ComputerService(transport);
  }
}
