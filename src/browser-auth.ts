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

import { ActivityTracker, type ActivitySnapshot, type SessionStats } from "./activity-tracker.js";
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
  /**
   * Which corner the badge floats in. See `RunJobs.badgePosition`
   * for the user-facing flavour. Defaults to `"bottom-right"`.
   */
  badgePosition?: BadgePosition;
}

/** Four-corner anchor for the floating activity badge. */
export type BadgePosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface BrowserUser {
  id?: string;
  name?: string;
}

const TOKEN_REFRESH_MARGIN_S = 60;
// Per-project localStorage namespacing.  When two BrowserAuth bundles
// live on the same origin (most commonly `localhost:5173` during
// development of multiple SDK-using apps, or a deployed origin that
// hosts more than one bundle), a single shared key would let them
// clobber each other's tokens — bundle B's signIn() would overwrite
// the token bundle A had cached, and the next time A booted it'd
// either reuse B's token (wrong project scope, every gateway call
// returns 404 on `files/...`) or skip the cache and redirect through
// the grant flow on every reload.  Append the constructor-supplied
// `project` to the key so bundles scoped to different projects keep
// independent slots in localStorage.  Bundles without an explicit
// project (iframe / parent-handshake mode) fall back to the legacy
// unsuffixed key, which preserves back-compat for already-persisted
// tokens after upgrade.
const STORAGE_KEY_BASE = "__runjobs_auth_v1__";
// Set when the user clicks "Sign out".  While present, getToken() must
// not silently redirect to the grant page even though the user still
// has a runjobs.ai cookie — otherwise the backend's auto-grant turns
// every page reload into a re-authentication.  Cleared on explicit
// signIn() so the user can come back.  Same per-project namespacing
// rationale as STORAGE_KEY_BASE — signing out of bundle A shouldn't
// also sign out bundle B that happens to share the origin.
const SIGNED_OUT_KEY_BASE = "__runjobs_signed_out_v1__";

/** Compose the localStorage key for an auth slot.  `null` project
 *  yields the base key (iframe-mode and pre-v1.x bundles), which
 *  preserves back-compat for tokens persisted before this change. */
function storageKey(project: string | null): string {
  return project ? `${STORAGE_KEY_BASE}:${project}` : STORAGE_KEY_BASE;
}

/** Same as storageKey, for the sticky sign-out flag. */
function signedOutKey(project: string | null): string {
  return project ? `${SIGNED_OUT_KEY_BASE}:${project}` : SIGNED_OUT_KEY_BASE;
}

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
  private readonly events: SDKEvents | null;
  /** Lazily-constructed when events are present — drives the badge's
   *  activity ring / LED / popover. nullable for tests / non-browser. */
  private readonly tracker: ActivityTracker | null;
  private readonly badgePosition: BadgePosition;
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
    this.events = opts.events ?? null;
    this.badgePosition = opts.badgePosition ?? "bottom-right";
    if (this.events && !this.hideBadge) {
      this.tracker = new ActivityTracker();
      this.tracker.attach(this.events);
    } else {
      this.tracker = null;
    }
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

    // User explicitly signed out — don't silently re-auth.  Throw so
    // the caller surfaces an unauthenticated state and can prompt the
    // user to click signIn.  Without this guard, the backend's
    // auto-grant flow would re-issue a token on every page reload
    // (the cookie on the gateway domain is still valid).
    if (this.isSignedOut()) {
      throw new Error("RunJobs: signed out — call client.signIn() to authenticate");
    }

    // ── Embedded (cross-site iframe) path ──
    //
    // Inside a cross-site iframe (the dashboard's bundle embed),
    // signIn() → /api/sdk/grant is a DEAD END: navigating the iframe to
    // the gateway origin is a *sub-frame* navigation, so the session
    // cookie is NOT sent (SameSite) and grant bounces to a login form
    // the user can't complete in place.  The dashboard parent — same
    // origin as the gateway, and it holds the cookie — is the ONLY
    // party that can mint a token here.  So we RE-handshake with the
    // parent on EVERY stale token (not just once at construction).
    // This is what lets a bundle survive token expiry / revocation
    // without ever dropping to the login screen.
    if (this.inIframe()) {
      try {
        // Reuse the eager construction-time handshake on the first call
        // (avoids a duplicate post), then consume it so later staleness
        // (expiry / 401-invalidate) starts a fresh handshake instead.
        if (this.parentHandshake) {
          await this.parentHandshake;
          this.parentHandshake = null;
        }
        if (!this.tokenIsFresh()) {
          await this.requestTokenFromParent();
        }
      } catch {
        /* parent slow / unreachable — fall through to the throw */
      }
      if (this.tokenIsFresh()) return this.token as string;
      // Never signIn() inside an iframe (cookie-less grant dead end).
      // Surface as unauthenticated so the bundle can retry / show state.
      throw new Error("RunJobs: could not obtain a token from the dashboard");
    }

    // ── Top-level (own tab / window) path ──
    //
    // signIn() → grant works here because the cookie IS sent on a
    // top-level navigation.
    if (this.parentHandshake) {
      await this.parentHandshake;
      if (this.tokenIsFresh()) return this.token as string;
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
  hasFreshToken(): boolean {
    return this.tokenIsFresh();
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

  /**
   * Return the localStorage keys this instance reads / writes for its
   * persisted token + sign-out flag.  Exposed for tests so we can
   * assert per-project namespacing without a real DOM; not part of
   * the public API surface (the leading underscore + `ForTest` suffix
   * is the SDK's convention for this).
   */
  _storageKeysForTest(): { auth: string; signedOut: string } {
    return {
      auth: storageKey(this.project),
      signedOut: signedOutKey(this.project),
    };
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
      localStorage.setItem(storageKey(this.project), JSON.stringify(data));
    } catch {
      /* quota / private mode — degrade to in-memory only */
    }
  }

  private loadPersisted() {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(storageKey(this.project));
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
      localStorage.removeItem(storageKey(this.project));
    } catch { /* ignore */ }
  }

  private isSignedOut(): boolean {
    if (typeof localStorage === "undefined") return false;
    try {
      return localStorage.getItem(signedOutKey(this.project)) === "1";
    } catch { return false; }
  }

  private markSignedOut() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(signedOutKey(this.project), "1");
    } catch { /* ignore */ }
  }

  private clearSignedOut() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(signedOutKey(this.project));
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
      const timers: ReturnType<typeof setTimeout>[] = [];
      const cleanup = () => {
        done = true;
        window.removeEventListener("message", onMessage);
        for (const t of timers) clearTimeout(t);
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

      // postMessage is NOT queued: if the parent's React listener isn't
      // mounted at the instant of our first post, that single message is
      // lost forever and we'd time out → dead-end grant redirect.  So
      // re-post a few times across the wait window; a late-mounting
      // parent still receives a request to answer.  The parent also
      // pushes the token proactively on iframe load — belt-and-braces.
      const post = () => {
        if (done) return;
        try {
          window.parent.postMessage({ type: "runjobs:request-token" }, this.origin);
        } catch (err) {
          cleanup();
          reject(err);
        }
      };
      post();
      for (const d of [250, 750, 1500, 3000]) timers.push(setTimeout(post, d));

      // Longer overall window (5s vs the old 3s) gives a heavy bundle +
      // a cold parent room to complete the round trip before we give up.
      timers.push(
        setTimeout(() => {
          if (done) return;
          cleanup();
          reject(new Error("runjobs: parent handshake timeout"));
        }, 5000),
      );
    });
  }

  /** Floating identity badge — bottom-right pill showing the user.
   *  Click opens the runjobs.ai dashboard in a new tab so the user
   *  can manage their account / billing without losing the bundle's
   *  in-flight state.  Uses `noopener,noreferrer` so the new tab
   *  can't reach back into the bundle window via `window.opener`. */
  private renderBadge() {
    if (typeof document === "undefined" || !this.userInfo) return;
    const ID = "__runjobs_identity__";
    const dashboardUrl = `${this.origin}/dashboard`;
    const ready = (cb: () => void) =>
      document.body ? cb() : document.addEventListener("DOMContentLoaded", cb);
    ready(() => {
      // Idempotent: remove an older instance so successive renders
      // (e.g. after sign-in finishes) don't stack badges.
      document.getElementById(ID)?.remove();
      const root = mountActivityBadge({
        id: ID,
        user: this.userInfo as BrowserUser,
        dashboardUrl,
        tracker: this.tracker,
        position: this.badgePosition,
        // Bind through `this` so the popover's Sign-out button runs
        // BrowserAuth.signOut (clears token cache + flips signed-out
        // flag + dispatches the auth event); a plain method reference
        // would lose `this`.
        //
        // Then hard-reload the page. signOut() deliberately doesn't
        // navigate (its contract leaves that to the host bundle), but
        // the badge IS the SDK's own UI, and a user clicking its
        // "Sign out" expects to land back on the app's signed-out /
        // login view — not keep staring at a now-stale authed page.
        // The reload re-runs the bundle's bootstrap against a cleared
        // token + the sticky signed-out flag, so the app naturally
        // shows its login state. Guard window for non-browser hosts.
        onSignOut: () => {
          this.signOut();
          if (typeof window !== "undefined") window.location.reload();
        },
      });
      document.body.appendChild(root);
    });
  }
}

/* ============================================================ *
 *  Activity Badge UI                                            *
 * ============================================================ *
 *
 * Vanilla-DOM render of the bottom-right identity badge with a
 * desktop-ball-style real-time activity layer. Stays out of
 * BrowserAuth's main class body to keep auth state and DOM concerns
 * separate — auth owns "who is signed in", this owns "what's
 * happening right now". Three visual layers:
 *
 *   1. Avatar + name pill — the existing static badge.
 *   2. Progress ring (SVG) wrapping the avatar — animates speed
 *      proportional to tokens/sec when a stream is active; fades
 *      out at idle. Single in-flight call shows one rotating arc;
 *      multi-call shows the avatar's outline glowing.
 *   3. LED dot at avatar's bottom-right — discrete colour signal:
 *      grey (idle) / blue pulsing (active) / red (recent error) /
 *      green fade (success-burst, 300ms after end).
 *
 * Clicking the badge toggles a popover showing the same data the
 * spec called for: Active / Recent / Session. Hover with 400ms
 * grace also opens it (matches macOS / Discord tray tooltips).
 *
 * Performance: the redraw loop pauses entirely when status==idle
 * AND the popover is closed (no rAF burn). When active, it
 * re-renders at ~6 Hz — fast enough for token rate to look live,
 * cheap enough to not warm a laptop fan.
 */

interface MountOpts {
  id: string;
  user: BrowserUser;
  dashboardUrl: string;
  tracker: ActivityTracker | null;
  position: BadgePosition;
  /** Fired when the user clicks the popover's "Sign out" link.
   *  Wires up to BrowserAuth.signOut so the token cache is cleared
   *  and the in-tab state flips to signed-out without a reload. */
  onSignOut: () => void;
}

/**
 * Per-corner CSS overrides for the floating badge + its popover.
 * `top` vs `bottom` flips the badge's vertical anchor AND the
 * popover's open direction (top-anchored badge → popover opens
 * downward); `right` vs `left` flips horizontal anchor on both.
 */
/**
 * Inject the `@keyframes __runjobs_led_pulse__` rule into the document
 * head ONCE (idempotent — re-mounts and multiple SDK instances on the
 * same page share the same rule). Must run at badge mount time so
 * the LED's `animation` CSS resolves the keyframe reference the
 * moment status flips from idle to active — previously this lived
 * inside createPopover() and only fired on first hover, leaving the
 * LED frozen until the user interacted.
 */
function ensurePulseKeyframes(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("__runjobs_kf__")) return;
  const style = document.createElement("style");
  style.id = "__runjobs_kf__";
  style.textContent =
    "@keyframes __runjobs_led_pulse__ {" +
    "  0%   { box-shadow: 0 0 0 0   rgba(59,130,246,0.7); }" +
    "  70%  { box-shadow: 0 0 0 6px rgba(59,130,246,0);   }" +
    "  100% { box-shadow: 0 0 0 0   rgba(59,130,246,0);   }" +
    "}";
  (document.head ?? document.documentElement).appendChild(style);
}

function badgeCornerStyles(position: BadgePosition): {
  badge: string;
  popover: string;
} {
  const v = position.startsWith("top") ? "top" : "bottom";
  const h = position.endsWith("right") ? "right" : "left";
  // Popover sits on the OPPOSITE vertical side of the badge so it
  // grows AWAY from the edge of the viewport, never offscreen.
  const popoverVerticalAnchor =
    v === "bottom" ? "bottom:calc(100% + 8px);top:auto" : "top:calc(100% + 8px);bottom:auto";
  const popoverHorizontalAnchor = h === "right" ? "right:0;left:auto" : "left:0;right:auto";
  return {
    badge: `${v}:16px;${h}:16px`,
    popover: `${popoverVerticalAnchor};${popoverHorizontalAnchor}`,
  };
}

// ─── Drag-to-move + position persistence ────────────────────────────
//
// Users sometimes want to move the floating badge — it overlaps a
// site's own corner UI (chat widget, footer button, etc.). Drag to
// reposition; the saved coords land in a cookie so reloads keep the
// chosen spot. Cookie because the user asked for cookie; localStorage
// would be the more typical choice for ~10 bytes of UI state, but
// cookie is fine — small payload, same-site, no SDK dependency on a
// storage permission.

/** Cookie key the saved badge position lives under. URI-safe, prefixed
 *  so other libraries / consumers don't accidentally collide. */
const BADGE_POS_COOKIE = "__runjobs_badge_pos__";

/** Pixel threshold a pointer must travel before we treat the gesture
 *  as a drag instead of a click. Below this, it's a normal badge tap
 *  that opens the popover. 5 px matches OS-level click slop tolerances. */
const BADGE_DRAG_THRESHOLD_PX = 5;

/** Edge inset when clamping a dragged badge into the viewport — keeps
 *  it visually inside the safe area on resize. Match the default
 *  corner offset (`16px` in badgeCornerStyles). */
const BADGE_EDGE_INSET_PX = 8;

function readBadgePosCookie(): { x: number; y: number } | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(BADGE_POS_COOKIE + "="));
  if (!raw) return null;
  const value = decodeURIComponent(raw.slice(BADGE_POS_COOKIE.length + 1));
  const parts = value.split(",");
  const rawX = parts[0];
  const rawY = parts[1];
  if (parts.length !== 2 || rawX === undefined || rawY === undefined) return null;
  const x = Number.parseInt(rawX, 10);
  const y = Number.parseInt(rawY, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function writeBadgePosCookie(x: number, y: number): void {
  if (typeof document === "undefined") return;
  // 1-year expiry, root path, lax cross-site so the cookie survives
  // navigation between subdomains under the same site. Secure when
  // we're on HTTPS so iframes can read it back without warnings.
  const maxAge = 60 * 60 * 24 * 365;
  const secure = typeof window !== "undefined" && window.location?.protocol === "https:" ? ";Secure" : "";
  document.cookie =
    `${BADGE_POS_COOKIE}=${encodeURIComponent(`${Math.round(x)},${Math.round(y)}`)};` +
    `path=/;max-age=${maxAge};SameSite=Lax${secure}`;
}

/** Snap (x, y) into the viewport so a saved position from a wider
 *  screen doesn't render off-canvas after a window resize.
 *  Coordinates are top-left of the badge element; w/h are its bounds. */
function clampToViewport(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const maxX = Math.max(BADGE_EDGE_INSET_PX, vw - w - BADGE_EDGE_INSET_PX);
  const maxY = Math.max(BADGE_EDGE_INSET_PX, vh - h - BADGE_EDGE_INSET_PX);
  return {
    x: Math.min(Math.max(BADGE_EDGE_INSET_PX, x), maxX),
    y: Math.min(Math.max(BADGE_EDGE_INSET_PX, y), maxY),
  };
}

/** Recompute the popover anchor CSS based on which quadrant of the
 *  viewport the badge currently sits in. Mirrors badgeCornerStyles'
 *  rule: popover grows AWAY from the nearer edge so it never escapes
 *  the viewport. Used after a drag so the popover keeps opening
 *  inward even when the badge is no longer in its starting corner. */
function popoverCssForRect(rect: { left: number; top: number; width: number; height: number }): string {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const verticalAnchor =
    cy < vh / 2
      ? "top:calc(100% + 8px);bottom:auto"
      : "bottom:calc(100% + 8px);top:auto";
  const horizontalAnchor = cx < vw / 2 ? "left:0;right:auto" : "right:0;left:auto";
  return `${verticalAnchor};${horizontalAnchor}`;
}

function mountActivityBadge(opts: MountOpts): HTMLButtonElement {
  const { id, user, dashboardUrl, tracker, position, onSignOut } = opts;
  const corners = badgeCornerStyles(position);

  // `currentPopoverCss` starts at the corner-derived anchor and gets
  // overwritten when the user drags the badge to a new quadrant.
  // createPopover() reads this at popover instantiation time; if the
  // popover was already built before a drag, the drag handler also
  // patches popover.style directly so the next open uses the new anchor.
  let currentPopoverCss = corners.popover;
  // Inject the LED pulse keyframes at mount time. Previously this
  // lived inside createPopover() — which only runs on first hover —
  // so the LED's `animation` CSS referenced a keyframe rule that
  // didn't exist until the user hovered, and the browser silently
  // skipped the animation. Result: LED stayed solid until hover,
  // exactly matching the bug report.
  ensurePulseKeyframes();
  const el = document.createElement("button");
  el.id = id;
  el.type = "button";
  el.title = "RunJobs activity";
  el.setAttribute("aria-label", "RunJobs activity status");
  el.style.cssText = [
    "position:fixed",
    corners.badge,
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
    "overflow:visible", // popover spills out the top
    "cursor:pointer",
    "appearance:none",
    "-webkit-appearance:none",
    "transition:background-color 120ms ease-out, box-shadow 120ms ease-out",
  ].join(";");
  el.addEventListener("mouseenter", () => {
    el.style.backgroundColor = "rgba(30,30,40,0.7)";
    el.style.boxShadow = "0 6px 20px rgba(0,0,0,0.22)";
  });
  el.addEventListener("mouseleave", () => {
    el.style.backgroundColor = "rgba(15,15,20,0.55)";
    el.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)";
  });

  // ─── Avatar with ring + LED ────────────────────────────────
  const avatarWrap = document.createElement("span");
  avatarWrap.style.cssText = [
    "position:relative",
    "width:26px;height:26px",
    "flex-shrink:0",
    "display:inline-flex;align-items:center;justify-content:center",
  ].join(";");

  // Progress ring (SVG). Hidden at idle so we don't paint when
  // nothing's happening. Stroke offset / dasharray animate via
  // direct style writes from the redraw loop.
  const ringNS = "http://www.w3.org/2000/svg";
  const ring = document.createElementNS(ringNS, "svg");
  ring.setAttribute("viewBox", "0 0 26 26");
  ring.setAttribute("width", "26");
  ring.setAttribute("height", "26");
  ring.style.cssText = [
    "position:absolute;inset:0",
    "pointer-events:none",
    "opacity:0",
    "transition:opacity 200ms ease-out",
  ].join(";");
  const ringTrack = document.createElementNS(ringNS, "circle");
  ringTrack.setAttribute("cx", "13");
  ringTrack.setAttribute("cy", "13");
  ringTrack.setAttribute("r", "12");
  ringTrack.setAttribute("fill", "none");
  ringTrack.setAttribute("stroke", "rgba(255,255,255,0.08)");
  ringTrack.setAttribute("stroke-width", "1.5");
  const ringArc = document.createElementNS(ringNS, "circle");
  ringArc.setAttribute("cx", "13");
  ringArc.setAttribute("cy", "13");
  ringArc.setAttribute("r", "12");
  ringArc.setAttribute("fill", "none");
  ringArc.setAttribute("stroke", "#3b82f6");
  ringArc.setAttribute("stroke-width", "2");
  ringArc.setAttribute("stroke-linecap", "round");
  // Rotate origin = center, start arc from 12 o'clock so progress
  // sweeps clockwise like every progress UI on the planet.
  ringArc.setAttribute("transform", "rotate(-90 13 13)");
  // Circumference = 2πr ≈ 75.4. dasharray=circumference + dashoffset
  // drives the arc length.
  const RING_CIRC = 2 * Math.PI * 12;
  ringArc.setAttribute("stroke-dasharray", String(RING_CIRC));
  ringArc.setAttribute("stroke-dashoffset", String(RING_CIRC));
  ring.appendChild(ringTrack);
  ring.appendChild(ringArc);

  const avatar = document.createElement("div");
  avatar.textContent = (user.name || "?").charAt(0).toUpperCase();
  avatar.style.cssText = [
    "width:22px;height:22px;border-radius:50%;flex-shrink:0",
    "display:flex;align-items:center;justify-content:center",
    "background:linear-gradient(135deg,#3b82f6,#8b5cf6)",
    "font-size:11px;font-weight:600;color:#fff",
    "position:relative",
  ].join(";");

  // LED status dot — absolute-positioned over the avatar's
  // bottom-right corner. Same trick Discord uses for online status.
  const led = document.createElement("span");
  led.style.cssText = [
    "position:absolute",
    "bottom:-2px;right:-2px",
    "width:8px;height:8px;border-radius:50%",
    "background:rgba(255,255,255,0.2)",
    "border:2px solid rgba(15,15,20,1)",
    "box-shadow:0 0 0 0 transparent",
    "transition:background-color 150ms ease-out, box-shadow 200ms ease-out",
    "pointer-events:none",
  ].join(";");

  avatarWrap.appendChild(ring);
  avatarWrap.appendChild(avatar);
  avatarWrap.appendChild(led);

  const name = document.createElement("span");
  name.textContent = user.name || "Signed in";
  name.style.cssText = "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none";

  el.appendChild(avatarWrap);
  el.appendChild(name);

  // ─── Popover (lazy, append on first open) ──────────────────
  //
  // Open / close has two modes:
  //   - hover: 400ms-grace open on badge enter; 300ms-grace close
  //     when neither badge NOR popover is hovered. The grace lets
  //     the user cross the 8px gap between badge and popover without
  //     losing the popover. Standard tooltip pattern.
  //   - click: sticky — stays open until the user clicks outside.
  //     Useful for reading + copying values out of the panel.
  let popover: HTMLDivElement | null = null;
  let popoverOpen = false;
  let popoverOpenedBy: "hover" | "click" | null = null;
  let openTimer: number | null = null;
  let closeTimer: number | null = null;

  const cancelOpen = () => {
    if (openTimer !== null) {
      window.clearTimeout(openTimer);
      openTimer = null;
    }
  };
  const cancelClose = () => {
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer = window.setTimeout(() => {
      // Re-check the mode — a click between schedule and fire turns
      // a hover-pending close into a sticky open.
      if (popoverOpenedBy === "hover") closePopover();
    }, 300);
  };

  const openPopover = (by: "hover" | "click") => {
    cancelOpen();
    cancelClose();
    if (popoverOpen) {
      // Upgrade a hover-open to click-stickiness if the user
      // clicked while the popover was already hover-shown.
      if (by === "click") popoverOpenedBy = "click";
      return;
    }
    if (!popover) {
      popover = createPopover(dashboardUrl, currentPopoverCss, () => {
        // Tear down our DOM before the auth flip runs so the popover
        // doesn't briefly show "signed out" state to a user who's
        // about to navigate away.  closePopover() also removes the
        // hover/click handlers' state.
        closePopover();
        onSignOut();
      });
      // Attach hover handlers ONCE — the popover element is reused
      // across open/close cycles, so .remove() / .appendChild()
      // doesn't shake the listeners off.
      popover.addEventListener("mouseenter", cancelClose);
      popover.addEventListener("mouseleave", () => {
        if (popoverOpenedBy === "hover") scheduleClose();
      });
    }
    el.appendChild(popover);
    popoverOpen = true;
    popoverOpenedBy = by;
    // Schedule one immediate redraw so the popover shows current
    // state, not a stale snapshot from the last close.
    requestRedraw();
  };

  const closePopover = () => {
    cancelClose();
    if (!popoverOpen) return;
    popover?.remove();
    popoverOpen = false;
    popoverOpenedBy = null;
  };

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    popoverOpen ? closePopover() : openPopover("click");
  });
  // Hover-open with 400ms delay — matches macOS tray tooltips.
  el.addEventListener("mouseenter", () => {
    cancelClose(); // moving back onto badge cancels a pending close
    cancelOpen();
    openTimer = window.setTimeout(() => {
      if (!popoverOpen) openPopover("hover");
    }, 400);
  });
  el.addEventListener("mouseleave", () => {
    cancelOpen();
    // Only the hover branch auto-closes; click-opened stays sticky
    // and dismisses via the click-outside handler below.
    if (popoverOpenedBy === "hover") scheduleClose();
  });
  // Click anywhere outside the badge closes the popover.
  document.addEventListener("click", (e) => {
    if (popoverOpen && !el.contains(e.target as Node)) closePopover();
  });

  // ─── Drag-to-move + cookie persistence ─────────────────────
  //
  // Two intents share the pointer-down on the badge:
  //   1. Quick tap → open popover (existing click handler).
  //   2. Hold-and-drag → reposition the badge.
  //
  // Disambiguate by movement distance: until the pointer travels
  // BADGE_DRAG_THRESHOLD_PX from its starting point we treat the
  // gesture as a pending click and let the existing click handler
  // run on pointerup. Past that threshold we flip to drag mode —
  // start moving the badge, claim the pointer via setPointerCapture
  // so we keep getting moves even when the pointer leaves the badge
  // bounds, and on pointerup persist the final coords + suppress
  // the click event the browser would otherwise synthesize.
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartBadgeLeft = 0;
  let dragStartBadgeTop = 0;
  let pointerDown = false;
  let isDragging = false;
  let suppressNextClick = false;

  /** Apply absolute pixel position to the badge, clearing the corner
   *  anchors set at mount. Used both by the drag handler (live update)
   *  and the cookie-restore path (mount-time hydrate). */
  const applyAbsolutePos = (x: number, y: number) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  };

  /** Recompute + apply the popover anchor based on the badge's current
   *  position in the viewport. Called after a drag so the popover
   *  always grows away from the nearest viewport edge. If the popover
   *  was already instantiated, patches its inline style in place. */
  const recomputePopoverAnchor = () => {
    const r = el.getBoundingClientRect();
    currentPopoverCss = popoverCssForRect({
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    });
    if (popover) {
      // Reset the four anchor properties before re-applying so we
      // don't leave stale `right` / `bottom` declarations stuck on
      // the element from the previous anchor.
      popover.style.top = "";
      popover.style.bottom = "";
      popover.style.left = "";
      popover.style.right = "";
      for (const decl of currentPopoverCss.split(";")) {
        const [prop, val] = decl.split(":");
        if (prop && val) popover.style.setProperty(prop.trim(), val.trim());
      }
    }
  };

  el.addEventListener("pointerdown", (e) => {
    // Only the primary button drags — secondary clicks should fall
    // through (browsers may show a context menu, etc.).
    if (e.button !== 0) return;
    pointerDown = true;
    isDragging = false;
    dragStartClientX = e.clientX;
    dragStartClientY = e.clientY;
    const r = el.getBoundingClientRect();
    dragStartBadgeLeft = r.left;
    dragStartBadgeTop = r.top;
  });

  el.addEventListener("pointermove", (e) => {
    if (!pointerDown) return;
    const dx = e.clientX - dragStartClientX;
    const dy = e.clientY - dragStartClientY;
    if (!isDragging) {
      if (Math.abs(dx) < BADGE_DRAG_THRESHOLD_PX && Math.abs(dy) < BADGE_DRAG_THRESHOLD_PX) {
        return; // still within click slop — keep treating as a tap
      }
      // Cross the threshold → enter drag mode. Capture the pointer
      // so further moves arrive even when the pointer escapes the
      // badge bounds (fast drags leave the small pill quickly).
      isDragging = true;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
      // Pre-emptively close any open popover — keeping it pinned to a
      // moving badge looks janky and a drag is clearly a different
      // intent than "look at the popover".
      if (popoverOpen) closePopover();
    }
    const rect = el.getBoundingClientRect();
    const clamped = clampToViewport(
      dragStartBadgeLeft + dx,
      dragStartBadgeTop + dy,
      rect.width,
      rect.height,
    );
    applyAbsolutePos(clamped.x, clamped.y);
  });

  const endDrag = (e: PointerEvent) => {
    if (!pointerDown) return;
    pointerDown = false;
    if (!isDragging) return;
    isDragging = false;
    el.style.cursor = "pointer";
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    // Persist final position. Re-read the rect so what we store is
    // exactly what's on screen — clampToViewport may have shaved
    // the trailing few pixels.
    const r = el.getBoundingClientRect();
    writeBadgePosCookie(r.left, r.top);
    recomputePopoverAnchor();
    // The browser will synthesize a click on the badge from this
    // pointer sequence (pointer went down + up on the same element).
    // Swallow it so a drag doesn't immediately open the popover.
    suppressNextClick = true;
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  // Capture-phase click swallower — runs BEFORE the existing click
  // handler that toggles the popover, so we can stop a drag-tail
  // click without modifying the open/close logic itself.
  el.addEventListener(
    "click",
    (e) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );

  // Hydrate from cookie. After all the listeners and the corner-based
  // default style are in place, fast-forward to the user's last saved
  // position if any. Clamp to the current viewport so a saved spot
  // from a wider monitor doesn't put the badge off-canvas.
  const savedPos = readBadgePosCookie();
  if (savedPos) {
    // We need el's measured size to clamp; but el isn't in the DOM
    // yet, so we lean on a defer to next frame after first append.
    // Until then, apply the raw saved coords (the corner-default
    // styles still apply if these are absurd; clamp will fix it).
    applyAbsolutePos(savedPos.x, savedPos.y);
    // Queue a one-shot post-mount clamp + popover-anchor recompute.
    // requestAnimationFrame fires after the parent appendChild
    // brings the badge into layout, so getBoundingClientRect works.
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const clamped = clampToViewport(savedPos.x, savedPos.y, r.width, r.height);
      applyAbsolutePos(clamped.x, clamped.y);
      recomputePopoverAnchor();
    });
  }

  // ─── Redraw loop ───────────────────────────────────────────
  //
  // Idle: zero work. Active OR popover open: redraw at ~6 Hz so
  // the ring sweep and per-call elapsed counters stay live without
  // burning CPU. Token-arrival events also push a redraw out of
  // band so the ring jumps as soon as a chunk lands.
  let rafScheduled = false;
  let intervalHandle: number | null = null;

  const reconcile = () => {
    rafScheduled = false;
    if (!tracker) {
      // No event bus → static badge. Hide ring + LED.
      ring.style.opacity = "0";
      led.style.background = "rgba(255,255,255,0.2)";
      return;
    }
    const snap = tracker.snapshot();
    updateRing(ring, ringArc, RING_CIRC, snap);
    updateLED(led, snap);
    if (popoverOpen && popover) updatePopover(popover, snap);
    // Schedule the next paint only if there's reason. When the
    // popover is open we want the elapsed seconds to tick; when
    // active we want the ring to keep sweeping.
    const needsLoop = snap.status !== "idle" || popoverOpen;
    if (needsLoop && intervalHandle === null) {
      intervalHandle = window.setInterval(requestRedraw, 160);
    } else if (!needsLoop && intervalHandle !== null) {
      window.clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };

  function requestRedraw() {
    if (rafScheduled) return;
    rafScheduled = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(reconcile);
    } else {
      setTimeout(reconcile, 0);
    }
  }

  // Drive redraws off the tracker's onChange — fires synchronously
  // after every start / delta / end / error so the LED + ring update
  // within an animation frame of the event, not when the user
  // happens to hover the badge. requestRedraw() coalesces multiple
  // notifications into one rAF paint, so a chunky stream (30+ deltas
  // per second) still paints at most once per frame.
  if (tracker) {
    tracker.onChange(requestRedraw);
  }

  // Initial paint so the user sees their LED/ring state at mount
  // even before any event fires.
  requestRedraw();

  return el;
}

function updateRing(
  ring: SVGSVGElement,
  arc: SVGCircleElement,
  circ: number,
  snap: ActivitySnapshot,
): void {
  if (snap.active.length === 0) {
    ring.style.opacity = "0";
    return;
  }
  ring.style.opacity = "1";
  // Pick the most informative active call for the ring (highest
  // tokens/sec, falling back to oldest). The popover lists every
  // call individually; this is just for the at-a-glance glow.
  const primary = snap.active.reduce((best, c) => (c.tokensPerSec > best.tokensPerSec ? c : best), snap.active[0]!);
  if (primary.streaming && primary.tokensPerSec > 0) {
    // Active streaming → arc length scales with tokens/sec, capped
    // at the full ring at ~60 tok/s (typical chat ceiling).
    const fraction = Math.min(primary.tokensPerSec / 60, 1);
    arc.setAttribute("stroke-dashoffset", String(circ * (1 - fraction)));
    arc.setAttribute("stroke", "#3b82f6");
  } else if (snap.status === "error") {
    arc.setAttribute("stroke-dashoffset", "0");
    arc.setAttribute("stroke", "#ef4444");
  } else {
    // Non-streaming or pre-first-token: indeterminate sweep — just
    // show a quarter-arc that rotates via CSS keyframes (added
    // below as a one-shot class).
    arc.setAttribute("stroke-dashoffset", String(circ * 0.75));
    arc.setAttribute("stroke", "#a78bfa");
  }
}

function updateLED(led: HTMLSpanElement, snap: ActivitySnapshot): void {
  switch (snap.status) {
    case "idle":
      led.style.background = "rgba(255,255,255,0.2)";
      led.style.boxShadow = "0 0 0 0 transparent";
      break;
    case "active":
      led.style.background = "#3b82f6";
      // CSS-driven pulse via box-shadow ring expanding outward —
      // single keyframe loop, cheaper than animating opacity.
      led.style.boxShadow = "0 0 0 0 rgba(59,130,246,0.7)";
      led.style.animation = "__runjobs_led_pulse__ 1.2s ease-out infinite";
      break;
    case "error":
      led.style.background = "#ef4444";
      led.style.boxShadow = "0 0 0 2px rgba(239,68,68,0.3)";
      led.style.animation = "";
      break;
  }
}

function createPopover(dashboardUrl: string, anchorCss: string, onSignOut: () => void): HTMLDivElement {
  const pop = document.createElement("div");
  pop.style.cssText = [
    "position:absolute",
    // Anchor varies by badge corner — see badgeCornerStyles. Splits
    // top/bottom + left/right so the popover always grows TOWARDS
    // the viewport interior.
    anchorCss,
    "min-width:280px;max-width:340px",
    "padding:10px 12px",
    "border-radius:10px",
    "background:rgba(15,15,20,0.92)",
    "backdrop-filter:blur(20px) saturate(1.3)",
    "-webkit-backdrop-filter:blur(20px) saturate(1.3)",
    "border:1px solid rgba(255,255,255,0.12)",
    "box-shadow:0 10px 30px rgba(0,0,0,0.4)",
    "color:#fff",
    "font:400 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    "cursor:default",
    "text-align:left",
  ].join(";");
  pop.setAttribute("data-runjobs-popover", "1");
  pop.addEventListener("click", (e) => e.stopPropagation());

  // The popover's content is rebuilt on every redraw to keep DOM
  // diffing simple. ~3 sections × ~6 children = ~20 nodes, no
  // measurable cost at the 6 Hz redraw rate.
  const inner = document.createElement("div");
  inner.setAttribute("data-runjobs-popover-content", "1");
  pop.appendChild(inner);

  const footer = document.createElement("div");
  footer.style.cssText = [
    "margin-top:10px;padding-top:8px",
    "border-top:1px solid rgba(255,255,255,0.08)",
    "display:flex;justify-content:space-between;align-items:center",
    "font-size:10px;color:rgba(255,255,255,0.6)",
  ].join(";");
  const dash = document.createElement("a");
  dash.textContent = "Open dashboard →";
  dash.href = dashboardUrl;
  dash.target = "_blank";
  dash.rel = "noopener noreferrer";
  dash.style.cssText = "color:#a78bfa;text-decoration:none";
  footer.appendChild(dash);

  // Sign-out lives opposite the dashboard link.  Styled subtle on
  // purpose — it's a destructive-ish action (drops the token cache,
  // forces the next API call into the signIn redirect) but not
  // dangerous, and we don't want it to compete visually with the
  // dashboard CTA.  Hover highlights it red as a "this is the action
  // that ends your session" cue.
  const signOutBtn = document.createElement("button");
  signOutBtn.type = "button";
  signOutBtn.textContent = "Sign out";
  signOutBtn.style.cssText = [
    "background:none;border:0;padding:0;margin:0",
    "font:inherit;cursor:pointer",
    "color:rgba(255,255,255,0.55)",
    "transition:color 120ms ease",
  ].join(";");
  signOutBtn.addEventListener("mouseenter", () => {
    signOutBtn.style.color = "#f87171";
  });
  signOutBtn.addEventListener("mouseleave", () => {
    signOutBtn.style.color = "rgba(255,255,255,0.55)";
  });
  signOutBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSignOut();
  });
  footer.appendChild(signOutBtn);

  pop.appendChild(footer);
  return pop;
}

function updatePopover(pop: HTMLDivElement, snap: ActivitySnapshot): void {
  const inner = pop.querySelector('[data-runjobs-popover-content]') as HTMLDivElement | null;
  if (!inner) return;
  inner.innerHTML = "";
  const now = Date.now();
  inner.appendChild(renderActiveSection(snap, now));
  inner.appendChild(renderRecentSection(snap, now));
  inner.appendChild(renderSessionSection(snap.session, now));
}

function renderActiveSection(snap: ActivitySnapshot, now: number): HTMLDivElement {
  const sec = document.createElement("div");
  sec.style.marginBottom = "10px";
  sec.appendChild(sectionLabel("Active", snap.active.length > 0 ? `${snap.active.length} in flight` : "—"));
  if (snap.active.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:rgba(255,255,255,0.4);font-size:10px;padding:2px 0";
    empty.textContent = "No calls in flight.";
    sec.appendChild(empty);
    return sec;
  }
  for (const c of snap.active) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;gap:8px;padding:3px 0";
    const left = document.createElement("span");
    left.style.cssText = "color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px";
    left.textContent = c.model;
    const right = document.createElement("span");
    right.style.cssText = "color:rgba(255,255,255,0.7);font-variant-numeric:tabular-nums;font-size:10px";
    const elapsed = ((now - c.startedAt) / 1000).toFixed(1);
    const rate = c.tokensPerSec > 0 ? ` · ${Math.round(c.tokensPerSec)} tok/s` : "";
    right.textContent = `${elapsed}s${rate}`;
    row.appendChild(left);
    row.appendChild(right);
    sec.appendChild(row);
  }
  return sec;
}

function renderRecentSection(snap: ActivitySnapshot, now: number): HTMLDivElement {
  const sec = document.createElement("div");
  sec.style.marginBottom = "10px";
  sec.appendChild(sectionLabel("Recent", snap.recent.length > 0 ? `last ${Math.min(snap.recent.length, 5)}` : "—"));
  if (snap.recent.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:rgba(255,255,255,0.4);font-size:10px;padding:2px 0";
    empty.textContent = "Nothing yet this session.";
    sec.appendChild(empty);
    return sec;
  }
  for (const c of snap.recent.slice(0, 5)) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;gap:8px;padding:3px 0";
    const left = document.createElement("span");
    left.style.cssText = "color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px";
    // Prefix bullet by status — cheap visual scan.
    const bullet = document.createElement("span");
    bullet.textContent = c.ok ? "✓ " : "✗ ";
    bullet.style.color = c.ok ? "#10b981" : "#ef4444";
    left.appendChild(bullet);
    left.appendChild(document.createTextNode(c.model));
    const right = document.createElement("span");
    right.style.cssText = "color:rgba(255,255,255,0.7);font-variant-numeric:tabular-nums;font-size:10px";
    const latency = `${(c.latencyMs / 1000).toFixed(1)}s`;
    const cost = c.costUSD !== undefined ? ` · $${c.costUSD.toFixed(4)}` : "";
    const ago = ` · ${relativeTime(now - c.endedAt)}`;
    right.textContent = `${latency}${cost}${ago}`;
    row.appendChild(left);
    row.appendChild(right);
    sec.appendChild(row);
  }
  return sec;
}

function renderSessionSection(s: SessionStats, now: number): HTMLDivElement {
  const sec = document.createElement("div");
  sec.appendChild(sectionLabel("Session", relativeTime(now - s.startedAt)));
  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:space-between;gap:12px;color:rgba(255,255,255,0.85);font-size:10px";
  const calls = document.createElement("span");
  calls.textContent = `${s.totalCalls} call${s.totalCalls === 1 ? "" : "s"}`;
  const cost = document.createElement("span");
  cost.textContent = `$${s.totalCostUSD.toFixed(4)}`;
  const errors = document.createElement("span");
  errors.textContent = s.errorCount > 0 ? `${s.errorCount} error${s.errorCount === 1 ? "" : "s"}` : "0 errors";
  if (s.errorCount > 0) errors.style.color = "#ef4444";
  row.appendChild(calls);
  row.appendChild(cost);
  row.appendChild(errors);
  sec.appendChild(row);
  return sec;
}

function sectionLabel(title: string, hint: string): HTMLDivElement {
  const lbl = document.createElement("div");
  lbl.style.cssText = [
    "display:flex;justify-content:space-between;align-items:baseline",
    "margin-bottom:4px",
    "color:rgba(255,255,255,0.55)",
    "font-size:10px;text-transform:uppercase;letter-spacing:0.05em",
  ].join(";");
  const t = document.createElement("span");
  t.textContent = title;
  const h = document.createElement("span");
  h.textContent = hint;
  h.style.cssText = "font-size:9px;letter-spacing:0";
  lbl.appendChild(t);
  lbl.appendChild(h);
  return lbl;
}

function relativeTime(ms: number): string {
  if (ms < 1500) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}
