// Transcreve mensagens de voz com o Whisper da Groq (o Claude não recebe áudio).

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/**
 * @param {Buffer} audio  bytes do áudio (o WhatsApp manda OGG/Opus)
 * @param {string} mimetype
 * @param {string} apiKey  chave da Groq
 * @returns {Promise<string>} texto transcrito
 */
export async function transcribe(audio, mimetype, apiKey) {
  const ext = mimetype?.includes("mp4") ? "m4a" : mimetype?.includes("mpeg") ? "mp3" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimetype || "audio/ogg" }), `audio.${ext}`);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "pt");
  form.append("response_format", "json");

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const error = new Error(`Groq respondeu ${res.status}: ${detail.slice(0, 300)}`);
    error.status = res.status;
    throw error;
  }
  const body = await res.json();
  return String(body.text ?? "").trim();
}
