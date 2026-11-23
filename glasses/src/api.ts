import type { Action, ActionRequest, ActionResult, FlaggedItem, QueueStats, ShiftStats } from "./types";

export interface QueueClient {
  next(skipped: string[]): Promise<{ item: FlaggedItem | null; pending: number; shift: ShiftStats & { high?: number } }>;
  act(itemId: string, request: ActionRequest, wave?: boolean): Promise<ActionResult>;
  undo(tokens: string[]): Promise<void>;
  transcribe(pcm16: Uint8Array): Promise<string>;
  intent(text: string, itemId: string): Promise<ActionRequest>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class HttpClient implements QueueClient {
  constructor(
    private readonly baseUrl: string,
    private readonly code: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        ...init,
        headers: { "content-type": "application/json", "x-pairing-code": this.code, ...init.headers },
      });
    } catch {
      throw new ApiError("Offline. Press to retry", 0);
    }
    if (response.status === 501) throw new ApiError("Voice not set up on server", 501);
    if (response.status === 401 || response.status === 403) throw new ApiError("Wrong pairing code", response.status);
    if (!response.ok && response.status !== 204) throw new ApiError(`Server error ${response.status}`, response.status);
    return response;
  }

  async next(skipped: string[]) {
    const query = skipped.length ? `?skip=${encodeURIComponent(skipped.join(","))}` : "";
    const [nextRes, statsRes] = await Promise.all([this.request(`/queue/next${query}`), this.request("/queue/stats")]);
    const stats = (await statsRes.json()) as QueueStats;
    if (nextRes.status === 204) return { item: null, pending: stats.pending, shift: stats };
    return { item: (await nextRes.json()) as FlaggedItem, pending: stats.pending, shift: stats };
  }

  async act(itemId: string, request: ActionRequest, wave = false) {
    const response = await this.request(`/queue/${encodeURIComponent(itemId)}/action`, {
      method: "POST",
      body: JSON.stringify(wave ? { ...request, wave } : request),
    });
    return (await response.json()) as ActionResult;
  }

  async undo(tokens: string[]) {
    const body = tokens.length > 1 ? { undoTokens: tokens } : { undoToken: tokens[0] };
    await this.request("/queue/undo", { method: "POST", body: JSON.stringify(body) });
  }

  async transcribe(pcm16: Uint8Array) {
    const response = await this.request("/voice/transcribe", {
      method: "POST",
      body: JSON.stringify({ audio: toBase64(pcm16) }),
    });
    return ((await response.json()) as { text: string }).text;
  }

  async intent(text: string, itemId: string) {
    const response = await this.request("/voice/intent", { method: "POST", body: JSON.stringify({ text, itemId }) });
    if (response.status === 422) throw new ApiError("Did not understand", 422);
    return (await response.json()) as ActionRequest;
  }
}

const FIXTURES: FlaggedItem[] = [
  {
    id: "mock-1",
    chatId: -1001,
    chatTitle: "Crypto Builders",
    userId: 501,
    username: "support_helpdesk_77",
    text: "Hi! I'm from Wallet Support. Your wallet is at risk, DM me now and verify your seed phrase at wallet-verify.xyz to avoid a permanent lock.",
    messageId: 9001,
    risk: "high",
    score: 0.96,
    reason: "Fake support + wallet link",
    offenses: 3,
    suggested: { action: "ban", deleteRecent: 10 },
    ownSuggested: { action: "ban", deleteRecent: 10 },
    waveSize: 1,
    flaggedAt: new Date().toISOString(),
  },
  {
    id: "mock-2",
    chatId: -1001,
    chatTitle: "Crypto Builders",
    userId: 502,
    username: null,
    text: "Double your ETH in 24h guaranteed. Send 0.1 ETH get 0.2 back. t.me/doubler_bot",
    messageId: 9002,
    risk: "medium",
    score: 0.71,
    reason: "Giveaway scam link",
    offenses: 1,
    suggested: { action: "mute", muteMinutes: 60, deleteRecent: 1 },
    ownSuggested: { action: "mute", muteMinutes: 60, deleteRecent: 1 },
    waveSize: 1,
    flaggedAt: new Date().toISOString(),
  },
  {
    id: "mock-3",
    chatId: -1001,
    chatTitle: "Crypto Builders",
    userId: 503,
    username: "newbie_joe",
    text: "anyone know a good exchange? also check my channel",
    messageId: 9003,
    risk: "low",
    score: 0.32,
    reason: "Self promotion",
    offenses: 1,
    suggested: { action: "ignore" },
    ownSuggested: { action: "ignore" },
    waveSize: 1,
    flaggedAt: new Date().toISOString(),
  },
];

export class MockClient implements QueueClient {
  private queue = [...FIXTURES];
  private undoStack = new Map<string, FlaggedItem>();

  async next(skipped: string[]) {
    const item = this.queue.find((i) => !skipped.includes(i.id)) ?? null;
    return { item, pending: this.queue.length, shift: { handled: 0, muted: 0, banned: 0, ignored: 0 } };
  }

  async act(itemId: string, _request: ActionRequest) {
    const item = this.queue.find((i) => i.id === itemId);
    if (item) this.undoStack.set(`undo-${itemId}`, item);
    this.queue = this.queue.filter((i) => i.id !== itemId);
    return { undoToken: `undo-${itemId}` };
  }

  async undo(tokens: string[]) {
    for (const token of tokens) {
      const item = this.undoStack.get(token);
      if (item) this.queue.unshift(item);
      this.undoStack.delete(token);
    }
  }

  async transcribe(_pcm16: Uint8Array) {
    return "ban and delete their last 10";
  }

  async intent(text: string, _itemId: string): Promise<ActionRequest> {
    const action: Action = /mute/i.test(text) ? "mute" : /ignore|keep/i.test(text) ? "ignore" : "ban";
    const count = /last (\d+)/i.exec(text)?.[1];
    return count ? { action, deleteRecent: Number(count) } : { action };
  }
}
