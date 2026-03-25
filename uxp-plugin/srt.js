/**
 * SRT dosya oluşturma + Adobe Transcript JSON dönüştürme modülü
 * Segment bazlı akıllı segmentasyon destekler.
 */

const SRT_CONFIG = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDuration: 0.7,
  maxDuration: 7.0,
  gapBetweenSubs: 0.083,
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

// ─── Smart Word-by-Word Sözlükler ───────────────────────────────────────────

/** İleriye bağlanan kelimeler — sonraki kelimeyle birleştirmeyi tercih eder */
const FORWARD_BINDING = new Set([
  'bir', 'bu', 'şu', 'o', 'her', 'hiç', 'hiçbir', 'birçok',
  'en', 'çok', 'pek', 'daha', 'az', 'tam', 'gayet',
  'tüm', 'bütün', 'bazı', 'birkaç', 'kaç', 'hangi',
  'ne', 'öyle', 'böyle', 'şöyle'
]);

/** Geriye bağlanan kelimeler — önceki kelimeyle birleştirmeyi tercih eder */
const BACKWARD_BINDING = new Set([
  'da', 'de', 'mi', 'mı', 'mu', 'mü',
  'ki', 'ya', 'bile', 'dahi', 'ise'
]);

function formatTimestamp(seconds) {
  // Negatif değerleri sıfıra çek
  if (seconds < 0) seconds = 0;

  // Toplam milisaniyeyi tamsayıya yuvarla — kayan nokta taşmasını önler
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
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
 * v4: Segment'te word-level timestamps (DTW/VAD-mapped) varsa GERÇEK zamanlamaları kullanır.
 *     Yoksa karakter-orantılı dağıtıma fallback eder.
 * Segment sınırı korunur, segmentId taşınır.
 */
function extractWords(segments) {
  const allWords = [];

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    const segStart = normalizeTime(seg.t0, seg.start);
    const segEnd = normalizeTime(seg.t1, seg.end);
    const segDuration = segEnd - segStart;
    const text = (seg.text || "").trim();
    if (!text || segDuration <= 0) continue;

    // ── Gerçek word timestamps varsa kullan (DTW/VAD-mapped) ──
    if (seg.words && seg.words.length > 0) {
      const segCollected = [];

      for (const w of seg.words) {
        const wText = (w.word || w.text || '').trim();
        if (!wText) continue;

        let wStart = w.start != null ? w.start :
                     (w.t0 != null ? w.t0 / 100 : 0);
        let wEnd = w.end != null ? w.end :
                   (w.t1 != null ? w.t1 / 100 : wStart + 0.1);

        // DTW zamanlaması: t_dtw ≥ 0 ise DTW aktif, server tarafında VAD-mapped centisaniye
        const hasDTW = w.t_dtw != null && w.t_dtw >= 0;
        const dtwOnset = hasDTW ? w.t_dtw / 100 : -1;

        // Sub-word token kontrolü: boşluksuz başlayan → önceki kelimeyle birleştir
        const rawWord = w.word || w.text || '';
        const startsWithSpace = rawWord.length > 0 && rawWord[0] === ' ';
        if (!startsWithSpace && segCollected.length > 0) {
          const prev = segCollected[segCollected.length - 1];
          if (wStart - prev.end < 0.2) {
            prev.text = prev.text + wText;
            prev.end = wEnd;
            continue;
          }
        }

        segCollected.push({
          text: wText,
          start: hasDTW ? dtwOnset : wStart,
          end: wEnd,
          hasDTW,
          dtwOnset,
        });
      }

      if (segCollected.length === 0) {
        // words dizisi boş çıktı — fallback'e düş (aşağıda)
      } else {
        // DTW onset tabanlı end zamanlama: ardışık onset'lerden sınır oluştur
        for (let k = 0; k < segCollected.length; k++) {
          const curr = segCollected[k];
          if (curr.hasDTW && k + 1 < segCollected.length && segCollected[k + 1].hasDTW) {
            curr.end = segCollected[k + 1].dtwOnset;
          }
          // Minimum kelime süresi: 50ms
          if (curr.end - curr.start < 0.05) {
            curr.end = curr.start + 0.05;
          }
          // Segment sınırı clamp
          curr.start = Math.max(segStart, Math.min(curr.start, segEnd));
          curr.end = Math.max(curr.start, Math.min(curr.end, segEnd));
        }

        // Overlap çözümleme: midpoint split
        for (let k = 0; k < segCollected.length - 1; k++) {
          if (segCollected[k].end > segCollected[k + 1].start) {
            const mid = (segCollected[k].end + segCollected[k + 1].start) / 2;
            segCollected[k].end = mid;
            segCollected[k + 1].start = mid;
          }
        }

        for (const w of segCollected) {
          allWords.push({
            text: w.text,
            start: w.start,
            end: w.end,
            segmentId: segIdx,
          });
        }
        continue; // Bu segment tamamlandı, fallback'e düşme
      }
    }

    // ── Fallback: word timestamps yoksa karakter-orantılı dağıtım ──
    const rawWords = text.split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) continue;

    const charWeights = rawWords.map(w => Math.max(w.length, 1));
    const totalWeight = charWeights.reduce((sum, w) => sum + w, 0);

    let cumWeight = 0;
    for (let i = 0; i < rawWords.length; i++) {
      const wStart = segStart + (cumWeight / totalWeight) * segDuration;
      cumWeight += charWeights[i];
      const wEnd = Math.min(segStart + (cumWeight / totalWeight) * segDuration, segEnd);

      allWords.push({
        text: rawWords[i],
        start: wStart,
        end: wEnd,
        segmentId: segIdx,
      });
    }
  }

  // ── Segment-arası sub-word birleştirme ──
  // Whisper bazen kelimeleri segment sınırında böler: "uyard" | "ım."
  // İlk kelime boşluksuz başlıyorsa (raw token'da) ve önceki kelime noktalama ile bitmiyorsa → birleştir.
  // extractWords raw token bilgisini taşımadığı için basit heuristik:
  // Segment sınırında, sonraki segmentin ilk kelimesi küçük harfle başlıyorsa ve ≤3 char ise → birleştir.
  const TR_VOWELS = 'aeıioöuüAEIİOÖUÜ';
  const TR_CONSONANTS = 'bcçdfgğhjklmnprsştvyzBCÇDFGĞHJKLMNPRSŞTVYZ';
  for (let i = 1; i < allWords.length; i++) {
    if (allWords[i].segmentId !== allWords[i - 1].segmentId) {
      const prev = allWords[i - 1];
      const curr = allWords[i];
      const prevClean = prev.text.replace(/[.,?!…;:]+$/, '');
      // Önceki kelime noktalama ile bitiyorsa birleştirme
      if (/[.?!…]$/.test(prev.text)) continue;
      // Sonraki kelime küçük harfle veya ünlüyle başlıyor + kısa (≤4 char, noktalama hariç)
      const currClean = curr.text.replace(/[.,?!…;:]+$/, '');
      const firstChar = currClean[0] || '';
      const endsWithConsonant = prevClean.length > 0 && TR_CONSONANTS.includes(prevClean[prevClean.length - 1]);
      const startsWithVowel = TR_VOWELS.includes(firstChar);
      const isShortSuffix = currClean.length <= 4 && firstChar === firstChar.toLowerCase() && firstChar !== firstChar.toUpperCase();
      if (isShortSuffix && endsWithConsonant && startsWithVowel) {
        prev.text = prevClean + curr.text;
        prev.end = curr.end;
        allWords.splice(i, 1);
        i--;
      }
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

    // CPS pre-check kaldırıldı (v5) — DTW zamanlamalarıyla uyumsuzdu, mikro-fragmantasyona
    // neden oluyordu. CPS kontrolü artık sadece post-process'te yapılır.

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

  // 0-süre düzeltme: DTW'nin aynı onset verdiği çok kısa kelimeler
  for (const sub of subtitles) {
    if (sub.end - sub.start < 0.05) {
      sub.end = sub.start + 0.2;
    }
  }

  // Post-process: CPS kontrolü — >20 CPS ve ≥4 kelimelik blokları cümle sınırında böl
  const cpsChecked = [];
  for (const sub of subtitles) {
    const duration = sub.end - sub.start;
    const plainText = sub.text.replace(/\n/g, ' ');
    const { status } = calculateCPS(plainText, duration);
    const allBlockWords = plainText.split(/\s+/);

    if (status === 'error' && allBlockWords.length >= 4) {
      // Cümle sonu sınırında en iyi bölme noktasını bul
      let bestSplitIdx = -1;
      let bestScore = Infinity;

      for (let j = 1; j < allBlockWords.length - 1; j++) {
        if (/[.?!…]$/.test(allBlockWords[j])) {
          const h1 = allBlockWords.slice(0, j + 1).join(' ');
          const h2 = allBlockWords.slice(j + 1).join(' ');
          const ratio = (j + 1) / allBlockWords.length;
          const midT = sub.start + duration * ratio;
          const cps1 = h1.length / Math.max(midT - sub.start, 0.05);
          const cps2 = h2.length / Math.max(sub.end - midT, 0.05);
          const score = Math.max(cps1, cps2);
          if (score < bestScore) { bestScore = score; bestSplitIdx = j; }
        }
      }

      if (bestSplitIdx >= 0) {
        const h1 = allBlockWords.slice(0, bestSplitIdx + 1).join(' ');
        const h2 = allBlockWords.slice(bestSplitIdx + 1).join(' ');
        const ratio = (bestSplitIdx + 1) / allBlockWords.length;
        const midT = sub.start + duration * ratio;
        cpsChecked.push({ start: sub.start, end: midT, text: splitIntoLines(h1) });
        cpsChecked.push({ start: midT, end: sub.end, text: splitIntoLines(h2) });
        continue;
      }
    }

    cpsChecked.push(sub);
  }

  // Post-process: akıllı minimum süre birleştirme
  // Sadece kurallar uygunsa merge et: CPS ≤ 25, chars ≤ 84, gap < 500ms
  const merged = [];
  for (let i = 0; i < cpsChecked.length; i++) {
    const sub = cpsChecked[i];
    const duration = sub.end - sub.start;

    if (duration < SRT_CONFIG.minDuration && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const prevPlain = prev.text.replace(/\n/g, ' ');
      const subPlain = sub.text.replace(/\n/g, ' ');
      const combinedPlain = prevPlain + ' ' + subPlain;
      const combinedDuration = sub.end - prev.start;
      const gap = sub.start - prev.end;
      const combinedCPS = combinedDuration > 0 ? combinedPlain.length / combinedDuration : 999;

      if (combinedDuration <= SRT_CONFIG.maxDuration &&
          combinedPlain.length <= MAX_CHARS_PER_BLOCK &&
          combinedCPS <= 25 &&
          gap < 0.5) {
        prev.end = sub.end;
        prev.text = splitIntoLines(combinedPlain);
        continue;
      }
    }

    merged.push({ ...sub });
  }

  // Gap ekleme — altyazılar arası minimum boşluk garantisi
  // Strateji: sadece gereken kadar geri çek, overlap varsa midpoint split.
  // Gerçek DTW zamanlamaları kullanıldığında drift minimal olur.
  for (let i = 0; i < merged.length - 1; i++) {
    const gap = merged[i + 1].start - merged[i].end;
    if (gap < SRT_CONFIG.gapBetweenSubs) {
      if (gap < 0) {
        // Overlap — midpoint split
        const mid = (merged[i].end + merged[i + 1].start) / 2;
        merged[i].end = mid;
        merged[i + 1].start = mid;
      } else {
        // Küçük gap — sadece mevcut bloğun end'ini gereken kadar geri çek
        const needed = SRT_CONFIG.gapBetweenSubs - gap;
        const currentDuration = merged[i].end - merged[i].start;
        // En fazla 100ms geri çek — drift'i önle
        const pullback = Math.min(needed, 0.1);
        merged[i].end = merged[i].end - pullback;
        // Minimum süre koruması
        if (merged[i].end <= merged[i].start) {
          merged[i].end = merged[i].start + Math.min(0.1, currentDuration);
        }
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
 *
 * Zamanlama stratejisi (v4.0 — Server-Side VAD Mapping):
 *   whisper-server artık token timestamps'ı whisper_vad_map_timestamp() ile
 *   orijinal video zamanına map ediyor (server.cpp'de). Client-side VAD offset
 *   düzeltmesine gerek yok. Token zamanlamaları doğrudan kullanılır.
 *   DTW onset'leri de server tarafında map edilmiş olarak gelir.
 *
 * @param {Object} result - whisper-server verbose_json yanıtı
 * @returns {Array<{text: string, start: number, end: number}>}
 */
function extractWordTimestamps(result) {
  const words = [];
  const segments = result.transcription || result.segments || [];

  for (const seg of segments) {
    // Segment sınırları — server tarafında VAD mapping uygulanmış
    const segStart = normalizeTime(seg.t0, seg.start);
    const segEnd = normalizeTime(seg.t1, seg.end);
    if (segEnd - segStart <= 0) continue;

    const segWords = seg.words || [];

    if (segWords.length > 0) {
      // 1. Sub-word token birleştirme
      // Server artık token timestamps'ı VAD mapping'den geçiriyor,
      // dolayısıyla word start/end orijinal video zamanında geliyor.
      const segCollected = [];
      for (const w of segWords) {
        const text = (w.word || w.text || '').trim();
        if (!text) continue;

        // Zamanlamalar — server tarafında VAD-mapped, orijinal video zamanı
        let wStart = w.start != null ? w.start :
                     (w.t0 != null ? w.t0 / 100 : 0);
        let wEnd = w.end != null ? w.end :
                   (w.t1 != null ? w.t1 / 100 : wStart + 0.1);

        // DTW zamanlaması: t_dtw ≥ 0 ise DTW aktif, server tarafında VAD-mapped centisaniye
        const hasDTW = w.t_dtw != null && w.t_dtw >= 0;
        const dtwOnset = hasDTW ? w.t_dtw / 100 : -1;

        // Sub-word token kontrolü: boşluksuz başlayan → önceki kelimeyle birleştir
        const rawWord = w.word || w.text || '';
        const startsWithSpace = rawWord.length > 0 && rawWord[0] === ' ';
        if (!startsWithSpace && segCollected.length > 0) {
          const prev = segCollected[segCollected.length - 1];
          if (wStart - prev.end < 0.2) {
            prev.text = prev.text + text;
            prev.end = wEnd;
            continue;
          }
        }

        segCollected.push({
          text,
          start: hasDTW ? dtwOnset : wStart,
          end: wEnd,
          hasDTW,
          dtwOnset,
        });
      }

      if (segCollected.length === 0) continue;

      // 2. DTW onset tabanlı end zamanlama: ardışık onset'lerden sınır oluştur
      for (let k = 0; k < segCollected.length; k++) {
        const curr = segCollected[k];

        if (curr.hasDTW && k + 1 < segCollected.length && segCollected[k + 1].hasDTW) {
          curr.end = segCollected[k + 1].dtwOnset;
        }

        // Minimum kelime süresi: 50ms
        if (curr.end - curr.start < 0.05) {
          curr.end = curr.start + 0.05;
        }

        // Segment sınırı clamp: kelime asla segment dışına taşamaz
        curr.start = Math.max(segStart, Math.min(curr.start, segEnd));
        curr.end = Math.max(curr.start, Math.min(curr.end, segEnd));
      }

      // 3. Overlap çözümleme: ardışık kelimelerde overlap varsa midpoint split
      for (let k = 0; k < segCollected.length - 1; k++) {
        const curr = segCollected[k];
        const next = segCollected[k + 1];
        if (curr.end > next.start) {
          const mid = (curr.end + next.start) / 2;
          curr.end = mid;
          next.start = mid;
        }
      }

      // 4. Temiz word dizisine dönüştür
      for (const w of segCollected) {
        words.push({ text: w.text, start: w.start, end: w.end });
      }
    } else {
      // Word-level timestamps hiç yok — segment tek blok olarak ekle
      const segText = (seg.text || '').trim();
      if (!segText) continue;

      words.push({
        text: segText,
        start: segStart,
        end: segEnd,
      });
    }
  }

  return words;
}

// ─── Smart Word-by-Word: Temizleme + Akıllı Gruplama ─────────────────────────

/**
 * Word timestamp dizisini temizler:
 * 1. Tek başına noktalama → önceki kelimeye yapıştır
 * 2. Cross-segment sub-word birleştirme ("sıkınt" + "ılıyım" → "sıkıntılıyım")
 * 3. Boş/anlamsız token filtresi
 * @param {Array<{text: string, start: number, end: number}>} words
 * @returns {Array<{text: string, start: number, end: number}>}
 */
function cleanWordTimestamps(words) {
  if (words.length === 0) return [];

  // 1. Noktalama yapıştırma: tek başına ".", ",", "!", "?" → önceki kelimeye ekle
  const punctCleaned = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const textClean = w.text.replace(/\s/g, '');

    if (/^[.,!?…;:]+$/.test(textClean)) {
      if (punctCleaned.length > 0) {
        const prev = punctCleaned[punctCleaned.length - 1];
        prev.text = prev.text + textClean;
        prev.end = Math.max(prev.end, w.end);
      }
      continue;
    }

    punctCleaned.push({ ...w });
  }

  // 2. Cross-segment sub-word birleştirme
  // "sıkınt" + "ılıyım" gibi segment sınırında bölünen kelimeleri yakalar.
  // İki tespit yöntemi:
  //   a) Güçlü sinyal: "ı" ile başlayan token — Türkçe'de çok nadir kelime başı
  //      (sadece ısı, ıslak, ılık, ırmak, ışık ve türevleri)
  //   b) Yapısal sinyal: önceki kelime ünsüz kümesiyle bitiyor + sonraki ünlüyle başlıyor
  //      ("sıkınt" → "nt" ünsüz kümesi + "ılıyım" → "ı" ünlü)
  const TR_VOWELS = 'aeıioöuüAEIİOÖUÜ';
  const TR_CONSONANTS = 'bcçdfgğhjklmnprsştvyzBCÇDFGĞHJKLMNPRSŞTVYZ';

  const merged = [];
  for (let i = 0; i < punctCleaned.length; i++) {
    const curr = punctCleaned[i];

    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      const prevEndsClean = !(/[.?!…,;:]$/.test(prev.text));

      if (prevEndsClean) {
        // a) "ı" ile başlayan token — çok güçlü sub-word sinyali
        const startsWithRareInitial = curr.text.length > 0 && curr.text[0] === 'ı';

        // b) Önceki kelime ünsüz kümesiyle bitiyor + sonraki ünlüyle başlıyor
        const prevClean = prev.text.replace(/[.,?!…;:]+$/, '');
        const endsWithConsonantCluster = prevClean.length >= 2 &&
          TR_CONSONANTS.includes(prevClean[prevClean.length - 1]) &&
          TR_CONSONANTS.includes(prevClean[prevClean.length - 2]);
        const startsWithVowel = curr.text.length > 0 && TR_VOWELS.includes(curr.text[0]);
        const isSubwordByStructure = endsWithConsonantCluster && startsWithVowel;

        if (startsWithRareInitial || isSubwordByStructure) {
          // Sub-word birleştirme: orijinal bitiş zamanını koru
          // Server artık VAD-mapped timestamps döndüğü için gap çıkarmaya gerek yok
          prev.text = prevClean + curr.text;
          prev.end = curr.end;
          continue;
        }
      }
    }

    merged.push({ ...curr });
  }

  // 3. Boş token filtresi
  return merged.filter(w => w.text.trim().length > 0);
}

/**
 * Temizlenmiş word dizisini akıllıca gruplar.
 * Remotion'un combineTokensWithinMilliseconds yaklaşımı + Türkçe dilbilgisi kuralları.
 *
 * Zorunlu birleştirme: edat, yrd. fiil, geriye bağlanan parçacıklar, ≤2 char kelime
 * Opsiyonel birleştirme: ileriye bağlanan kelimeler, 300ms zaman eşiği dahilindekiler
 * Limitler: max 3 kelime/grup, max 25 karakter/grup, 500ms+ gap → yeni grup
 *
 * @param {Array<{text: string, start: number, end: number}>} words
 * @returns {Array<{text: string, start: number, end: number}>}
 */
function groupSmartWords(words) {
  if (words.length === 0) return [];

  const MAX_GROUP_WORDS = 3;
  const MAX_GROUP_CHARS = 25;
  const COMBINE_THRESHOLD = 0.3; // 300ms — Remotion tarzı zaman eşiği
  const PAUSE_THRESHOLD = 0.5;   // 500ms — zorla yeni grup

  const groups = [];
  let currentGroup = [];

  function flushGroup() {
    if (currentGroup.length === 0) return;
    groups.push({
      text: currentGroup.map(w => w.text).join(' '),
      start: currentGroup[0].start,
      end: currentGroup[currentGroup.length - 1].end,
    });
    currentGroup = [];
  }

  function currentText() {
    return currentGroup.map(w => w.text).join(' ');
  }

  function cleanLower(text) {
    return (text || '').replace(/[.,?!…;:]+$/, '').toLowerCase();
  }

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (currentGroup.length === 0) {
      currentGroup.push(word);
      continue;
    }

    const lastInGroup = currentGroup[currentGroup.length - 1];
    const gap = word.start - lastInGroup.end;
    const prospectiveText = currentText() + ' ' + word.text;
    const cleanWord = cleanLower(word.text);
    const cleanLast = cleanLower(lastInGroup.text);

    // ─── Zorla YENİ GRUP: doğal duraklama (500ms+) ───
    if (gap >= PAUSE_THRESHOLD) {
      flushGroup();
      currentGroup.push(word);
      continue;
    }

    // ─── Zorla YENİ GRUP: cümle sonu ───
    // Gruptaki son kelime cümle sonuyla bittiyse yeni grup başlat
    if (/[.?!…]$/.test(lastInGroup.text) && !isAbbreviation(lastInGroup.text)) {
      flushGroup();
      currentGroup.push(word);
      continue;
    }

    // ─── Zorla BİRLEŞTİR: dilbilgisi kuralları ───
    let forceMerge = false;

    // Edat: önceki kelimeden asla ayrılmaz ("O kadar", "bunun için")
    if (POSTPOSITIONS.has(cleanWord)) forceMerge = true;
    // Yardımcı fiil: önceki isimden asla ayrılmaz ("yardım etti")
    if (AUXILIARY_VERBS.has(cleanWord)) forceMerge = true;
    // Geriye bağlanan parçacıklar ("var mı", "güzel de")
    if (BACKWARD_BINDING.has(cleanWord)) forceMerge = true;
    // ≤2 karakter kelime tek başına bırakma
    if (word.text.replace(/[.,?!…;:]+$/, '').length <= 2) forceMerge = true;

    if (forceMerge) {
      // Dilbilgisi kuralları için limiti 4 kelimeye kadar esnet
      if (currentGroup.length < MAX_GROUP_WORDS + 1) {
        currentGroup.push(word);
      } else {
        flushGroup();
        currentGroup.push(word);
      }
      continue;
    }

    // ─── Opsiyonel BİRLEŞTİR ───
    let shouldMerge = false;

    // Önceki kelime ileriye bağlanan ise ("bir taş", "çok güzel", "en iyi")
    if (FORWARD_BINDING.has(cleanLast) && currentGroup.length < MAX_GROUP_WORDS) {
      shouldMerge = true;
    }
    // Zaman eşiği dahilinde + karakter/kelime limitleri uygun
    else if (gap < COMBINE_THRESHOLD &&
             prospectiveText.length <= MAX_GROUP_CHARS &&
             currentGroup.length < MAX_GROUP_WORDS) {
      shouldMerge = true;
    }

    if (shouldMerge) {
      currentGroup.push(word);
    } else {
      // Flush öncesi: son kelime ileriye bağlanan ise, onu yeni gruba taşı
      // ("Artık iyi bir" → flush "Artık iyi", yeni grup "bir şey" olur)
      if (FORWARD_BINDING.has(cleanLast) && currentGroup.length > 1) {
        currentGroup.pop();
        flushGroup();
        currentGroup.push(lastInGroup);
        currentGroup.push(word);
      } else {
        flushGroup();
        currentGroup.push(word);
      }
    }
  }

  flushGroup();
  return groups;
}

/**
 * Smart Word-by-Word SRT üretir.
 * Akıllı gruplama ile 1-3 kelimelik altyazı blokları oluşturur.
 * @param {Object} result - whisper-server verbose_json yanıtı
 * @returns {string} SRT formatında metin
 */
function generateWordByWordSRT(result) {
  const rawWords = extractWordTimestamps(result);
  if (rawWords.length === 0) return '';

  // 1. Halüsinasyon temizleme: ardışık aynı kelime tekrarlarını sil
  const deduped = [];
  let repeatCount = 0;
  for (let i = 0; i < rawWords.length; i++) {
    const curr = rawWords[i].text.toLowerCase();
    const prev = i > 0 ? rawWords[i - 1].text.toLowerCase() : '';
    if (curr === prev) {
      repeatCount++;
      if (repeatCount >= 2) continue;
    } else {
      repeatCount = 0;
    }
    deduped.push(rawWords[i]);
  }

  // 2. Temizleme: noktalama yapıştırma + sub-word birleştirme + artifact filtre
  const cleaned = cleanWordTimestamps(deduped);

  // 3. Akıllı gruplama: Türkçe dilbilgisi + zaman bazlı
  const groups = groupSmartWords(cleaned);

  // 4. Minimum süre kontrolü + overlap giderme
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.end - g.start < 0.1) {
      const nextStart = (i + 1 < groups.length) ? groups[i + 1].start : Infinity;
      g.end = Math.min(g.start + 0.1, nextStart);
      if (g.end - g.start < 0.05 && i > 0) {
        const prevEnd = groups[i - 1].end;
        g.start = Math.max(g.end - 0.1, prevEnd);
      }
    }
  }

  for (let i = 0; i < groups.length - 1; i++) {
    if (groups[i].end > groups[i + 1].start) {
      groups[i].end = groups[i + 1].start;
    }
  }

  // 5. SRT formatına dönüştür
  const lines = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    lines.push(String(i + 1));
    lines.push(formatTimestamp(g.start) + ' --> ' + formatTimestamp(g.end));
    lines.push(g.text);
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
