import { Transport } from "./transport.js";
import { ChatService } from "./chat.js";
import { ModelsService } from "./models.js";
import { ImageService } from "./image.js";
import { AudioService } from "./audio.js";
import { VideoService } from "./video.js";
import { ComputerService } from "./computer.js";
import { FilesService } from "./files.js";
import { EmbeddingsService } from "./embeddings.js";
import { BrowserAuth, type BrowserUser } from "./browser-auth.js";
import { SDKEvents } from "./events.js";

const DEFAULT_BASE_URL = "https://api.runjobs.ai";

/**
 * Auth strategy.
 *
 *   - `"static"` (default): use `apiKey` or `apiKeyResolver` directly.
 *   - `"runjobs"`: opt into the built-in browser auth flow that
 *     handshakes with `https://www.runjobs.ai/api/sdk/grant`.  No
 *     external auth.js script needed; the SDK consumes the URL
 *     fragment after the redirect-back, exposes `client.user` and
 *     `client.signIn()`, and renders an identity badge.  Only useful
 *     in browsers — in Node this falls back to throwing the same
 *     "missing apiKey" error you'd get with no auth config.
 */
export type AuthProvider = "static" | "runjobs";

export interface ClientOptions {
  /** Static gateway API key (typically prefixed `gw-` / `rj_` / `rrt_`).
   *  Required unless `apiKeyResolver` or `authProvider: "runjobs"` is supplied. */
  apiKey?: string;
  /**
   * Dynamic API key resolver.  See `AuthProvider` for the typical
   * runjobs.ai browser-bundle wiring.
   *
   * Wins over `apiKey` when both are supplied.
   */
  apiKeyResolver?: () => string | Promise<string>;
  /**
   * Auth strategy — defaults to `"static"`.  Pass `"runjobs"` to
   * activate the built-in browser auth flow against runjobs.ai;
   * baseURL defaults to `https://www.runjobs.ai` in that mode.
   */
  authProvider?: AuthProvider;
  /**
   * Show the floating identity badge in `runjobs` auth mode.
   * **Default `true`** — the badge is now a desktop-ball-style
   * real-time activity indicator (LED dot + progress ring around
   * the avatar + click-through popover with active calls / recent
   * completions / session totals). Set `false` only when the
   * bundle ships its own status UI and you don't want the platform
   * badge in the corner.
   */
  showIdentityBadge?: boolean;
  /**
   * Which corner the identity badge floats in. Defaults to
   * `"bottom-right"` — the canonical tray-app position. Switch to
   * `"bottom-left"` when the bundle's own UI occupies the right
   * gutter (e.g. a chat dock); the top corners are useful for
   * fullscreen / portrait kiosk layouts.
   *
   * The popover anchors itself to the same corner — bottom-left
   * badge → popover opens up + right of the badge; top-* badges →
   * popover opens down. Each corner only nudges the CSS; the badge
   * + popover content is identical.
   */
  badgePosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /**
   * @deprecated Use `showIdentityBadge` instead.  Kept for back-compat;
   * acts as `showIdentityBadge: !hideIdentityBadge` when set.
   */
  hideIdentityBadge?: boolean;
  /**
   * Pin the runjobs.ai grant flow to a specific project (only used
   * when `authProvider: "runjobs"`).  When set, `/api/sdk/grant`
   * receives `project_id=<value>` and mints an `rrt_*` resource
   * token bound to THAT project — required for `client.files.*`
   * calls from any origin that isn't a registered (origin, app)
   * pair (e.g. a bundle running on `localhost:5173` during dev).
   *
   * Production bundles served from a registered origin can omit
   * this; the gateway derives the project from the (origin, app)
   * pair.
   */
  project?: string;
  /** Override the default gateway base URL.  Defaults to
   *  `https://api.runjobs.ai`, or `https://www.runjobs.ai` when
   *  `authProvider: "runjobs"` is set. */
  baseURL?: string;
  /** Optional fetch override (e.g. node-fetch with custom agent). */
  fetch?: typeof fetch;
}

/**
 * Top-level RunJobs SDK client.  Construct once, share across services.
 *
 * Browser bundle (resource projects on runjobs.ai):
 *
 * ```html
 * <script src="https://cdn.jsdelivr.net/npm/@runjobsai/sdk/dist/sdk.umd.js"></script>
 * <script>
 *   const client = new RunJobs.Client({ authProvider: "runjobs" });
 *   const res = await client.chat.create({
 *     model: "gpt-4o-mini",
 *     messages: [{ role: "user", content: "hello" }],
 *   });
 * </script>
 * ```
 *
 * Node / server-side:
 *
 * ```ts
 * import { RunJobs } from "@runjobsai/sdk";
 * const client = new RunJobs({ apiKey: process.env.RUNJOBS_API_KEY! });
 * ```
 */
export class RunJobs {
  readonly chat: ChatService;
  readonly models: ModelsService;
  readonly image: ImageService;
  readonly audio: AudioService;
  readonly video: VideoService;
  readonly computer: ComputerService;
  readonly files: FilesService;
  readonly embeddings: EmbeddingsService;

  /**
   * Browser auth helper, populated only when `authProvider: "runjobs"`.
   * Use `client.signIn()` and `client.user` for the common cases; the
   * full instance is exposed for advanced flows (manual `onTokenChange`
   * subscription, etc.).
   */
  readonly auth: BrowserAuth | null = null;

  /**
   * Runtime event bus for SDK-call telemetry. Every LLM-ish service
   * (chat / embeddings / image / audio / video / computer) fires
   * `request:start`, `request:streamDelta`, `request:end`, and
   * `request:error` events here so UI overlays — like the bottom-right
   * identity badge's activity ring — can render real-time state
   * without business code threading anything through.
   *
   * Zero-cost when nobody subscribes (emit is a few property reads).
   * Subscribe via `client.events.on("request:start", handler)` — the
   * returned closure is the unsubscribe.
   */
  readonly events: SDKEvents = new SDKEvents();

  constructor(options: ClientOptions = {}) {
    const provider = options.authProvider ?? "static";
    let apiKeyResolver = options.apiKeyResolver;
    let baseURL = options.baseURL;
    let onUnauthorized: (() => void) | undefined;

    if (provider === "runjobs") {
      // Default the gateway origin to www.runjobs.ai for the runjobs
      // auth flow — that's where /api/sdk/grant lives.  Users overriding
      // baseURL explicitly (e.g. self-hosted runjobs) keep control.
      baseURL = baseURL ?? "https://www.runjobs.ai";
      // Badge default: SHOWN. The badge is now a real-time activity
      // indicator (LED + ring + popover) — useful enough that we'd
      // rather have the rare "I already have my own UI" bundle opt
      // OUT with `showIdentityBadge: false` than have every bundle
      // miss the live feedback by default. The legacy
      // `hideIdentityBadge` flag still wins when set, for callers
      // that explicitly suppressed the badge under the old default.
      const showBadge =
        options.showIdentityBadge !== undefined
          ? options.showIdentityBadge
          : options.hideIdentityBadge !== undefined
            ? !options.hideIdentityBadge
            : true;
      const auth = new BrowserAuth({
        origin: baseURL,
        hideBadge: !showBadge,
        // Pipe the shared event bus into BrowserAuth so the badge can
        // render its real-time activity ring / LED / popover. Safe to
        // pass even when the caller never subscribes — emit is a few
        // property reads when nobody's listening.
        events: this.events,
        ...(options.badgePosition !== undefined && { badgePosition: options.badgePosition }),
        ...(options.project !== undefined && { project: options.project }),
      });
      (this as { auth: BrowserAuth | null }).auth = auth;
      // The browser auth resolver wins over any caller-supplied one
      // because the auth flow owns token issuance + refresh from now on.
      apiKeyResolver = auth.getToken;
      // 401 from the gateway → token was revoked server-side (typically
      // because the user unsubscribed in another tab).  Drop the cached
      // token so the transport's auto-retry hits a fresh signIn() flow.
      onUnauthorized = () => auth.invalidate();
    }

    if (!options.apiKey && !apiKeyResolver) {
      throw new Error(
        "runjobs: pass either `apiKey`, `apiKeyResolver`, or `authProvider: \"runjobs\"`",
      );
    }
    const transport = new Transport({
      baseURL: baseURL ?? DEFAULT_BASE_URL,
      ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
      ...(apiKeyResolver !== undefined && { apiKeyResolver }),
      ...(onUnauthorized !== undefined && { onUnauthorized }),
      ...(options.fetch ? { fetchImpl: options.fetch } : {}),
    });
    // Service constructors receive the shared event bus so each call
    // path (chat/embeddings/image/audio/video/computer) can emit
    // start/end/error around its network operations. Files and Models
    // intentionally don't take it — they're infrastructure, not
    // user-facing LLM calls, and surfacing them would clutter the
    // badge with /v1/models polls.
    this.chat = new ChatService(transport, this.events);
    this.models = new ModelsService(transport);
    this.image = new ImageService(transport, this.events);
    this.audio = new AudioService(transport, this.events);
    this.video = new VideoService(transport, this.events);
    this.computer = new ComputerService(transport, this.events);
    this.files = new FilesService(transport);
    this.embeddings = new EmbeddingsService(transport, this.events);
  }

  /** Force a redirect to the runjobs.ai grant page.  No-op in static
   *  auth mode or in Node. */
  signIn(): void {
    this.auth?.signIn();
  }

  /**
   * Clear the cached token + identity from memory and localStorage.
   * The next API call will trigger sign-in again (redirect to grant
   * page).  Wire this to a "Sign out" button in your settings UI.
   *
   * No-op in static auth mode or in Node.
   */
  signOut(): void {
    this.auth?.signOut();
  }

  /** Currently-authenticated user (runjobs auth mode), or null. */
  get user(): BrowserUser | null {
    return this.auth?.user ?? null;
  }
}
