// browser-auth.ts — opt-in runjobs.ai auth flow for browser bundles.
//
// Activated by `new RunJobs({ authProvider: "runjobs", baseURL: "..." })`.
// In Node and other non-window environments this module's runtime code
// short-circuits to no-ops; it ships with the IIFE bundle for resource
// bundles loaded via <script> tag.
//
// Responsibilities:
//   - Detect & consume `#runjobs_token=…` URL fragment planted by the
//     grant page after a successful sign-in.
//   - Trigger a redirect-based grant flow when the bundle calls a
//     gateway endpoint without a fresh token.
//   - In iframe contexts (the runjobs dashboard embedding), handshake
//     with the parent via postMessage to silently obtain a token.
//   - Render an unobtrusive identity badge in the bottom-right corner
//     so the end user can see WHICH runjobs account is paying for the
//     calls being made on their behalf.
//
// Why redirect (not popup): under COOP=same-origin (required so the
// bundle can use OPFS / SharedArrayBuffer), the browser severs the
// window.opener relationship for cross-origin popups, so popup-based
// grant flows silently lose their postMessage replies.

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
}

export interface BrowserUser {
  id?: string;
  name?: string;
}

const TOKEN_REFRESH_MARGIN_S = 60;
const STORAGE_KEY = "__runjobs_auth_v1__";
// Set when the user clicks "Sign out".  While present, getToken() must
// not silently redirect to the grant page even though the user still
// has a runjobs.ai cookie — otherwise the backend's auto-grant turns
// every page reload into a re-authentication.  Cleared on explicit
// signIn() so the user can come back.
const SIGNED_OUT_KEY = "__runjobs_signed_out_v1__";

interface PersistedAuth {
  token: string;
  expiresAt: number;
  user?: BrowserUser;
  origin: string;
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
export class BrowserAuth {
  private readonly origin: string;
  private readonly hideBadge: boolean;
  private readonly project: string | null;
  private token: string | null = null;
  private expiresAt = 0;
  private userInfo: BrowserUser | null = null;
  private listeners: Array<(token: string) => void> = [];
  private parentHandshake: Promise<void> | null = null;
  private signingIn = false;

  constructor(opts: BrowserAuthOptions = {}) {
    this.origin = (opts.origin ?? "https://www.runjobs.ai").replace(/\/$/, "");
    this.hideBadge = !!opts.hideBadge;
    this.project = opts.project ?? null;
    if (typeof window === "undefined") return;

    // Restore from localStorage (survives page reloads).  We pin the
    // saved token to the gateway origin: a bundle that switches
    // between dev / prod gateways shouldn't accidentally reuse the
    // previous one's token.
    this.loadPersisted();

    // Eager: install token from the URL fragment if the grant page
    // just redirected us back here.  This always WINS over a
    // localStorage-cached token because a fresh redirect implies the
    // user just (re)authenticated and the old cache may be stale.
    // A successful fragment install also clears the "signed out"
    // sticky flag — the user explicitly signed in again.
    if (this.consumeFragment()) {
      this.clearSignedOut();
    }

    if (this.isSignedOut()) {
      // Honour the user's explicit sign-out across reloads.  Don't
      // attempt parent handshake or render the badge.
    } else if (this.inIframe() && !this.tokenIsFresh()) {
      // Best-effort parent handshake — silent if it succeeds, falls
      // through to the standard fragment / redirect path otherwise.
      this.parentHandshake = this.requestTokenFromParent().catch(() => {
        /* dashboard parent unavailable; will redirect on next call */
      });
    } else if (this.tokenIsFresh() && this.userInfo && !this.hideBadge) {
      // Restored from cache — render the badge so the user can see
      // they're already signed in (and find the sign-out affordance
      // their bundle author exposed).
      this.renderBadge();
    }
  }

  /** Public token-fetcher; pass to RunJobs as `apiKeyResolver`. */
  getToken = async (): Promise<string> => {
    if (this.tokenIsFresh()) return this.token as string;
    if (this.parentHandshake) {
      await this.parentHandshake;
      if (this.tokenIsFresh()) return this.token as string;
    }
    // User explicitly signed out — don't silently re-auth.  Throw so
    // the caller surfaces an unauthenticated state and can prompt the
    // user to click signIn.  Without this guard, the backend's
    // auto-grant flow would re-issue a token on every page reload
    // (the cookie on the gateway domain is still valid).
    if (this.isSignedOut()) {
      throw new Error("RunJobs: signed out — call client.signIn() to authenticate");
    }
    // No fresh token + can't get one silently → redirect to grant.
    // The page is about to unload; return a never-resolving Promise so
    // the caller doesn't proceed with a half-issued request.
    this.signIn();
    return new Promise(() => {});
  };

  /** Subscribe to (re)acquisition events. Returns an unsubscribe fn. */
  onTokenChange(handler: (token: string) => void): () => void {
    this.listeners.push(handler);
    return () => {
      const i = this.listeners.indexOf(handler);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Currently-authenticated user, or null. */
  get user(): BrowserUser | null {
    return this.userInfo;
  }

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
  signOut(): void {
    this.token = null;
    this.expiresAt = 0;
    this.userInfo = null;
    this.parentHandshake = null;
    this.signingIn = false;
    this.clearPersisted();
    this.markSignedOut();
    this.removeBadge();
  }

  /**
   * Drop the in-memory + persisted token without setting the sticky
   * "signed out" flag.  Used by the transport layer when the gateway
   * returns 401 (token revoked server-side, e.g. user unsubscribed in
   * another tab).  The next `getToken()` will trigger the standard
   * `signIn()` redirect-grant flow and the user re-auths transparently.
   */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
    this.userInfo = null;
    this.parentHandshake = null;
    this.signingIn = false;
    this.clearPersisted();
  }

  /** Force a redirect to the grant page. */
  signIn(): void {
    if (typeof window === "undefined" || this.signingIn) return;
    // Explicit signIn clears the "signed out" flag so getToken() can
    // proceed with the redirect-grant flow.
    this.clearSignedOut();
    this.signingIn = true;
    const ret = location.href.split("#")[0] ?? location.href;
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)")
      .matches
      ? "dark"
      : "light";
    location.href = this.buildGrantUrl({
      pageOrigin: location.origin,
      app: location.host,
      redirectTo: ret,
      scheme,
    });
  }

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
  }): string {
    return this.buildGrantUrl(args);
  }

  private buildGrantUrl(args: {
    pageOrigin: string;
    app: string;
    redirectTo: string;
    scheme: "light" | "dark";
  }): string {
    const params = new URLSearchParams();
    params.set("origin", args.pageOrigin);
    params.set("app", args.app);
    params.set("redirect_to", args.redirectTo);
    params.set("scheme", args.scheme);
    if (this.project) params.set("project_id", this.project);
    return this.origin + "/api/sdk/grant?" + params.toString();
  }

  // ── Internals ────────────────────────────────────────────────────

  private nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  private tokenIsFresh(): boolean {
    return !!this.token && this.nowSec() < this.expiresAt - TOKEN_REFRESH_MARGIN_S;
  }

  private inIframe(): boolean {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }

  private setToken(token: string, expiresAt: number, user?: BrowserUser) {
    this.token = token;
    this.expiresAt = expiresAt || this.nowSec() + 3600;
    if (user) {
      this.userInfo = user;
      if (!this.hideBadge) this.renderBadge();
    }
    this.savePersisted();
    for (const fn of this.listeners) {
      try {
        fn(token);
      } catch (err) {
        console.warn("[runjobs] onTokenChange handler threw", err);
      }
    }
  }

  private savePersisted() {
    if (typeof localStorage === "undefined" || !this.token) return;
    try {
      const data: PersistedAuth = {
        token: this.token,
        expiresAt: this.expiresAt,
        origin: this.origin,
        ...(this.userInfo ? { user: this.userInfo } : {}),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* quota / private mode — degrade to in-memory only */
    }
  }

  private loadPersisted() {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<PersistedAuth>;
      if (!data.token || !data.origin) return;
      // Pin to the gateway origin we were constructed with — a bundle
      // talking to a different gateway shouldn't reuse this token.
      if (data.origin !== this.origin) return;
      // Already expired?  Drop it; next call will redirect to grant.
      if (typeof data.expiresAt === "number" && data.expiresAt > 0 &&
          this.nowSec() >= data.expiresAt - TOKEN_REFRESH_MARGIN_S) {
        this.clearPersisted();
        return;
      }
      this.token = data.token;
      this.expiresAt = data.expiresAt ?? 0;
      if (data.user) this.userInfo = data.user;
    } catch {
      /* corrupted blob — drop it */
      this.clearPersisted();
    }
  }

  private clearPersisted() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }

  private isSignedOut(): boolean {
    if (typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem(SIGNED_OUT_KEY) === "1";
    } catch { return false; }
  }

  private markSignedOut() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(SIGNED_OUT_KEY, "1");
    } catch { /* ignore */ }
  }

  private clearSignedOut() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(SIGNED_OUT_KEY);
    } catch { /* ignore */ }
  }

  private removeBadge() {
    if (typeof document === "undefined") return;
    document.getElementById("__runjobs_identity__")?.remove();
  }

  /** Parse the #runjobs_token=… fragment, install, then strip it. */
  private consumeFragment(): boolean {
    if (!location.hash || location.hash.indexOf("runjobs_token=") < 0)
      return false;
    const params: Record<string, string> = {};
    location.hash
      .replace(/^#/, "")
      .split("&")
      .forEach((kv) => {
        const i = kv.indexOf("=");
        if (i >= 0) params[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      });
    if (!params.runjobs_token) return false;
    let user: BrowserUser | undefined;
    if (params.user) {
      try {
        user = JSON.parse(params.user);
      } catch {
        /* malformed; ignore — token still works */
      }
    }
    this.setToken(
      params.runjobs_token,
      parseInt(params.expires_at ?? "", 10) || 0,
      user,
    );
    // Clean fragment so a refresh doesn't re-consume.
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch {
      /* ignore — non-fatal */
    }
    return true;
  }

  /** postMessage handshake with the dashboard parent (iframe path). */
  private requestTokenFromParent(): Promise<void> {
    return new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        done = true;
        window.removeEventListener("message", onMessage);
      };
      const onMessage = (e: MessageEvent) => {
        if (e.origin !== this.origin) return;
        const data = e.data as
          | { type: string; token?: string; expires_at?: number; user?: BrowserUser }
          | null;
        if (data && data.type === "runjobs:token" && data.token) {
          this.setToken(data.token, data.expires_at ?? 0, data.user);
          cleanup();
          resolve();
        }
      };
      window.addEventListener("message", onMessage);
      try {
        window.parent.postMessage({ type: "runjobs:request-token" }, this.origin);
      } catch (err) {
        cleanup();
        reject(err);
        return;
      }
      setTimeout(() => {
        if (done) return;
        cleanup();
        reject(new Error("runjobs: parent handshake timeout"));
      }, 3000);
    });
  }

  /** Floating identity badge — bottom-right pill showing the user. */
  private renderBadge() {
    if (typeof document === "undefined" || !this.userInfo) return;
    const ID = "__runjobs_identity__";
    const ready = (cb: () => void) =>
      document.body ? cb() : document.addEventListener("DOMContentLoaded", cb);
    ready(() => {
      document.getElementById(ID)?.remove();
      const el = document.createElement("div");
      el.id = ID;
      el.style.cssText = [
        "position:fixed",
        "bottom:16px",
        "right:16px",
        "z-index:2147483647",
        "display:flex",
        "align-items:center",
        "gap:8px",
        "padding:6px 12px 6px 6px",
        "border-radius:999px",
        "font:500 12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
        "color:#fff",
        "background:rgba(15,15,20,0.55)",
        "backdrop-filter:blur(10px) saturate(1.2)",
        "-webkit-backdrop-filter:blur(10px) saturate(1.2)",
        "border:1px solid rgba(255,255,255,0.12)",
        "box-shadow:0 4px 16px rgba(0,0,0,0.15)",
        "user-select:none",
        "max-width:220px",
        "overflow:hidden",
      ].join(";");
      const u = this.userInfo as BrowserUser;
      const avatar = document.createElement("div");
      avatar.textContent = (u.name || "?").charAt(0).toUpperCase();
      avatar.style.cssText = [
        "width:22px;height:22px;border-radius:50%;flex-shrink:0",
        "display:flex;align-items:center;justify-content:center",
        "background:linear-gradient(135deg,#3b82f6,#8b5cf6)",
        "font-size:11px;font-weight:600;color:#fff",
      ].join(";");
      const name = document.createElement("span");
      name.textContent = u.name || "Signed in";
      name.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      el.appendChild(avatar);
      el.appendChild(name);
      document.body.appendChild(el);
    });
  }
}
