export interface BrowserAuthOptions {
    /**
     * Origin where the runjobs gateway lives — also the page that issues
     * tokens at /api/sdk/grant.  Default `https://www.runjobs.ai`.
     */
    origin?: string;
    /**
     * Suppress the floating identity badge.  Default `false`.
     */
    hideBadge?: boolean;
}
export interface BrowserUser {
    id?: string;
    name?: string;
    avatar_url?: string;
}
/**
 * BrowserAuth encapsulates the browser-side auth state for a RunJobs
 * client.  Exposes:
 *
 *   - getToken()       fresh bearer (auto-refreshes / signs in)
 *   - signIn()         force a redirect to the grant page
 *   - user             { id, name, avatar_url } — null until signed in
 *   - onTokenChange(fn) subscribe to token (re)acquisition
 *
 * Construct once per page; the SDK passes its `getToken` as the
 * transport's `apiKeyResolver`.
 */
export declare class BrowserAuth {
    private readonly origin;
    private readonly hideBadge;
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
    /** Force a redirect to the grant page. */
    signIn(): void;
    private nowSec;
    private tokenIsFresh;
    private inIframe;
    private setToken;
    /** Parse the #runjobs_token=… fragment, install, then strip it. */
    private consumeFragment;
    /** postMessage handshake with the dashboard parent (iframe path). */
    private requestTokenFromParent;
    /** Floating identity badge — bottom-right pill showing the user. */
    private renderBadge;
}
//# sourceMappingURL=browser-auth.d.ts.map