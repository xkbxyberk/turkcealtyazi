# srt.js v2 — Yeniden Yazım Planı (Penalty-Based Akıllı Segmentasyon)

> Bu doküman, mevcut srt.js'nin araştırma raporlarına dayanarak tamamen yeniden yazılması için detaylı teknik planı içerir. Claude Code'a verilecek promptun temelini oluşturur.

---

## Mevcut Durum (srt.js v1)

### Var olan fonksiyonlar:
- `filterShortSegments()` — 0.1s altı segmentleri sil ✅
- `removeHallucinations()` — ABAB pattern tespiti ✅
- `mergeFragmentedWords()` — <4 char parçaları birleştir ✅
- `extractWords()` — segment text'inden kelime çıkar ✅
- `groupWordsIntoSubtitles()` — basit segmentasyon ✅
- `formatSRT()` — SRT formatına dönüştür ✅

### Mevcut SRT_CONFIG:
```javascript
const SRT_CONFIG = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDuration: 1.0,
  maxDuration: 7.0,
  gapBetweenSubs: 0.1,
};
```

### Eksikler (araştırma raporlarına göre):
1. CPS kontrolü yok
2. Penalty scoring sistemi yok
3. Edat/yardımcı fiil koruması yok
4. Orphan kelime kontrolü yok
5. Geometrik denge yok
6. Kısaltma istisna listesi yok
7. Zarf-fiil tespiti yok
8. Sayı normalizasyonu yok

---

## Yeni Mimari: srt.js v2

### Genişletilmiş SRT_CONFIG:
```javascript
const SRT_CONFIG = {
  // Mevcut
  maxCharsPerLine: 42,
  maxLines: 2,
  minDuration: 1.0,
  maxDuration: 7.0,
  gapBetweenSubs: 0.1,
  
  // YENİ
  targetCPS: 17,        // Nominal CPS hedefi
  maxCPS: 20,           // Mutlak CPS limiti (aşılamaz)
  childCPS: 13,         // Çocuk içerik modu (gelecek)
  minOrphanChars: 5,    // Bu uzunluktan kısa kelime orphan sayılır
  maxSoftCPL: 48,       // Sentaktik bütünlük için esnetilebilir limit
  pauseThreshold: 2.0,  // Kasıtlı duraklama eşiği (saniye)
};
```

### Statik Sözlükler (Dictionaries):

```javascript
// Son çekim edatları — öncesinden ASLA kırılmaz
const POSTPOSITIONS = new Set([
  'için', 'gibi', 'kadar', 'göre', 'doğru', 'karşı', 'rağmen',
  'beri', 'başka', 'dair', 'ait', 'ile', 'boyunca', 'üzere',
  'dolayı', 'itibaren', 'önce', 'sonra', 'arasında'
]);

// Bağlaçlar — öncesinden kırılır (bağlaç yeni satır/bloğun başında)
const CONJUNCTIONS = new Set([
  'ama', 'fakat', 'lakin', 'ancak', 'yalnız',
  've', 'veya', 'ya', 'yahut',
  'çünkü', 'oysa', 'oysaki', 'madem', 'mademki',
  'halbuki', 'üstelik', 'hem', 'ne', 'ki'
]);

// Yardımcı fiiller — önceki isimden ASLA ayrılmaz
// Hem mastar hem çekimli halleri
const AUXILIARY_VERBS = new Set([
  'etmek', 'olmak', 'yapmak', 'kılmak', 'eylemek',
  'etti', 'oldu', 'yaptı', 'kıldı',
  'ediyor', 'oluyor', 'yapıyor',
  'eder', 'olur', 'yapar',
  'etmiş', 'olmuş', 'yapmış',
  'edecek', 'olacak', 'yapacak',
  'etmeli', 'olmalı', 'yapmalı',
  'edildi', 'olundu', 'yapıldı',
  'etmekte', 'olmakta',
  'edebilir', 'olabilir', 'yapabilir'
]);

// Kısaltmalar — noktası cümle sonu DEĞİL
const ABBREVIATIONS = new Set([
  'Dr.', 'Prof.', 'Av.', 'Doç.', 'Yrd.', 'Öğr.', 'Gör.',
  'vb.', 'vs.', 'vd.', 'bkz.', 'çev.', 'yay.',
  'M.Ö.', 'M.S.', 'a.g.e.', 'dn.',
  'Ltd.', 'Şti.', 'A.Ş.', 'Org.', 'Gen.', 'Alb.',
  'St.', 'Mr.', 'Mrs.', 'Jr.', 'Sr.'
]);

// Zarf-fiil ek kalıpları (regex) — sonrasından kırma ödülü
const ADVERBIAL_SUFFIXES = [
  /[ıiuü]p$/,              // -ıp, -ip, -up, -üp
  /(ar|er)ak$/,            // -arak, -erek
  /[mM](ad|ed)an$/,        // -madan, -meden
  /(ınc|inc|unc|ünc)[ae]$/, // -ınca, -ince, -unca, -ünce
  /(dığ|diğ|duğ|düğ)[ıiuü]nda$/, // -dığında, -diğinde...
  /[iıuü]ken$/,            // -iken, -ken
];
```

### Ana Fonksiyonlar:

#### 1. `calculatePenalty(words, breakIndex)` — YENİ
```
Her potansiyel kırma noktası (boşluk) için ceza puanı hesaplar.
- breakIndex: Kelime dizisinde kırma yapılacak pozisyon
- Döndürür: number (negatif = iyi kırma noktası, pozitif = kötü)

Kontroller (sırasıyla):
1. Sonraki kelime edat mı? → +1000
2. Sonraki kelime yrd. fiil mi? → +1000
3. Önceki kelime sayı, sonraki kelime birim mi? → +1000
4. Önceki kelime sıfat, sonraki kelime isim mi? (basit heuristik) → +500
5. Orphan yaratıyor mu? (kalan kelime ≤5 char) → +500
6. Önceki kelime noktalamala biter mi? → -100
7. Önceki kelime zarf-fiil eki taşır mı? → -40
8. Sonraki kelime bağlaç mı? → -30
```

#### 2. `findBestBreakPoint(words, startIdx, endIdx)` — YENİ
```
Verilen kelime aralığında en düşük cezalı kırma noktasını bulur.
- Her boşluğa calculatePenalty uygular
- En düşük toplam cezayı döndürür
```

#### 3. `splitIntoLines(text)` — YENİ (mevcut mantığı değiştirir)
```
Bir altyazı bloğunun metnini 1 veya 2 satıra böler.
- Toplam karakter ≤42 → tek satır döndür
- >42 → penalty scoring ile en iyi kırma noktasını bul
- Sentaktik bütünlük 42'yi aşıyorsa 48'e kadar esnet
- 48'i de aşıyorsa: zorla en az cezalı noktadan kır
```

#### 4. `calculateCPS(text, duration)` — YENİ
```
CPS = karakter_sayisi / süre
- Boşluklar dahil
- >17 → uyarı (sarı)
- >20 → blok bölünmeli (kırmızı)
```

#### 5. `groupWordsIntoSubtitles(words)` — GÜNCELLEME
```
Mevcut mantık korunur ama şu kontroller eklenir:
- Her blok oluşturulduğunda CPS hesapla
- CPS > 20 ise bloğu ikiye böl (findBestBreakPoint ile)
- Süre > 7sn ise bloğu ikiye böl
- Süre < 1sn ise bir sonraki blokla birleştir
- ≥2sn sessizlik → blok kapat + "..." ekle
```

#### 6. `isAbbreviation(word)` — YENİ
```
Kelime kısaltma listesinde mi kontrol eder.
- "Dr." → true (cümle sonu DEĞİL)
- "geldi." → false (cümle sonu)
```

#### 7. `detectAdverbialSuffix(word)` — YENİ
```
Kelime zarf-fiil eki taşıyor mu kontrol eder (regex ile).
- "gelip" → true
- "yaparak" → true
- "gidince" → true
```

#### 8. `normalizeNumbers(text)` — YENİ (gelecek faz)
```
"yüzde elli" → "%50"
"bin dokuz yüz" → "1.900"
1-9 → yazıyla, 10+ → rakamla
Bu karmaşık — ilk sürümde atlanabilir, post-processing olarak eklenebilir.
```

### İşlem Sırası (Pipeline):

```
Whisper segments
  │
  ▼
filterShortSegments()      ← mevcut, değişmez
  │
  ▼
removeHallucinations()     ← mevcut, değişmez
  │
  ▼
mergeFragmentedWords()     ← mevcut, değişmez
  │
  ▼
extractWords()             ← mevcut, değişmez
  │
  ▼
groupWordsIntoSubtitles()  ← GÜNCELLEME (CPS + penalty scoring)
  │                           ├─ calculatePenalty()
  │                           ├─ findBestBreakPoint()
  │                           ├─ calculateCPS()
  │                           ├─ isAbbreviation()
  │                           └─ detectAdverbialSuffix()
  │
  ▼
splitIntoLines()           ← YENİ (her blok için)
  │                           ├─ penalty scoring ile satır kırma
  │                           ├─ orphan kontrolü
  │                           └─ geometrik denge
  │
  ▼
formatSRT()                ← mevcut, değişmez
```

---

## Uygulama Stratejisi

### Adım 1: Sözlükleri ekle (5 dk)
- POSTPOSITIONS, CONJUNCTIONS, AUXILIARY_VERBS, ABBREVIATIONS, ADVERBIAL_SUFFIXES

### Adım 2: Yardımcı fonksiyonları yaz (15 dk)
- calculatePenalty(), isAbbreviation(), detectAdverbialSuffix(), calculateCPS()

### Adım 3: findBestBreakPoint() yaz (10 dk)

### Adım 4: splitIntoLines() yaz (15 dk)

### Adım 5: groupWordsIntoSubtitles() güncelle (20 dk)
- CPS kontrolü ekle
- Kasıtlı duraklama tespiti ekle
- Kısaltma istisnası ekle

### Adım 6: Test (10 dk)
- Aynı video ile önceki SRT vs yeni SRT karşılaştırması

### Toplam tahmini süre: ~75 dakika Claude Code çalışması
