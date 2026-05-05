import { Transport } from "./transport.js";
import { ChatService } from "./chat.js";
import { ModelsService } from "./models.js";
import { ImageService } from "./image.js";
import { AudioService } from "./audio.js";
import { VideoService } from "./video.js";
import { ComputerService } from "./computer.js";
import { BrowserAuth } from "./browser-auth.js";
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
    /**
     * Browser auth helper, populated only when `authProvider: "runjobs"`.
     * Use `client.signIn()` and `client.user` for the common cases; the
     * full instance is exposed for advanced flows (manual `onTokenChange`
     * subscription, etc.).
     */
    auth = null;
    constructor(options = {}) {
        const provider = options.authProvider ?? "static";
        let apiKeyResolver = options.apiKeyResolver;
        let baseURL = options.baseURL;
        if (provider === "runjobs") {
            // Default the gateway origin to www.runjobs.ai for the runjobs
            // auth flow — that's where /api/sdk/grant lives.  Users overriding
            // baseURL explicitly (e.g. self-hosted runjobs) keep control.
            baseURL = baseURL ?? "https://www.runjobs.ai";
            const auth = new BrowserAuth({
                origin: baseURL,
                ...(options.hideIdentityBadge !== undefined && {
                    hideBadge: options.hideIdentityBadge,
                }),
            });
            this.auth = auth;
            // The browser auth resolver wins over any caller-supplied one
            // because the auth flow owns token issuance + refresh from now on.
            apiKeyResolver = auth.getToken;
        }
        if (!options.apiKey && !apiKeyResolver) {
            throw new Error("runjobs: pass either `apiKey`, `apiKeyResolver`, or `authProvider: \"runjobs\"`");
        }
        const transport = new Transport({
            baseURL: baseURL ?? DEFAULT_BASE_URL,
            ...(options.apiKey !== undefined && { apiKey: options.apiKey }),
            ...(apiKeyResolver !== undefined && { apiKeyResolver }),
            ...(options.fetch ? { fetchImpl: options.fetch } : {}),
        });
        this.chat = new ChatService(transport);
        this.models = new ModelsService(transport);
        this.image = new ImageService(transport);
        this.audio = new AudioService(transport);
        this.video = new VideoService(transport);
        this.computer = new ComputerService(transport);
    }
    /** Force a redirect to the runjobs.ai grant page.  No-op in static
     *  auth mode or in Node. */
    signIn() {
        this.auth?.signIn();
    }
    /** Currently-authenticated user (runjobs auth mode), or null. */
    get user() {
        return this.auth?.user ?? null;
    }
}
//# sourceMappingURL=client.js.map