# Türkçe Altyazı Segmentasyon — Araştırma Referans Dokümanı

> Bu doküman, Gemini Deep Research ile yapılan iki kapsamlı araştırmanın (Whisper Fine-Tuning + Akıllı Segmentasyon) projemize uygulanabilir bulgularını sentezler. Tam raporlar: `docs/` klasöründeki PDF dosyaları.

---

## 1. Metrik Standartlar (Netflix + AVTpro)

| Kriter | Değer | Not |
|--------|-------|-----|
| Max karakter/satır (CPL) | 42 | Boşluk ve noktalama dahil |
| Max satır/blok | 2 | 3 satıra asla izin verilmez |
| CPS (yetişkin) | 17 nominal, 20 mutlak maks | >20 CPS'de kelimelerin %25'i atlanıyor |
| CPS (çocuk) | 13 | — |
| Min süre | 833ms (5/6 sn, 20 frame@24fps) | <1sn yanıp sönme hissi yaratır |
| Max süre | 7 saniye | >7sn tekrar okuma (re-reading) tetikler |
| Bloklar arası gap | Min 2 frame (~83ms) | Gözün metnin değiştiğini algılaması için |
| Shot change kuralı | 12 frame (yarım saniye) | Konuşma kesime ±12 frame yakınsa snap to cut |

## 2. Sentaktik Kurallar — Asla Ayrılmayacak Birimler

### Ceza: +1000 (Kesinlikle yasak)

| Birim | Yanlış | Doğru |
|-------|--------|-------|
| İsim + Edat | Senin / gibi biri | Senin gibi / biri |
| Sıfat + İsim | Çok güzel / bir gün | Çok güzel bir gün / geçirdik |
| İsim tamlaması | Milli Eğitim / Bakanlığı | Milli Eğitim Bakanlığı / açıkladı |
| İsim + Yrd. fiil | yardım / etmek | yardım etmek |
| Olumsuzluk + Fiil | hiç / görmedim | hiç görmedim |
| Unvan + İsim | Doktor / Mehmet | Doktor Mehmet |
| Sayı + Birim | 15 / kg | 15 kg |

### Edatlar Listesi (öncesinden kırılmaz)
```
için, gibi, kadar, göre, doğru, karşı, rağmen, beri, başka, dair, ait, ile
```

### Yardımcı Fiiller Listesi (önceki isimden ayrılmaz)
```
etmek, olmak, yapmak, kılmak, eylemek, edebilmek, olabilmek
+ çekimli halleri: etti, oldu, oluyor, etmekte, olmakta, yapıyor, edildi...
```

## 3. Tercih Edilen Kırma Noktaları

| Nokta | Ceza/Ödül | Kural |
|-------|-----------|-------|
| Noktalama sonrası (. ? ! , ;) | -100 (ödül) | En doğal kırma noktası |
| Zarf-fiil eki sonrası (-ıp, -arak, -ınca, -dığında) | -40 (ödül) | Yan cümle bitişi |
| Bağlaçtan ÖNCE (ama, fakat, ve, çünkü...) | -30 (ödül) | Bağlaç yeni satırda başlar |
| Özne tamlandıktan sonra | -20 (ödül) | Doğal sentaktik sınır |

### Bağlaçlar Listesi (öncesinden kırılır)
```
ve, veya, ya da, yahut, ama, fakat, lakin, ancak, yalnız, çünkü, 
oysa, oysaki, madem, mademki, halbuki, üstelik
```

### Zarf-fiil Ekleri (sonrasından kırılır)
```
-ıp/-ip/-up/-üp, -arak/-erek, -madan/-meden, -ınca/-ince/-unca/-ünce,
-dığında/-diğinde/-duğunda/-düğünde, -ken/-iken
```

## 4. Dinamik Ceza Matrisi (Penalty Scoring System)

```
Noktalama sonrası kırma         → -100 (ödül)
Zarf-fiil eki sonrası kırma     → -40  (ödül)
Bağlaçtan önce kırma            → -30  (ödül)
İsim + Edat arası kırma         → +1000 (ceza)
İsim + Yrd. fiil arası kırma    → +1000 (ceza)
Sayı + Birim arası kırma        → +1000 (ceza)
Sıfat + İsim arası kırma        → +1000 (ceza)
Orphan kelime (≤5 char tek)     → +500  (ceza)
42 CPL aşımı                    → +2000 (geçersiz kılma)
```

**Çelişki kuralı:** Sentaktik bütünlük > 42 char limiti. 45-48 char'a çıkmak, kelime öbeğini bölmekten daha az zararlı. AMA CPS 20'yi asla aşamaz — aşıyorsa cümle iki bloğa bölünür.

## 5. Bloklar Arası Segmentasyon

- **Cümle sonu** (.?!): Yeni blok başlat
- **Kısaltma istisnası**: Dr., Prof., Av., vb., vs., M.Ö., M.S., ABD, BM → cümle sonu DEĞİL
- **Kasıtlı duraklama** (≥2sn sessizlik): Blok kapat + sonuna "..." ekle, yeni blok "..." ile başlasın
- **Süregelen cümle** iki blok arasında: Noktalama KULLANILMAZ (eski "..." metodu yasaklanmıştır)
- **84+ char cümle**: Zarf tümleci bitiminden veya bağlaçtan önce mantıksal bölme
- **Konuşmacı değişimi**: Aynı blokta max 2 kişi, satır başına "-" (tiresiz boşluk yok: "-Nasılsın?")

## 6. Geometrik Denge

- 42 char'a sığıyorsa tek satır (gereksiz 2 satır YAPMA)
- 2 satırda: Alt satır uzun (bottom-heavy pyramid) tercih
- Orphan kelime yasak: Üst/alt satırda 5 char'dan kısa tek kelime bırakılmaz
- Orphan tespitinde: Kırma noktasını bir önceki boşluğa kaydrı (early line break)

## 7. Formatlama Kuralları

- **Sayılar**: 1-9 yazıyla (bir, iki...), 10+ rakamla (10, 26...), büyük sayılar: "15 milyon"
- **Ondalık**: Virgül (21,5) — nokta DEĞİL
- **Yüzde**: %50 (önde) — 50% DEĞİL  
- **Binlik ayıracı**: Nokta (3.500)
- **Tırnak**: Düz çift tırnak (" "), iç içe tek tırnak (' ')
- **Kısaltmalar**: Noktasız (ABD, BM, NATO, FBI)
- **Yabancı kelime + ek**: Kesme işareti (FBI'a, Bluetooth'unu, check-in'den)
- **Şarkı sözleri**: İtalik, her satır büyük harfle başlar, satır sonunda nokta/virgül yok
- **Bağlaçlardan önce**: Virgül KONULMAZ

## 8. Whisper Optimizasyonu (İlk Rapor Bulguları)

- **beam_size=1**: Halüsinasyonları azaltır (greedy decoding)
- **initial_prompt**: Max 224 token (~900 char), özel isim/terim zorlama, noktalama teşviki
- **VAD**: Zaten aktif (Silero v6.2.0) ✅
- **word_timestamps**: KULLANILMAZ (sub-word token sorunu) ✅
- **CPS hesaplama**: Şu an yok — EKLENMELİ
- **Kısaltma sözlüğü**: Şu an yok — EKLENMELİ

## 9. Algoritma Pipeline (Karar Ağacı)

```
Girdi: Whisper segments → [{text, start, end}, ...]

1. ÖN İŞLEME
   ├─ filterShortSegments() (< 0.1s sil) ✅ mevcut
   ├─ removeHallucinations() (ABAB pattern) ✅ mevcut  
   ├─ mergeFragmentedWords() ✅ mevcut
   └─ normalizeNumbers() ← YENİ (yüzde elli → %50, bin → 1.000)

2. KELİME ÇIKARMA
   └─ extractWords() ✅ mevcut

3. AKILLI SEGMENTASYON (srt.js yeniden yazım)
   ├─ 3a. Cümle sonu tespiti (noktalama + kısaltma istisnası)
   ├─ 3b. Akustik duraklama tespiti (≥2sn → blok kapat)
   ├─ 3c. Süre kontrolü (max 7sn → zorla böl)
   ├─ 3d. CPS kontrolü (>20 → zorla böl) ← YENİ
   ├─ 3e. Satır kırma (>42 char → penalty scoring ile kır) ← YENİ
   ├─ 3f. Sentaktik güvenlik duvarı (edat/yrd.fiil koruması) ← YENİ
   ├─ 3g. Orphan kelime kontrolü ← YENİ
   └─ 3h. Geometrik denge (satır uzunlukları dengeleme) ← YENİ

4. SRT ÇIKTI
   └─ formatSRT() ✅ mevcut
```
