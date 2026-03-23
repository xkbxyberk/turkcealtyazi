/**
 * Export modülü — SRT, VTT, TXT formatlarında dışa aktarma
 * Faz 3: Araç çubuğu + export
 */

/**
 * Altyazı dizisini SRT formatında string olarak döndürür.
 * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles
 * @returns {string}
 */
function exportSRT(subtitles) {
  return writeSRT(subtitles);
}

/**
 * Saniye değerini WebVTT zaman damgasına çevirir.
 * "HH:MM:SS.mmm" (nokta ile, SRT'deki virgülden farklı)
 */
function formatVTTTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return (
    String(h).padStart(2, '0') + ':' +
    String(m).padStart(2, '0') + ':' +
    String(s).padStart(2, '0') + '.' +
    String(ms).padStart(3, '0')
  );
}

/**
 * Altyazı dizisini WebVTT formatında string olarak döndürür.
 * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles
 * @returns {string}
 */
function exportVTT(subtitles) {
  if (!subtitles || subtitles.length === 0) return '';

  const lines = ['WEBVTT', ''];

  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    lines.push(String(i + 1));
    lines.push(formatVTTTimestamp(sub.startTime) + ' --> ' + formatVTTTimestamp(sub.endTime));
    lines.push(sub.text);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Altyazı dizisini düz metin olarak döndürür (zamanlama yok).
 * @param {Array<{text: string}>} subtitles
 * @returns {string}
 */
function exportTXT(subtitles) {
  if (!subtitles || subtitles.length === 0) return '';
  return subtitles.map(sub => sub.text).join('\n');
}
