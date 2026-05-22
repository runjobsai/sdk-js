import type { SDKEvents } from "./events.js";
export interface BrowserAuthOptions {
    /**
     * Origin where the runjobs gateway lives — also the page that issues
     * tokens at /api/sdk/grant.  Default `https://www.runjobs.ai`.
     */
    origin?: string;
    /**
     * Suppress the floating identity badge.  Default `false` at this
     * layer.  The wrapping `RunJobs` client passes `hideBadge: false`
     * by default (badge SHOWN — it's now a live activity indicator,
     * see `activity-tracker.ts`); callers wanting their own status UI
     * opt out via `RunJobs({ showIdentityBadge: false })`. Set this
     * directly only when constructing BrowserAuth without going
     * through `RunJobs`.
     */
    hideBadge?: boolean;
    /**
     * Pin the grant flow to a named runjobs.ai project.  When set, the
     * SDK passes `project_id=<value>` to `/api/sdk/grant`, asking the
     * gateway to mint a project-bound `rrt_*` resource token for THAT
     * project regardless of which (origin, app) pair the bundle is
     * served from.
     *
     * Use cases:
     *   - **Local dev** for a 1:1 bundle/project app: the localhost
     *     origin isn't registered with any project, so without this
     *     option the grant flow can't pick one and `client.files` 403s
     *     on every call.  Pin the project explicitly and `pnpm dev`
     *     hits the same files namespace as production.
     *   - **Multi-tenant bundles** that let the user pick a project at
     *     runtime — pass the chosen project id, then call `signOut()` +
     *     `signIn()` (or reconstruct the client) on switch.
     *
     * Omit to keep the default behaviour: the gateway derives the
     * project from the registered (origin, app) pair.
     */
    project?: string;
    /**
     * Optional event bus from the parent RunJobs client.  When wired,
     * the identity badge subscribes to call telemetry events and
     * renders a real-time activity ring + LED dot + click-through
     * popover with active / recent / session stats — turning the
     * static "signed in" badge into a desktop-ball-style live
     * indicator (similar to a tray-app gauge).
     *
     * Optional and back-compat: when omitted (or when `hideBadge` is
     * true), the badge falls back to its original static behaviour.
     */
    events?: SDKEvents;
}
export interface BrowserUser {
    id?: string;
    name?: string;
}
/**
 * BrowserAuth encapsulates the browser-side auth state for a RunJobs
 * client.  Exposes:
 *
 *   - getToken()       fresh bearer (auto-refreshes / signs in)
 *   - signIn()         force a redirect to the grant page
 *   - user             { id, name } — null until signed in
 *   - onTokenChange(fn) subscribe to token (re)acquisition
 *
 * Construct once per page; the SDK passes its `getToken` as the
 * transport's `apiKeyResolver`.
 */
export declare class BrowserAuth {
    private readonly origin;
    private readonly hideBadge;
    private readonly project;
    private readonly events;
    /** Lazily-constructed when events are present — drives the badge's
     *  activity ring / LED / popover. nullable for tests / non-browser. */
    private readonly tracker;
    private token;
    private expiresAt;
    private userInfo;
    private listeners;
    private parentHandshake;
    private signingIn;
    constructor(opts?: BrowserAuthOptions);
    /** Public token-fetcher; pass to RunJobs as `apiKeyResolver`. */
    getToken: () => Promise<string>;
    /** Subscribe to (re)acquisition events. Returns an unsubscribe fn. */
    onTokenChange(handler: (token: string) => void): () => void;
    /** Currently-authenticated user, or null. */
    get user(): BrowserUser | null;
    /**
     * True iff a cached bearer token is present AND not within the
     * 60-second pre-expiry refresh margin.  Use this — not `user !==
     * null` — to decide whether to show "please sign in" UI: the user
     * metadata is only populated when the SDK was fed fresh user info
     * (post-redirect fragment carries it; iframe handshake carries it;
     * an older localStorage save format may have persisted only the
     * token).  A token without metadata is still a fully-usable
     * session — every gateway call will succeed — and prompting the
     * user to sign in there causes a redirect that loses session
     * continuity for no reason.
     */
    hasFreshToken(): boolean;
    /**
     * Clear the cached token / user / badge and the persisted copy in
     * localStorage.  Next gateway call will trigger a redirect to the
     * grant page — i.e. the standard sign-in flow.  Wire this to a
     * "Sign out" button in the bundle's settings UI.
     *
     * Does NOT redirect on its own; the bundle decides whether to
     * also navigate the user (e.g. to a logged-out splash page) or
     * just refresh state and let the next API call re-prompt.
     */
    signOut(): void;
    /**
     * Drop the in-memory + persisted token without setting the sticky
     * "signed out" flag.  Used by the transport layer when the gateway
     * returns 401 (token revoked server-side, e.g. user unsubscribed in
     * another tab).  The next `getToken()` will trigger the standard
     * `signIn()` redirect-grant flow and the user re-auths transparently.
     */
    invalidate(): void;
    /** Force a redirect to the grant page. */
    signIn(): void;
    /**
     * Build the `/api/sdk/grant?…` URL the user is redirected to.  Split
     * out so tests can assert URL formation without a `window` context;
     * `signIn` is the only production caller.
     *
     * Public surface, but namespaced under `_buildGrantUrlForTest` so it
     * doesn't show up in IntelliSense as a normal API.
     */
    _buildGrantUrlForTest(args: {
        pageOrigin: string;
        app: string;
        redirectTo: string;
        scheme: "light" | "dark";
    }): string;
    private buildGrantUrl;
    private nowSec;
    private tokenIsFresh;
    private inIframe;
    private setToken;
    private savePersisted;
    private loadPersisted;
    private clearPersisted;
    private isSignedOut;
    private markSignedOut;
    private clearSignedOut;
    private removeBadge;
    /** Parse the #runjobs_token=… fragment, install, then strip it. */
    private consumeFragment;
    /** postMessage handshake with the dashboard parent (iframe path). */
    private requestTokenFromParent;
    /** Floating identity badge — bottom-right pill showing the user.
     *  Click opens the runjobs.ai dashboard in a new tab so the user
     *  can manage their account / billing without losing the bundle's
     *  in-flight state.  Uses `noopener,noreferrer` so the new tab
     *  can't reach back into the bundle window via `window.opener`. */
    private renderBadge;
}
//# sourceMappingURL=browser-auth.d.ts.map