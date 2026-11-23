import {
  AudioInputSource,
  StartUpPageCreateResult,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { ApiError, HttpClient, MockClient, type QueueClient } from "./api";
import { toGesture } from "./gestures";
import { bootEffect, initialState, reduce, type Effect, type Msg, type State } from "./machine";
import { renderScreen } from "./render";
import { concatChunks } from "./voice";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const MOCK = import.meta.env.VITE_MOCK === "1" || new URLSearchParams(location.search).has("mock");
const STORAGE_KEY = "gavel.pairingCode";
const POLL_MS = 4000;

const HEADER = { id: 1, name: "header" } as const;
const BODY = { id: 2, name: "body" } as const;
const FOOTER = { id: 3, name: "footer" } as const;

function readPairingCode(): string | null {
  const fromUrl = new URLSearchParams(location.search).get("code");
  if (fromUrl) localStorage.setItem(STORAGE_KEY, fromUrl.trim());
  return localStorage.getItem(STORAGE_KEY) || (MOCK ? "mock" : null);
}

async function boot(): Promise<void> {
  const bootedAt = Date.now();
  const bridge = await waitForEvenAppBridge();
  let state: State = initialState(readPairingCode());
  let client: QueueClient | null = null;
  let chunks: Uint8Array[] = [];
  let lastRendered = "";
  let renderQueue: Promise<unknown> = Promise.resolve();

  const status = document.getElementById("status");
  const form = document.getElementById("pair-form") as HTMLFormElement;
  const input = document.getElementById("pair-input") as HTMLInputElement;

  function clientFor(code: string): QueueClient {
    return MOCK ? new MockClient() : new HttpClient(API_URL, code);
  }

  function render(): void {
    const screen = renderScreen(state);
    const key = JSON.stringify(screen);
    if (key === lastRendered) return;
    lastRendered = key;
    if (status) status.textContent = `${screen.header} - ${screen.body.split("\n")[0]}`;
    renderQueue = renderQueue.then(async () => {
      await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: HEADER.id, containerName: HEADER.name, content: screen.header }));
      await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: BODY.id, containerName: BODY.name, content: screen.body }));
      await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: FOOTER.id, containerName: FOOTER.name, content: screen.footer }));
    });
  }

  function dispatch(msg: Msg): void {
    const step = reduce(state, msg);
    state = step.state;
    render();
    void run(step.effect);
  }

  async function guarded(task: () => Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        dispatch({ type: "unpair" });
        return;
      }
      dispatch({ type: "failed", message: error instanceof ApiError ? error.message : "Offline. Press to retry" });
    }
  }

  async function run(effect: Effect): Promise<void> {
    if (effect.type === "none") return;
    if (effect.type === "savePairing") {
      if (effect.code) localStorage.setItem(STORAGE_KEY, effect.code);
      else localStorage.removeItem(STORAGE_KEY);
      client = effect.code ? clientFor(effect.code) : null;
      if (form) form.hidden = effect.code !== null;
      if (effect.code) await run({ type: "fetchNext", skipped: [] });
      return;
    }
    if (effect.type === "scheduleToast") {
      setTimeout(() => dispatch({ type: "toastDone" }), effect.ms);
      return;
    }
    if (!client) return;
    const api = client;
    await guarded(async () => {
      if (effect.type === "fetchNext") {
        const { item, pending, shift } = await api.next(effect.skipped);
        dispatch({ type: "loaded", item, pending, shift, high: shift.high });
      } else if (effect.type === "poll") {
        const { item, pending, shift } = await api.next([]);
        dispatch({ type: "polled", item, pending, high: shift.high });
      } else if (effect.type === "act") {
        const result = await api.act(effect.itemId, effect.request, effect.wave);
        dispatch({ type: "acted", request: effect.request, ...result });
      } else if (effect.type === "undo") {
        await api.undo(effect.tokens ?? [effect.token]);
        dispatch({ type: "undone" });
      } else if (effect.type === "startRecording") {
        chunks = [];
        await bridge.audioControl(true, AudioInputSource.Glasses);
      } else if (effect.type === "stopRecording") {
        await bridge.audioControl(false);
        const pcm = concatChunks(chunks);
        chunks = [];
        try {
          const text = await api.transcribe(pcm);
          if (!text.trim()) throw new ApiError("Did not hear that", 0);
          dispatch({ type: "voiceHeard", text });
          dispatch({ type: "voiceIntent", request: await api.intent(text, effect.itemId) });
        } catch (error) {
          dispatch({ type: "voiceFailed", message: error instanceof ApiError ? error.message : "Did not understand" });
        }
      }
    });
  }

  bridge.onEvenHubEvent((event) => {
    if (event.audioEvent) {
      chunks.push(event.audioEvent.audioPcm);
      return;
    }
    const gesture = toGesture(event, Date.now() - bootedAt);
    if (gesture) dispatch({ type: "gesture", gesture });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = input.value.trim();
    if (code) dispatch({ type: "paired", code });
  });

  const layout = {
    containerTotalNum: 3,
    textObject: [
      new TextContainerProperty({ xPosition: 0, yPosition: 0, width: 576, height: 40, containerID: HEADER.id, containerName: HEADER.name, content: "GAVEL", isEventCapture: 0 }),
      new TextContainerProperty({ xPosition: 0, yPosition: 44, width: 576, height: 190, containerID: BODY.id, containerName: BODY.name, content: "", isEventCapture: 1 }),
      new TextContainerProperty({ xPosition: 0, yPosition: 240, width: 576, height: 48, containerID: FOOTER.id, containerName: FOOTER.name, content: "", isEventCapture: 0 }),
    ],
  };
  const created = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(layout));
  if (created !== StartUpPageCreateResult.success && !(await bridge.rebuildPageContainer(new RebuildPageContainer(layout)))) {
    throw new Error(`Startup page failed: ${created}`);
  }

  if (state.code) client = clientFor(state.code);
  form.hidden = state.code !== null;
  render();
  void run(bootEffect(state));
  setInterval(() => dispatch({ type: "tick" }), POLL_MS);
}

void boot();
