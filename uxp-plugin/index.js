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

// =====================================================================
//  Sunucu Otomatik Başlatma
// =====================================================================

async function launchServer() {
  try {
    const shell = uxp.shell;
    console.debug("uxp.shell keys:", Object.keys(shell || {}));

    if (shell && typeof shell.openPath === "function") {
      console.debug("shell.openPath ile başlatılıyor:", START_SCRIPT);
      await shell.openPath(START_SCRIPT);
      setServerLaunching();
      return true;
    }

    if (shell && typeof shell.openExternal === "function") {
      const fileUrl = "file://" + START_SCRIPT;
      console.debug("shell.openExternal ile başlatılıyor:", fileUrl);
      await shell.openExternal(fileUrl);
      setServerLaunching();
      return true;
    }

    console.debug("shell API bulunamadı — manuel başlatma gerekli.");
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
      if (cachedProject && !getProject._logged) {
        getProject._logged = true;
        console.debug("project proto keys:", Object.getOwnPropertyNames(Object.getPrototypeOf(cachedProject)));
      }
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

  if (connected) {
    statusDot.className = "status-dot connected";
    statusBadge.className = "status-badge connected";
    statusLabel.textContent = "Bağlı";
    serverHelpSection.classList.add("hidden");
    btnLaunchServer.disabled = false;
    btnLaunchServer.textContent = "Sunucuyu Başlat";
  } else {
    statusDot.classList.remove("connected");
    statusBadge.classList.remove("connected");
    if (!statusDot.classList.contains("launching")) {
      statusLabel.textContent = "Bağlantı yok";
    }
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

    console.debug("Aktif sequence:", name || "(yok)");
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

function showProgress(text, value) {
  actionSection.classList.add("hidden");
  progressSection.classList.add("active");
  progressLabel.textContent = text;
  progressFill.style.width = value + "%";
  progressPercent.textContent = value + "%";
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
      console.debug("rootItem children count:", children ? children.length : 0);
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
        console.debug("videoTrack[" + t + "] clip[" + c + "]:", baseItem.name);

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
    const result = await transcribeAudio(audioBlob, fileName);

    console.debug("Raw response (first 500 chars):", JSON.stringify(result).substring(0, 500));

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

    // 5. Transcript API ile clip'e transkript ekle + SRT'yi projeye import et
    showProgress("Transkript ekleniyor...", 95);
    let transcriptImported = false;

    try {
      if (ppro.Transcript && typeof ppro.Transcript.importFromJSON === "function"
          && typeof ppro.Transcript.createImportTextSegmentsAction === "function") {

        const transcriptJSON = generateAdobeTranscriptJSON(segments);
        if (transcriptJSON) {
          const clipProjectItem = await getClipProjectItemForPath(mediaPath || fileName);

          if (clipProjectItem) {
            try {
              const textSegments = ppro.Transcript.importFromJSON(transcriptJSON);

              project.lockedAccess(() => {
                project.executeTransaction((compoundAction) => {
                  const action = ppro.Transcript.createImportTextSegmentsAction(
                    textSegments,
                    clipProjectItem
                  );
                  compoundAction.addAction(action);
                }, "TürkçeAltyazı Transkript Import");
              });

              transcriptImported = true;
            } catch (trErr) {
              console.warn("Transcript import hatası:", trErr.message);
            }
          }
        }
      }

      if (project && typeof project.importFiles === "function") {
        await project.importFiles([srtPath], true);
      }
    } catch (importErr) {
      console.warn("Import hatası:", importErr.message);
    }

    // Tamamlandı
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    showProgress("Tamamlandı!", 100);

    const detailParts = [segments.length + " segment · " + elapsed + "s"];
    if (transcriptImported) {
      detailParts.push("Transkript clip'e eklendi");
    } else {
      detailParts.push("SRT projeye eklendi — timeline'a sürükleyin");
    }

    setTimeout(() => {
      hideProgress();
      showResult("success", "Altyazı oluşturuldu", detailParts.join("\n"), srtFileName);
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
      console.debug("Sequence event listener bağlandı.");
    }
  } catch (e) {
    console.warn("Event listener kurulumu başarısız:", e.message);
  }
}

// =====================================================================
//  Panel Lifecycle
// =====================================================================

async function panelCreate() {
  console.debug("TürkçeAltyazı panel oluşturuldu");
  const shell = uxp.shell;
  console.debug("uxp.shell keys:", Object.keys(shell || {}));

  await setupEventListener();
  startPolling();
}

async function panelDestroy() {
  console.debug("TürkçeAltyazı panel kapatılıyor");
  stopPolling();
  stopTimer();
}

// =====================================================================
//  Başlatma
// =====================================================================

btnGenerate.addEventListener("click", handleGenerate);

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
