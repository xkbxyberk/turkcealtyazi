/**
 * whisper-server API iletişim modülü
 */

const SERVER_URL = "http://localhost:8787";

/**
 * Sunucu sağlık kontrolü
 * @returns {Promise<boolean>}
 */
async function checkServerHealth() {
  try {
    const response = await fetch(SERVER_URL + "/", { method: "GET" });
    return response.ok;
  } catch (e) {
    return false;
  }
}

/**
 * Ses dosyasını whisper-server'a gönderip transkripsiyon al.
 * @param {Blob} audioBlob - Ses verisi
 * @param {string} filename - Dosya adı
 * @returns {Promise<Object>} whisper-server yanıtı
 */
async function transcribeAudio(audioBlob, filename, initialPrompt, wordTimestamps) {
  const formData = new FormData();
  formData.append("file", audioBlob, filename || "audio.wav");
  formData.append("language", "tr");
  formData.append("response_format", "verbose_json");
  if (initialPrompt && initialPrompt.length > 0) {
    formData.append("prompt", initialPrompt);
  }
  if (wordTimestamps) {
    formData.append("word_timestamps", "true");
  }

  const response = await fetch(SERVER_URL + "/inference", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error("Sunucu hatası (" + response.status + "): " + text);
  }

  return await response.json();
}
