const ppro = require("premierepro");
const uxp = require("uxp");
const uxpfs = uxp.storage;
const fs = uxpfs.localFileSystem;

// Sunucu başlatma yolları
const START_SCRIPT = "/Users/akbay/Developer/turkcealtyazi/companion-app/start-server.command";
const START_SCRIPT_SH = "/Users/akbay/Developer/turkcealtyazi/companion-app/start-server.sh";
const SERVER_START_CMD = START_SCRIPT_SH;

// --- DOM Referansları ---

const statusDot = document.getElementById("statusDot");
const statusLabel = document.getElementById("statusLabel");
const statusBadge = document.getElementById("statusBadge");

const sequenceContent = document.getElementById("sequenceContent");
const sequenceNameEl = document.getElementById("sequenceName");
const sequenceMetaEl = document.getElementById("sequenceMeta");
const sequenceEmpty = document.getElementById("sequenceEmpty");

const actionSection = document.getElementById("actionSection");
const btnGenerate = document.getElementById("btnGenerate");

const progressSection = document.getElementById("progressSection");
const progressLabel = document.getElementById("progressLabel");
const progressFill = document.getElementById("progressFill");
const progressPercent = document.getElementById("progressPercent");
const progressTimer = document.getElementById("progressTimer");

const resultCard = document.getElementById("resultCard");
const resultTitle = document.getElementById("resultTitle");
const resultDetail = document.getElementById("resultDetail");
const resultFile = document.getElementById("resultFile");

const serverHelpSection = document.getElementById("serverHelpSection");
const btnLaunchServer = document.getElementById("btnLaunchServer");
const btnCopyCommand = document.getElementById("btnCopyCommand");

// --- Durum Değişkenleri ---

let serverConnected = false;
let pollTimer = null;
let isProcessing = false;
let lastSequenceName = null;
let cachedProject = null;
let processStartTime = null;
let timerInterval = null;
let lastSrtPath = null; // Son oluşturulan SRT dosya yolu

// =====================================================================
//  Sayfa Geçişi
// =====================================================================

function showPage(pageName) {
  const pageCreate = document.getElementById('page-create');
  const pageEditor = document.getElementById('page-editor');

  const outgoing = pageName === 'editor' ? pageCreate : pageEditor;
  const incoming = pageName === 'editor' ? pageEditor : pageCreate;

  // Fade-out current page
  outgoing.classList.add('page-fade-out');

  setTimeout(() => {
    outgoing.style.display = 'none';
    outgoing.classList.remove('page-fade-out');

    incoming.style.display = 'flex';
    incoming.classList.add('page-fade-out');

    // Force reflow then fade-in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        incoming.classList.remove('page-fade-out');
        incoming.classList.add('page-fade-in');
        setTimeout(() => incoming.classList.remove('page-fade-in'), 200);
      });
    });

    if (pageName === 'editor') {
      startPlayheadSync();
    } else {
      stopPlayheadSync();
    }
  }, 150);
}

// =====================================================================
//  Sunucu Otomatik Başlatma
// =====================================================================

async function launchServer() {
  try {
    const shell = uxp.shell;
    if (shell && typeof shell.openPath === "function") {
      await shell.openPath(START_SCRIPT);
      setServerLaunching();
      return true;
    }

    if (shell && typeof shell.openExternal === "function") {
      const fileUrl = "file://" + START_SCRIPT;
      await shell.openExternal(fileUrl);
      setServerLaunching();
      return true;
    }

    return false;
  } catch (e) {
    console.error("launchServer hatası:", e.message);
    return false;
  }
}

function setServerLaunching() {
  statusDot.className = "status-dot launching";
  statusBadge.className = "status-badge launching";
  statusLabel.textContent = "Başlatılıyor...";
  btnLaunchServer.disabled = true;
  btnLaunchServer.textContent = "Başlatılıyor...";

  setTimeout(() => {
    if (!serverConnected) {
      btnLaunchServer.disabled = false;
      btnLaunchServer.textContent = "Sunucuyu Başlat";
      statusDot.classList.remove("launching");
      statusBadge.classList.remove("launching");
    }
  }, 15000);
}

// --- Sunucu Butonları ---

btnLaunchServer.addEventListener("click", async () => {
  const ok = await launchServer();
  if (!ok) {
    btnLaunchServer.textContent = "Başlatılamadı";
    setTimeout(() => { btnLaunchServer.textContent = "Sunucuyu Başlat"; }, 2000);
  }
});

btnCopyCommand.addEventListener("click", async () => {
  try {
    const clipboard = uxp.clipboard || navigator.clipboard;
    if (clipboard && typeof clipboard.write === "function") {
      await clipboard.write(SERVER_START_CMD);
    } else if (clipboard && typeof clipboard.writeText === "function") {
      await clipboard.writeText(SERVER_START_CMD);
    } else if (clipboard && typeof clipboard.setContent === "function") {
      clipboard.setContent({ "text/plain": SERVER_START_CMD });
    }
    btnCopyCommand.textContent = "Kopyalandı!";
    setTimeout(() => { btnCopyCommand.textContent = "Komutu Kopyala"; }, 2000);
  } catch (e) {
    console.warn("Clipboard hatası:", e.message);
    btnCopyCommand.textContent = "Kopyalanamadı";
    setTimeout(() => { btnCopyCommand.textContent = "Komutu Kopyala"; }, 2000);
  }
});

// =====================================================================
//  Premiere Pro API
// =====================================================================

async function getProject() {
  try {
    if (ppro.Project && typeof ppro.Project.getActiveProject === "function") {
      cachedProject = await ppro.Project.getActiveProject();
      return cachedProject;
    }
  } catch (e) {
    console.warn("getActiveProject hatası:", e.message);
  }
  return null;
}

async function getActiveSequence() {
  try {
    const project = await getProject();
    if (!project) return null;
    if (typeof project.getActiveSequence === "function") {
      return await project.getActiveSequence();
    }
    if (project.activeSequence) return project.activeSequence;
  } catch (e) {
    console.warn("getActiveSequence hatası:", e.message);
  }
  return null;
}

// =====================================================================
//  Sunucu Durumu
// =====================================================================

async function updateServerStatus() {
  const connected = await checkServerHealth();
  serverConnected = connected;

  const statusDetailEl = document.getElementById("statusDetail");
  if (connected) {
    statusDot.className = "status-dot connected";
    statusBadge.className = "status-badge connected";
    statusLabel.textContent = "Sunucu OK";
    if (statusDetailEl) statusDetailEl.textContent = "8787 \u00B7 v3";
    serverHelpSection.classList.add("hidden");
    btnLaunchServer.disabled = false;
    btnLaunchServer.textContent = "Sunucuyu Ba\u015Flat";
  } else {
    statusDot.classList.remove("connected");
    statusBadge.classList.remove("connected");
    if (!statusDot.classList.contains("launching")) {
      statusLabel.textContent = "Sunucu Yok";
    }
    if (statusDetailEl) statusDetailEl.textContent = "";
    serverHelpSection.classList.remove("hidden");
  }
}

// =====================================================================
//  Polling
// =====================================================================

async function pollUpdate() {
  await updateServerStatus();
  await updateSequenceInfo();
}

function startPolling() {
  pollUpdate();
  pollTimer = setInterval(pollUpdate, 5000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// =====================================================================
//  Sequence Bilgisi
// =====================================================================

async function updateSequenceInfo() {
  const seq = await getActiveSequence();
  const name = seq ? seq.name : null;

  if (name !== lastSequenceName) {
    lastSequenceName = name;

    if (name) {
      sequenceContent.classList.add("active");
      sequenceEmpty.classList.add("hidden");
      sequenceNameEl.textContent = name;
      sequenceNameEl.title = name;

      try {
        const duration = seq.end ? (seq.end.seconds || 0) - (seq.start ? seq.start.seconds || 0 : 0) : 0;
        if (duration > 0) {
          const mins = Math.floor(duration / 60);
          const secs = Math.floor(duration % 60);
          sequenceMetaEl.textContent = mins + ":" + String(secs).padStart(2, "0") + " süre";
        } else {
          sequenceMetaEl.textContent = "";
        }
      } catch (_) {
        sequenceMetaEl.textContent = "";
      }
    } else {
      sequenceContent.classList.remove("active");
      sequenceEmpty.classList.remove("hidden");
    }

  }

  btnGenerate.disabled = !serverConnected || !seq || isProcessing;
}

function updateButtonState() {
  btnGenerate.disabled = !serverConnected || !lastSequenceName || isProcessing;
}

// =====================================================================
//  İlerleme & Sonuç UI
// =====================================================================

function startTimer() {
  processStartTime = Date.now();
  timerInterval = setInterval(() => {
    const s = ((Date.now() - processStartTime) / 1000).toFixed(1);
    progressTimer.textContent = s + "s";
  }, 500);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateProgressSteps(activeStep) {
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById('step' + i);
    if (!el) continue;
    const numEl = el.querySelector('.step-number');
    el.classList.remove('active', 'completed');
    if (i < activeStep) {
      el.classList.add('completed');
      if (numEl) numEl.textContent = '\u2713';
    } else if (i === activeStep) {
      el.classList.add('active');
      if (numEl) numEl.textContent = String(i);
    } else {
      if (numEl) numEl.textContent = String(i);
    }
  }
}

function showProgress(text, value) {
  actionSection.classList.add("hidden");
  progressSection.classList.add("active");
  progressLabel.textContent = text;
  progressFill.style.width = value + "%";
  progressPercent.textContent = value + "%";

  // Adım göstergesi güncelle
  if (value <= 20) updateProgressSteps(1);
  else if (value <= 75) updateProgressSteps(2);
  else updateProgressSteps(3);
}

function hideProgress() {
  progressSection.classList.remove("active");
  actionSection.classList.remove("hidden");
  progressFill.style.width = "0%";
  progressPercent.textContent = "0%";
  progressTimer.textContent = "";
  stopTimer();
}

function showResult(type, title, detail, fileName) {
  resultCard.className = "result-card " + type;
  resultTitle.textContent = title;
  resultDetail.textContent = detail || "";
  resultFile.textContent = fileName || "";
}

function hideResult() {
  resultCard.className = "result-card";
  resultTitle.textContent = "";
  resultDetail.textContent = "";
  resultFile.textContent = "";
  const resultMetrics = document.getElementById('resultMetrics');
  if (resultMetrics) resultMetrics.style.display = 'none';
  const btnEditor = document.getElementById('btnOpenEditor');
  if (btnEditor) btnEditor.style.display = 'none';
}

// =====================================================================
//  Ses Dosyası Alma
// =====================================================================

async function getFirstMediaPath(sequence) {
  try {
    const trackPath = await getMediaPathFromTracks(sequence);
    if (trackPath) return trackPath;

    const project = await getProject();
    if (project) {
      const rootItem = await project.getRootItem();
      const children = await rootItem.getItems();
      const rootPath = await findAnyMediaPath(children);
      if (rootPath) return rootPath;
    }
  } catch (e) {
    console.error("getFirstMediaPath hatası:", e.message, e.stack);
  }
  return null;
}

async function getMediaPathFromTracks(sequence) {
  try {
    let trackItemType = 1;
    if (ppro.Constants && ppro.Constants.TrackItemType) {
      trackItemType = ppro.Constants.TrackItemType.CLIP || 1;
    }

    const videoTrackCount = await sequence.getVideoTrackCount();
    for (let t = 0; t < videoTrackCount; t++) {
      const track = await sequence.getVideoTrack(t);
      const clips = track.getTrackItems(trackItemType, false);
      if (!clips || clips.length === 0) continue;

      for (let c = 0; c < clips.length; c++) {
        const baseItem = await clips[c].getProjectItem();
        if (!baseItem) continue;

        if (ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function") {
          const clipItem = ppro.ClipProjectItem.cast(baseItem);
          if (clipItem && typeof clipItem.getMediaFilePath === "function") {
            const path = await clipItem.getMediaFilePath();
            if (path) return path;
          }
        }
      }
    }

    const audioTrackCount = await sequence.getAudioTrackCount();
    for (let t = 0; t < audioTrackCount; t++) {
      const track = await sequence.getAudioTrack(t);
      const clips = track.getTrackItems(trackItemType, false);
      if (!clips || clips.length === 0) continue;

      for (let c = 0; c < clips.length; c++) {
        const baseItem = await clips[c].getProjectItem();
        if (!baseItem) continue;

        if (ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function") {
          const clipItem = ppro.ClipProjectItem.cast(baseItem);
          if (clipItem && typeof clipItem.getMediaFilePath === "function") {
            const path = await clipItem.getMediaFilePath();
            if (path) return path;
          }
        }
      }
    }
  } catch (e) {
    console.error("getMediaPathFromTracks hatası:", e.message);
  }
  return null;
}

async function findAnyMediaPath(items) {
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function") {
      const clipItem = ppro.ClipProjectItem.cast(item);
      if (clipItem) {
        const path = await clipItem.getMediaFilePath();
        if (path) return path;
      }
    }
    if (ppro.FolderItem && typeof ppro.FolderItem.cast === "function") {
      const folderItem = ppro.FolderItem.cast(item);
      if (folderItem) {
        const subItems = await folderItem.getItems();
        const result = await findAnyMediaPath(subItems);
        if (result) return result;
      }
    }
  }
  return null;
}

async function getClipProjectItemForPath(mediaPath) {
  try {
    const project = await getProject();
    if (!project) return null;

    const rootItem = await project.getRootItem();
    const children = await rootItem.getItems();
    if (!children) return null;

    const fileName = mediaPath.split("/").pop();

    for (let i = 0; i < children.length; i++) {
      const item = children[i];
      if (ppro.ClipProjectItem && typeof ppro.ClipProjectItem.cast === "function") {
        const clipItem = ppro.ClipProjectItem.cast(item);
        if (clipItem && item.name === fileName) return clipItem;
      }
      if (ppro.FolderItem && typeof ppro.FolderItem.cast === "function") {
        const folder = ppro.FolderItem.cast(item);
        if (folder) {
          const subItems = await folder.getItems();
          for (let j = 0; j < subItems.length; j++) {
            const clipItem = ppro.ClipProjectItem.cast(subItems[j]);
            if (clipItem && subItems[j].name === fileName) return clipItem;
          }
        }
      }
    }
  } catch (e) {
    console.warn("getClipProjectItemForPath hatası:", e.message);
  }
  return null;
}

async function readFileAsBlob(filePath) {
  const file = await fs.getEntryWithUrl("file:" + filePath);
  const data = await file.read({ format: uxpfs.formats.binary });
  return new Blob([data], { type: "application/octet-stream" });
}

// =====================================================================
//  Ana İş Akışı
// =====================================================================

async function handleGenerate() {
  if (isProcessing) return;
  isProcessing = true;
  updateButtonState();
  hideResult();
  startTimer();

  const startTime = Date.now();

  try {
    const sequence = await getActiveSequence();
    if (!sequence) throw new Error("Aktif bir sequence bulunamadı.");

    const seqName = sequence.name || "sequence";

    // 1. Medya yolunu bul
    showProgress("Ses dosyası okunuyor...", 10);
    const mediaPath = await getFirstMediaPath(sequence);

    let audioBlob;
    let fileName;

    if (mediaPath) {
      showProgress("Ses dosyası okunuyor...", 15);
      audioBlob = await readFileAsBlob(mediaPath);
      fileName = mediaPath.split("/").pop();
    } else {
      showProgress("Dosya seçin...", 15);
      const pickedFile = await fs.getFileForOpening({
        types: ["wav", "mp3", "mp4", "m4a", "mov", "flac", "ogg"],
      });
      if (!pickedFile) throw new Error("Dosya seçilmedi.");
      const data = await pickedFile.read({ format: uxpfs.formats.binary });
      audioBlob = new Blob([data], { type: "application/octet-stream" });
      fileName = pickedFile.name;
    }

    // 2. Transkripsiyon
    showProgress("Sunucuya gönderiliyor...", 20);
    const initialPrompt = document.getElementById('initialPrompt')?.value?.trim() || '';
    const result = await transcribeAudio(audioBlob, fileName, initialPrompt);


    showProgress("Transkripsiyon yapılıyor (VAD + Core ML)...", 40);

    // 3. Segmentleri işle + SRT oluştur
    showProgress("Segmentler işleniyor...", 60);

    const segments = result.transcription || result.segments || [];
    if (segments.length === 0) throw new Error("Transkripsiyon sonucu boş döndü.");

    showProgress("SRT segmentleri oluşturuluyor...", 75);
    const srtContent = generateSRT(segments);
    if (!srtContent) throw new Error("SRT içeriği oluşturulamadı.");

    // 4. SRT dosyasını otomatik kaydet (video dosya adıyla)
    showProgress("Dosya kaydediliyor...", 90);
    const mediaBaseName = fileName
      ? fileName.replace(/\.[^.]+$/, "")
      : seqName;
    const srtFileName = mediaBaseName.replace(/[^a-zA-Z0-9_\-ğüşıöçĞÜŞİÖÇ ]/g, "") + "_altyazi.srt";

    const project = await getProject();
    const projectDir = project.path.substring(0, project.path.lastIndexOf("/"));
    const altyaziDir = projectDir + "/altyazilar";

    let folder;
    try {
      folder = await fs.getEntryWithUrl("file:" + altyaziDir);
    } catch (_) {
      const parentFolder = await fs.getEntryWithUrl("file:" + projectDir);
      folder = await parentFolder.createFolder("altyazilar");
    }

    const saveFile = await folder.createFile(srtFileName, { overwrite: true });
    await saveFile.write(srtContent, { format: uxpfs.formats.utf8 });
    const srtPath = saveFile.nativePath;

    // 5. Tamamlandı — SRT projeye henüz import edilmez, kullanıcı düzenledikten sonra import edecek
    showProgress("Tamamlanıyor...", 95);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    showProgress("Tamamlandı!", 100);

    const detailParts = [segments.length + " segment · " + elapsed + "s"];
    detailParts.push("Düzenleyicide açılıyor...");

    lastSrtPath = srtPath;

    setTimeout(async () => {
      hideProgress();
      showResult("success", "Altyaz\u0131 Haz\u0131r", detailParts.join("\n"), srtFileName);

      // Metrikleri doldur
      const resultMetrics = document.getElementById('resultMetrics');
      const metricBlocks = document.getElementById('metricBlocks');
      const metricDuration = document.getElementById('metricDuration');
      const metricCPS = document.getElementById('metricCPS');
      if (resultMetrics) resultMetrics.style.display = 'flex';
      if (metricBlocks) metricBlocks.textContent = String(segments.length);

      // S\u00fcre hesapla
      if (metricDuration && segments.length > 0) {
        const lastSeg = segments[segments.length - 1];
        const totalSec = lastSeg.t1 != null ? lastSeg.t1 / 1000 : (lastSeg.end || 0);
        const mins = Math.floor(totalSec / 60);
        const secs = Math.floor(totalSec % 60);
        metricDuration.textContent = mins + ':' + String(secs).padStart(2, '0');
      }

      // Ortalama CPS hesapla
      if (metricCPS) {
        const srtText = srtContent || '';
        const totalChars = srtText.replace(/\d+\n[\d:,\s\-\>]+\n/g, '').replace(/\n\n/g, '').replace(/\n/g, ' ').length;
        const lastSeg = segments[segments.length - 1];
        const totalDur = lastSeg.t1 != null ? lastSeg.t1 / 1000 : (lastSeg.end || 1);
        const avgCps = totalDur > 0 ? (totalChars / totalDur) : 0;
        metricCPS.textContent = avgCps.toFixed(1);
      }

      const btnEditor = document.getElementById('btnOpenEditor');
      if (btnEditor) btnEditor.style.display = 'block';
      showPage('editor');
      await loadSRT(lastSrtPath);
    }, 800);

  } catch (err) {
    hideProgress();
    showResult("error", "Hata oluştu", err.message);
    console.error("TürkçeAltyazı hatası:", err);
  } finally {
    isProcessing = false;
    updateButtonState();
    stopTimer();
  }
}

// =====================================================================
//  Event Listener Kurulumu
// =====================================================================

async function setupEventListener() {
  try {
    const project = await getProject();
    if (!project) return;

    if (ppro.EventManager && typeof ppro.EventManager.addEventListener === "function") {
      ppro.EventManager.addEventListener(project, "onActiveSequenceChanged", () => {
        updateSequenceInfo();
      });
    }
  } catch (e) {
    console.warn("Event listener kurulumu başarısız:", e.message);
  }
}

// =====================================================================
//  Panel Lifecycle
// =====================================================================

async function panelCreate() {

  // Karakter sayacı
  const promptInput = document.getElementById('initialPrompt');
  const charCount = document.getElementById('promptCharCount');
  if (promptInput && charCount) {
    promptInput.addEventListener('input', () => {
      charCount.textContent = promptInput.value.length;
    });
  }

  await setupEventListener();
  startPolling();
}

async function panelDestroy() {
  stopPolling();
  stopTimer();
  stopPlayheadSync();
}

// =====================================================================
//  Başlatma
// =====================================================================

btnGenerate.addEventListener("click", handleGenerate);

// Sayfa geçiş butonları
document.getElementById('btnBackToCreate').addEventListener('click', () => {
  if (editorState.isModified) {
    if (!confirm('Kaydedilmemiş değişiklikler var. Yine de çıkmak istiyor musunuz?')) {
      return;
    }
  }
  showPage('create');
});

document.getElementById('btnOpenEditor').addEventListener('click', () => {
  showPage('editor');
  if (lastSrtPath) loadSRT(lastSrtPath);
});

// Düzenleme alanı event listener'larını bağla
initEditArea();

try {
  const entrypoints = uxp.entrypoints;
  if (entrypoints && typeof entrypoints.setup === "function") {
    entrypoints.setup({
      panels: {
        "turkcealtyazi.panel": {
          create: panelCreate,
          destroy: panelDestroy,
        },
      },
    });
  } else {
    panelCreate();
  }
} catch (e) {
  console.warn("Lifecycle setup hatası:", e.message);
  panelCreate();
}
