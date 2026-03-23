# TürkçeAltyazı — Kapsamlı Kod İncelemesi ve UI/UX İyileştirme Raporu

> Tarih: 23 Mart 2026
> Kapsam: Tüm proje dosyaları (uxp-plugin/ + companion-app/ + docs/)
> İnceleme Derinliği: Satır satır

---

## BÖLÜM 1: KRİTİK HATALAR (Acil Düzeltilmeli)

### 🔴 HATA 1: `enforceLineLimit()` — Metin Kaybı

**Dosya:** `srt.js`, satır ~367
**Sorun:** Fonksiyon 45 karakteri aşan satırı en yakın boşluktan kesiyor ama KALAN METNİ SİLİYOR.

```javascript
function enforceLineLimit(line) {
  if (!line || line.length <= SRT_CONFIG.maxSoftCPL) return line;
  let breakPos = line.lastIndexOf(' ', SRT_CONFIG.maxSoftCPL);
  if (breakPos <= 0) return line;
  return line.substring(0, breakPos); // ← SORUN: breakPos'tan sonrası kaybolur!
}
```

**Etki:** Uzun satırlarda kelimelerin sessizce kaybolması. Kullanıcı fark etmeyebilir.
**Çözüm:** Fonksiyon sadece `splitIntoLines` içinden çağrılıyor, orada da her iki satıra uygulanıyor. Kesilmiş kısım hiçbir yerde kullanılmıyor. Bu fonksiyon ya kaldırılmalı ya da satır kırma mantığına entegre edilmeli.

---

### 🔴 HATA 2: Undo Stack Taşması — Her Tuş Vuruşu Ayrı Undo

**Dosya:** `editor.js`, `updateText()` fonksiyonu
**Sorun:** `editText` textarea'sının `input` event'ine bağlı. CTRL, A, B, C, D... 5 harf = 5 ayrı undo kaydı.

```javascript
// editor.js
const editText = document.getElementById('editText');
if (editText) {
  editText.addEventListener('input', updateText); // ← Her keystroke'da çağrılır
}
```

`updateText()` içinde:
```javascript
pushUndo({ type: 'edit_text', data: { index: index, text: oldText } });
// ← Her karakter için pushUndo çağrılıyor!
```

**Etki:** 50 adımlık undo stack 50 karakter yazmakla doluyor. Gerçek işlemler (böl, birleştir) stack'ten düşüyor.
**Çözüm:** Debounce mekanizması ekle — 500ms boyunca yeni keystroke gelmezse tek bir undo kaydı oluştur.

```javascript
// ÖNERİLEN ÇÖZÜM:
let _textUndoTimer = null;
let _textUndoSnapshot = null;

function updateText() {
  const index = editorState.selectedIndex;
  if (index < 0) return;
  const editText = document.getElementById('editText');
  if (!editText) return;

  // İlk değişiklikte snapshot al
  if (!_textUndoSnapshot) {
    _textUndoSnapshot = editorState.subtitles[index].text;
  }

  editorState.subtitles[index].text = editText.value;
  editorState.isModified = true;
  refreshEditIndicators();
  updateCard(index);

  // Debounce: 500ms sonra tek undo kaydı oluştur
  if (_textUndoTimer) clearTimeout(_textUndoTimer);
  _textUndoTimer = setTimeout(() => {
    if (_textUndoSnapshot !== null && _textUndoSnapshot !== editText.value) {
      pushUndo({ type: 'edit_text', data: { index, text: _textUndoSnapshot } });
    }
    _textUndoSnapshot = null;
    _textUndoTimer = null;
  }, 500);
}
```

---

### 🔴 HATA 3: Virtual Scroll + Seçim Çakışması

**Dosya:** `editor.js`
**Sorun:** Virtual scroll aktifken (100+ altyazı), seçili kart viewport dışına scroll edilirse DOM'dan kaldırılır. `selectSubtitle()` kartı bulamaz → seçim görsel olarak kaybolur. Ayrıca `updateCard()` da sessizce başarısız olur.

**Etki:** Büyük dosyalarda (100+ blok) düzenleme yapıldığında seçim kaybolur.
**Çözüm:** Virtual scroll render fonksiyonunda seçili indeksi her zaman render aralığına dahil et:

```javascript
// renderVirtualList içinde:
const selectedIdx = editorState.selectedIndex;
// Eğer seçili kart render aralığının dışındaysa, aralığı genişlet
if (selectedIdx >= 0) {
  const selectedFilteredIdx = filtered.indexOf(selectedIdx);
  if (selectedFilteredIdx >= 0) {
    if (selectedFilteredIdx < renderStart) renderStart = selectedFilteredIdx;
    if (selectedFilteredIdx >= renderEnd) renderEnd = selectedFilteredIdx + 1;
  }
}
```

---

### 🔴 HATA 4: Orphaned JSDoc — `generateAdobeTranscriptJSON`

**Dosya:** `srt.js`, satır ~420 civarı
**Sorun:** JSDoc yorumu fonksiyonun hemen önünde değil, araya Faz 3 bölüm yorumu girmiş:

```javascript
/**
 * whisper-server verbose_json çıktısını Adobe Transcript JSON formatına çevirir.
 * @param {Array} segments - whisper segments dizisi
 * @returns {string} Adobe transcript JSON string
 */
// ─── SRT Parse / Write (Faz 3) ──────────────────────────────────────────────
function parseTimestamp(ts) { ... }  // ← JSDoc bu fonksiyona değil!
```

Gerçek `generateAdobeTranscriptJSON` fonksiyonu dosyanın en sonunda.
**Etki:** IDE'lerde yanlış tip bilgisi, bakım zorluğu.
**Çözüm:** JSDoc'u `generateAdobeTranscriptJSON` fonksiyonunun hemen önüne taşı.

---

## BÖLÜM 2: ORTA SEVİYE HATALAR

### 🟡 HATA 5: `extractWords` Zamanlama Sızıntısı

**Dosya:** `srt.js`, `extractWords()` fonksiyonu
**Sorun:** `effectiveDuration = Math.max(segDuration, minTotalDuration)` hesaplaması, kelime sayısı çoksa segment sınırının ötesine taşabilir:

```javascript
const effectiveDuration = Math.max(segDuration, minTotalDuration);
// minTotalDuration = rawWords.length * 0.1
// Eğer 20 kelime + 1sn segment → minTotalDuration = 2sn > segDuration = 1sn
// → Kelime end zamanları segment sonunun 1sn ötesine taşar
```

**Etki:** Bazı altyazı bloklarının zamanlaması bir sonraki segmentle örtüşebilir.
**Çözüm:** `end` değerini `Math.min(wEnd, segEnd)` ile sınırla ve kelime sürelerini segment içine sıkıştır.

---

### 🟡 HATA 6: Sayfa Geçişinde Async Yarış Durumu

**Dosya:** `index.js`, `handleGenerate()` sonrası
**Sorun:**
```javascript
setTimeout(() => {
  hideProgress();
  showResult(...);
  showPage('editor');
  loadSRT(lastSrtPath);  // ← async ama await yok!
}, 800);
```

`loadSRT` async fonksiyon ama await edilmiyor. Sayfa gösterilir, render başlar, SRT henüz yüklenmemiş olabilir.
**Çözüm:** `setTimeout` callback'ini async yapıp `await loadSRT(lastSrtPath)` kullan.

---

### 🟡 HATA 7: Klavye Kısayolları Eksik

**Dosya:** `editor.js`
**Sorun:** Hiçbir klavye kısayolu yok:
- Ctrl+Z → undo (yok)
- Ctrl+Y / Ctrl+Shift+Z → redo (yok)
- Ctrl+S → kaydet (yok)
- Delete → seçili altyazıyı sil (yok)
- ↑/↓ → önceki/sonraki altyazı (yok)

**Etki:** Profesyonel iş akışında ciddi verimlilik kaybı.
**Çözüm:**
```javascript
document.addEventListener('keydown', (e) => {
  // Textarea aktifken metin kısayollarını engelleme
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveSRT();
    }
    return;
  }

  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveSRT(); }
  if (e.key === 'ArrowUp') { navigateSubtitle(-1); }
  if (e.key === 'ArrowDown') { navigateSubtitle(1); }
});
```

---

### 🟡 HATA 8: `mergeSubtitle` Süre Hesabı Yanıltıcı

**Dosya:** `editor.js`, `mergeSubtitle()`
**Sorun:** `mergedDuration = sub2.endTime - sub1.startTime` — iki blok arası gap'i dahil ediyor. Gerçek okuma süresi daha kısa.

**Etki:** CPS uyarısı gösterilmesi gereken birleştirmelerde "OK" gösteriyor.
**Çözüm:** `mergedDuration = (sub1.endTime - sub1.startTime) + (sub2.endTime - sub2.startTime)` veya gap'i çıkar.

---

### 🟡 HATA 9: `splitIntoLines` Sonsuz Döngü Riski

**Dosya:** `srt.js`, `splitIntoLines()`
**Sorun:** 45 karakteri aşan tek bir kelime (URL, uzun bileşik kelime) durumunda:
- İlk dal: `findBestLineBreak` tek kelime → `line2 = ''`
- İkinci dal: `text.lastIndexOf(' ', mid)` → -1 veya 0
- `breakPos <= 0` → `enforceLineLimit(text)` → metin kaybolabilir

**Etki:** Nadir ama URL'ler veya çok uzun Türkçe bileşik kelimeler sorun yaratır.

---

## BÖLÜM 3: KOZMETİK / KÜÇÜK SORUNLAR

### 🟢 SORUN 10: Kaydedilmemiş Değişiklik Göstergesi Yok
`editorState.isModified = true` set ediliyor ama UI'da hiçbir görsel ipucu yok. Başlıkta "*" veya kaydet butonunda renk değişikliği olmalı.

### 🟢 SORUN 11: Altyazı Sayısı Gösterilmiyor
Araç çubuğunda toplam altyazı sayısı yok. "154 altyazı" veya filtre aktifken "12/154" gibi bir gösterge olmalı.

### 🟢 SORUN 12: Export Dosya Yolu Bildirilmiyor
Export sonrası "VTT dosyası kaydedildi" diyor ama nereye kaydedildiğini söylemiyor.

### 🟢 SORUN 13: `confirm()` UXP Uyumluluğu
UXP ortamında `window.confirm()` destekleniyor ama native görünmüyor. Özel bir modal dialog daha tutarlı olur.

### 🟢 SORUN 14: `console.warn` Kalıntıları
CLAUDE.md "sadece console.error/warn kaldı" diyor ama `console.warn` production'da da gereksiz. Bazıları bilgilendirici ama çoğu kaldırılabilir.

### 🟢 SORUN 15: `manifest.json` `minVersion` Düşük
`"minVersion": "25.1.0"` ama UXP API'lerinin bazıları (özellikle Transcript API) daha yeni sürümlerde eklendi. `25.6.0` olmalı.

---

## BÖLÜM 4: UI/UX DERİN ANALİZ VE BEYİN FIRTINASI

### Mevcut Durum Değerlendirmesi

Şu anki UI, fonksiyonel olarak iyi çalışıyor ama **"geliştirici aracı"** hissi veriyor, **"profesyonel ürün"** hissi vermiyor. Premiere Pro'nun koyu temasıyla uyumlu olmaya çalışıyor ama bazı şeyler eksik:

1. **Tipografi monoton** — Her yerde aynı font, aynı ağırlık
2. **Renk paleti sınırlı** — Sadece yeşil/sarı/kırmızı durumsal renkler var, marka rengi yok
3. **Mikro-etkileşimler yok** — Butonlara tıklama, kart seçme, sayfa geçişi hepsi anında
4. **Bilgi hiyerarşisi düz** — Her şey aynı görsel ağırlıkta
5. **Boş durumlar sade** — "Altyazı bulunamadı" düz metin, hiçbir görsel yok

---

### 🎨 UI/UX İYİLEŞTİRME ÖNERİLERİ

#### A. Sayfa 1 (Oluşturma) — İlk İzlenim

**A1. Hero Animasyonu:**
Eklenti ilk açıldığında kısa bir "merhaba" animasyonu — logo/isim fade-in, durum noktası pulse. 300ms, tek seferlik.

**A2. Sunucu Durum Kartı Yeniden Tasarım:**
Şu anki dot + "Bağlı" yerine:
```
┌─────────────────────────────┐
│  ◉ Sunucu Aktif             │
│  large-v3 · Core ML · 8787  │
│  ▸ Son işlem: 2dk önce       │
└─────────────────────────────┘
```
Bağlı değilken kart kırmızı-turuncu gradient border ile dikkat çeker.

**A3. Progress Animasyonu İyileştirmesi:**
Düz progress bar yerine:
- "Ses dosyası okunuyor..." → dalga formu animasyonu (pulse)
- "Transkripsiyon yapılıyor..." → ses dalgası ikonu dönüyor
- "SRT oluşturuluyor..." → satır satır beliren metin efekti
Her adımın kendi ikonu ve mikro-animasyonu olsun.

**A4. Sonuç Kartı Zenginleştirme:**
```
┌──────────────────────────────────────┐
│  ✓ Altyazı Oluşturuldu              │
│                                      │
│  ┌──────┐  ┌──────┐  ┌──────┐      │
│  │ 154  │  │ 8:30 │  │ 16.2 │      │
│  │ blok │  │ süre │  │ ort. │      │
│  │      │  │      │  │ CPS  │      │
│  └──────┘  └──────┘  └──────┘      │
│                                      │
│  ⚠ 12 blokta CPS>20 uyarısı        │
│                                      │
│  [Düzenle →]                         │
└──────────────────────────────────────┘
```
3 mini metrik kartı yan yana, CPS uyarısı varsa sarı badge.

---

#### B. Sayfa 2 (Düzenleme) — Ana Çalışma Alanı

**B1. Altyazı Kartları Yeniden Tasarım:**

Şu anki düz kartlar yerine daha bilgi yoğun ama temiz kartlar:

```
┌─ #12 ──────────────────────────────────┐
│ 00:01:23,450 → 00:01:25,890    2.44s  │
│                                        │
│ Bir Pringles olmuş 15 lira.           │
│                                        │
│ ●16.8 CPS        27/42  ██████████░░ │
└────────────────────────────────────────┘
```

Yenilikler:
- **CPS çubuğu (mini progress bar):** Sayıdan daha sezgisel. Yeşilden kırmızıya gradient.
- **Süre göstergesi:** Sağ üstte, zamanlama satırının yanında
- **Hover efekti:** Kart hafifçe büyüyor (transform: scale(1.01)), gölge artıyor
- **Seçili kart:** Sol kenarda 3px mavi çizgi yerine tam border + hafif glow efekti

**B2. Düzenleme Alanı — Daha İnteraktif:**

Mevcut timing butonları (◄ ►) çok küçük ve anlaşılmaz. Önerilen:

```
┌─ Metin Düzenle ─────────────────────────┐
│ Bir Pringles olmuş 15 lira.            │
│ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁ │
│ 27/42 karakter · 1 satır               │
└─────────────────────────────────────────┘

┌─ Zamanlama ──────────────────────────────┐
│                                          │
│  Başlangıç         Bitiş         Süre   │
│  [-] 01:23,450 [+] [-] 01:25,890 [+] 2.44s │
│                                          │
│  CPS: 16.8  ●●●●●●●●○○  OK             │
│                                          │
└──────────────────────────────────────────┘

┌─ İşlemler ───────────────────────────────┐
│  [✂ Böl]  [🔗 Birleştir]  [🗑 Sil]     │
└──────────────────────────────────────────┘
```

- **Zamanlama butonları büyütülmüş:** [-] ve [+] yerine "◀ 100ms" ve "100ms ▶" yazısıyla
- **CPS çubuğu büyük:** 10 dot göstergesi — anlık durum tespiti
- **Karakter sayacı metin altında:** Textarea'nın hemen altında, canlı güncellenen

**B3. Araç Çubuğu — Badge'ler ve Durum:**

```
[🔍 Ara...          ] [⚠ CPS>20 (12)] [📏 >42 (3)] │ [↩] [↪] │ 154 altyazı
```

- Filtre butonlarında **eşleşme sayısı** badge olarak
- Sağ kenarda **toplam altyazı sayısı**
- Undo/redo butonları: stack boşken disabled + soluk

**B4. Alt Araç Çubuğu — Kaydetme Durumu:**

```
[💾 Kaydet ●] [📥 Yükle] [⏱ Offset] │ [📤 Export ▼]
```

- Kaydet butonunun yanında **turuncu nokta** → kaydedilmemiş değişiklik var
- Kaydedildiğinde nokta yeşile döner, 2sn sonra kaybolur

**B5. Waveform Mini-Preview (İleri Seviye):**

Düzenleme alanının üstünde, seçili altyazının zaman aralığına karşılık gelen basit bir dalga formu göstergesi. Bu Premiere Pro'nun timeline'ından bağımsız, sadece görsel ipucu. Whisper'dan gelen segment bilgileriyle oluşturulabilir (ses yok, sadece VAD segment sınırları).

---

#### C. Ayarlar Paneli — Tam Sayfa Overlay Sorunu

**C1. Slide Panel yerine Dropdown/Popover:**
Tam sayfa overlay yerine, ⚙ butonuna tıklayınca sağdan %60 genişliğinde slide-in panel. Altyazı listesi solda görünmeye devam eder.

**C2. Canlı Önizleme:**
Ayarlar panelinin en üstünde küçük bir önizleme kutusu:
```
┌─────────────────────────────────┐
│         ÖNİZLEME                │
│   ┌───────────────────────┐     │
│   │ Örnek altyazı metni   │     │
│   │ İkinci satır           │     │
│   └───────────────────────┘     │
│                                 │
│   YouTube Standart · Arial 24px │
└─────────────────────────────────┘
```
Font, renk, boyut değiştikçe anında güncellenir.

---

#### D. Genel Tasarım İyileştirmeleri

**D1. Mikro Animasyonlar:**
- Kart seçimi: 150ms ease-out border renk geçişi
- Sayfa geçişi: 200ms slide (soldan/sağdan)
- Toast mesajları: Yukarıdan aşağı slide-in + fade-out
- Buton tıklama: Kısa scale(0.97) → scale(1) bounce

**D2. Boş Durum Ekranları:**
"Altyazı bulunamadı" yerine:
```
     📝
  Henüz altyazı yok
  
  ← Geri dönüp "Altyazı Oluştur"a basın
  veya mevcut bir SRT dosyası yükleyin
```

Arama sonucu boşsa:
```
     🔍
  "xxx" bulunamadı
  154 altyazı arandı
```

**D3. Renk Sistemi Genişletme:**
Mevcut:
- accent: #4A9FED (mavi)
- success: #2D9D78 (yeşil)
- warning: #E68D3B (turuncu)
- error: #D7373F (kırmızı)

Eklenecek:
- accent-soft: #4A9FED20 (mavi %12 opaklık — vurgulama arka planı)
- surface-elevated: #333333 (kartlar için, bg-card'dan daha açık)
- surface-sunken: #1A1A1A (input'lar için, bg-panel'den daha koyu)
- text-accent: #7BBFFF (link/vurgu metni)

**D4. Tipografi Hiyerarşisi:**
```css
/* Başlık: Kalın, büyük */
.text-heading { font-size: 14px; font-weight: 700; letter-spacing: -0.2px; }

/* Alt başlık: Orta */
.text-subheading { font-size: 12px; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase; }

/* Gövde: Normal */
.text-body { font-size: 12px; font-weight: 400; line-height: 1.5; }

/* Etiket: Küçük, soluk */
.text-label { font-size: 10px; font-weight: 500; color: var(--text-secondary); letter-spacing: 0.5px; }

/* Monospace: Zamanlamalar */
.text-mono { font-family: "SF Mono", "Source Code Pro", Menlo, monospace; font-size: 11px; font-variant-numeric: tabular-nums; }
```

**D5. Kart Renk Kodlaması Zenginleştirme:**
Sadece sol kenarda border yerine, kartın tamamına hafif gradient uygula:

```css
.subtitle-card.has-error {
  border-left: 3px solid var(--error);
  background: linear-gradient(90deg, rgba(215,55,63,0.06) 0%, var(--bg-card) 30%);
}

.subtitle-card.has-warning {
  border-left: 3px solid var(--warning);
  background: linear-gradient(90deg, rgba(230,141,59,0.06) 0%, var(--bg-card) 30%);
}
```

---

## BÖLÜM 5: COMPANION APP İYİLEŞTİRMELERİ

### 🟡 start-server.sh — Sağlık Kontrolü Eksik

Sunucu başlatıldıktan sonra gerçekten hazır olup olmadığı kontrol edilmiyor. Model yüklenmesi 5-10 saniye sürebilir.

```bash
# ÖNERİ: Başlatma sonrası health check bekle
echo "Model yükleniyor..."
for i in $(seq 1 30); do
  if curl -s http://localhost:$PORT/ > /dev/null 2>&1; then
    echo "whisper-server hazır! (${i}s)"
    exit 0
  fi
  sleep 1
done
echo "Uyarı: whisper-server 30 saniye içinde hazır olmadı."
```

### 🟡 stop-server.sh — Graceful Shutdown

`kill` yerine `kill -TERM` kullanarak graceful shutdown sağlanmalı. Model bellek temizliği için önemli.

---

## BÖLÜM 6: CLAUDE CODE PROMPT (Hataları Düzeltme + UI/UX Faz 1)

```
Önce şu dokümanları oku:
1. CLAUDE.md
2. docs/Faz3_Duzenleme_Paneli_Plan.md

Şimdi aşağıdaki kritik hataları düzelt ve UI/UX iyileştirmelerini uygula.

### KRİTİK HATA DÜZELTMELERİ:

1. srt.js — enforceLineLimit() metin kaybı:
enforceLineLimit fonksiyonunu düzelt. Eğer satır maxSoftCPL'yi aşıyorsa, metni silmek yerine uyarı logla ve olduğu gibi döndür. splitIntoLines içindeki mantık zaten 2 satıra bölmeyi deniyor.

2. editor.js — Undo debounce:
updateText fonksiyonuna debounce mekanizması ekle. Her keystroke yerine 500ms sessizlikten sonra tek bir undo kaydı oluştur. _textUndoTimer ve _textUndoSnapshot değişkenleri kullan. Mevcut pushUndo çağrısını kaldır, yerine debounced versiyon koy.

3. editor.js — Virtual scroll + seçim:
renderVirtualList fonksiyonunda, seçili altyazının (editorState.selectedIndex) her zaman render aralığında olmasını sağla. renderStart/renderEnd hesaplandıktan sonra, selectedIndex filtered listesindeki pozisyonunu kontrol et ve aralığa dahil et.

4. srt.js — Orphaned JSDoc:
generateAdobeTranscriptJSON fonksiyonunun JSDoc yorumunu doğru yere (fonksiyonun hemen önüne) taşı. "SRT Parse / Write (Faz 3)" bölüm yorumunun üstündeki yetim JSDoc'u kaldır.

5. editor.js — Klavye kısayolları:
page-editor aktifken şu kısayolları ekle:
- Ctrl+Z → undo() (textarea dışındayken)
- Ctrl+Y → redo() (textarea dışındayken)
- Ctrl+S → saveSRT() (her zaman, textarea içindeyken bile)
- ArrowUp/ArrowDown → önceki/sonraki altyazıya geç (textarea dışındayken)
document.addEventListener('keydown', ...) ile, sadece page-editor görünürken aktif olsun.

6. index.js — Async yarış durumu:
handleGenerate içindeki setTimeout callback'ini async yapıp loadSRT'yi await et.

### UI/UX İYİLEŞTİRMELERİ:

7. styles.css — Kaydedilmemiş değişiklik göstergesi:
btnSaveSRT butonuna .has-changes class'ı ekle (turuncu nokta pseudo-element). editor.js'de isModified değiştiğinde class'ı toggle et.

8. styles.css — Altyazı sayısı göstergesi:
Araç çubuğuna (toolbar) bir span#subtitleCount ekle. renderList sonrası güncelle: "154 altyazı" veya filtre aktifken "12/154".

9. styles.css — Filtre badge'leri:
btnFilterCPS ve btnFilterLine butonlarına eşleşme sayısını gösteren küçük badge ekle. renderList içinde hesapla.

10. styles.css — Kart gradient arka planları:
has-error ve has-warning kartlarına hafif gradient arka plan ekle (sol kenarda renk, sağa doğru soluyor).

11. styles.css — Hover animasyonları:
subtitle-card hover'ına transform: translateX(2px) + box-shadow ekle. transition: all 0.15s ease.

12. editor.js — mergeSubtitle CPS hesabını düzelt:
mergedDuration hesabında gap'i çıkar: mergedDuration = (sub1.endTime - sub1.startTime) + (sub2.endTime - sub2.startTime)

13. manifest.json — minVersion güncelle:
"minVersion": "25.1.0" → "25.6.0"

14. CLAUDE.md — Bu değişiklikleri belgele.
```

---

## ÖZET — Öncelik Matrisi

| Öncelik | Sayı | Kategori |
|---------|------|----------|
| 🔴 Kritik | 4 | enforceLineLimit, undo flood, virtual scroll, orphaned JSDoc |
| 🟡 Orta | 5 | extractWords timing, async race, klavye kısayolları, merge CPS, splitIntoLines edge case |
| 🟢 Kozmetik | 6 | Kaydet göstergesi, altyazı sayısı, export yolu, confirm UXP, console.warn, manifest version |
| 🎨 UI/UX | 15+ | Kart tasarımı, animasyonlar, badge'ler, boş durumlar, renk sistemi, tipografi, önizleme |

**Tavsiye:** Önce 🔴 kritik hataları düzelt (1 Claude Code promptu), sonra UI/UX iyileştirmelerini ayrı bir prompt olarak ver.
