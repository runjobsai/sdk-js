import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";

/* ------------------------------------------------------------------ */
/* Request                                                             */
/* ------------------------------------------------------------------ */

/**
 * Video generation params. Most fields map 1:1 to the gateway's
 * `/v1/videos/generations` body. Optional booleans (`generate_audio`,
 * `watermark`, `camera_fixed`, `return_last_frame`, `draft`) are
 * tri-state — omit to use the upstream default; explicit `false`
 * forces off.
 */
export interface VideoGenerateParams {
  prompt: string;
  aspect_ratio?: string;
  duration?: number;
  resolution?: string;
  generate_audio?: boolean;

  /**
   * First / last frame keyframes (image-to-video). Each accepts:
   *   - hosted https:// URL
   *   - data:image/...;base64,<payload> URI (use `encodeImageUrl`)
   *
   * The previous `first_frame_b64` / `last_frame_b64` sibling fields
   * were removed — wrap raw bytes in a data: URI client-side via
   * `encodeImageUrl` and pass through `*_url` instead.
   */
  first_frame_url?: string;
  last_frame_url?: string;

  /**
   * Multimodal reference inputs (Seedance 2.0). Each entry can be a
   * hosted URL or a data: URI (use `encodeImageUrl` for raw bytes).
   * `reference_images_b64` was removed — fold any raw-base64 entries
   * into `reference_image_urls` as data: URIs.
   */
  reference_image_urls?: string[];
  reference_video_urls?: string[];
  reference_audio_urls?: string[];

  /** Single-input drivers (video-edit / motion-transfer / lip-sync). */
  source_video_url?: string;
  source_image_url?: string;
  source_audio_url?: string;

  watermark?: boolean;
  camera_fixed?: boolean;
  return_last_frame?: boolean;
  seed?: number;

  /** Alternative to `duration` for Seedance 1.0 pro / lite. */
  frames?: number;

  /** Seedance 1.5 pro Draft Mode. */
  draft?: boolean;
  draft_task_id?: string;

  /** "flex" = offline (~50% price); pair with execution_expires_after. */
  service_tier?: string;
  execution_expires_after?: number;

  /** Webhook for state-transition notifications. */
  callback_url?: string;
  user?: string;

  /** Pass-through for provider-specific knobs. */
  [extra: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Response                                                            */
/* ------------------------------------------------------------------ */

export interface VideoTask {
  id: string;
  status: string;
  usage: Usage;
}

export interface VideoUsageTokens {
  completion_tokens?: number;
  total_tokens?: number;
}

export interface VideoStatus {
  id: string;
  status: string;
  progress: number;
  video_url?: string;
  error?: string;
  /** Final frame as a separate image — populated when return_last_frame=true. */
  last_frame_url?: string;
  /** Seedance Draft Mode Step1 task id, exposed when the draft succeeds. */
  draft_task_id?: string;
  duration?: number;
  fps?: number;
  resolution?: string;
  ratio?: string;
  seed?: number;
  service_tier?: string;
  /** Upstream-reported tokens (Seedance bills per output token). */
  usage_tokens?: VideoUsageTokens;
  created_at?: number;
  updated_at?: number;
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export interface WaitOptions {
  /** Defaults to 5000ms. */
  pollIntervalMs?: number;
  signal?: AbortSignal;
}

export class VideoService {
  constructor(private readonly transport: Transport) {}

  /** Submit a video generation task. */
  async generate(
    model: string,
    params: VideoGenerateParams,
    init?: { signal?: AbortSignal },
  ): Promise<VideoTask> {
    return this.transport.postJSON<VideoTask>(
      "/v1/videos/generations",
      { model, ...params },
      init,
    );
  }

  /** Fetch the current status of a task. */
  async getStatus(
    taskID: string,
    init?: { signal?: AbortSignal },
  ): Promise<VideoStatus> {
    return this.transport.getJSON<VideoStatus>(
      `/v1/videos/generations/${encodeURIComponent(taskID)}`,
      init,
    );
  }

  /**
   * Poll `getStatus()` until the task reaches a terminal state
   * (`succeeded` / `failed`). Default poll interval is 5s.
   */
  async wait(taskID: string, opts: WaitOptions = {}): Promise<VideoStatus> {
    const interval = opts.pollIntervalMs ?? 5000;
    while (true) {
      const status = await this.getStatus(taskID, { signal: opts.signal });
      if (status.status === "succeeded" || status.status === "failed") {
        return status;
      }
      await sleep(interval, opts.signal);
    }
  }

  /** Download the raw video bytes for a completed task. */
  async getContent(
    taskID: string,
    init?: { signal?: AbortSignal },
  ): Promise<{ data: Uint8Array; contentType: string }> {
    return this.transport.getRaw(
      `/v1/videos/${encodeURIComponent(taskID)}/content`,
      init,
    );
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
