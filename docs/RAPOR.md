# TürkçeAltyazı — Proje Raporu

**Tarih:** 18 Mart 2026
**Proje:** Adobe Premiere Pro için Türkçe Otomatik Altyazı Eklentisi

---

## Genel Bakış

Adobe Premiere Pro için tamamen lokal çalışan, Türkçe otomatik altyazı oluşturan bir UXP eklentisi geliştirildi. Sistem iki bileşenden oluşuyor:

1. **Companion App** — whisper.cpp tabanlı HTTP sunucu (Apple Silicon optimizasyonlu)
2. **UXP Eklenti** — Premiere Pro içinde çalışan panel

---

## Bileşen 1: Companion App (whisper-server)

**Konum:** `companion-app/`

| Dosya | Açıklama |
|---|---|
| `whisper.cpp/` | Core ML + Metal GPU ile build edilmiş whisper.cpp |
| `start-server.sh` | Sunucuyu arka planda başlatır (port 8787, nohup) |
| `stop-server.sh` | PID veya port'tan sunucuyu durdurur |
| `*.command` | macOS Terminal wrapper'ları |

**Teknik detaylar:**
- **Model:** `ggml-large-v3` — Türkçe doğruluğu için turbo yerine tam model
- **Hızlandırma:** Core ML (Neural Engine) + Metal GPU — encode ~640ms
- **Endpoint:** `POST /inference` — multipart form (file, language=tr, response_format=verbose_json)
- **Ses dönüşümü:** `--convert` bayrağı ile FFmpeg otomatik WAV'a çevirir (mp4, mov, m4a vb. kabul eder)
- **Çakışma koruması:** `lsof -i :8787` ile port kontrolü, zaten çalışıyorsa tekrar başlatmaz

---

## Bileşen 2: UXP Eklenti

**Konum:** `uxp-plugin/`

### Dosya Yapısı

| Dosya | Satır | Açıklama |
|---|---|---|
| `manifest.json` | 52 | UXP v5 manifest — Premiere Pro 25.1+, lifecycle hook'ları, izinler |
| `index.html` | 55 | Panel HTML — Spectrum Web Components, sunucu yardım bölümü |
| `index.js` | 576 | Ana mantık — medya yolu bulma, transkripsiyon, SRT kayıt, Transcript API |
| `styles.css` | 110 | Spectrum uyumlu stiller, koyu tema, sunucu yardım bölümü |
| `api.js` | 44 | whisper-server HTTP iletişimi (fetch + FormData) |
| `srt.js` | 128 | SRT oluşturma + Adobe Transcript JSON dönüştürme |

### İş Akışı (Tek Tık)

```
[Altyazı Oluştur] butonuna bas
       │
       ▼
1. Medya yolu otomatik bulunur
   sequence → videoTrack → clip → getProjectItem()
   → ClipProjectItem.cast() → getMediaFilePath()
       │
       ▼
2. Dosya okunur ve whisper-server'a gönderilir
   HTTP POST localhost:8787/inference
   (FormData: file + language=tr + response_format=verbose_json)
       │
       ▼
3. SRT dosyası oluşturulur ve otomatik kaydedilir
   {proje dizini}/altyazilar/{sequence_adı}_altyazi.srt
   (dosya diyaloğu açılmaz)
       │
       ▼
4. Transcript API ile transkript clip'e eklenir
   importFromJSON() → createImportTextSegmentsAction()
   → lockedAccess + executeTransaction
       │
       ▼
5. SRT projeye import edilir
   project.importFiles([srtPath], true)
```

### UI Özellikleri

- **Sunucu durumu:** Yeşil/kırmızı nokta + 5 saniyede bir polling
- **Sunucu yoksa:** Başlatma talimatı + "Komutu Panoya Kopyala" butonu
- **Sunucu bağlandığında:** Talimat otomatik gizlenir
- **Aktif sequence:** Otomatik algılama (EventManager + polling)
- **İlerleme çubuğu:** Her adımda güncellenen progress bar
- **Sonuç mesajı:** Segment sayısı, süre, dosya yolu

---

## Çözülen Teknik Zorluklar

### 1. UXP Premiere Pro API Yapısı
**Sorun:** `ppro.app` yok, ExtendScript pattern'leri çalışmıyor.
**Çözüm:** `ppro.Project.getActiveProject()` → statik async sınıflar pattern'i. GitHub'daki `types.d.ts` referans alındı.

### 2. ProjectItem Cast Zorunluluğu (En kritik keşif)
**Sorun:** `getItems()` ve `getProjectItem()` base `ProjectItem` döndürüyor — `getMediaFilePath()` yok. `prototype.call()`, `Object.setPrototypeOf()`, `SourceMonitor` yaklaşımları başarısız.
**Çözüm:** Adobe'nin resmi dokümantasyonundan keşfedilen `ppro.ClipProjectItem.cast(item)` pattern'i. Cast sonrası tüm subclass metodları erişilebilir.

### 3. shell.openPath() Çalışmıyor
**Sorun:** UXP Premiere'de `uxp.shell` objesi boş — otomatik sunucu başlatma imkansız.
**Çözüm:** Manuel başlatma yaklaşımı — sunucu yokken Terminal komutu göster + clipboard'a kopyala butonu.

### 4. Caption Track API Yok
**Sorun:** SRT projeye import ediliyor ama timeline caption track'e programatik eklenemiyor.
**Çözüm:** `ppro.Transcript` API ile transkript doğrudan clip'e ekleniyor. Kullanıcı SRT'yi manuel sürükleyip bırakabiliyor.

### 5. SRT Dosya Diyaloğu
**Sorun:** Her seferinde "nereye kaydedilsin?" diyaloğu açılıyordu.
**Çözüm:** `project.path`'den proje dizini alınıp `altyazilar/` klasörüne otomatik kayıt. `folder.createFile()` ile diyaloğsuz yazma.

---

## Mevcut Kısıtlamalar

| Kısıt | Nedeni | Durum |
|---|---|---|
| Sunucu manuel başlatılıyor | `shell.openPath()` UXP'de çalışmıyor | Clipboard ile kolay başlatma |
| SRT timeline'a manuel ekleniyor | Caption track API henüz yok (Adobe doğruladı) | Transcript API ile clip'e ekleniyor |
| Tek konuşmacı desteği | whisper-server diarization desteklemiyor | İleride eklenebilir |

---

## Teknoloji Yığını

```
┌─────────────────────────────────────────┐
│  Premiere Pro 25.6+                     │
│  ┌───────────────────────────────────┐  │
│  │  UXP Eklenti (JavaScript ES6)    │  │
│  │  Spectrum Web Components          │  │
│  │  UXP Premiere Pro API             │  │
│  └──────────────┬────────────────────┘  │
└─────────────────┼───────────────────────┘
                  │ HTTP (localhost:8787)
┌─────────────────┼───────────────────────┐
│  whisper-server │                       │
│  ├── whisper.cpp (C++)                  │
│  ├── Core ML (Neural Engine)            │
│  ├── Metal (GPU)                        │
│  ├── ggml-large-v3 model                │
│  └── FFmpeg (ses dönüşümü)              │
└─────────────────────────────────────────┘
```

---

## UXP Premiere Pro API Referans Notları

### Temel Erişim
```javascript
const ppro = require("premierepro");
// 59 key'li modül — statik sınıflar, ppro.app YOK

const project = await ppro.Project.getActiveProject();
const sequence = await project.getActiveSequence();
```

### Cast Pattern (ZORUNLU)
```javascript
// getItems() ve getProjectItem() base ProjectItem döndürür
const items = await rootItem.getItems();

// ClipProjectItem'a cast et
const clipItem = ppro.ClipProjectItem.cast(item);
if (clipItem) {
  const path = await clipItem.getMediaFilePath();
}

// FolderItem'a cast et
const folder = ppro.FolderItem.cast(item);
if (folder) {
  const children = await folder.getItems();
}
```

### Transaction Pattern
```javascript
project.lockedAccess(() => {
  project.executeTransaction((compoundAction) => {
    const action = ppro.Transcript.createImportTextSegmentsAction(
      textSegments, clipProjectItem
    );
    compoundAction.addAction(action);
  }, "İşlem Adı");
});
```

### Bilinen Kısıtlamalar
- `uxp.shell.openPath()` → çalışmaz (shell objesi boş)
- Caption track'e programatik item ekleme → API yok
- `lockedAccess` callback'i senkron (await kullanılamaz)
- `TrackItemType`: `{EMPTY:0, CLIP:1, TRANSITION:2, PREVIEW:3, FEEDBACK:4}`
