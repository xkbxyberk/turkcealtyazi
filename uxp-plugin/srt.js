/**
 * SRT dosya oluşturma + Adobe Transcript JSON dönüştürme modülü
 * Segment bazlı akıllı segmentasyon destekler.
 */

const SRT_CONFIG = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDuration: 1.0,
  maxDuration: 7.0,
  gapBetweenSubs: 0.1,
};

// Türkçe bağlaçlar — yeni satırda başlayabilir
const TR_CONJUNCTIONS = ["ama", "fakat", "ancak", "çünkü", "ve", "veya", "ya", "ki", "hem", "ne", "ise", "oysa"];

// Türkçe kısa ekler — önceki kelimeyle aynı satırda kalmalı
const TR_SUFFIXES = ["dir", "dır", "tır", "tir", "dur", "dür", "tur", "tür", "dır.", "dir.", "tır.", "tir."];

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return (
    String(h).padStart(2, "0") +
    ":" +
    String(m).padStart(2, "0") +
    ":" +
    String(s).padStart(2, "0") +
    "," +
    String(ms).padStart(3, "0")
  );
}

/**
 * Segment zamanlamasını normalize eder (whisper-server t0/t1 veya start/end formatı).
 */
function normalizeTime(t0, start) {
  return t0 != null ? t0 / 100 : (start || 0);
}

/**
 * Halüsinasyon tespiti: tekrarlanan pattern'leri temizler.
 * ABAB pattern'leri (2+ farklı cümle döngüsü) ve ardışık tekrarları yakalar.
 */
function removeHallucinations(segments) {
  if (segments.length < 4) return segments;

  // 1. Sondaki tekrarlanan döngüyü tespit et (ABAB, ABCABC vb.)
  const WINDOW = 20;
  const tail = segments.slice(-Math.min(WINDOW, segments.length));
  const tailTexts = tail.map(s => (s.text || "").trim().toLowerCase());

  for (let patternLen = 1; patternLen <= 4; patternLen++) {
    if (tailTexts.length < patternLen * 3) continue;

    const pattern = tailTexts.slice(-patternLen);
    let repeatCount = 0;

    for (let i = tailTexts.length - patternLen; i >= 0; i -= patternLen) {
      const chunk = tailTexts.slice(i, i + patternLen);
      if (chunk.join("|") === pattern.join("|")) {
        repeatCount++;
      } else {
        break;
      }
    }

    if (repeatCount >= 3) {
      const removeCount = (repeatCount - 1) * patternLen;
      console.log("Halüsinasyon tespit: " + patternLen + "-uzunluk pattern, " + repeatCount + " tekrar, " + removeCount + " segment siliniyor");
      segments = segments.slice(0, segments.length - removeCount);
      break;
    }
  }

  // 2. Ardışık aynı metin kontrolü
  const cleaned = [];
  let lastText = "";
  let repeatCount = 0;

  for (const seg of segments) {
    const text = (seg.text || "").trim().toLowerCase();
    if (!text) continue;

    if (text === lastText) {
      repeatCount++;
      if (repeatCount >= 2) continue;
    } else {
      repeatCount = 0;
    }
    lastText = text;
    cleaned.push(seg);
  }

  return cleaned;
}

/**
 * Çok kısa segmentleri filtreler (< 0.1 saniye, anlamsız).
 */
function filterShortSegments(segments) {
  return segments.filter(seg => {
    const start = normalizeTime(seg.t0, seg.start);
    const end = normalizeTime(seg.t1, seg.end);
    return (end - start) >= 0.1;
  });
}

/**
 * Segment sınırlarında bölünmüş kelime parçalarını birleştirir.
 * "ald ım", "mam lusu", "yo ğurt" gibi parçaları düzeltir.
 */
function mergeFragmentedWords(segments) {
  const merged = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = (seg.text || "").trim();

    if (merged.length > 0 && text.length < 4 && text.length > 0) {
      const prev = merged[merged.length - 1];
      const prevText = (prev.text || "").trim();
      const lastChar = prevText[prevText.length - 1];

      if (lastChar && !".?!,;:".includes(lastChar)) {
        const prevEnd = normalizeTime(prev.t1, prev.end);
        const segStart = normalizeTime(seg.t0, seg.start);
        const segEnd = normalizeTime(seg.t1, seg.end);

        prev.text = prevText + text;
        if (prev.t1 != null) { prev.t1 = seg.t1; }
        if (prev.end != null) { prev.end = seg.end; }
        continue;
      }
    }
    merged.push({ ...seg });
  }
  return merged;
}

/**
 * Tüm segmentlerden düz word listesi çıkarır.
 * Kelimeleri segment süresine eşit dağıtır (word-level timestamps kullanılmıyor).
 */
function extractWords(segments) {
  const allWords = [];

  for (const seg of segments) {
    const segStart = normalizeTime(seg.t0, seg.start);
    const segEnd = normalizeTime(seg.t1, seg.end);
    const segDuration = segEnd - segStart;
    const text = (seg.text || "").trim();
    if (!text || segDuration <= 0) continue;

    const rawWords = text.split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) continue;
    const wordDur = segDuration / rawWords.length;

    for (let i = 0; i < rawWords.length; i++) {
      allWords.push({
        text: rawWords[i],
        start: segStart + i * wordDur,
        end: segStart + (i + 1) * wordDur,
      });
    }
  }

  return allWords;
}

/**
 * Cümle sonu mu kontrol eder.
 */
function isSentenceEnd(word) {
  return /[.?!…]$/.test(word);
}

/**
 * Virgül sonrası mı kontrol eder.
 */
function hasComma(word) {
  return /,$/.test(word);
}

/**
 * Kelime Türkçe bağlaç mı?
 */
function isConjunction(word) {
  const clean = word.replace(/[.,?!…;:]+$/, "").toLowerCase();
  return TR_CONJUNCTIONS.includes(clean);
}

/**
 * Kelime Türkçe kısa ek mi? (önceki kelimeyle kalmalı)
 */
function isTurkishSuffix(word) {
  const clean = word.replace(/[.,?!…;:]+$/, "").toLowerCase();
  return TR_SUFFIXES.includes(clean);
}

/**
 * Word listesini akıllıca SRT bloklarına gruplar.
 */
function groupWordsIntoSubtitles(words) {
  if (words.length === 0) return [];

  const subtitles = [];
  let currentWords = [];

  function flushSubtitle() {
    if (currentWords.length === 0) return;

    const start = currentWords[0].start;
    const end = currentWords[currentWords.length - 1].end;
    const lines = buildLines(currentWords);

    subtitles.push({ start, end, text: lines.join("\n") });
    currentWords = [];
  }

  function buildLines(wordList) {
    const lines = [""];
    let li = 0;

    for (let i = 0; i < wordList.length; i++) {
      const w = wordList[i].text;
      const candidate = lines[li] ? lines[li] + " " + w : w;

      if (candidate.length > SRT_CONFIG.maxCharsPerLine && lines[li].length > 0) {
        if (li + 1 < SRT_CONFIG.maxLines) {
          li++;
          lines[li] = w;
        } else {
          lines[li] += " " + w;
        }
      } else {
        lines[li] = candidate;
      }
    }

    return lines.filter(Boolean);
  }

  function currentDuration() {
    if (currentWords.length === 0) return 0;
    return currentWords[currentWords.length - 1].end - currentWords[0].start;
  }

  function currentCharCount() {
    const text = currentWords.map(w => w.text).join(" ");
    return text.length;
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const nextWord = i + 1 < words.length ? words[i + 1] : null;

    currentWords.push(word);

    let shouldFlush = false;

    // 1. Cümle sonu — her zaman flush
    if (isSentenceEnd(word.text)) {
      shouldFlush = true;
    }

    // 2. Maksimum süre aşıldı
    if (currentDuration() >= SRT_CONFIG.maxDuration) {
      shouldFlush = true;
    }

    // 3. Karakter limiti: 2 satırlık max karakter aşıldı
    if (currentCharCount() >= SRT_CONFIG.maxCharsPerLine * SRT_CONFIG.maxLines) {
      shouldFlush = true;
    }

    // 4. Sonraki kelime bağlaç ise ve yeterli içerik varsa
    if (nextWord && isConjunction(nextWord.text) && currentWords.length >= 3) {
      shouldFlush = true;
    }

    // 5. Sonraki kelime Türkçe kısa ek ise flush'u engelle
    if (shouldFlush && nextWord && isTurkishSuffix(nextWord.text)) {
      shouldFlush = false;
    }

    // 6. Gap kontrolü — sonraki kelime ile arada büyük boşluk varsa
    if (nextWord && (nextWord.start - word.end) > 0.5 && currentWords.length >= 2) {
      shouldFlush = true;
    }

    if (shouldFlush) {
      flushSubtitle();
    }
  }

  // Kalan kelimeleri flush et
  flushSubtitle();

  // Post-process: minimum süre kontrolü — çok kısa altyazıları birleştir
  const merged = [];
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    const duration = sub.end - sub.start;

    if (duration < SRT_CONFIG.minDuration && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const combinedText = prev.text + "\n" + sub.text;
      const combinedLines = combinedText.split("\n");

      if (combinedLines.length <= SRT_CONFIG.maxLines &&
          (sub.end - prev.start) <= SRT_CONFIG.maxDuration) {
        prev.end = sub.end;
        prev.text = combinedText;
        continue;
      }
    }

    merged.push({ ...sub });
  }

  // Gap ekleme
  for (let i = 0; i < merged.length - 1; i++) {
    const gap = merged[i + 1].start - merged[i].end;
    if (gap < SRT_CONFIG.gapBetweenSubs) {
      merged[i].end = merged[i + 1].start - SRT_CONFIG.gapBetweenSubs;
      if (merged[i].end < merged[i].start) {
        merged[i].end = merged[i].start + 0.01;
      }
    }
  }

  return merged;
}

/**
 * whisper-server segments dizisinden SRT string oluşturur.
 * Halüsinasyon temizleme + akıllı segmentasyon yapar.
 * @param {Array} segments - whisper segments dizisi
 * @returns {string} SRT formatında metin (UTF-8, BOM'suz)
 */
function generateSRT(segments) {
  if (!segments || segments.length === 0) return "";

  // Ön işleme: kısa segmentleri filtrele + halüsinasyonları temizle + parçalanmış kelimeleri birleştir
  let cleaned = filterShortSegments(segments);
  cleaned = removeHallucinations(cleaned);
  cleaned = mergeFragmentedWords(cleaned);

  if (cleaned.length === 0) return "";

  const words = extractWords(cleaned);
  let subtitles;

  if (words.length > 0) {
    subtitles = groupWordsIntoSubtitles(words);
  }

  // Fallback: akıllı gruplama hiç subtitle üretmediyse, basit segment→SRT
  if (!subtitles || subtitles.length === 0) {
    subtitles = [];
    for (const seg of cleaned) {
      const start = normalizeTime(seg.t0, seg.start);
      const end = normalizeTime(seg.t1, seg.end);
      const text = (seg.text || "").trim();
      if (!text) continue;
      subtitles.push({ start, end, text });
    }
  }

  const lines = [];
  subtitles.forEach((sub, i) => {
    lines.push(String(i + 1));
    lines.push(formatTimestamp(sub.start) + " --> " + formatTimestamp(sub.end));
    lines.push(sub.text);
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * whisper-server verbose_json çıktısını Adobe Transcript JSON formatına çevirir.
 * @param {Array} segments - whisper segments dizisi
 * @returns {string} Adobe transcript JSON string
 */
function generateAdobeTranscriptJSON(segments) {
  if (!segments || segments.length === 0) return null;

  // Halüsinasyon temizleme + parçalanmış kelime birleştirme burada da uygula
  let cleaned = filterShortSegments(segments);
  cleaned = removeHallucinations(cleaned);
  cleaned = mergeFragmentedWords(cleaned);

  const speakerId = "00000000-0000-0000-0000-000000000001";
  const adobeSegments = [];

  for (const seg of cleaned) {
    const segStart = normalizeTime(seg.t0, seg.start);
    const segEnd = normalizeTime(seg.t1, seg.end);
    const segDuration = segEnd - segStart;
    const text = (seg.text || "").trim();
    if (!text || segDuration <= 0) continue;

    const words = [];
    const rawWords = text.split(/\s+/).filter(Boolean);
    const wordDuration = segDuration / rawWords.length;

    for (let w = 0; w < rawWords.length; w++) {
      words.push({
        confidence: 1.0,
        duration: Math.max(0.01, wordDuration),
        eos: w === rawWords.length - 1,
        start: segStart + w * wordDuration,
        tags: [],
        text: rawWords[w],
        type: "word"
      });
    }

    adobeSegments.push({
      duration: segDuration,
      language: "tr-tr",
      speaker: speakerId,
      start: segStart,
      words: words
    });
  }

  const transcriptObj = {
    language: "tr-tr",
    segments: adobeSegments,
    speakers: [
      { id: speakerId, name: "Konuşmacı 1" }
    ]
  };

  return JSON.stringify(transcriptObj);
}
