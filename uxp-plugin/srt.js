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
  // v2 eklemeleri
  targetCPS: 17,
  maxCPS: 20,
  minOrphanChars: 5,
  maxSoftCPL: 45,
  pauseThreshold: 2.0,
};

// ─── Türkçe Sentaktik Sözlükler (v2) ───────────────────────────────────────

/** Son çekim edatları — öncesinden ASLA kırılmaz */
const POSTPOSITIONS = new Set([
  'için', 'gibi', 'kadar', 'göre', 'doğru', 'karşı', 'rağmen',
  'beri', 'başka', 'dair', 'ait', 'ile', 'boyunca', 'üzere',
  'dolayı', 'itibaren', 'önce', 'sonra', 'arasında'
]);

/** Bağlaçlar — öncesinden kırılır (bağlaç yeni satır/bloğun başında) */
const CONJUNCTIONS = new Set([
  'ama', 'fakat', 'lakin', 'ancak', 'yalnız',
  've', 'veya', 'yahut', 'çünkü', 'oysa', 'oysaki',
  'madem', 'mademki', 'halbuki', 'üstelik'
]);

/** Yardımcı fiiller — önceki isimden ASLA ayrılmaz */
const AUXILIARY_VERBS = new Set([
  'etmek', 'olmak', 'yapmak', 'kılmak', 'eylemek',
  'etti', 'oldu', 'yaptı', 'ediyor', 'oluyor', 'yapıyor',
  'eder', 'olur', 'yapar', 'etmiş', 'olmuş', 'yapmış',
  'edecek', 'olacak', 'yapacak', 'etmeli', 'olmalı',
  'edildi', 'olundu', 'yapıldı', 'edebilir', 'olabilir',
  'etmekte', 'olmakta', 'edilmek', 'olmaya', 'etmeye'
]);

/** Kısaltmalar — noktası cümle sonu DEĞİL */
const ABBREVIATIONS = new Set([
  'Dr.', 'Prof.', 'Av.', 'Doç.', 'Yrd.', 'Öğr.', 'Gör.',
  'vb.', 'vs.', 'vd.', 'bkz.', 'çev.', 'yay.',
  'M.Ö.', 'M.S.', 'Ltd.', 'Şti.', 'A.Ş.',
  'Org.', 'Gen.', 'Alb.', 'St.', 'Mr.', 'Mrs.'
]);

/** Zarf-fiil ek kalıpları — sonrasından kırma ödülü */
const ADVERBIAL_PATTERNS = [
  /[ıiuü]p$/i,
  /(ar|er)ak$/i,
  /m[ae]d[ae]n$/i,
  /(ınc|inc|unc|ünc)[ae]$/i,
  /(dığ|diğ|duğ|düğ)[ıiuü]nd[ae]$/i,
  /[iıuü]?ken$/i,
];

/** Birim kelimeleri — sayıdan sonra gelince ayrılmaz */
const UNITS = new Set([
  'kg', 'km', 'm', 'cm', 'mm', 'lt', 'ml', 'gr',
  'TL', 'lira', 'kilo', 'metre', 'saat', 'dakika',
  'saniye', 'yıl', 'ay', 'gün', 'derece'
]);

// Eski bağlaç/ek listeler (geriye dönük uyumluluk — v2 Set'leri kullanılıyor)
const TR_CONJUNCTIONS = ["ama", "fakat", "ancak", "çünkü", "ve", "veya", "ya", "ki", "hem", "ne", "ise", "oysa"];
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
 * v2.1: Minimum 100ms/kelime, segment sınırı korunur, segmentId taşınır.
 */
function extractWords(segments) {
  const allWords = [];
  const MIN_WORD_DURATION = 0.1; // 100ms minimum

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    const segStart = normalizeTime(seg.t0, seg.start);
    const segEnd = normalizeTime(seg.t1, seg.end);
    const segDuration = segEnd - segStart;
    const text = (seg.text || "").trim();
    if (!text || segDuration <= 0) continue;

    const rawWords = text.split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) continue;

    // Segment sınırını ASLA aşma — kelimeleri segment içine sıkıştır
    const effectiveDuration = segDuration;
    const wordDur = effectiveDuration / rawWords.length;

    for (let i = 0; i < rawWords.length; i++) {
      const wStart = segStart + i * wordDur;
      const wEnd = segStart + (i + 1) * wordDur;

      allWords.push({
        text: rawWords[i],
        start: Math.max(wStart, segStart),          // segment sınırı altına düşme
        end: Math.min(wEnd, segEnd),
        segmentId: segIdx,                           // orijinal segment kimliği
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

// ─── v2 Yardımcı Fonksiyonlar ──────────────────────────────────────────────

/**
 * Kelimenin sonundaki nokta kısaltma mı yoksa cümle sonu mu?
 * @param {string} word
 * @returns {boolean} true ise kısaltma (cümle sonu DEĞİL)
 */
function isAbbreviation(word) {
  if (!word || !word.endsWith('.')) return false;
  return ABBREVIATIONS.has(word);
}

/**
 * Kelime zarf-fiil eki taşıyor mu?
 * @param {string} word
 * @returns {boolean}
 */
function detectAdverbialSuffix(word) {
  if (!word || word.length < 3) return false;
  const clean = word.replace(/[.,?!…;:]+$/, '');
  if (clean.length < 3) return false;
  return ADVERBIAL_PATTERNS.some(pattern => pattern.test(clean));
}

/**
 * Okuma hızı (CPS) hesaplar.
 * @param {string} text - Altyazı metni
 * @param {number} durationSeconds - Süre (saniye)
 * @returns {{ cps: number, status: 'ok'|'warning'|'error' }}
 */
function calculateCPS(text, durationSeconds) {
  if (!text || durationSeconds <= 0) return { cps: 0, status: 'ok' };
  const cps = text.length / durationSeconds;
  let status = 'ok';
  if (cps > SRT_CONFIG.maxCPS) status = 'error';
  else if (cps > SRT_CONFIG.targetCPS) status = 'warning';
  return { cps, status };
}

/**
 * Kelime sayı mı kontrol eder.
 * @param {string} word
 * @returns {boolean}
 */
function isNumber(word) {
  return /^\d+([.,]\d+)?$/.test(word);
}

/**
 * Kırma noktası için ceza puanı hesaplar.
 * @param {string[]} words - Kelime dizisi
 * @param {number} breakIndex - Bu kelimeden SONRA kır (0-indexed)
 * @returns {number} Negatif = iyi, pozitif = kötü
 */
function calculatePenalty(words, breakIndex) {
  if (breakIndex < 0 || breakIndex >= words.length - 1) return Infinity;

  const currentWord = words[breakIndex];
  const nextWord = words[breakIndex + 1];
  const cleanNext = nextWord.replace(/[.,?!…;:]+$/, '').toLowerCase();
  const cleanCurrent = currentWord.replace(/[.,?!…;:]+$/, '').toLowerCase();

  // Sentaktik bütünlük cezaları (+1000)
  if (POSTPOSITIONS.has(cleanNext)) return 1000;
  if (AUXILIARY_VERBS.has(cleanNext)) return 1000;
  if (isNumber(currentWord) && UNITS.has(cleanNext)) return 1000;

  // Orphan cezası (+500)
  const afterBreak = words.slice(breakIndex + 1).join(' ');
  const beforeBreak = words.slice(0, breakIndex + 1).join(' ');
  if (afterBreak.length <= SRT_CONFIG.minOrphanChars && words.length - breakIndex - 1 === 1) return 500;
  if (beforeBreak.length <= SRT_CONFIG.minOrphanChars && breakIndex === 0) return 500;

  // Ödüller (negatif)
  if (/[.?!;]$/.test(currentWord) && !isAbbreviation(currentWord)) return -100;
  if (/,$/.test(currentWord)) return -80;
  if (detectAdverbialSuffix(currentWord)) return -40;
  if (CONJUNCTIONS.has(cleanNext)) return -30;

  return 0;
}

/**
 * Metin bloğunu 2 satıra bölmek için en iyi noktayı bulur.
 * @param {string} text - Bölünecek metin
 * @returns {{ line1: string, line2: string }}
 */
function findBestLineBreak(text) {
  const words = text.split(/\s+/);
  if (words.length <= 1) return { line1: text, line2: '' };

  let bestScore = Infinity;
  let bestIndex = Math.floor(words.length / 2) - 1; // fallback: ortadan kır

  for (let i = 0; i < words.length - 1; i++) {
    const line1 = words.slice(0, i + 1).join(' ');
    const line2 = words.slice(i + 1).join(' ');

    // maxSoftCPL aşımı kontrolü
    if (line1.length > SRT_CONFIG.maxSoftCPL || line2.length > SRT_CONFIG.maxSoftCPL) continue;

    let score = calculatePenalty(words, i);

    // Geometrik denge bonusu — satır uzunluk farkı küçük olsun, bottom-heavy tercih
    const diff = Math.abs(line1.length - line2.length);
    score -= 5 * (1 - diff / SRT_CONFIG.maxCharsPerLine);

    // Bottom-heavy bonus: alt satır uzunsa küçük ek ödül
    if (line2.length >= line1.length) score -= 3;

    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return {
    line1: words.slice(0, bestIndex + 1).join(' '),
    line2: words.slice(bestIndex + 1).join(' ')
  };
}

/**
 * Altyazı bloğu metnini 1 veya 2 satıra böler.
 * @param {string} text - Altyazı metni (satır kırmasız)
 * @returns {string} 1 veya 2 satırlı metin (\n ile ayrılmış)
 */
function splitIntoLines(text) {
  if (!text) return '';

  // Tek satıra sığıyorsa bölme
  if (text.length <= SRT_CONFIG.maxCharsPerLine) return text;

  const { line1, line2 } = findBestLineBreak(text);
  if (!line2) return line1;

  // Her iki satır da maxSoftCPL (45) altındaysa kabul et
  if (line1.length <= SRT_CONFIG.maxSoftCPL && line2.length <= SRT_CONFIG.maxSoftCPL) {
    return enforceLineLimit(line1) + '\n' + enforceLineLimit(line2);
  }

  // >45 ise zorla en yakın boşluktan kır
  const mid = Math.floor(text.length / 2);
  let breakPos = text.lastIndexOf(' ', mid);
  if (breakPos <= 0) breakPos = text.indexOf(' ', mid);
  if (breakPos <= 0) return enforceLineLimit(text);
  return enforceLineLimit(text.substring(0, breakPos)) + '\n' + enforceLineLimit(text.substring(breakPos + 1));
}

/**
 * Tek satırın maxSoftCPL (45) karakteri kesinlikle geçmemesini sağlar.
 * Aşarsa en yakın boşluktan keser.
 */
function enforceLineLimit(line) {
  if (!line || line.length <= SRT_CONFIG.maxSoftCPL) return line;
  // maxSoftCPL aşıldığında metni kesmek yerine olduğu gibi döndür.
  // splitIntoLines zaten 2 satıra bölmeyi deniyor, burada veri kaybı yapmamalıyız.
  return line;
}

/**
 * Word listesini akıllıca SRT bloklarına gruplar.
 * v2: Kısaltma istisnası, kasıtlı duraklama, CPS kontrolü, penalty-based bağlaç kırma.
 */
function groupWordsIntoSubtitles(words) {
  if (words.length === 0) return [];

  const subtitles = [];
  let currentWords = [];
  let addEllipsisBefore = false; // Kasıtlı duraklama sonrası "..." ön eki

  function flushSubtitle(appendEllipsis) {
    if (currentWords.length === 0) return;

    const start = currentWords[0].start;
    const end = currentWords[currentWords.length - 1].end;
    let text = currentWords.map(w => w.text).join(' ');

    // Kasıtlı duraklama: blok sonuna "..." ekle
    if (appendEllipsis) {
      text = text + '...';
    }

    // Kasıtlı duraklama: blok başına "..." ekle
    if (addEllipsisBefore) {
      text = '...' + text;
      addEllipsisBefore = false;
    }

    // splitIntoLines ile satır kırma uygula
    text = splitIntoLines(text);

    subtitles.push({ start, end, text });
    currentWords = [];
  }

  function currentDuration() {
    if (currentWords.length === 0) return 0;
    return currentWords[currentWords.length - 1].end - currentWords[0].start;
  }

  function currentCharCount() {
    return currentWords.map(w => w.text).join(' ').length;
  }

  const MAX_CHARS_PER_BLOCK = SRT_CONFIG.maxCharsPerLine * SRT_CONFIG.maxLines; // 84

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const nextWord = i + 1 < words.length ? words[i + 1] : null;

    // CPS pre-check: kelimeyi eklemeden ÖNCE CPS kontrol et
    if (currentWords.length > 0) {
      const prospectiveText = currentWords.map(w => w.text).join(' ') + ' ' + word.text;
      const prospectiveStart = currentWords[0].start;
      const prospectiveEnd = word.end;
      const prospectiveDuration = prospectiveEnd - prospectiveStart;
      if (prospectiveDuration > 0) {
        const prospectiveCPS = prospectiveText.length / prospectiveDuration;
        if (prospectiveCPS > SRT_CONFIG.maxCPS) {
          flushSubtitle(false); // Önce mevcut bloğu kapat
        }
      }
    }

    currentWords.push(word);

    let shouldFlush = false;

    // 1. Cümle sonu — kısaltma istisnası ile kontrol
    if (isSentenceEnd(word.text) && !isAbbreviation(word.text)) {
      shouldFlush = true;
    }

    // 2. Maksimum süre aşıldı
    if (currentDuration() >= SRT_CONFIG.maxDuration) {
      shouldFlush = true;
    }

    // 3. Karakter limiti: maxCharsPerBlock (84) aşıldı
    if (currentCharCount() >= MAX_CHARS_PER_BLOCK) {
      shouldFlush = true;
    }

    // 4. Sonraki kelime bağlaç ise ve yeterli içerik varsa (v2: CONJUNCTIONS Set)
    if (nextWord && !shouldFlush) {
      const cleanNext = nextWord.text.replace(/[.,?!…;:]+$/, '').toLowerCase();
      if (CONJUNCTIONS.has(cleanNext) && currentWords.length >= 3) {
        shouldFlush = true;
      }
    }

    // 5. Sentaktik bütünlük koruması — sonraki kelime edat/yrd.fiil ise flush'u engelle
    if (shouldFlush && nextWord) {
      const cleanNext = nextWord.text.replace(/[.,?!…;:]+$/, '').toLowerCase();
      if (POSTPOSITIONS.has(cleanNext) || AUXILIARY_VERBS.has(cleanNext)) {
        // Karakter limiti çok aşılmadıysa koru (maxSoftCPL × 2 = 90)
        if (currentCharCount() < SRT_CONFIG.maxSoftCPL * SRT_CONFIG.maxLines) {
          shouldFlush = false;
        }
      }
      // Eski: Türkçe kısa ek kontrolü
      if (isTurkishSuffix(nextWord.text)) {
        shouldFlush = false;
      }
    }

    // 6. Kasıtlı duraklama tespiti (≥2sn sessizlik)
    if (nextWord && (nextWord.start - word.end) >= SRT_CONFIG.pauseThreshold) {
      flushSubtitle(true); // "..." ekle
      addEllipsisBefore = true;
      continue;
    }

    // 7. Segment sınırı gap kontrolü — farklı Whisper segmentlerinden gelen kelimeler
    //    arasında 300ms+ boşluk varsa blok kapat
    if (nextWord && nextWord.segmentId !== undefined && word.segmentId !== undefined) {
      if (nextWord.segmentId !== word.segmentId && (nextWord.start - word.end) >= 0.3) {
        shouldFlush = true;
      }
    }

    // 8. Normal gap kontrolü — sonraki kelime ile arada boşluk varsa
    if (nextWord && (nextWord.start - word.end) > 0.5 && currentWords.length >= 2) {
      shouldFlush = true;
    }

    if (shouldFlush) {
      flushSubtitle(false);
    }
  }

  // Kalan kelimeleri flush et
  flushSubtitle(false);

  // Post-process: CPS kontrolü — >20 CPS olan blokları böl
  const cpsChecked = [];
  for (const sub of subtitles) {
    const duration = sub.end - sub.start;
    const plainText = sub.text.replace(/\n/g, ' ');
    const { status } = calculateCPS(plainText, duration);

    if (status === 'error' && plainText.split(/\s+/).length >= 2) {
      // CPS çok yüksek — bloğu ikiye böl
      const allWords = plainText.split(/\s+/);
      const midIdx = Math.floor(allWords.length / 2);
      const firstHalf = allWords.slice(0, midIdx).join(' ');
      const secondHalf = allWords.slice(midIdx).join(' ');
      const midTime = sub.start + (duration * midIdx / allWords.length);

      cpsChecked.push({
        start: sub.start,
        end: midTime,
        text: splitIntoLines(firstHalf)
      });
      cpsChecked.push({
        start: midTime,
        end: sub.end,
        text: splitIntoLines(secondHalf)
      });
    } else {
      cpsChecked.push(sub);
    }
  }

  // Post-process: minimum süre kontrolü — çok kısa altyazıları birleştir
  const merged = [];
  for (let i = 0; i < cpsChecked.length; i++) {
    const sub = cpsChecked[i];
    const duration = sub.end - sub.start;

    if (duration < SRT_CONFIG.minDuration && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const prevPlain = prev.text.replace(/\n/g, ' ');
      const subPlain = sub.text.replace(/\n/g, ' ');
      const combinedPlain = prevPlain + ' ' + subPlain;

      if ((sub.end - prev.start) <= SRT_CONFIG.maxDuration) {
        prev.end = sub.end;
        prev.text = splitIntoLines(combinedPlain);
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

// ─── Word-by-Word SRT Üretimi ───────────────────────────────────────────────

/**
 * Whisper verbose_json yanıtından word-level timestamps çıkarır.
 * Sub-word token'ları (boşluksuz başlayan) önceki kelimeyle birleştirir.
 * @param {Object} result - whisper-server verbose_json yanıtı
 * @returns {Array<{text: string, start: number, end: number}>}
 */
function extractWordTimestamps(result) {
  const words = [];
  const segments = result.transcription || result.segments || [];

  for (const seg of segments) {
    // whisper.cpp verbose_json word_timestamps yanıtı:
    // segment.words = [{word: " Merhaba", start: 0.5, end: 0.9, probability: 0.98}, ...]
    const segWords = seg.words || [];

    if (segWords.length > 0) {
      // Word-level timestamps mevcut — kullan
      for (const w of segWords) {
        const text = (w.word || w.text || '').trim();
        if (!text) continue;

        const wStart = w.start != null ? w.start :
                       (w.t0 != null ? w.t0 / 100 : 0);
        const wEnd = w.end != null ? w.end :
                     (w.t1 != null ? w.t1 / 100 : wStart + 0.1);

        // Sub-word token kontrolü: boşlukla başlamayan token öncekiyle birleş
        const rawWord = w.word || w.text || '';
        if (words.length > 0 && rawWord.length > 0 && rawWord[0] !== ' ' && !/^[A-ZÇĞİÖŞÜa-zçğıöşü]/.test(rawWord[0]) === false) {
          // Eğer önceki kelimenin sonu ile bu kelimenin başı bitişikse birleştir
          if (rawWord[0] !== ' ' && words.length > 0) {
            const prev = words[words.length - 1];
            // Zaman farkı çok küçükse (50ms altı) sub-word token olabilir
            if (wStart - prev.end < 0.05) {
              prev.text = prev.text + text;
              prev.end = wEnd;
              continue;
            }
          }
        }

        words.push({ text, start: wStart, end: wEnd });
      }
    } else {
      // Word-level timestamps yok — segment bazlı fallback (eşit dağıtım)
      const segStart = normalizeTime(seg.t0, seg.start);
      const segEnd = normalizeTime(seg.t1, seg.end);
      const segText = (seg.text || '').trim();
      if (!segText) continue;

      const rawWords = segText.split(/\s+/).filter(Boolean);
      const segDur = segEnd - segStart;
      const wordDur = rawWords.length > 0 ? segDur / rawWords.length : segDur;

      for (let i = 0; i < rawWords.length; i++) {
        words.push({
          text: rawWords[i],
          start: segStart + i * wordDur,
          end: segStart + (i + 1) * wordDur,
        });
      }
    }
  }

  return words;
}

/**
 * Word-by-word SRT üretir — her kelime ayrı bir SRT entry.
 * Milisaniye hassasiyetinde ses-altyazı senkronizasyonu.
 * @param {Object} result - whisper-server verbose_json yanıtı (word_timestamps=true)
 * @returns {string} SRT formatında metin
 */
function generateWordByWordSRT(result) {
  const words = extractWordTimestamps(result);
  if (words.length === 0) return '';

  // Halüsinasyon temizleme: ardışık aynı kelime tekrarlarını sil
  const cleaned = [];
  let repeatCount = 0;
  for (let i = 0; i < words.length; i++) {
    const curr = words[i].text.toLowerCase();
    const prev = i > 0 ? words[i - 1].text.toLowerCase() : '';
    if (curr === prev) {
      repeatCount++;
      if (repeatCount >= 2) continue; // 3+ ardışık aynı kelime → sil
    } else {
      repeatCount = 0;
    }
    cleaned.push(words[i]);
  }

  // Minimum süre kontrolü: çok kısa kelimeleri genişlet (min 100ms)
  for (const w of cleaned) {
    if (w.end - w.start < 0.1) {
      w.end = w.start + 0.1;
    }
  }

  // SRT formatına dönüştür
  const lines = [];
  for (let i = 0; i < cleaned.length; i++) {
    const w = cleaned[i];
    lines.push(String(i + 1));
    lines.push(formatTimestamp(w.start) + ' --> ' + formatTimestamp(w.end));
    lines.push(w.text);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── SRT Parse / Write (Faz 3) ──────────────────────────────────────────────

/**
 * SRT zaman damgasını float saniyeye çevirir.
 * "HH:MM:SS,mmm" → float seconds
 */
function parseTimestamp(ts) {
  const parts = ts.trim().split(':');
  if (parts.length !== 3) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  const secParts = parts[2].split(',');
  const s = parseInt(secParts[0], 10) || 0;
  const ms = parseInt(secParts[1] || '0', 10) || 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

/**
 * SRT formatındaki metni parse eder.
 * @param {string} srtContent - SRT dosya içeriği
 * @returns {Array<{id: string, index: number, startTime: number, endTime: number, text: string}>}
 */
function parseSRT(srtContent) {
  if (!srtContent || !srtContent.trim()) return [];

  const subtitles = [];
  // Blokları çift satır kırmasıyla ayır (Windows/Unix uyumlu)
  const blocks = srtContent.trim().replace(/\r\n/g, '\n').split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // 1. satır: sıra numarası
    const index = parseInt(lines[0].trim(), 10);
    if (isNaN(index)) continue;

    // 2. satır: zaman damgası
    const timeLine = lines[1].trim();
    const timeMatch = timeLine.match(/^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})$/);
    if (!timeMatch) continue;

    const startTime = parseTimestamp(timeMatch[1]);
    const endTime = parseTimestamp(timeMatch[2]);

    // 3+ satır: metin
    const text = lines.slice(2).join('\n').trim();
    if (!text) continue;

    subtitles.push({
      id: 'sub_' + String(index).padStart(3, '0'),
      index,
      startTime,
      endTime,
      text
    });
  }

  return subtitles;
}

/**
 * Altyazı dizisini SRT formatına dönüştürür.
 * @param {Array<{startTime: number, endTime: number, text: string}>} subtitles
 * @returns {string} SRT formatında metin (UTF-8, BOM'suz)
 */
function writeSRT(subtitles) {
  if (!subtitles || subtitles.length === 0) return '';

  const lines = [];
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    lines.push(String(i + 1));
    lines.push(formatTimestamp(sub.startTime) + ' --> ' + formatTimestamp(sub.endTime));
    lines.push(sub.text);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Adobe Transcript JSON ──────────────────────────────────────────────────

/**
 * whisper-server verbose_json çıktısını Adobe Transcript JSON formatına çevirir.
 * @param {Array} segments - whisper segments dizisi
 * @returns {string|null} Adobe transcript JSON string, veya boşsa null
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
