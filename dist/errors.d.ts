/**
 * APIError represents an error returned by the RunJobs gateway.
 *
 * Use `instanceof APIError` (or check `name === "APIError"`) to distinguish
 * gateway errors from network / runtime errors:
 *
 * ```ts
 * try {
 *   await client.chat.create({ model: "...", messages: [...] });
 * } catch (e) {
 *   if (e instanceof APIError) {
 *     console.error(`API ${e.statusCode}: ${e.message}`);
 *   } else {
 *     throw e;
 *   }
 * }
 * ```
 */
export declare class APIError extends Error {
    readonly statusCode: number;
    readonly type: string;
    constructor(statusCode: number, type: string, message: string);
}
//# sourceMappingURL=errors.d.ts.map