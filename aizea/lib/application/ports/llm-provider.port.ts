// ILLMProvider — port for chat completions.
//
// Concrete implementations live in lib/infrastructure/ai/.
// Domain and application services depend only on this interface.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Sampling temperature. Default: 0.4 */
  temperature?: number;
  /** Max output tokens. Default: 8000 */
  maxTokens?: number;
  /** Force JSON output. Default: false */
  json?: boolean;
  /** Override the model for this call only. */
  model?: string;
}

export interface ILLMProvider {
  /**
   * Send a chat request and return the raw text response.
   * Implementations handle retry + timeout internally.
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;

  /**
   * Like `chat` but parses the response as JSON.
   * Sets `json: true` in the request automatically.
   */
  chatJSON<T>(messages: ChatMessage[], options?: ChatOptions): Promise<T>;

  /** Human-readable provider name for logging. */
  readonly name: string;
}
