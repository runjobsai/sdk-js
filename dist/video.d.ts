import type { Transport } from "./transport.js";
import type { Usage } from "./types.js";
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
    /** First / last frame keyframes (image-to-video). */
    first_frame_url?: string;
    last_frame_url?: string;
    first_frame_b64?: string;
    last_frame_b64?: string;
    /** Multimodal reference inputs (Seedance 2.0). */
    reference_image_urls?: string[];
    reference_images_b64?: string[];
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
export interface WaitOptions {
    /** Defaults to 5000ms. */
    pollIntervalMs?: number;
    signal?: AbortSignal;
}
export declare class VideoService {
    private readonly transport;
    constructor(transport: Transport);
    /** Submit a video generation task. */
    generate(model: string, params: VideoGenerateParams, init?: {
        signal?: AbortSignal;
    }): Promise<VideoTask>;
    /** Fetch the current status of a task. */
    getStatus(taskID: string, init?: {
        signal?: AbortSignal;
    }): Promise<VideoStatus>;
    /**
     * Poll `getStatus()` until the task reaches a terminal state
     * (`succeeded` / `failed`). Default poll interval is 5s.
     */
    wait(taskID: string, opts?: WaitOptions): Promise<VideoStatus>;
    /** Download the raw video bytes for a completed task. */
    getContent(taskID: string, init?: {
        signal?: AbortSignal;
    }): Promise<{
        data: Uint8Array;
        contentType: string;
    }>;
}
//# sourceMappingURL=video.d.ts.map