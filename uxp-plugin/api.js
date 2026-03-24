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
  // NOT: whisper.cpp server "word_timestamps" parametresi desteklemez.
  // Token timestamps verbose_json modunda her zaman üretilir.
  // wordTimestamps parametresi srt.js tarafında mod seçimi için kullanılır.

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
