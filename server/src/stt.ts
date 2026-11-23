export interface Transcriber {
  transcribe(pcm16: Buffer): Promise<string>;
}

export function pcm16ToWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class WhisperTranscriber implements Transcriber {
  constructor(
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async transcribe(pcm16: Buffer): Promise<string> {
    const form = new FormData();
    form.append("model", this.model);
    form.append("file", new Blob([new Uint8Array(pcm16ToWav(pcm16))], { type: "audio/wav" }), "audio.wav");
    const res = await this.fetchFn(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`stt failed: ${res.status}`);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? "").trim();
  }
}
