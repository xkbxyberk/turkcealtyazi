# Faz 3 — Altyazı Düzenleme Paneli: Detaylı Planlama Dokümanı

> TürkçeAltyazı eklentisi için profesyonel altyazı düzenleme paneli.
> Rakip analizi: Cutback, Brevidy, AutoCut, FireCut, DaVinci Resolve 20
> Fark: Tamamen lokal, internet gerektirmez, sınırsız kullanım, veri gizliliği %100

---

## Panel Mimarisi — 4 Ana Bölüm

```
┌─────────────────────────────────────────────────┐
│ HEADER BAR (40px)                               │
│ [← Geri] TürkçeAltyazı ─ Düzenle  [⚙ Ayarlar] │
├─────────────────────────────────────────────────┤
│ ARAÇ ÇUBUĞU (36px)                             │
│ [🔍 Ara] [⚠ CPS>20] [Geri Al] [Yinele] [Kaydet]│
├─────────────────────────────────────────────────┤
│                                                 │
│ ALTYAZI LİSTESİ (scrollable, ~60% panel yüksekl)│
│                                                 │
│ ┌─ #1 ─────────────────────────────────────── ┐ │
│ │ 00:00:00,130 → 00:00:01,690  ●17.2 CPS     │ │
│ │ Bir Pringles olmuş 15 lira.          27/42  │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─ #2 ─────────────────────────────────────── ┐ │
│ │ 00:00:01,790 → 00:00:03,110  ●12.8 CPS     │ │
│ │ Pringles ya cips ya.                 20/42  │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─ #3 ⚠ ──────────────────────────────────── ┐ │
│ │ 00:00:03,210 → 00:00:05,790  ●22.1 CPS     │ │
│ │ Lan bu ülkenin yarısı Pringles.      43/42  │ │
│ │ En son camıza dönemindeydi.                 │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
├─────────────────────────────────────────────────┤
│ DÜZENLEME ALANI (expandable)                    │
│                                                 │
│ ┌─ Metin ──────────────────────────────────── ┐ │
│ │ Lan bu ülkenin yarısı Pringles.             │ │
│ │ En son camıza dönemindeydi.                 │ │
│ └─────────────────────────────────────────────┘ │
│                                                 │
│ Başlangıç: [00:00:03,210] [◄][►]  ±100ms      │
│ Bitiş:     [00:00:05,790] [◄][►]  ±100ms      │
│ Süre: 2.58s  CPS: 22.1 ⚠  Satır: 43/42 ⚠     │
│                                                 │
│ [✂ Böl] [🔗 Birleştir] [🗑 Sil]               │
│                                                 │
├─────────────────────────────────────────────────┤
│ ALT ARAÇ ÇUBUĞU (40px)                         │
│ [💾 SRT Kaydet] [📥 Yeniden Yükle] [⏱ Offset] │
│ [📤 Export ▼]                                   │
└─────────────────────────────────────────────────┘
```

---

## Bölüm A: Altyazı Listesi

### Görünüm
- Her blok bir "kart" olarak gösterilir
- Kart yüksekliği: tek satır ~36px, çift satır ~52px
- Sol kenarda sıra numarası (#1, #2...)
- Sağ üstte CPS badge (renk kodlu):
  - Yeşil dot (●): CPS ≤ 17 (OK)
  - Sarı dot (●): CPS 17-20 (Uyarı)
  - Kırmızı dot (●): CPS > 20 (Hata)
- Sağ altta karakter sayacı: "38/42"
  - Beyaz: ≤42
  - Sarı: 43-45
  - Kırmızı: >45
- Satır uzunluğu veya CPS aşımı varsa: kart sol kenarında turuncu/kırmızı border
- Aktif altyazı (playhead'in bulunduğu veya seçili): mavi border + hafif parlak arka plan

### Etkileşim
- **Tek tıklama:** Altyazıyı seçer → düzenleme alanında gösterir
- **Çift tıklama:** Playhead'i o altyazının başlangıcına atlar (Premiere Pro'da)
- **Scroll:** Smooth scrolling, altyazı listesi dikey kaydırılabilir
- **Playhead sync:** Video oynatılırken aktif altyazı otomatik ortaya scroll edilir
- **Drag & drop:** (Faz 3.5) Altyazı sırasını değiştirme

### Filtreler (Araç çubuğundaki butonlar)
- **🔍 Ara:** Metin arama — yazılan kelimeyi içeren altyazılar vurgulanır
- **⚠ CPS>20:** Sadece CPS>20 olan altyazıları göster (sorunlu blokları hızlı bulma)
- **📏 >42ch:** Sadece 42+ karakter satırı olan blokları göster

---

## Bölüm B: Düzenleme Alanı

### Metin Editörü
- Textarea (2-3 satır görünür)
- Canlı karakter sayacı: Her tuş vuruşunda güncellenir
- Canlı CPS hesaplama: Metin veya süre değişince anında güncellenir
- Satır kırma göstergesi: Her satırın uzunluğu ayrı gösterilir ("Satır 1: 38/42 | Satır 2: 31/42")
- Enter tuşu = satır kırma (\n) — max 2 satır, 3. satır engellenir
- Metin değiştiğinde kart anında güncellenir (two-way binding)

### Zamanlama Kontrolü
- Başlangıç/bitiş zamanı: Düzenlenebilir input (HH:MM:SS,mmm formatı)
- **◄ ► ok butonları:** Her tıklama ±100ms kaydırır
- **Shift + ok:** ±500ms kaydırır (hızlı ayar)
- **Süre göstergesi:** Otomatik hesaplanır (bitiş - başlangıç)
- **Önceki/sonraki ile çakışma kontrolü:** Zamanlama değiştirildiğinde örtüşme uyarısı

### Aksiyonlar
- **✂ Böl:** Metin imlecinin bulunduğu pozisyondan altyazıyı ikiye böler
  - Yeni bloğun başlangıcı: Orijinal sürenin ortası (kelime oranına göre)
  - Her iki blok da listede güncellenir
- **🔗 Birleştir:** Seçili altyazıyı bir sonrakiyle birleştirir
  - Metin birleşir, başlangıç=ilk blok, bitiş=ikinci blok
  - CPS kontrolü: Birleşim sonrası CPS>20 ise uyarı göster
- **🗑 Sil:** Altyazıyı listeden kaldırır
  - Onay sorar: "Bu altyazıyı silmek istediğinize emin misiniz?"

---

## Bölüm C: Araç Çubuğu

### Üst Araç Çubuğu
- **🔍 Ara:** Arama kutusu açılır/kapanır (toggle). Metin yazıldıkça canlı filtreleme
- **⚠ CPS>20:** Toggle buton — aktifken sadece sorunlu blokları gösterir
- **↩ Geri Al:** Son işlemi geri alır (undo)
- **↪ Yinele:** Geri alınan işlemi tekrar uygular (redo)
- **💾 Kaydet:** Değişiklikleri SRT dosyasına yazar

### Undo/Redo Sistemi
- Her metin düzenleme, zamanlama değişikliği, böl/birleştir/sil işlemi undo stack'e eklenir
- Max 50 adım geri alma
- Veri yapısı:
```javascript
const undoStack = []; // [{type, data, timestamp}, ...]
const redoStack = [];
// type: 'edit_text', 'edit_time', 'split', 'merge', 'delete'
// data: {index, before: {...}, after: {...}}
```

---

## Bölüm D: Alt Araç Çubuğu ve Export

### Butonlar
- **💾 SRT Kaydet:** Düzenlenmiş altyazıyı aynı dosyaya yazar (üzerine yazar)
- **📥 Yeniden Yükle:** Disk'teki SRT'yi tekrar okur (düzenlemeleri sıfırlar, onay sorar)
- **⏱ Offset:** Modal açılır — tüm altyazılara sabit milisaniye ekler/çıkarır
  - Input: ±milisaniye (örn: +500ms veya -200ms)
  - "Uygula" butonu tüm bloklara offset ekler
- **📤 Export ▼:** Dropdown menü:
  - SRT (SubRip) — varsayılan
  - VTT (WebVTT) — YouTube/web uyumlu
  - TXT (düz metin) — sadece metin, zamanlama olmadan

---

## Bölüm E: Playhead Senkronizasyonu

### Nasıl çalışır
- UXP API üzerinden Premiere Pro'nun playhead pozisyonunu dinler
- Aktif altyazı (playhead zamanına karşılık gelen) vurgulanır
- Otomatik scroll: Aktif altyazı panelin ortasına scroll edilir
- Polling interval: 500ms (çok sık = performans sorunu, çok yavaş = gecikme)

### Teknik Uygulama (UXP)
```javascript
// Playhead pozisyonu alma (UXP API)
const ppro = require('premierepro');

async function getPlayheadPosition() {
  const project = await ppro.Project.getActiveProject();
  const sequence = await project.getActiveSequence();
  // sequence.getPlayerPosition() → Ticks cinsinden
  const position = await sequence.getPlayerPosition();
  // Ticks → saniye dönüşümü (254016000000 ticks = 1 saniye @24fps)
  return ticksToSeconds(position);
}

// 500ms'de bir kontrol et
let syncInterval = null;
function startPlayheadSync() {
  syncInterval = setInterval(async () => {
    const pos = await getPlayheadPosition();
    highlightSubtitleAtTime(pos);
  }, 500);
}
```

---

## Bölüm F: Panel Navigasyonu (Çok Ekranlı Yapı)

Eklenti iki "sayfa" arasında geçiş yapar:

### Sayfa 1: Oluşturma (Mevcut UI)
- Sequence bilgisi
- Özel terimler kutusu (initial_prompt)
- "Altyazı Oluştur" butonu
- İlerleme çubuğu
- Sonuç kartı

### Sayfa 2: Düzenleme (Yeni — Faz 3)
- Altyazı listesi + düzenleme alanı + araçlar
- "← Geri" butonu ile Sayfa 1'e dönüş

### Geçiş Mantığı
- Altyazı oluşturma tamamlandığında otomatik olarak Sayfa 2'ye geçer
- Kullanıcı "← Geri" ile Sayfa 1'e dönebilir
- Mevcut bir SRT varsa, Sayfa 1'de "Düzenle" butonu ile Sayfa 2'ye gidebilir
- Sayfa değişimi: CSS display:none/block ile (DOM her zaman yüklü, hız için)

---

## Bölüm G: Stil ve Kişiselleştirme (Faz 3.5)

### Ayarlar Paneli (⚙ butonu ile açılır)
- **Font:** Sistem fontları listesi (dropdown)
- **Font boyutu:** 12-72px arası slider
- **Renk:** Metin rengi (color picker veya preset)
- **Arka plan:** Altyazı arka plan rengi + opaklık
- **Pozisyon:** Alt/üst/orta (3 butonlu toggle)
- **Hazır şablonlar:**
  - YouTube standart (beyaz, siyah kenarlık)
  - TikTok/Reels (kalın, renkli, animasyonlu)
  - Sinema (serif font, şeffaf arka plan)
  - Netflix (beyaz, yarı saydam siyah kutu)
  - Özel (kullanıcı kayıtlı)

### Şablon Kayıt/Yükleme
- Şablon = JSON objesi: {name, font, size, color, bgColor, bgOpacity, position}
- Premiere Pro proje dizinine "altyazi_sablonlar/" klasöründe saklanır
- Max 10 özel şablon

---

## Bölüm H: Kelime Kelime Animasyon (Faz 4 — İleri Seviye)

> NOT: Bu özellik Caption track API gerektirdiği için şu an UXP'de sınırlı.
> Alternatif: MOGRT şablon kullanımı veya Essential Graphics ile entegrasyon.

### Animasyon Türleri
- **Karaoke:** Kelime söylenirken vurgulanır (renk değişimi)
- **Pop-up:** Her kelime sırayla ekrana gelir (scale animasyon)
- **Typewriter:** Kelimeler soldan sağa yazılır
- **Fade:** Her kelime fade-in ile belirir

### Teknik Yaklaşım
- Premiere Pro'nun MOGRT (Motion Graphics Template) sistemini kullan
- Her altyazı bloğu için Essential Graphics parametreleri set et
- Word-level timestamps gerektirir — segment bazlı timestamps ile sınırlı
- Alternatif: SRT yerine ASS (Advanced SubStation Alpha) formatı export

---

## Veri Yapısı

### Bellekteki Altyazı Modeli
```javascript
// Her altyazı bloğu
const subtitleModel = {
  id: 'sub_001',           // Benzersiz ID
  index: 1,                // Sıra numarası
  startTime: 0.130,        // Saniye (float)
  endTime: 1.690,          // Saniye (float)
  text: 'Bir Pringles olmuş 15 lira.',
  // Hesaplanan değerler (getter)
  duration: 1.560,         // endTime - startTime
  charCount: 27,           // text.length (satır kırmaları dahil)
  lineCount: 1,            // text.split('\n').length
  maxLineLength: 27,       // max(her satırın uzunluğu)
  cps: 17.3,               // charCount / duration
  cpsStatus: 'warning',    // ok | warning | error
  lineStatus: 'ok',        // ok | warning (>42) | error (>45)
  // Düzenleme durumu
  isModified: false,       // Orijinalden farklı mı
  isSelected: false,       // Seçili mi
  isActive: false,         // Playhead bu bloktayken true
};

// Panel durumu
const editorState = {
  subtitles: [],           // subtitleModel dizisi
  selectedIndex: -1,       // Seçili altyazı indeksi
  searchQuery: '',         // Arama metni
  filterMode: 'all',       // all | cps_error | line_error
  undoStack: [],           // Undo geçmişi
  redoStack: [],           // Redo geçmişi
  isModified: false,       // Kaydedilmemiş değişiklik var mı
  srtFilePath: '',         // Mevcut SRT dosya yolu
  playheadPosition: 0,     // Son bilinen playhead pozisyonu (saniye)
  syncEnabled: true,       // Playhead sync açık mı
};
```

---

## Dosya Yapısı (Yeni/Güncellenen Dosyalar)

```
uxp-plugin/
├── index.html          ← GÜNCELLEME: 2 sayfa yapısı, düzenleme HTML
├── index.js            ← GÜNCELLEME: Sayfa geçişi, playhead sync
├── styles.css          ← GÜNCELLEME: Düzenleme paneli stilleri
├── api.js              ← DEĞİŞMEZ
├── srt.js              ← GÜNCELLEME: SRT parse/write fonksiyonları eklenir
├── editor.js           ← YENİ: Düzenleme paneli mantığı
│   ├── loadSRT()       — SRT dosyasını parse edip modele yükle
│   ├── saveSRT()       — Modelden SRT dosyasına yaz
│   ├── renderList()    — Altyazı listesini DOM'a render et
│   ├── selectSubtitle()— Altyazı seç ve düzenleme alanını güncelle
│   ├── updateText()    — Metin değişikliğini modele yaz
│   ├── updateTiming()  — Zamanlama değişikliğini modele yaz
│   ├── splitSubtitle() — Altyazıyı ikiye böl
│   ├── mergeSubtitle() — İki altyazıyı birleştir
│   ├── deleteSubtitle()— Altyazıyı sil
│   ├── applyOffset()   — Tüm zamanlamalara offset ekle
│   ├── undo() / redo() — Geri al / yinele
│   ├── search()        — Metin arama
│   ├── filterByCPS()   — CPS filtresi
│   └── startSync()     — Playhead senkronizasyonu başlat
└── export.js           ← YENİ: Export fonksiyonları
    ├── exportSRT()     — SRT formatı
    ├── exportVTT()     — WebVTT formatı
    └── exportTXT()     — Düz metin formatı
```

---

## Uygulama Sırası (Claude Code Promptları)

### Prompt 1: Temel Altyapı (Sayfa geçişi + SRT parse)
- index.html'e 2 sayfa yapısı ekle (display:none/block)
- srt.js'e parseSRT() ve writeSRT() fonksiyonları ekle
- Sayfa geçiş butonları ve mantığı

### Prompt 2: Altyazı Listesi (Render + Seçim)
- editor.js oluştur
- loadSRT() → renderList() → selectSubtitle() zinciri
- CPS/karakter renk kodlaması
- Tıklama ile seçim

### Prompt 3: Düzenleme Alanı (Metin + Zamanlama)
- Textarea ile inline metin düzenleme
- Zamanlama input'ları ve ±100ms butonları
- Canlı CPS/karakter sayacı
- Two-way binding (düzenleme ↔ liste)

### Prompt 4: Böl / Birleştir / Sil
- splitSubtitle() — imleç pozisyonundan bölme
- mergeSubtitle() — sonraki blokla birleştirme
- deleteSubtitle() — onaylı silme
- Undo/redo stack entegrasyonu

### Prompt 5: Araç Çubuğu + Export
- Arama (canlı filtreleme)
- CPS>20 filtresi
- Undo/redo butonları
- SRT kaydet, yeniden yükle
- Offset modal
- Export (SRT, VTT, TXT)

### Prompt 6: Playhead Senkronizasyonu
- getPlayheadPosition() UXP API
- 500ms polling ile aktif altyazı vurgulama
- Otomatik scroll
- Çift tıklama ile playhead atlama

### Prompt 7: Stil ve Şablonlar (Faz 3.5)
- Ayarlar paneli UI
- Font/boyut/renk seçiciler
- Hazır şablonlar (YouTube, TikTok, Netflix, Sinema)
- Şablon kayıt/yükleme

### Prompt 8: Animasyon Desteği (Faz 4)
- MOGRT entegrasyonu araştırması
- Kelime kelime animasyon şablonları
- Essential Graphics parametre kontrolü

---

## Metrik Hedefler

| Metrik | Hedef |
|--------|-------|
| Altyazı listesi render hızı | <100ms (500 blok için) |
| Metin düzenleme tepki süresi | <16ms (60fps) |
| Playhead sync gecikmesi | <500ms |
| SRT kaydetme süresi | <200ms |
| Undo/redo tepki süresi | <50ms |
| Max altyazı blok sayısı | 2000+ (uzun video desteği) |

---

## UXP Kısıtlamalar ve Çözümleri

| Kısıtlama | Çözüm |
|-----------|-------|
| localStorage yok | Verileri bellekte tut, SRT dosyasına yaz |
| Node.js yok | Pure JavaScript, UXP fetch API |
| Sınırlı CSS | Spectrum Web Components + custom CSS |
| Caption track API yok | SRT dosya bazlı çalışma |
| shell.openPath çalışmıyor | Kullanıcıya dosya yolunu göster |
| Büyük DOM performansı | Sanal scroll (virtual scrolling) — sadece görünen blokları render et |

---

## Zamanlama Tahmini

| Prompt | İçerik | Tahmini Süre |
|--------|--------|-------------|
| Prompt 1 | Sayfa geçişi + SRT parse | ~5 dk |
| Prompt 2 | Altyazı listesi | ~8 dk |
| Prompt 3 | Düzenleme alanı | ~8 dk |
| Prompt 4 | Böl/birleştir/sil + undo | ~10 dk |
| Prompt 5 | Araçlar + export | ~8 dk |
| Prompt 6 | Playhead sync | ~5 dk |
| Prompt 7 | Stil/şablonlar | ~10 dk |
| Prompt 8 | Animasyon (araştırma) | ~15 dk |
| **Toplam** | | **~69 dk** |

> Not: Rate limit nedeniyle promptlar arasında bekleme süreleri olabilir.
> Promptları günlere yayarak 2-3 prompt/gün şeklinde uygulamak en güvenli strateji.
