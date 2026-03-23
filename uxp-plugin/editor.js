/**
 * Altyazı Düzenleme Paneli — editor.js
 * Faz 3: Altyazı listesi render, seçim, CPS/karakter renk kodları
 */

const uxp_editor = require("uxp");
const uxpfs_editor = uxp_editor.storage;
const fs_editor = uxpfs_editor.localFileSystem;

// ─── Editor State ────────────────────────────────────────────────────────────

const editorState = {
  subtitles: [],        // [{id, index, startTime, endTime, text}, ...]
  selectedIndex: -1,    // Seçili altyazı indeksi
  searchQuery: '',      // Arama metni
  filterMode: 'all',    // all | cps_error | line_error
  isModified: false,    // Kaydedilmemiş değişiklik var mı
  srtFilePath: '',      // Mevcut SRT dosya yolu
  playheadPosition: 0,  // Son bilinen playhead pozisyonu (saniye)
  playheadActiveIndex: -1, // Playhead'in üzerinde olduğu altyazı indeksi
  syncEnabled: false,   // Playhead sync aktif mi
  undoStack: [],        // [{type, data, timestamp}, ...] — max 50
  redoStack: [],        // [{type, data, timestamp}, ...]
};

let _textUndoTimer = null;
let _textUndoSnapshot = null;

function markModified() {
  editorState.isModified = true;
  const btn = document.getElementById('btnSaveSRT');
  if (btn) btn.classList.add('has-changes');
}

function markSaved() {
  editorState.isModified = false;
  const btn = document.getElementById('btnSaveSRT');
  if (btn) btn.classList.remove('has-changes');
}

// ─── Undo/Redo Sistemi ──────────────────────────────────────────────────────

/**
 * Altyazı nesnesinin derin kopyasını oluşturur.
 */
function deepCloneSub(sub) {
  return { id: sub.id, index: sub.index, startTime: sub.startTime, endTime: sub.endTime, text: sub.text };
}

/**
 * Tüm altyazı dizisinin derin kopyasını oluşturur.
 */
function deepCloneSubtitles() {
  return editorState.subtitles.map(s => deepCloneSub(s));
}

/**
 * Undo stack'e işlem ekler, redo stack'i temizler.
 * @param {{type: string, data: object}} action
 */
function pushUndo(action) {
  action.timestamp = Date.now();
  editorState.undoStack.push(action);
  if (editorState.undoStack.length > 50) {
    editorState.undoStack.shift();
  }
  editorState.redoStack = [];
}

/**
 * Son işlemi geri alır.
 */
function undo() {
  if (editorState.undoStack.length === 0) return;

  const action = editorState.undoStack.pop();
  const redoAction = { type: action.type, timestamp: Date.now() };

  switch (action.type) {
    case 'edit_text': {
      const sub = editorState.subtitles[action.data.index];
      redoAction.data = { index: action.data.index, text: sub.text };
      sub.text = action.data.text;
      break;
    }
    case 'edit_time': {
      const sub = editorState.subtitles[action.data.index];
      redoAction.data = { index: action.data.index, startTime: sub.startTime, endTime: sub.endTime };
      sub.startTime = action.data.startTime;
      sub.endTime = action.data.endTime;
      break;
    }
    case 'split': {
      // Bölme geri alınıyor: iki bloğu tek bloğa birleştir
      redoAction.data = {
        index: action.data.index,
        block1: deepCloneSub(editorState.subtitles[action.data.index]),
        block2: deepCloneSub(editorState.subtitles[action.data.index + 1])
      };
      editorState.subtitles[action.data.index] = deepCloneSub(action.data.original);
      editorState.subtitles.splice(action.data.index + 1, 1);
      renumberSubtitles();
      break;
    }
    case 'merge': {
      // Birleştirme geri alınıyor: tek bloğu ikiye ayır
      redoAction.data = {
        index: action.data.index,
        merged: deepCloneSub(editorState.subtitles[action.data.index])
      };
      editorState.subtitles[action.data.index] = deepCloneSub(action.data.block1);
      editorState.subtitles.splice(action.data.index + 1, 0, deepCloneSub(action.data.block2));
      renumberSubtitles();
      break;
    }
    case 'delete': {
      // Silme geri alınıyor: bloğu geri ekle
      redoAction.data = { index: action.data.index };
      editorState.subtitles.splice(action.data.index, 0, deepCloneSub(action.data.deleted));
      renumberSubtitles();
      break;
    }
    case 'offset': {
      // Offset geri alınıyor: snapshot'tan geri yükle
      redoAction.data = { snapshot: deepCloneSubtitles() };
      editorState.subtitles = action.data.snapshot.map(s => deepCloneSub(s));
      break;
    }
  }

  editorState.redoStack.push(redoAction);
  markModified();
  renderList();

  const selectIdx = action.data.index != null ? Math.min(action.data.index, editorState.subtitles.length - 1) : -1;
  if (selectIdx >= 0) selectSubtitle(selectIdx);
}

/**
 * Geri alınan işlemi tekrar uygular.
 */
function redo() {
  if (editorState.redoStack.length === 0) return;

  const action = editorState.redoStack.pop();
  const undoAction = { type: action.type, timestamp: Date.now() };

  switch (action.type) {
    case 'edit_text': {
      const sub = editorState.subtitles[action.data.index];
      undoAction.data = { index: action.data.index, text: sub.text };
      sub.text = action.data.text;
      break;
    }
    case 'edit_time': {
      const sub = editorState.subtitles[action.data.index];
      undoAction.data = { index: action.data.index, startTime: sub.startTime, endTime: sub.endTime };
      sub.startTime = action.data.startTime;
      sub.endTime = action.data.endTime;
      break;
    }
    case 'split': {
      // Bölmeyi tekrar uygula
      undoAction.data = {
        index: action.data.index,
        original: deepCloneSub(editorState.subtitles[action.data.index])
      };
      editorState.subtitles[action.data.index] = deepCloneSub(action.data.block1);
      editorState.subtitles.splice(action.data.index + 1, 0, deepCloneSub(action.data.block2));
      renumberSubtitles();
      break;
    }
    case 'merge': {
      // Birleştirmeyi tekrar uygula
      undoAction.data = {
        index: action.data.index,
        block1: deepCloneSub(editorState.subtitles[action.data.index]),
        block2: deepCloneSub(editorState.subtitles[action.data.index + 1])
      };
      editorState.subtitles[action.data.index] = deepCloneSub(action.data.merged);
      editorState.subtitles.splice(action.data.index + 1, 1);
      renumberSubtitles();
      break;
    }
    case 'delete': {
      // Silmeyi tekrar uygula
      undoAction.data = {
        index: action.data.index,
        deleted: deepCloneSub(editorState.subtitles[action.data.index])
      };
      editorState.subtitles.splice(action.data.index, 1);
      renumberSubtitles();
      break;
    }
    case 'offset': {
      // Offset tekrar uygula
      undoAction.data = { snapshot: deepCloneSubtitles() };
      editorState.subtitles = action.data.snapshot.map(s => deepCloneSub(s));
      break;
    }
  }

  editorState.undoStack.push(undoAction);
  markModified();
  renderList();

  const selectIdx = action.data.index != null ? Math.min(action.data.index, editorState.subtitles.length - 1) : -1;
  if (selectIdx >= 0) selectSubtitle(selectIdx);
}

/**
 * Altyazı indekslerini yeniden numaralar.
 */
function renumberSubtitles() {
  for (let i = 0; i < editorState.subtitles.length; i++) {
    editorState.subtitles[i].index = i + 1;
    editorState.subtitles[i].id = i + 1;
  }
}

// ─── Virtual Scroll Sabitleri ─────────────────────────────────────────────────

const CARD_HEIGHT_ESTIMATE = 64;
const VIRTUAL_BUFFER = 15;
const VIRTUAL_THRESHOLD = 100; // Bu sayının altındaki listeler doğrudan render edilir
let _lastRenderRange = { start: -1, end: -1 };

// ─── Kullanıcı Mesajları ─────────────────────────────────────────────────────

/**
 * Editör içinde kısa süreli bilgi mesajı gösterir.
 * @param {string} text
 * @param {'info'|'warning'|'error'} type
 */
function showEditorMessage(text, type) {
  let toast = document.getElementById('editorToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'editorToast';
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      toolbar.parentNode.insertBefore(toast, toolbar.nextSibling);
    } else {
      return;
    }
  }
  toast.textContent = text;
  toast.className = 'editor-toast toast-' + (type || 'info');
  toast.style.display = 'block';
  if (toast._timeout) clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// ─── Hesaplama Yardımcıları ──────────────────────────────────────────────────

/**
 * Altyazı bloğu için hesaplanan metrikleri döndürür.
 */
function getSubtitleMetrics(sub) {
  const duration = sub.endTime - sub.startTime;
  const lines = sub.text.split('\n');
  const lineCount = lines.length;
  const maxLineLength = Math.max(...lines.map(l => l.length));
  const plainText = sub.text.replace(/\n/g, ' ');
  const charCount = plainText.length;
  const cps = duration > 0 ? charCount / duration : 0;

  let cpsStatus = 'ok';
  if (cps > SRT_CONFIG.maxCPS) cpsStatus = 'error';
  else if (cps > SRT_CONFIG.targetCPS) cpsStatus = 'warning';

  let lineStatus = 'ok';
  if (maxLineLength > SRT_CONFIG.maxSoftCPL) lineStatus = 'error';
  else if (maxLineLength > SRT_CONFIG.maxCharsPerLine) lineStatus = 'warning';

  return { duration, charCount, lineCount, maxLineLength, cps, cpsStatus, lineStatus };
}

// ─── SRT Dosya Yükleme ──────────────────────────────────────────────────────

/**
 * SRT dosyasını okur, parse eder ve listeyi render eder.
 * @param {string} filePath - SRT dosyasının tam yolu
 */
async function loadSRT(filePath) {
  if (!filePath) {
    showEditorMessage('SRT dosya yolu belirtilmedi.', 'warning');
    return;
  }

  try {
    const file = await fs_editor.getEntryWithUrl("file:" + filePath);
    const content = await file.read({ format: uxpfs_editor.formats.utf8 });
    const subtitles = parseSRT(content);

    editorState.subtitles = subtitles;
    editorState.srtFilePath = filePath;
    editorState.selectedIndex = -1;
    markSaved();
    editorState.undoStack = [];
    editorState.redoStack = [];

    renderList();
    loadStyleJSON();
    loadCustomTemplates();

    if (subtitles.length === 0) {
      showEditorMessage('SRT dosyası boş veya geçersiz.', 'warning');
    }
  } catch (e) {
    console.error("loadSRT hatası:", e.message);
    showEditorMessage('SRT yükleme hatası: ' + e.message, 'error');
  }
}

// ─── Liste Render ────────────────────────────────────────────────────────────

/**
 * Filtre/arama kriterlerine uyan altyazı indekslerini döndürür.
 */
function buildFilteredList() {
  const filtered = [];
  for (let i = 0; i < editorState.subtitles.length; i++) {
    const sub = editorState.subtitles[i];
    const metrics = getSubtitleMetrics(sub);
    if (editorState.filterMode === 'cps_error' && metrics.cpsStatus !== 'error') continue;
    if (editorState.filterMode === 'line_error' && metrics.maxLineLength <= SRT_CONFIG.maxCharsPerLine) continue;
    if (editorState.searchQuery && !sub.text.toLowerCase().includes(editorState.searchQuery)) continue;
    filtered.push(i);
  }
  return filtered;
}

/**
 * Altyazı listesini subtitleList konteynerine render eder.
 * Küçük listeler doğrudan, büyük listeler virtual scroll ile render edilir.
 */
function renderList() {
  const container = document.getElementById('subtitleList');
  if (!container) return;

  const filtered = buildFilteredList();
  editorState._filteredIndices = filtered;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="editor-empty">' +
      (editorState.subtitles.length === 0 ? 'Altyazı bulunamadı' : 'Eşleşen altyazı bulunamadı') +
      '</div>';
    _lastRenderRange = { start: -1, end: -1 };
    return;
  }

  // Küçük liste: documentFragment ile doğrudan render
  if (filtered.length <= VIRTUAL_THRESHOLD) {
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const idx of filtered) {
      const sub = editorState.subtitles[idx];
      const metrics = getSubtitleMetrics(sub);
      frag.appendChild(createSubtitleCard(sub, idx, metrics));
    }
    container.appendChild(frag);
    _lastRenderRange = { start: -1, end: -1 };
    return;
  }

  // Büyük liste: virtual scroll
  _lastRenderRange = { start: -1, end: -1 }; // Zorla yeniden render
  renderVirtualList(container, filtered);
  setupVirtualScrollListener(container);
}

/**
 * Virtual scroll: Sadece görünür alandaki kartları render eder.
 */
function renderVirtualList(container, filtered) {
  const totalHeight = filtered.length * CARD_HEIGHT_ESTIMATE;
  const scrollTop = container.scrollTop;
  const viewHeight = container.clientHeight || 400;

  const startVisible = Math.floor(scrollTop / CARD_HEIGHT_ESTIMATE);
  const endVisible = Math.ceil((scrollTop + viewHeight) / CARD_HEIGHT_ESTIMATE);

  let renderStart = Math.max(0, startVisible - VIRTUAL_BUFFER);
  let renderEnd = Math.min(filtered.length, endVisible + VIRTUAL_BUFFER);

  // Seçili kartı her zaman render aralığına dahil et
  const selectedIdx = editorState.selectedIndex;
  if (selectedIdx >= 0 && filtered) {
    const selectedFilteredPos = filtered.indexOf(selectedIdx);
    if (selectedFilteredPos >= 0) {
      if (selectedFilteredPos < renderStart) renderStart = selectedFilteredPos;
      if (selectedFilteredPos >= renderEnd) renderEnd = selectedFilteredPos + 1;
    }
  }

  // Aynı aralık → tekrar render etme
  if (_lastRenderRange.start === renderStart && _lastRenderRange.end === renderEnd) {
    return;
  }
  _lastRenderRange = { start: renderStart, end: renderEnd };

  const savedScroll = container.scrollTop;
  container.innerHTML = '';

  // Üst boşluk
  if (renderStart > 0) {
    const topSpacer = document.createElement('div');
    topSpacer.className = 'virtual-spacer';
    topSpacer.style.height = (renderStart * CARD_HEIGHT_ESTIMATE) + 'px';
    container.appendChild(topSpacer);
  }

  // Görünür kartlar
  const frag = document.createDocumentFragment();
  for (let f = renderStart; f < renderEnd; f++) {
    const idx = filtered[f];
    const sub = editorState.subtitles[idx];
    const metrics = getSubtitleMetrics(sub);
    frag.appendChild(createSubtitleCard(sub, idx, metrics));
  }
  container.appendChild(frag);

  // Alt boşluk
  if (renderEnd < filtered.length) {
    const bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'virtual-spacer';
    bottomSpacer.style.height = ((filtered.length - renderEnd) * CARD_HEIGHT_ESTIMATE) + 'px';
    container.appendChild(bottomSpacer);
  }

  // Scroll pozisyonunu koru
  container.scrollTop = savedScroll;
}

/**
 * Virtual scroll için scroll event listener'ı kurar (bir kez).
 */
function setupVirtualScrollListener(container) {
  if (container._virtualScrollBound) return;
  container._virtualScrollBound = true;

  let scrollRAF = null;
  container.addEventListener('scroll', () => {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(() => {
      scrollRAF = null;
      const filtered = editorState._filteredIndices;
      if (filtered && filtered.length > VIRTUAL_THRESHOLD) {
        renderVirtualList(container, filtered);
      }
    });
  });
}

/**
 * Tek bir altyazı kartı DOM elemanı oluşturur.
 */
function createSubtitleCard(sub, index, metrics) {
  const card = document.createElement('div');
  card.className = 'subtitle-card';
  card.dataset.index = index;

  // Uyarı/hata kenar rengi
  if (metrics.cpsStatus === 'error' || metrics.lineStatus === 'error') {
    card.classList.add('has-error');
  } else if (metrics.cpsStatus === 'warning' || metrics.lineStatus === 'warning') {
    card.classList.add('has-warning');
  }

  // Seçili kart
  if (index === editorState.selectedIndex) {
    card.classList.add('selected');
  }

  // Kart içeriği
  // Üst satır: sıra no + zaman + CPS badge
  const header = document.createElement('div');
  header.className = 'subtitle-card-header';

  const indexLabel = document.createElement('span');
  indexLabel.className = 'subtitle-index';
  indexLabel.textContent = '#' + (index + 1);

  const timeLabel = document.createElement('span');
  timeLabel.className = 'subtitle-time';
  timeLabel.textContent = formatTimestamp(sub.startTime) + ' → ' + formatTimestamp(sub.endTime);

  const cpsBadge = document.createElement('span');
  cpsBadge.className = 'cps-badge-group';
  const cpsDot = document.createElement('span');
  cpsDot.className = 'cps-badge cps-' + metrics.cpsStatus;
  const cpsValue = document.createElement('span');
  cpsValue.className = 'cps-value';
  cpsValue.textContent = metrics.cps.toFixed(1);
  cpsBadge.appendChild(cpsDot);
  cpsBadge.appendChild(cpsValue);

  header.appendChild(indexLabel);
  header.appendChild(timeLabel);
  header.appendChild(cpsBadge);

  // Alt satır: metin + karakter sayacı
  const body = document.createElement('div');
  body.className = 'subtitle-card-body';

  const textPreview = document.createElement('div');
  textPreview.className = 'subtitle-text';

  // Arama vurgulama
  if (editorState.searchQuery) {
    const lowerText = sub.text.toLowerCase();
    const queryLower = editorState.searchQuery;
    const idx = lowerText.indexOf(queryLower);
    if (idx >= 0) {
      const before = sub.text.substring(0, idx);
      const match = sub.text.substring(idx, idx + queryLower.length);
      const after = sub.text.substring(idx + queryLower.length);
      textPreview.innerHTML = '';
      textPreview.appendChild(document.createTextNode(before));
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      mark.textContent = match;
      textPreview.appendChild(mark);
      textPreview.appendChild(document.createTextNode(after));
    } else {
      textPreview.textContent = sub.text;
    }
  } else {
    textPreview.textContent = sub.text;
  }

  const charCount = document.createElement('span');
  charCount.className = 'char-count';
  if (metrics.maxLineLength > SRT_CONFIG.maxSoftCPL) {
    charCount.classList.add('over45');
  } else if (metrics.maxLineLength > SRT_CONFIG.maxCharsPerLine) {
    charCount.classList.add('over42');
  }
  charCount.textContent = metrics.maxLineLength + '/' + SRT_CONFIG.maxCharsPerLine;

  body.appendChild(textPreview);
  body.appendChild(charCount);

  card.appendChild(header);
  card.appendChild(body);

  // Tıklama event
  card.addEventListener('click', () => {
    selectSubtitle(index);
  });

  // Çift tıklama: playhead'i bu altyazının başlangıcına atla
  card.addEventListener('dblclick', () => {
    jumpToTime(sub.startTime);
  });

  return card;
}

// ─── Seçim ───────────────────────────────────────────────────────────────────

/**
 * Altyazıyı seçer, düzenleme alanını doldurur, CSS class'ı günceller.
 */
function selectSubtitle(index) {
  // Bekleyen metin undo'sunu flush et
  if (_textUndoTimer) {
    clearTimeout(_textUndoTimer);
    _textUndoTimer = null;
    if (_textUndoSnapshot !== null && editorState.selectedIndex >= 0) {
      const currentText = editorState.subtitles[editorState.selectedIndex]?.text;
      if (_textUndoSnapshot !== currentText) {
        pushUndo({ type: 'edit_text', data: { index: editorState.selectedIndex, text: _textUndoSnapshot } });
      }
    }
    _textUndoSnapshot = null;
  }

  const prevIndex = editorState.selectedIndex;
  editorState.selectedIndex = index;

  // Önceki seçimi kaldır
  if (prevIndex >= 0) {
    const prevCard = document.querySelector('.subtitle-card[data-index="' + prevIndex + '"]');
    if (prevCard) prevCard.classList.remove('selected');
  }

  // Yeni seçimi uygula
  const card = document.querySelector('.subtitle-card[data-index="' + index + '"]');
  if (card) {
    card.classList.add('selected');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Düzenleme alanını doldur
  const sub = editorState.subtitles[index];
  if (!sub) return;

  const editEmpty = document.getElementById('editEmpty');
  const editContent = document.getElementById('editContent');
  if (editEmpty) editEmpty.style.display = 'none';
  if (editContent) editContent.style.display = 'block';

  const editText = document.getElementById('editText');
  if (editText) editText.value = sub.text;

  const editStartTime = document.getElementById('editStartTime');
  const editEndTime = document.getElementById('editEndTime');
  if (editStartTime) editStartTime.value = formatTimestamp(sub.startTime);
  if (editEndTime) editEndTime.value = formatTimestamp(sub.endTime);

  // Örtüşme border'ını temizle
  if (editStartTime) editStartTime.classList.remove('overlap');
  if (editEndTime) editEndTime.classList.remove('overlap');

  refreshEditIndicators();
}

// ─── Düzenleme Alanı Göstergeleri ─────────────────────────────────────────────

/**
 * Süre, CPS ve satır bilgisi göstergelerini günceller.
 */
function refreshEditIndicators() {
  const index = editorState.selectedIndex;
  if (index < 0 || index >= editorState.subtitles.length) return;

  const sub = editorState.subtitles[index];
  const metrics = getSubtitleMetrics(sub);

  const editDuration = document.getElementById('editDuration');
  if (editDuration) editDuration.textContent = 'Süre: ' + metrics.duration.toFixed(2) + 's';

  const editCPS = document.getElementById('editCPS');
  if (editCPS) {
    editCPS.textContent = 'CPS: ' + metrics.cps.toFixed(1);
    editCPS.className = 'info-item';
    if (metrics.cpsStatus === 'error') editCPS.classList.add('info-error');
    else if (metrics.cpsStatus === 'warning') editCPS.classList.add('info-warning');
  }

  const editLineInfo = document.getElementById('editLineInfo');
  if (editLineInfo) {
    const lines = sub.text.split('\n');
    const parts = lines.map((l, i) => 'Satır ' + (i + 1) + ': ' + l.length + '/' + SRT_CONFIG.maxCharsPerLine);
    editLineInfo.textContent = parts.join(' | ');
  }
}

// ─── Metin Güncelleme ─────────────────────────────────────────────────────────

/**
 * Textarea'daki metin değiştiğinde çağrılır.
 */
function updateText() {
  const index = editorState.selectedIndex;
  if (index < 0 || index >= editorState.subtitles.length) return;

  const editText = document.getElementById('editText');
  if (!editText) return;

  // İlk değişiklikte eski metni snapshot'la
  if (_textUndoSnapshot === null) {
    _textUndoSnapshot = editorState.subtitles[index].text;
  }

  // Metni hemen güncelle (UI anlık tepki versin)
  editorState.subtitles[index].text = editText.value;
  markModified();
  refreshEditIndicators();
  updateCard(index);

  // Debounce: 500ms sessizlikten sonra tek bir undo kaydı oluştur
  if (_textUndoTimer) clearTimeout(_textUndoTimer);
  _textUndoTimer = setTimeout(() => {
    if (_textUndoSnapshot !== null && _textUndoSnapshot !== editText.value) {
      pushUndo({ type: 'edit_text', data: { index: index, text: _textUndoSnapshot } });
    }
    _textUndoSnapshot = null;
    _textUndoTimer = null;
  }, 500);
}

/**
 * Listedeki kartı güncel verilerle yeniden oluşturur.
 */
function updateCard(index) {
  const container = document.getElementById('subtitleList');
  if (!container) return;

  const oldCard = container.querySelector('.subtitle-card[data-index="' + index + '"]');
  if (!oldCard) return;

  const sub = editorState.subtitles[index];
  const metrics = getSubtitleMetrics(sub);
  const newCard = createSubtitleCard(sub, index, metrics);
  container.replaceChild(newCard, oldCard);
}

// ─── Zamanlama Güncelleme ─────────────────────────────────────────────────────

/**
 * Zamanlama değerini delta kadar değiştirir.
 * @param {'start'|'end'} field
 * @param {number} delta — saniye cinsinden (±0.1)
 */
function updateTiming(field, delta) {
  const index = editorState.selectedIndex;
  if (index < 0 || index >= editorState.subtitles.length) return;

  const sub = editorState.subtitles[index];
  pushUndo({ type: 'edit_time', data: { index: index, startTime: sub.startTime, endTime: sub.endTime } });

  if (field === 'start') {
    sub.startTime = Math.max(0, Math.round((sub.startTime + delta) * 1000) / 1000);
  } else {
    sub.endTime = Math.max(0, Math.round((sub.endTime + delta) * 1000) / 1000);
  }

  // Bitiş başlangıçtan önce olamaz
  if (sub.endTime <= sub.startTime) {
    sub.endTime = sub.startTime + 0.1;
  }

  markModified();

  // Input'ları güncelle
  const editStartTime = document.getElementById('editStartTime');
  const editEndTime = document.getElementById('editEndTime');
  if (editStartTime) editStartTime.value = formatTimestamp(sub.startTime);
  if (editEndTime) editEndTime.value = formatTimestamp(sub.endTime);

  // Örtüşme kontrolü
  checkOverlap(index);

  refreshEditIndicators();
  updateCard(index);
}

/**
 * Zamanlama input'undan parse edip günceller.
 * @param {'start'|'end'} field
 */
function updateTimingFromInput(field) {
  const index = editorState.selectedIndex;
  if (index < 0 || index >= editorState.subtitles.length) return;

  const sub = editorState.subtitles[index];
  const inputId = field === 'start' ? 'editStartTime' : 'editEndTime';
  const input = document.getElementById(inputId);
  if (!input) return;

  const parsed = parseTimestamp(input.value);
  if (isNaN(parsed) || parsed < 0) {
    // Geçersiz değer — eski değere geri dön
    input.value = formatTimestamp(field === 'start' ? sub.startTime : sub.endTime);
    return;
  }

  pushUndo({ type: 'edit_time', data: { index: index, startTime: sub.startTime, endTime: sub.endTime } });

  if (field === 'start') {
    sub.startTime = parsed;
  } else {
    sub.endTime = parsed;
  }

  if (sub.endTime <= sub.startTime) {
    sub.endTime = sub.startTime + 0.1;
    if (document.getElementById('editEndTime')) {
      document.getElementById('editEndTime').value = formatTimestamp(sub.endTime);
    }
  }

  markModified();
  checkOverlap(index);
  refreshEditIndicators();
  updateCard(index);
}

/**
 * Önceki/sonraki blokla örtüşme kontrolü.
 */
function checkOverlap(index) {
  const sub = editorState.subtitles[index];
  const editStartTime = document.getElementById('editStartTime');
  const editEndTime = document.getElementById('editEndTime');
  let startOverlap = false;
  let endOverlap = false;

  // Önceki blokla örtüşme
  if (index > 0) {
    const prev = editorState.subtitles[index - 1];
    if (sub.startTime < prev.endTime) startOverlap = true;
  }

  // Sonraki blokla örtüşme
  if (index < editorState.subtitles.length - 1) {
    const next = editorState.subtitles[index + 1];
    if (sub.endTime > next.startTime) endOverlap = true;
  }

  if (editStartTime) {
    if (startOverlap) editStartTime.classList.add('overlap');
    else editStartTime.classList.remove('overlap');
  }
  if (editEndTime) {
    if (endOverlap) editEndTime.classList.add('overlap');
    else editEndTime.classList.remove('overlap');
  }
}

// ─── Böl / Birleştir / Sil ───────────────────────────────────────────────────

/**
 * Seçili altyazıyı imleç pozisyonundan ikiye böler.
 */
function splitSubtitle(index) {
  if (index < 0 || index >= editorState.subtitles.length) {
    showEditorMessage('Bölmek için bir altyazı seçin.', 'warning');
    return;
  }

  const editText = document.getElementById('editText');
  if (!editText) return;

  const cursorPos = editText.selectionStart;
  const text = editorState.subtitles[index].text;

  if (cursorPos <= 0 || cursorPos >= text.length) {
    showEditorMessage('İmleci metnin içine yerleştirin.', 'warning');
    return;
  }

  const sub = editorState.subtitles[index];
  pushUndo({ type: 'split', data: { index: index, original: deepCloneSub(sub) } });

  const textBefore = text.substring(0, cursorPos).trim();
  const textAfter = text.substring(cursorPos).trim();

  if (!textBefore || !textAfter) {
    editorState.undoStack.pop();
    showEditorMessage('Boş parça oluşturulamaz — imleci başka bir yere koyun.', 'warning');
    return;
  }

  const originalEnd = sub.endTime;
  const duration = originalEnd - sub.startTime;
  const totalChars = text.replace(/\s+/g, '').length;
  const firstChars = textBefore.replace(/\s+/g, '').length;
  const ratio = totalChars > 0 ? firstChars / totalChars : 0.5;
  const midTime = Math.round((sub.startTime + duration * ratio) * 1000) / 1000;

  // Orijinal bloğu güncelle (ilk parça)
  sub.text = textBefore;
  sub.endTime = midTime;

  // Yeni bloğu ekle (ikinci parça)
  const newSub = {
    id: index + 2,
    index: index + 2,
    startTime: midTime,
    endTime: originalEnd,
    text: textAfter
  };

  editorState.subtitles.splice(index + 1, 0, newSub);
  renumberSubtitles();
  markModified();

  renderList();
  selectSubtitle(index);
}

/**
 * Seçili altyazıyı bir sonraki ile birleştirir.
 */
function mergeSubtitle(index) {
  if (index < 0 || index >= editorState.subtitles.length) {
    showEditorMessage('Birleştirmek için bir altyazı seçin.', 'warning');
    return;
  }

  if (index >= editorState.subtitles.length - 1) {
    showEditorMessage('Son blok birleştirilemez — sonraki blok yok.', 'warning');
    return;
  }

  const sub1 = editorState.subtitles[index];
  const sub2 = editorState.subtitles[index + 1];

  // CPS kontrolü — gerçek konuşma süresi: gap'i çıkar
  const mergedText = sub1.text + ' ' + sub2.text;
  const gapBetween = Math.max(0, sub2.startTime - sub1.endTime);
  const mergedDuration = (sub2.endTime - sub1.startTime) - gapBetween;
  const mergedCPS = mergedDuration > 0 ? mergedText.replace(/\n/g, ' ').length / mergedDuration : 0;

  if (mergedCPS > SRT_CONFIG.maxCPS) {
    if (!confirm('CPS çok yüksek (' + mergedCPS.toFixed(1) + '). Yine de birleştirmek istiyor musunuz?')) {
      return;
    }
  }

  pushUndo({ type: 'merge', data: { index: index, block1: deepCloneSub(sub1), block2: deepCloneSub(sub2) } });

  // Metin birleştirme: 42 char aşıyorsa \n ile, yoksa boşluk ile
  const line1 = sub1.text.replace(/\n/g, ' ');
  const line2 = sub2.text.replace(/\n/g, ' ');
  if (line1.length + 1 + line2.length <= SRT_CONFIG.maxCharsPerLine) {
    sub1.text = line1 + ' ' + line2;
  } else {
    sub1.text = line1 + '\n' + line2;
  }

  sub1.endTime = sub2.endTime;

  editorState.subtitles.splice(index + 1, 1);
  renumberSubtitles();
  markModified();

  renderList();
  selectSubtitle(index);
}

/**
 * Seçili altyazıyı siler.
 */
function deleteSubtitle(index) {
  if (index < 0 || index >= editorState.subtitles.length) {
    showEditorMessage('Silmek için bir altyazı seçin.', 'warning');
    return;
  }

  if (!confirm('Bu altyazıyı silmek istediğinize emin misiniz?')) {
    return;
  }

  const deleted = deepCloneSub(editorState.subtitles[index]);
  pushUndo({ type: 'delete', data: { index: index, deleted: deleted } });

  editorState.subtitles.splice(index, 1);
  renumberSubtitles();
  markModified();

  renderList();

  // Yeni seçim
  if (editorState.subtitles.length === 0) {
    editorState.selectedIndex = -1;
    const editEmpty = document.getElementById('editEmpty');
    const editContent = document.getElementById('editContent');
    if (editEmpty) editEmpty.style.display = 'block';
    if (editContent) editContent.style.display = 'none';
  } else {
    const newIndex = Math.min(index, editorState.subtitles.length - 1);
    selectSubtitle(newIndex);
  }
}

// ─── Arama ve Filtre ──────────────────────────────────────────────────────────

/**
 * Arama sorgusunu uygular. Eşleşmeyen kartları gizler, eşleşen kelimeyi vurgular.
 */
function searchSubtitles(query) {
  editorState.searchQuery = query.toLowerCase().trim();
  renderList();
}

/**
 * CPS filtre toggle: 'all' ↔ 'cps_error'
 */
function filterByCPS() {
  if (editorState.filterMode === 'cps_error') {
    editorState.filterMode = 'all';
  } else {
    editorState.filterMode = 'cps_error';
  }
  renderList();

  const btn = document.getElementById('btnFilterCPS');
  if (btn) {
    if (editorState.filterMode === 'cps_error') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }
}

/**
 * Satır filtre toggle: 'all' ↔ 'line_error'
 */
function filterByLine() {
  if (editorState.filterMode === 'line_error') {
    editorState.filterMode = 'all';
  } else {
    editorState.filterMode = 'line_error';
  }
  renderList();

  const btn = document.getElementById('btnFilterLine');
  if (btn) {
    if (editorState.filterMode === 'line_error') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  }
}

// ─── Kaydet / Yükle ──────────────────────────────────────────────────────────

/**
 * Düzenlenmiş altyazıyı SRT dosyasına yazar.
 */
async function saveSRT() {
  if (!editorState.srtFilePath || editorState.subtitles.length === 0) {
    showEditorMessage('Kaydedilecek altyazı yok.', 'warning');
    return;
  }

  try {
    const srtContent = writeSRT(editorState.subtitles);
    const file = await fs_editor.getEntryWithUrl("file:" + editorState.srtFilePath);
    await file.write(srtContent, { format: uxpfs_editor.formats.utf8 });
    markSaved();

    const btn = document.getElementById('btnSaveSRT');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Kaydedildi';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }

    // Stil dosyasını da kaydet
    saveStyleJSON();
  } catch (e) {
    console.error("saveSRT hatası:", e.message);
    showEditorMessage('Kaydetme hatası: ' + e.message, 'error');
  }
}

/**
 * SRT dosyasını diskten tekrar yükler.
 */
async function reloadSRT() {
  if (!editorState.srtFilePath) {
    showEditorMessage('Yüklenecek SRT dosyası yok.', 'warning');
    return;
  }

  if (editorState.isModified) {
    if (!confirm('Kaydedilmemiş değişiklikler var. Yeniden yüklemek istediğinize emin misiniz?')) {
      return;
    }
  }

  editorState.undoStack = [];
  editorState.redoStack = [];
  await loadSRT(editorState.srtFilePath);
}

// ─── Offset ──────────────────────────────────────────────────────────────────

/**
 * Offset dialogunu açar/kapatır.
 */
function toggleOffsetDialog() {
  let dialog = document.getElementById('offsetDialog');
  if (dialog) {
    // Zaten açıksa kapat
    dialog.remove();
    return;
  }

  dialog = document.createElement('div');
  dialog.id = 'offsetDialog';
  dialog.className = 'offset-dialog';
  dialog.innerHTML =
    '<label class="offset-label">Offset (ms):</label>' +
    '<input type="number" id="offsetInput" class="offset-input" value="0" step="100" />' +
    '<div class="offset-actions">' +
    '<button class="toolbar-btn" id="btnApplyOffset">Uygula</button>' +
    '<button class="toolbar-btn" id="btnCancelOffset">İptal</button>' +
    '</div>';

  const bottomBar = document.getElementById('bottomBar');
  if (bottomBar) {
    bottomBar.parentNode.insertBefore(dialog, bottomBar);
  }

  document.getElementById('btnApplyOffset').addEventListener('click', () => {
    applyOffset();
    dialog.remove();
  });

  document.getElementById('btnCancelOffset').addEventListener('click', () => {
    dialog.remove();
  });
}

/**
 * Tüm altyazılara offset uygular.
 */
function applyOffset() {
  const input = document.getElementById('offsetInput');
  if (!input) return;

  const offsetMs = parseInt(input.value, 10);
  if (isNaN(offsetMs) || offsetMs === 0) return;

  const offsetSec = offsetMs / 1000;

  // pushUndo: tüm diziyi kaydet (offset özel tip)
  pushUndo({
    type: 'offset',
    data: {
      offsetMs: offsetMs,
      snapshot: deepCloneSubtitles()
    }
  });

  for (const sub of editorState.subtitles) {
    sub.startTime = Math.max(0, Math.round((sub.startTime + offsetSec) * 1000) / 1000);
    sub.endTime = Math.max(0, Math.round((sub.endTime + offsetSec) * 1000) / 1000);
    if (sub.endTime <= sub.startTime) {
      sub.endTime = sub.startTime + 0.1;
    }
  }

  markModified();
  renderList();
  if (editorState.selectedIndex >= 0) selectSubtitle(editorState.selectedIndex);
  showEditorMessage(offsetMs + 'ms offset uygulandı.', 'info');
}

// ─── Export Dropdown ─────────────────────────────────────────────────────────

/**
 * Export dropdown menüsünü toggle eder.
 */
function toggleExportMenu() {
  const menu = document.getElementById('exportMenu');
  if (menu) {
    menu.classList.toggle('visible');
  }
}

/**
 * Seçilen formatta export yapar.
 * @param {'srt'|'vtt'|'txt'} format
 */
async function handleExport(format) {
  if (editorState.subtitles.length === 0) {
    showEditorMessage('Dışa aktarılacak altyazı yok.', 'warning');
    return;
  }

  // Menüyü kapat
  const menu = document.getElementById('exportMenu');
  if (menu) menu.classList.remove('visible');

  let content, extension;
  switch (format) {
    case 'vtt':
      content = exportVTT(editorState.subtitles);
      extension = '.vtt';
      break;
    case 'txt':
      content = exportTXT(editorState.subtitles);
      extension = '.txt';
      break;
    default:
      content = exportSRT(editorState.subtitles);
      extension = '.srt';
      break;
  }

  // Dosya adını oluştur
  const baseName = editorState.srtFilePath
    ? editorState.srtFilePath.replace(/\.[^.]+$/, '')
    : 'altyazi';
  const filePath = baseName + extension;

  try {
    // Aynı dizine kaydet
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
    const fileName = filePath.substring(filePath.lastIndexOf('/') + 1);
    const folder = await fs_editor.getEntryWithUrl("file:" + dirPath);
    const file = await folder.createFile(fileName, { overwrite: true });
    await file.write(content, { format: uxpfs_editor.formats.utf8 });
    const btn = document.getElementById('btnExport');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ ' + format.toUpperCase();
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
    showEditorMessage(format.toUpperCase() + ' dosyası kaydedildi.', 'info');
  } catch (e) {
    console.error("handleExport hatası:", e.message);
    showEditorMessage('Dışa aktarma hatası: ' + e.message, 'error');
  }
}

// ─── Playhead Senkronizasyonu ─────────────────────────────────────────────────

const TICKS_PER_SECOND = 254016000000;
let syncInterval = null;

/**
 * Premiere Pro playhead pozisyonunu saniye olarak döndürür.
 * API yoksa null döner.
 */
async function getPlayheadPosition() {
  try {
    const ppro_ref = require('premierepro');
    const project = await ppro_ref.Project.getActiveProject();
    if (!project) return null;
    const sequence = await project.getActiveSequence();
    if (!sequence) return null;

    if (typeof sequence.getPlayerPosition !== 'function') {
      return null;
    }

    const ticks = await sequence.getPlayerPosition();
    if (ticks == null) return null;

    // Ticks nesne olabilir (TickTime) — .ticks veya doğrudan sayı
    const tickValue = typeof ticks === 'object' ? (ticks.ticks || ticks.seconds * TICKS_PER_SECOND || 0) : ticks;
    return tickValue / TICKS_PER_SECOND;
  } catch (e) {
    return null;
  }
}

/**
 * Verilen zamana karşılık gelen altyazıyı vurgular.
 * @param {number} timeInSeconds
 */
function highlightSubtitleAtTime(timeInSeconds) {
  if (timeInSeconds == null) return;

  // Bu zamana karşılık gelen bloğu bul
  let activeIndex = -1;
  for (let i = 0; i < editorState.subtitles.length; i++) {
    const sub = editorState.subtitles[i];
    if (timeInSeconds >= sub.startTime && timeInSeconds < sub.endTime) {
      activeIndex = i;
      break;
    }
  }

  // Zaten aynı blok aktifse → bir şey yapma
  if (activeIndex === editorState.playheadActiveIndex) return;

  // Önceki aktifin .active class'ını kaldır
  if (editorState.playheadActiveIndex >= 0) {
    const prevCard = document.querySelector('.subtitle-card[data-index="' + editorState.playheadActiveIndex + '"]');
    if (prevCard) prevCard.classList.remove('playhead-active');
  }

  editorState.playheadActiveIndex = activeIndex;

  // Yeni aktife .active ekle ve scroll et
  if (activeIndex >= 0) {
    const card = document.querySelector('.subtitle-card[data-index="' + activeIndex + '"]');
    if (card) {
      card.classList.add('playhead-active');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

/**
 * Playhead senkronizasyonunu başlatır (500ms interval).
 */
function startPlayheadSync() {
  if (syncInterval) return; // Zaten çalışıyor

  // İlk kontrol: API mevcut mu?
  getPlayheadPosition().then(pos => {
    if (pos === null) {
      // Playhead sync API mevcut değil — devre dışı
      editorState.syncEnabled = false;
      return;
    }

    editorState.syncEnabled = true;
    editorState.playheadActiveIndex = -1;

    syncInterval = setInterval(async () => {
      try {
        const pos = await getPlayheadPosition();
        if (pos !== null) {
          editorState.playheadPosition = pos;
          highlightSubtitleAtTime(pos);
        }
      } catch (_) {
        // Sessizce devam et
      }
    }, 500);
  });
}

/**
 * Playhead senkronizasyonunu durdurur.
 */
function stopPlayheadSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  editorState.syncEnabled = false;
  editorState.playheadActiveIndex = -1;
}

/**
 * Playhead'i belirtilen zamana atlar.
 * @param {number} timeInSeconds
 */
async function jumpToTime(timeInSeconds) {
  try {
    const ppro_ref = require('premierepro');
    const project = await ppro_ref.Project.getActiveProject();
    if (!project) return;
    const sequence = await project.getActiveSequence();
    if (!sequence) return;

    if (typeof sequence.setPlayerPosition !== 'function') {
      // setPlayerPosition API mevcut değil
      return;
    }

    const ticks = Math.round(timeInSeconds * TICKS_PER_SECOND);
    await sequence.setPlayerPosition(ticks);
  } catch (e) {
    console.warn("jumpToTime hatası:", e.message);
  }
}

// ─── Stil ve Şablon Sistemi ───────────────────────────────────────────────────

const styleState = {
  fontFamily: 'Arial',
  fontSize: 24,
  bold: false,
  italic: false,
  underline: false,
  textColor: '#FFFFFF',
  bgColor: '#000000',
  bgOpacity: 80,
  position: 'bottom'
};

const TEMPLATES = {
  youtube: {
    fontFamily: 'Arial', fontSize: 24,
    bold: false, italic: false, underline: false,
    textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 80, position: 'bottom'
  },
  tiktok: {
    fontFamily: 'Arial', fontSize: 36,
    bold: true, italic: false, underline: false,
    textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 0, position: 'center'
  },
  sinema: {
    fontFamily: 'Georgia', fontSize: 18,
    bold: false, italic: false, underline: false,
    textColor: '#FFFFFF', bgColor: 'transparent', bgOpacity: 0, position: 'bottom'
  },
  netflix: {
    fontFamily: 'Arial', fontSize: 22,
    bold: false, italic: false, underline: false,
    textColor: '#FFFFFF', bgColor: '#000000', bgOpacity: 80, position: 'bottom'
  }
};

let customTemplates = []; // [{name, ...styleState}]

/**
 * Hazır şablonu styleState'e uygular ve UI'ı günceller.
 */
function applyTemplate(templateName) {
  const tmpl = TEMPLATES[templateName];
  if (!tmpl) return;

  Object.assign(styleState, tmpl);
  syncSettingsUI();

  // Aktif şablon kartını vurgula
  document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
  const card = document.querySelector('.template-card[data-template="' + templateName + '"]');
  if (card) card.classList.add('active');
}

/**
 * Özel şablon uygular.
 */
function applyCustomTemplate(index) {
  if (index < 0 || index >= customTemplates.length) return;
  const tmpl = customTemplates[index];
  Object.assign(styleState, {
    fontFamily: tmpl.fontFamily, fontSize: tmpl.fontSize,
    bold: tmpl.bold, italic: tmpl.italic, underline: tmpl.underline,
    textColor: tmpl.textColor, bgColor: tmpl.bgColor,
    bgOpacity: tmpl.bgOpacity, position: tmpl.position
  });
  syncSettingsUI();
}

/**
 * Mevcut styleState'i özel şablon olarak kaydeder.
 */
async function saveCustomTemplate(name) {
  if (!name || name.trim().length === 0) return;
  if (customTemplates.length >= 10) {
    console.warn("saveCustomTemplate: Maksimum 10 özel şablon");
    return;
  }

  const tmpl = Object.assign({ name: name.trim() }, styleState);
  customTemplates.push(tmpl);

  // JSON dosyasına kaydet
  await persistCustomTemplates();
  renderCustomTemplates();
}

/**
 * Özel şablonu siler.
 */
async function deleteCustomTemplate(index) {
  if (index < 0 || index >= customTemplates.length) return;
  customTemplates.splice(index, 1);
  await persistCustomTemplates();
  renderCustomTemplates();
}

/**
 * Özel şablonları SRT dizinine JSON olarak yazar.
 */
async function persistCustomTemplates() {
  try {
    if (!editorState.srtFilePath) return;
    const dirPath = editorState.srtFilePath.substring(0, editorState.srtFilePath.lastIndexOf('/'));
    const folder = await fs_editor.getEntryWithUrl("file:" + dirPath);

    // altyazi_sablonlar klasörü
    let templatesFolder;
    try {
      templatesFolder = await fs_editor.getEntryWithUrl("file:" + dirPath + '/altyazi_sablonlar');
    } catch (_) {
      templatesFolder = await folder.createFolder('altyazi_sablonlar');
    }

    const file = await templatesFolder.createFile('templates.json', { overwrite: true });
    await file.write(JSON.stringify(customTemplates, null, 2), { format: uxpfs_editor.formats.utf8 });
  } catch (e) {
    console.warn("persistCustomTemplates hatası:", e.message);
  }
}

/**
 * Özel şablonları JSON dosyasından yükler.
 */
async function loadCustomTemplates() {
  try {
    if (!editorState.srtFilePath) return;
    const dirPath = editorState.srtFilePath.substring(0, editorState.srtFilePath.lastIndexOf('/'));
    const filePath = dirPath + '/altyazi_sablonlar/templates.json';
    const file = await fs_editor.getEntryWithUrl("file:" + filePath);
    const content = await file.read({ format: uxpfs_editor.formats.utf8 });
    customTemplates = JSON.parse(content);
    renderCustomTemplates();
  } catch (_) {
    // Dosya yoksa sorun değil
    customTemplates = [];
  }
}

/**
 * Mevcut styleState'i .style.json dosyasına kaydeder.
 */
async function saveStyleJSON() {
  try {
    if (!editorState.srtFilePath) return;
    const stylePath = editorState.srtFilePath.replace(/\.srt$/i, '.style.json');
    const dirPath = stylePath.substring(0, stylePath.lastIndexOf('/'));
    const fileName = stylePath.substring(stylePath.lastIndexOf('/') + 1);
    const folder = await fs_editor.getEntryWithUrl("file:" + dirPath);
    const file = await folder.createFile(fileName, { overwrite: true });
    await file.write(JSON.stringify(styleState, null, 2), { format: uxpfs_editor.formats.utf8 });
  } catch (e) {
    console.warn("saveStyleJSON hatası:", e.message);
  }
}

/**
 * .style.json dosyasından stilleri yükler.
 */
async function loadStyleJSON() {
  try {
    if (!editorState.srtFilePath) return;
    const stylePath = editorState.srtFilePath.replace(/\.srt$/i, '.style.json');
    const file = await fs_editor.getEntryWithUrl("file:" + stylePath);
    const content = await file.read({ format: uxpfs_editor.formats.utf8 });
    const loaded = JSON.parse(content);
    Object.assign(styleState, loaded);
    syncSettingsUI();
  } catch (_) {
    // Dosya yoksa varsayılanları kullan
  }
}

/**
 * styleState'i ayarlar paneli UI kontrollerine yansıtır.
 */
function syncSettingsUI() {
  const fontFamily = document.getElementById('settingFontFamily');
  if (fontFamily) fontFamily.value = styleState.fontFamily;

  const fontSize = document.getElementById('settingFontSize');
  const fontSizeValue = document.getElementById('fontSizeValue');
  if (fontSize) fontSize.value = styleState.fontSize;
  if (fontSizeValue) fontSizeValue.textContent = styleState.fontSize;

  const toggleBold = document.getElementById('toggleBold');
  const toggleItalic = document.getElementById('toggleItalic');
  const toggleUnderline = document.getElementById('toggleUnderline');
  if (toggleBold) toggleBold.classList.toggle('active', styleState.bold);
  if (toggleItalic) toggleItalic.classList.toggle('active', styleState.italic);
  if (toggleUnderline) toggleUnderline.classList.toggle('active', styleState.underline);

  const textColorInput = document.getElementById('settingTextColor');
  if (textColorInput) textColorInput.value = styleState.textColor;
  updateColorPresetSelection('textColorPresets', styleState.textColor);

  const bgColorInput = document.getElementById('settingBgColor');
  if (bgColorInput) bgColorInput.value = styleState.bgColor;
  updateColorPresetSelection('bgColorPresets', styleState.bgColor);

  const bgOpacity = document.getElementById('settingBgOpacity');
  const bgOpacityValue = document.getElementById('bgOpacityValue');
  if (bgOpacity) bgOpacity.value = styleState.bgOpacity;
  if (bgOpacityValue) bgOpacityValue.textContent = styleState.bgOpacity;

  document.querySelectorAll('.position-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.position === styleState.position);
  });

  // Aktif hazır şablon vurgusu
  document.querySelectorAll('.template-card').forEach(c => c.classList.remove('active'));
  for (const [name, tmpl] of Object.entries(TEMPLATES)) {
    const match = Object.keys(tmpl).every(k => styleState[k] === tmpl[k]);
    if (match) {
      const card = document.querySelector('.template-card[data-template="' + name + '"]');
      if (card) card.classList.add('active');
    }
  }

  // Style JSON otomatik kaydet
  saveStyleJSON();
}

/**
 * Renk preset butonlarının aktif durumunu günceller.
 */
function updateColorPresetSelection(containerId, activeColor) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.color-preset').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === activeColor);
  });
}

/**
 * Özel şablon listesini render eder.
 */
function renderCustomTemplates() {
  const list = document.getElementById('customTemplateList');
  if (!list) return;
  list.innerHTML = '';

  for (let i = 0; i < customTemplates.length; i++) {
    const tmpl = customTemplates[i];
    const item = document.createElement('div');
    item.className = 'custom-template-item';

    const nameEl = document.createElement('span');
    nameEl.className = 'custom-template-item-name';
    nameEl.textContent = tmpl.name;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'custom-template-item-delete';
    deleteBtn.textContent = '\u00D7';
    deleteBtn.title = 'Sil';
    const idx = i;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteCustomTemplate(idx);
    });

    item.appendChild(nameEl);
    item.appendChild(deleteBtn);

    item.addEventListener('click', () => {
      applyCustomTemplate(idx);
    });

    list.appendChild(item);
  }
}

/**
 * Ayarlar panelini açar/kapatır.
 */
function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  if (!panel) return;
  const isVisible = panel.style.display !== 'none';
  panel.style.display = isVisible ? 'none' : 'flex';
  if (!isVisible) {
    syncSettingsUI();
    loadCustomTemplates();
  }
}

/**
 * Ayarlar paneli event listener'larını bağlar.
 */
function initSettingsPanel() {
  const btnSettings = document.getElementById('btnSettings');
  if (btnSettings) btnSettings.addEventListener('click', toggleSettings);

  const btnClose = document.getElementById('btnSettingsClose');
  if (btnClose) btnClose.addEventListener('click', toggleSettings);

  // Font ailesi
  const fontFamily = document.getElementById('settingFontFamily');
  if (fontFamily) fontFamily.addEventListener('change', () => {
    styleState.fontFamily = fontFamily.value;
    syncSettingsUI();
  });

  // Font boyutu slider
  const fontSize = document.getElementById('settingFontSize');
  if (fontSize) fontSize.addEventListener('input', () => {
    styleState.fontSize = parseInt(fontSize.value, 10);
    const label = document.getElementById('fontSizeValue');
    if (label) label.textContent = styleState.fontSize;
  });
  if (fontSize) fontSize.addEventListener('change', () => {
    syncSettingsUI();
  });

  // Bold/Italic/Underline toggle
  const toggleBold = document.getElementById('toggleBold');
  if (toggleBold) toggleBold.addEventListener('click', () => {
    styleState.bold = !styleState.bold;
    toggleBold.classList.toggle('active', styleState.bold);
    syncSettingsUI();
  });

  const toggleItalic = document.getElementById('toggleItalic');
  if (toggleItalic) toggleItalic.addEventListener('click', () => {
    styleState.italic = !styleState.italic;
    toggleItalic.classList.toggle('active', styleState.italic);
    syncSettingsUI();
  });

  const toggleUnderline = document.getElementById('toggleUnderline');
  if (toggleUnderline) toggleUnderline.addEventListener('click', () => {
    styleState.underline = !styleState.underline;
    toggleUnderline.classList.toggle('active', styleState.underline);
    syncSettingsUI();
  });

  // Metin renk presetleri
  const textPresets = document.getElementById('textColorPresets');
  if (textPresets) textPresets.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-preset');
    if (btn && btn.dataset.color) {
      styleState.textColor = btn.dataset.color;
      syncSettingsUI();
    }
  });

  // Metin renk input
  const textColorInput = document.getElementById('settingTextColor');
  if (textColorInput) textColorInput.addEventListener('change', () => {
    styleState.textColor = textColorInput.value;
    syncSettingsUI();
  });

  // Arka plan renk presetleri
  const bgPresets = document.getElementById('bgColorPresets');
  if (bgPresets) bgPresets.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-preset');
    if (btn && btn.dataset.color) {
      styleState.bgColor = btn.dataset.color;
      syncSettingsUI();
    }
  });

  // Arka plan renk input
  const bgColorInput = document.getElementById('settingBgColor');
  if (bgColorInput) bgColorInput.addEventListener('change', () => {
    styleState.bgColor = bgColorInput.value;
    syncSettingsUI();
  });

  // Arka plan opaklık slider
  const bgOpacity = document.getElementById('settingBgOpacity');
  if (bgOpacity) bgOpacity.addEventListener('input', () => {
    styleState.bgOpacity = parseInt(bgOpacity.value, 10);
    const label = document.getElementById('bgOpacityValue');
    if (label) label.textContent = styleState.bgOpacity;
  });
  if (bgOpacity) bgOpacity.addEventListener('change', () => {
    syncSettingsUI();
  });

  // Pozisyon toggle
  document.querySelectorAll('.position-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      styleState.position = btn.dataset.position;
      document.querySelectorAll('.position-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      syncSettingsUI();
    });
  });

  // Hazır şablon kartları
  document.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', () => {
      const tmplName = card.dataset.template;
      if (tmplName) applyTemplate(tmplName);
    });
  });

  // Özel şablon kaydet
  const btnSaveTemplate = document.getElementById('btnSaveTemplate');
  if (btnSaveTemplate) btnSaveTemplate.addEventListener('click', () => {
    const input = document.getElementById('templateNameInput');
    if (input && input.value.trim()) {
      saveCustomTemplate(input.value.trim());
      input.value = '';
    }
  });
}

// ─── Event Listener'lar ──────────────────────────────────────────────────────

/**
 * Düzenleme alanı event listener'larını bağlar.
 * index.js'den initEditor() ile çağrılır.
 */
function initEditArea() {
  const editText = document.getElementById('editText');
  if (editText) {
    editText.addEventListener('input', updateText);

    // 3. satırı engelle
    editText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const lines = editText.value.split('\n');
        if (lines.length >= 2) {
          e.preventDefault();
        }
      }
    });
  }

  // Zamanlama butonları
  const btnStartMinus = document.getElementById('btnStartMinus');
  const btnStartPlus = document.getElementById('btnStartPlus');
  const btnEndMinus = document.getElementById('btnEndMinus');
  const btnEndPlus = document.getElementById('btnEndPlus');

  if (btnStartMinus) btnStartMinus.addEventListener('click', () => updateTiming('start', -0.1));
  if (btnStartPlus) btnStartPlus.addEventListener('click', () => updateTiming('start', 0.1));
  if (btnEndMinus) btnEndMinus.addEventListener('click', () => updateTiming('end', -0.1));
  if (btnEndPlus) btnEndPlus.addEventListener('click', () => updateTiming('end', 0.1));

  // Zamanlama input'ları — change event
  const editStartTime = document.getElementById('editStartTime');
  const editEndTime = document.getElementById('editEndTime');

  if (editStartTime) editStartTime.addEventListener('change', () => updateTimingFromInput('start'));
  if (editEndTime) editEndTime.addEventListener('change', () => updateTimingFromInput('end'));

  // Aksiyon butonları
  const btnSplit = document.getElementById('btnSplit');
  const btnMerge = document.getElementById('btnMerge');
  const btnDelete = document.getElementById('btnDelete');

  if (btnSplit) btnSplit.addEventListener('click', () => splitSubtitle(editorState.selectedIndex));
  if (btnMerge) btnMerge.addEventListener('click', () => mergeSubtitle(editorState.selectedIndex));
  if (btnDelete) btnDelete.addEventListener('click', () => deleteSubtitle(editorState.selectedIndex));

  // ─── Üst Araç Çubuğu ───────────────────────────────────────────
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => searchSubtitles(searchInput.value));
  }

  const btnFilterCPS = document.getElementById('btnFilterCPS');
  if (btnFilterCPS) btnFilterCPS.addEventListener('click', filterByCPS);

  const btnFilterLine = document.getElementById('btnFilterLine');
  if (btnFilterLine) btnFilterLine.addEventListener('click', filterByLine);

  const btnUndo = document.getElementById('btnUndo');
  if (btnUndo) btnUndo.addEventListener('click', undo);

  const btnRedo = document.getElementById('btnRedo');
  if (btnRedo) btnRedo.addEventListener('click', redo);

  // ─── Alt Araç Çubuğu ───────────────────────────────────────────
  const btnSaveSRT = document.getElementById('btnSaveSRT');
  if (btnSaveSRT) btnSaveSRT.addEventListener('click', saveSRT);

  const btnReloadSRT = document.getElementById('btnReloadSRT');
  if (btnReloadSRT) btnReloadSRT.addEventListener('click', reloadSRT);

  const btnOffsetBtn = document.getElementById('btnOffset');
  if (btnOffsetBtn) btnOffsetBtn.addEventListener('click', toggleOffsetDialog);

  const btnExport = document.getElementById('btnExport');
  if (btnExport) btnExport.addEventListener('click', toggleExportMenu);

  // Export dropdown menü öğeleri
  const exportMenu = document.getElementById('exportMenu');
  if (exportMenu) {
    exportMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (item && item.dataset.format) {
        handleExport(item.dataset.format);
      }
    });
  }

  // Export menüyü dışarı tıklayınca kapat
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('exportWrapper');
    const menu = document.getElementById('exportMenu');
    if (menu && wrapper && !wrapper.contains(e.target)) {
      menu.classList.remove('visible');
    }
  });

  // Ayarlar paneli
  initSettingsPanel();

  // ─── Klavye Kısayolları ─────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Sadece editor sayfası görünürken aktif
    const pageEditor = document.getElementById('page-editor');
    if (!pageEditor || pageEditor.style.display === 'none') return;

    const isTextInput = e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT';

    // Ctrl+S → her zaman kaydet (textarea içindeyken bile)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveSRT();
      return;
    }

    // Aşağıdaki kısayollar sadece textarea/input dışındayken çalışır
    if (isTextInput) return;

    // Ctrl+Z → undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }

    // Ctrl+Y veya Ctrl+Shift+Z → redo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }

    // ArrowUp → önceki altyazı
    if (e.key === 'ArrowUp' && editorState.selectedIndex > 0) {
      e.preventDefault();
      selectSubtitle(editorState.selectedIndex - 1);
      return;
    }

    // ArrowDown → sonraki altyazı
    if (e.key === 'ArrowDown' && editorState.selectedIndex < editorState.subtitles.length - 1) {
      e.preventDefault();
      selectSubtitle(editorState.selectedIndex + 1);
      return;
    }

    // Delete → seçili altyazıyı sil
    if (e.key === 'Delete' && editorState.selectedIndex >= 0) {
      e.preventDefault();
      deleteSubtitle(editorState.selectedIndex);
      return;
    }
  });
}
