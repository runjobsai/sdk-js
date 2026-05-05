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
export class APIError extends Error {
    statusCode;
    type;
    constructor(statusCode, type, message) {
        super(`runjobs: ${statusCode} ${type}: ${message}`);
        this.name = "APIError";
        this.statusCode = statusCode;
        this.type = type;
    }
}
//# sourceMappingURL=errors.js.map