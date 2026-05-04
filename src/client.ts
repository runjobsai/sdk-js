import { Transport } from "./transport.js";
import { ChatService } from "./chat.js";
import { ModelsService } from "./models.js";
import { ImageService } from "./image.js";
import { AudioService } from "./audio.js";
import { VideoService } from "./video.js";
import { ComputerService } from "./computer.js";

const DEFAULT_BASE_URL = "https://api.runjobs.ai";

export interface ClientOptions {
  /** Gateway API key (typically prefixed `gw-`). Required. */
  apiKey: string;
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
    if (!options.apiKey) {
      throw new Error("runjobs: apiKey is required");
    }
    const transport = new Transport({
      baseURL: options.baseURL ?? DEFAULT_BASE_URL,
      apiKey: options.apiKey,
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
