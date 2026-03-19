# TürkçeAltyazı — Premiere Pro Türkçe Altyazı Eklentisi

## Proje nedir?
Adobe Premiere Pro için Türkçe otomatik altyazı oluşturan bir UXP eklentisi. İki ana bileşen var:
1. **Companion App:** whisper.cpp tabanlı lokal ses-yazı dönüştürme sunucusu (macOS, Apple Silicon M4)
2. **UXP Eklenti:** Premiere Pro içinde çalışan panel — companion app'e HTTP istekleri atar, SRT oluşturur, projeye import eder

## Mimari
- whisper-server bağımsız çalışır — eklenti panel açıldığında sunucu durumunu kontrol eder, yoksa kullanıcıya başlatma talimatı gösterir
- İletişim: UXP → HTTP POST → localhost:8787/inference → whisper-server
- Ses format dönüşümü: whisper-server `--convert` bayrağı ile otomatik (FFmpeg gerekli)
- Medya yolu: Track clip → `ClipProjectItem.cast()` → `getMediaFilePath()` ile otomatik bulunur
- VAD: Silero VAD v6.2.0 ile sessiz bölümler otomatik atlanır
- Halüsinasyon temizleme: Ardışık tekrarlanan segmentler ve çok kısa segmentler (<0.1s) otomatik filtrelenir
- Çıktı: SRT dosyası (proje dizini/altyazilar/, video dosya adıyla) + Transcript API ile clip'e transkript ekleme

## Proje yapısı
```
turkcealtyazi/
├── companion-app/
│   ├── whisper.cpp/            # Build edildi, Core ML + Metal GPU ile çalışıyor
│   ├── start-server.sh         # whisper-server başlatma scripti
│   ├── stop-server.sh          # whisper-server durdurma scripti
│   ├── start-server.command    # macOS Terminal wrapper
│   ├── stop-server.command     # macOS Terminal wrapper
│   ├── server.log              # Sunucu log dosyası (otomatik oluşur)
│   └── server.pid              # Sunucu PID dosyası (otomatik oluşur)
├── uxp-plugin/
│   ├── manifest.json           # UXP eklenti tanımı (lifecycle hook'ları dahil)
│   ├── index.html              # Panel HTML (Spectrum Web Components)
│   ├── index.js                # Ana mantık + lifecycle (panelCreate/panelDestroy)
│   ├── styles.css              # Stiller (Spectrum uyumlu, koyu tema)
│   ├── api.js                  # whisper-server iletişimi (fetch + FormData)
│   ├── srt.js                  # SRT + Adobe Transcript JSON oluşturma
│   └── icons/                  # Eklenti ikonları (light/dark)
└── docs/
```

## Komutlar
- whisper-server başlatma: `companion-app/start-server.sh` (veya doğrudan: `cd companion-app/whisper.cpp && ./build/bin/whisper-server -m models/ggml-large-v3.bin -l tr --port 8787 --convert --vad --vad-model models/ggml-silero-v6.2.0.bin`)
- whisper-server durdurma: `companion-app/stop-server.sh`
- whisper-server test: `curl -X POST http://localhost:8787/inference -F "file=@test.wav" -F "language=tr" -F "response_format=verbose_json"`
- UXP eklenti yükleme: UXP Developer Tool → Add Plugin → uxp-plugin/manifest.json

## Teknik kararlar
- **Model:** ggml-large-v3 (turbo değil) — Türkçe doğruluğu öncelikli
- **Core ML:** Aktif — encoder Neural Engine'de çalışıyor, encode ~640ms (build: `DWHISPER_COREML=ON DGGML_METAL=ON`)
- **Neden whisper.cpp:** Apple Silicon'da Metal + Core ML desteği, faster-whisper CUDA bağımlı (Mac'te sadece CPU)
- **Neden UXP:** Adobe'un yeni standardı, CEP sunset sürecinde
- **Neden SRT + Transcript API:** UXP Caption Track API henüz tamamlanmadı — caption track'e programatik ekleme yok
- **ProjectItem cast pattern:** `FolderItem.getItems()` ve `TrackItem.getProjectItem()` base ProjectItem döndürür, `ClipProjectItem.cast(item)` / `FolderItem.cast(item)` ile cast etmek gerekir
- **SRT otomatik kayıt:** Proje dizini/altyazilar/ klasörüne otomatik kaydedilir (dosya diyaloğu açılmaz)
- **VAD (Voice Activity Detection):** Silero VAD v6.2.0 modeli ile sessiz kısımlar otomatik atlanır — hem doğruluğu artırır hem hızlandırır
- **Halüsinasyon temizleme:** Ardışık tekrarlanan segmentler (aynı metin max 2 kez) ve çok kısa segmentler (<0.1s) otomatik filtrelenir
- **SRT segmentasyon kuralları:** Segment bazlı akıllı segmentasyon — satır başına max 42 karakter, altyazı başına max 2 satır, min 1s / max 7s süre, segmentler arası 0.1s boşluk, cümle sonu algılama, Türkçe bağlaç/ek kuralları
- **Word-level timestamps kullanılmıyor:** whisper.cpp BPE sub-word token döndürüyor ("Pringles" → "Pr","ing","les"), segment bazlı timestamps yeterli kalitede
- **SRT dosya adı:** Video dosya adından türetilir (örn: `interview_altyazi.srt`), sequence adı yerine

## Platform
- macOS, Apple M4 MacBook Air (10 CPU, 10 GPU, 16 Neural Engine)
- Premiere Pro 25.6+ (UXP desteği)
- Xcode 26.3, Homebrew, FFmpeg, CMake, Python 3.11 (brew), Node.js v24, Git kurulu

## Geliştirme kuralları
- UXP eklenti kodu: JavaScript ES6, HTML, CSS
- Adobe Spectrum Web Components kullan (UI tutarlılığı için)
- Tüm metin içeriği UTF-8 (Türkçe karakter desteği)
- Hata mesajları Türkçe olsun
- SRT dosyaları UTF-8 BOM'suz olmalı
- Her değişiklik sonrası test et: whisper-server yanıt veriyor mu, SRT geçerli mi

## UXP Premiere Pro API Notları
- `require("premierepro")` → 59 key'li modül, statik sınıflar döndürür — `ppro.app` YOK
- Proje: `ppro.Project.getActiveProject()` → async, `project.getActiveSequence()` → async
- Track erişimi: `sequence.getVideoTrackCount()` → `sequence.getVideoTrack(i)` → `track.getTrackItems(TrackItemType.CLIP, false)`
- **CAST ZORUNLU:** `getItems()`, `getProjectItem()` base ProjectItem döndürür:
  - `ppro.ClipProjectItem.cast(item)` → ClipProjectItem (getMediaFilePath, changeMediaFilePath vb.)
  - `ppro.FolderItem.cast(item)` → FolderItem (getItems, createBinAction vb.)
- Transcript API: `ppro.Transcript.importFromJSON(jsonStr)` → TextSegments, `ppro.Transcript.createImportTextSegmentsAction(textSegments, clipItem)` → Action
- Transaction pattern: `project.lockedAccess(() => { project.executeTransaction((ca) => { ca.addAction(action); }, "label"); })`
- Event: `ppro.EventManager.addEventListener(project, "onActiveSequenceChanged", handler)`
- `shell.openPath()` UXP Premiere'de ÇALIŞMAZ (shell objesi boş)
- Caption track'e programatik item ekleme API'si YOK (Adobe bunu doğruladı)
- SRT otomatik kayıt: `project.path` → proje dizini, `folder.createFile()` ile dosya diyaloğu olmadan kayıt, dosya adı video dosyasından türetilir
