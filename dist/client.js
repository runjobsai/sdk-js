import { Transport } from "./transport.js";
import { ChatService } from "./chat.js";
import { ModelsService } from "./models.js";
import { ImageService } from "./image.js";
import { AudioService } from "./audio.js";
import { VideoService } from "./video.js";
import { ComputerService } from "./computer.js";
import { FilesService } from "./files.js";
import { EmbeddingsService } from "./embeddings.js";
import { BrowserAuth } from "./browser-auth.js";
import { SDKEvents } from "./events.js";
const DEFAULT_BASE_URL = "https://api.runjobs.ai";
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
    chat;
    models;
    image;
    audio;
    video;
    computer;
    files;
    embeddings;
    /**
     * Browser auth helper, populated only when `authProvider: "runjobs"`.
     * Use `client.signIn()` and `client.user` for the common cases; the
     * full instance is exposed for advanced flows (manual `onTokenChange`
     * subscription, etc.).
     */
    auth = null;
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
    events = new SDKEvents();
    constructor(options = {}) {
        const provider = options.authProvider ?? "static";
        let apiKeyResolver = options.apiKeyResolver;
        let baseURL = options.baseURL;
        let onUnauthorized;
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
            const showBadge = options.showIdentityBadge !== undefined
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
                ...(options.project !== undefined && { project: options.project }),
            });
            this.auth = auth;
            // The browser auth resolver wins over any caller-supplied one
            // because the auth flow owns token issuance + refresh from now on.
            apiKeyResolver = auth.getToken;
            // 401 from the gateway → token was revoked server-side (typically
            // because the user unsubscribed in another tab).  Drop the cached
            // token so the transport's auto-retry hits a fresh signIn() flow.
            onUnauthorized = () => auth.invalidate();
        }
        if (!options.apiKey && !apiKeyResolver) {
            throw new Error("runjobs: pass either `apiKey`, `apiKeyResolver`, or `authProvider: \"runjobs\"`");
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
    signIn() {
        this.auth?.signIn();
    }
    /**
     * Clear the cached token + identity from memory and localStorage.
     * The next API call will trigger sign-in again (redirect to grant
     * page).  Wire this to a "Sign out" button in your settings UI.
     *
     * No-op in static auth mode or in Node.
     */
    signOut() {
        this.auth?.signOut();
    }
    /** Currently-authenticated user (runjobs auth mode), or null. */
    get user() {
        return this.auth?.user ?? null;
    }
}
//# sourceMappingURL=client.js.map