# TürkçeAltyazı — Premiere Pro Türkçe Altyazı Eklentisi

## Proje nedir?
Adobe Premiere Pro için Türkçe otomatik altyazı oluşturan bir UXP eklentisi. İki ana bileşen var:
1. **Companion App:** whisper.cpp tabanlı lokal ses-yazı dönüştürme sunucusu (macOS, Apple Silicon M4)
2. **UXP Eklenti:** Premiere Pro içinde çalışan panel — companion app'e HTTP istekleri atar, SRT oluşturur, timeline'a import eder

## Mimari
- whisper-server, panelCreate'de başlar, panelDestroy'da durur (ama şu an shell.openPath UXP'de çalışmadığı için manuel başlatılıyor)
- İletişim: UXP → HTTP POST → localhost:8787 → whisper-server
- Ses format dönüşümü: whisper-server --convert bayrağı ile dahili
- Çıktı: SRT dosyası → Premiere Pro'ya import

## Proje yapısı
```
turkcealtyazi/
├── companion-app/
│   ├── whisper.cpp/          # Core ML + Metal GPU ile build edildi
│   ├── start-server.sh       # --convert --vad --vad-model ile başlatma
│   ├── stop-server.sh        # PID veya port'tan durdurma
│   ├── start-server.command  # macOS Terminal wrapper
│   ├── stop-server.command
│   ├── server.log / server.pid
│   └── models/
│       ├── ggml-large-v3.bin          # 2.9 GB, ana model
│       ├── ggml-large-v3-turbo.bin    # 1.6 GB, hız modu
│       └── ggml-silero-v6.2.0.bin     # VAD modeli
├── uxp-plugin/
│   ├── manifest.json
│   ├── index.html
│   ├── index.js
│   ├── styles.css
│   ├── api.js
│   ├── srt.js                # ← AKILLI SEGMENTASYON MOTORU
│   ├── editor.js             # ← DÜZENLEME PANELİ (Faz 3+4)
│   └── export.js             # ← SRT/VTT/TXT export
├── docs/
│   ├── TurkceAltyazi_YolHaritasi.md
│   ├── Segmentasyon_Arastirma_Referans.md   # Araştırma referansı
│   └── srt_v2_yeniden_yazim_plani.md        # Yeniden yazım planı
└── CLAUDE.md
```

## Komutlar
- whisper-server başlatma:
  ```bash
  cd companion-app/whisper.cpp
  ./build/bin/whisper-server -m models/ggml-large-v3.bin -l tr --port 8787 --convert \
    --beam-size 1 --vad --vad-model models/ggml-silero-v6.2.0.bin
  ```
- whisper-server test:
  ```bash
  curl -X POST http://localhost:8787/inference \
    -F "file=@test.wav" -F "language=tr" -F "response_format=verbose_json"
  ```
- UXP eklenti yükleme: UXP Developer Tool → Add Plugin → uxp-plugin/manifest.json

## Teknik kararlar
- **Model:** ggml-large-v3 (turbo DEĞİL) — Türkçe doğruluğu öncelikli
- **Core ML aktif:** Encode ~640ms (6.4x hızlanma, Metal only: ~4100ms)
- **Build:** `cmake -B build -DWHISPER_COREML=ON -DGGML_METAL=ON -DCMAKE_BUILD_TYPE=Release`
- **Neden whisper.cpp:** Apple Silicon'da Metal + Core ML desteği
- **Neden UXP:** Adobe'un yeni standardı, CEP sunset sürecinde
- **Neden SRT import:** UXP Caption API henüz yok (Adobe doğruladı)
- **Endpoint:** POST http://localhost:8787/inference (FormData: file, language=tr, response_format=verbose_json)
- **word_timestamps:** KULLANILMAZ — sub-word token sorunu yaratır, segment bazlı timestamps kullanılıyor
- **--convert bayrağı:** ZORUNLU — video dosyası direkt gönderilince FFmpeg dönüşümü için
- **--beam-size 1:** Greedy decoding — sessiz kısımlarda halüsinasyon azaltır (varsayılan beam=5 uydurma metin üretir)
- **initial_prompt:** UI'dan isteğe bağlı, özel isim/terim zorlama (max 224 token, ~900 karakter). FormData'da `prompt` alanı olarak gönderilir

## Platform
- macOS, Apple M4 MacBook Air (10 CPU, 10 GPU, 16 Neural Engine)
- Premiere Pro 25.6+ (UXP desteği, manifest minVersion: 25.6.0)
- Xcode 26.3, Python 3.11 (brew), Node.js v24, Git, CMake

## UXP API Keşifleri (Önemli)
```javascript
const ppro = require("premierepro");
// ppro.app YOK — statik sınıflar kullanılır

const project = await ppro.Project.getActiveProject();
const sequence = await project.getActiveSequence();

// ClipProjectItem Cast (ZORUNLU — getMediaFilePath için)
const clipItem = ppro.ClipProjectItem.cast(item);
if (clipItem) {
  const path = await clipItem.getMediaFilePath();
}

// Track/Clip erişimi
const track = await sequence.getVideoTrack(0);
const clips = track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);

// SRT Import
await project.importFiles([srtPath], true); // suppressUI=true
```

### UXP Kısıtlamalar
- `uxp.shell` boş (Array(0)) — shell.openPath() çalışmıyor
- Caption track API yok
- lockedAccess callback'i senkron (await kullanılamaz)

---

## SRT Segmentasyon Motoru (srt.js)

### İşlem Hattı (v2.1)
1. `filterShortSegments()` — 0.1s altı segmentleri sil
2. `removeHallucinations()` — ABAB pattern tespiti (son 20 segment, 1-4 uzunluk, 3+ tekrar)
3. `mergeFragmentedWords()` — <4 char parçaları birleştir
4. `extractWords()` — segment text'inden kelime çıkar (v2.1: min 100ms/kelime, segmentId taşır)
5. `groupWordsIntoSubtitles()` — penalty-based akıllı segmentasyon (v2.1)
   - `isAbbreviation()` — kısaltma istisnası
   - `calculateCPS()` — okuma hızı kontrolü
   - CPS pre-check: kelime eklemeden ÖNCE CPS > 20 kontrolü
   - maxCharsPerBlock (84): 2 satır toplamı hard limit
   - Segment sınırı gap kontrolü: farklı Whisper segmentleri arası 300ms+ → flush
   - `splitIntoLines()` → `findBestLineBreak()` → `calculatePenalty()` — satır kırma
   - `enforceLineLimit()` — 45 char hard limit (satır başına)
   - `detectAdverbialSuffix()` — zarf-fiil tespiti
   - Kasıtlı duraklama tespiti (≥2sn → "...")
   - Sentaktik bütünlük koruması (edat/yrd.fiil)
   - CPS post-process: ≥2 kelimelik bloklar da bölünebilir
6. `formatSRT()` — SRT formatına dönüştür

### SRT_CONFIG
```javascript
const SRT_CONFIG = {
  maxCharsPerLine: 42,
  maxLines: 2,
  minDuration: 1.0,
  maxDuration: 7.0,
  gapBetweenSubs: 0.1,
  // v2 eklemeleri:
  targetCPS: 17,
  maxCPS: 20,
  minOrphanChars: 5,
  maxSoftCPL: 45,
  pauseThreshold: 2.0,
};
```

### ★ srt.js v2 — Penalty-Based Akıllı Segmentasyon (UYGULANACAK)

Bu bölüm, Gemini Deep Research raporlarına dayanarak tasarlanmıştır.
Detaylı plan: `docs/srt_v2_yeniden_yazim_plani.md`

#### Türkçe Sentaktik Sözlükler (srt.js içine gömülecek)

**Edatlar** (öncesinden ASLA kırılmaz — ceza: +1000):
```
için, gibi, kadar, göre, doğru, karşı, rağmen, beri, başka, dair, ait, ile,
boyunca, üzere, dolayı, itibaren, önce, sonra, arasında
```

**Bağlaçlar** (öncesinden kırılır — ödül: -30):
```
ve, veya, ya da, yahut, ama, fakat, lakin, ancak, yalnız, çünkü,
oysa, oysaki, madem, mademki, halbuki, üstelik
```

**Yardımcı Fiiller** (önceki isimden ASLA ayrılmaz — ceza: +1000):
```
etmek, olmak, yapmak, kılmak, eylemek
+ çekimli halleri: etti, oldu, oluyor, eder, olur, edecek, olacak,
  etmiş, olmuş, etmeli, olmalı, edildi, olundu, edebilir, olabilir...
```

**Kısaltmalar** (noktası cümle sonu DEĞİL):
```
Dr., Prof., Av., Doç., Yrd., Öğr., Gör., vb., vs., vd., bkz.,
M.Ö., M.S., Ltd., Şti., A.Ş., St., Mr., Mrs.
```

**Zarf-fiil Ekleri** (sonrasından kırma — ödül: -40):
```
-ıp/-ip/-up/-üp, -arak/-erek, -madan/-meden,
-ınca/-ince/-unca/-ünce, -dığında/-diğinde, -ken/-iken
```

#### Penalty Scoring Sistemi
```
Noktalama sonrası kırma         → -100 (ödül, en iyi kırma noktası)
Zarf-fiil eki sonrası           → -40  (ödül)
Bağlaçtan önce                  → -30  (ödül)
İsim + Edat arası               → +1000 (ceza, kesinlikle yasak)
İsim + Yrd. fiil arası          → +1000 (ceza)
Sayı + Birim arası              → +1000 (ceza)
Orphan kelime (≤5 char)         → +500  (ceza)
42 CPL aşımı                    → +2000 (donanımsal engel)
```

**Çelişki kuralı:** Sentaktik bütünlük > 42 char limiti. 45-48 char kabul edilir.
AMA CPS 20 ASLA aşılamaz — aşıyorsa cümle iki bloğa bölünür.

#### CPS (Characters Per Second) Kontrolü
```
CPS = toplam_karakter / süre_saniye
Hedef: ≤17 CPS (yetişkin)
Uyarı: 17-20 CPS (sarı)
Hata:  >20 CPS (kırmızı, blok bölünmeli)
```

#### Netflix/AVTpro Metrik Standartları
| Kriter | Değer |
|--------|-------|
| Max CPL | 42 |
| Max satır | 2 |
| CPS yetişkin | 17 nominal, 20 mutlak maks |
| Min süre | 833ms (5/6 sn) |
| Max süre | 7 sn |
| Blok gap | Min 83ms (2 frame @24fps) |

---

## Geliştirme Fazları

### ✅ Faz 1 — MVP (Tamamlandı)
- whisper-server kurulum ve Core ML optimizasyonu
- UXP eklenti paneli (sequence algılama, medya yolu bulma)
- Transkripsiyon ve SRT oluşturma
- Otomatik SRT kayıt (proje dizini/altyazilar/)
- Transcript API ile clip'e ekleme
- UI/UX yeniden tasarım

### ✅ Faz 2 — Kalite İyileştirme (Tamamlandı)
- VAD (Silero) entegrasyonu
- Halüsinasyon temizleme (ABAB pattern)
- Kelime birleştirme (segment sınırı parçalanması)
- Akıllı SRT segmentasyonu (42 char, cümle sonu, Türkçe kurallar)

### ✅ Faz 2.5 — Araştırma Tabanlı İyileştirmeler (Tamamlandı)
- [x] beam_size=1 (greedy decoding) — halüsinasyon azaltma
- [x] initial_prompt UI kutusu — özel isim/terim zorlama (max 224 token, ~900 karakter)
- [x] srt.js v2 — Penalty-Based Akıllı Segmentasyon:
  - [x] Türkçe sentaktik sözlükler (edat, bağlaç, yrd. fiil, kısaltma, birim)
  - [x] calculatePenalty() — dinamik ceza puanlama
  - [x] findBestLineBreak() — en iyi kırma noktası bulma
  - [x] splitIntoLines() — penalty ile satır kırma
  - [x] calculateCPS() — okuma hızı kontrolü
  - [x] isAbbreviation() — kısaltma istisnası
  - [x] detectAdverbialSuffix() — zarf-fiil tespiti
  - [x] Orphan kelime kontrolü
  - [x] Geometrik denge (bottom-heavy pyramid)
  - [x] Kasıtlı duraklama tespiti (≥2sn → "..." ekleme)
  - [x] Sentaktik bütünlük koruması (edat/yrd.fiil flush engelleme)
- [x] CPS kontrolü (17 nominal, 20 mutlak maks)
- [x] srt.js v2.1 — Zamanlama ve Segmentasyon Düzeltmeleri:
  - [x] extractWords(): min 100ms/kelime, segmentId taşıma
  - [x] CPS pre-check: kelime eklemeden ÖNCE CPS > 20 kontrolü
  - [x] maxCharsPerBlock (84): blok karakter hard limit
  - [x] Segment sınırı gap kontrolü (300ms+ → flush)
  - [x] enforceLineLimit(): 45 char satır hard limit
  - [x] CPS post-process: ≥2 kelimelik blok bölme
  - [x] maxSoftCPL: 48 → 45

### ✅ Faz 3 — Düzenleme Paneli (Tamamlandı)
- [x] Çift sayfa yapısı (page-create / page-editor) — display:none/block geçişi
- [x] SRT parse/write fonksiyonları (parseSRT, writeSRT — srt.js'e eklendi)
- [x] Sonuç kartında "Düzenle" butonu + otomatik sayfa geçişi
- [x] Altyazı listesi görünümü (render + seçim + CPS renk kodları) — editor.js oluşturuldu
- [x] Inline metin düzenleme + zamanlama kontrolü — editArea, updateText, updateTiming
- [x] Böl / birleştir / sil + undo/redo — splitSubtitle, mergeSubtitle, deleteSubtitle, pushUndo, undo, redo
- [x] Araç çubuğu + export (SRT, VTT, TXT) — toolbar (arama, CPS/satır filtre, undo/redo), bottomBar (kaydet, yükle, offset, export dropdown), export.js
- [x] Playhead senkronizasyonu — 500ms polling, otomatik vurgulama + scroll, çift tıklama ile playhead atlama. NOT: sequence.getPlayerPosition() ve setPlayerPosition() UXP'de mevcut olmayabilir — API yoksa sync otomatik devre dışı kalır

### ✅ Faz 4 — Stil ve Kişiselleştirme (Tamamlandı)
- [x] Ayarlar paneli (⚙ butonu → overlay panel) — font, boyut, renk, pozisyon, opaklık
- [x] Font ayarları: ailesi (dropdown), boyut (12-72px slider), B/I/U toggle butonlar
- [x] Renk ayarları: metin rengi (6 preset + custom input), arka plan rengi (4 preset + custom), opaklık slider (0-100%)
- [x] Pozisyon toggle: Alt | Orta | Üst (3 butonlu)
- [x] Hazır şablonlar: YouTube Standart, TikTok/Reels, Sinema, Netflix (tıklanabilir kartlar)
- [x] Özel şablon kaydet/yükle: JSON olarak altyazi_sablonlar/ klasörüne (max 10)
- [x] Stil otomatik kayıt: .style.json dosyası SRT'nin yanına kaydedilir
- NOT: Stiller henüz timeline'a uygulanmıyor — .style.json olarak saklanıyor. İleride Caption track API veya MOGRT entegrasyonu ile uygulanacak

### ✅ Faz 4.5 — Genel Polish ve Performans (Tamamlandı)
- [x] Tüm buton event listener'ları bağlandığı doğrulandı (initEditArea)
- [x] Edge case handling: boş liste, tek blok silme, son blokta birleştirme uyarıları
- [x] Kaydedilmemiş değişiklik varken sayfa geçişinde onay dialogu
- [x] Kullanıcı dostu toast mesaj sistemi (showEditorMessage — info/warning/error)
- [x] Try/catch ile hata yakalama ve Türkçe mesaj gösterimi (saveSRT, loadSRT, handleExport)
- [x] Console.debug/log temizliği — sadece console.error/warn kaldı
- [x] Virtual scroll: 100+ altyazılı listelerde sadece görünen kartlar render edilir
- [x] documentFragment kullanımı ile DOM batch render optimizasyonu
- [x] Scroll pozisyonu koruması ve requestAnimationFrame throttling

### ⏳ Faz 5 — Animasyon (Araştırma Aşaması)
Kelime kelime animasyon için potansiyel yaklaşımlar:
1. **MOGRT (Motion Graphics Template):** Premiere Pro'nun Essential Graphics paneli ile entegrasyon. Her altyazı bloğu için parametreli MOGRT oluştur. Avantaj: Native Premiere render. Dezavantaj: UXP'den MOGRT oluşturma API'si sınırlı.
2. **ASS (Advanced SubStation Alpha) formatı:** SRT yerine ASS export. Animasyon bilgisi dosyada embedded. Avantaj: Zengin stil/animasyon desteği. Dezavantaj: Premiere Pro native desteklemiyor, harici dönüştürücü gerekir.
3. **Essential Graphics API:** UXP üzerinden Essential Graphics parametrelerini set etme. Araştırılacak: ppro.Project'ten graphics template'e erişim var mı?
4. **Fusion Title Templates (DaVinci yaklaşımı):** İlham kaynağı — DaVinci Resolve 20'nin animated subtitle sistemi.

### ⏳ Faz 6 — Fine-Tuning (Uzun Vadeli)
- LoRA fine-tuning (rank 32/64, alpha 64/128)
- Pseudo-labeling pipeline
- whisper.cpp GGML dönüşümü
- Zemberek NLP entegrasyonu

## Geliştirme kuralları
- UXP eklenti kodu: JavaScript ES6, HTML, CSS
- Tüm metin içeriği UTF-8 (Türkçe karakter desteği)
- Hata mesajları Türkçe olsun
- SRT dosyaları UTF-8 BOM'suz olmalı
- Her değişiklik sonrası test et
- Değişiklik yapmadan önce ilgili dosyayı oku ve anla
- srt.js değişikliklerinde: aynı video ile önceki vs yeni SRT karşılaştırması yap

## Açık sorunlar
| Sorun | Durum | Not |
|-------|-------|-----|
| Sunucu manuel başlatılıyor | Çözümsüz | shell.openPath UXP'de çalışmıyor |
| SRT timeline'a manuel ekleniyor | Çözümsüz | Caption track API yok (Adobe) |
| Birkaç kelime bölünmesi | Kısmen çözüldü | "yo ğurt" gibi nadir vakalar |

## Hata Düzeltmeleri (v1.1)
- [x] srt.js: enforceLineLimit() metin kaybı düzeltildi — artık metni kesmiyor
- [x] editor.js: Undo debounce eklendi — 500ms sessizlikten sonra tek undo kaydı
- [x] editor.js: Virtual scroll seçim kaybı düzeltildi — seçili kart her zaman render edilir
- [x] srt.js: Orphaned JSDoc düzeltildi — generateAdobeTranscriptJSON yorumu doğru yere taşındı
- [x] srt.js: extractWords zamanlama sızıntısı düzeltildi — kelimeler segment sınırını aşmaz
- [x] index.js: handleGenerate async yarış durumu düzeltildi — loadSRT await ediliyor
- [x] editor.js: Klavye kısayolları eklendi (Ctrl+Z/Y/S, ↑↓, Delete)
- [x] editor.js: mergeSubtitle CPS hesabı düzeltildi — gap çıkarılıyor
- [x] editor.js: Kaydedilmemiş değişiklik göstergesi eklendi (Kaydet butonunda turuncu nokta)
- [x] manifest.json: minVersion 25.1.0 → 25.6.0

## Araştırma Referansları
- `docs/Segmentasyon_Arastirma_Referans.md` — İki Deep Research raporunun sentezi
- `docs/srt_v2_yeniden_yazim_plani.md` — srt.js v2 detaylı teknik plan
- `docs/Faz3_Duzenleme_Paneli_Plan.md` — Faz 3 düzenleme paneli detaylı plan
- Netflix Türkçe TTSG: https://partnerhelp.netflixstudios.com/hc/en-us/articles/215342858
- AVTpro Türkçe: https://avtpro.ooona.net/wp-content/uploads/2023/06/AVTpro_StyleGuide_Tr.pdf
- Polat et al. 2024 (LoRA Türkçe): https://www.mdpi.com/2079-9292/13/21/4227
