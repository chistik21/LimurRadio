/* ============================================================
   Limurane — музыкальный веб-плеер
   Чистый JavaScript, без фреймворков.
   Хранилище: IndexedDB (аудиофайлы, обложки, метаданные)
   + localStorage (плейлисты, избранное, настройки).
   ============================================================ */

"use strict";

/* ---------------- Утилиты ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgUse(path) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

const ICONS = {
  play: "M8 5.1v13.8L19 12 8 5.1z",
  heart: "M12 21s-7.5-4.6-9.8-9.2C.6 8.4 2.6 4.9 6 4.6c2-.2 3.9.9 6 3.2 2.1-2.3 4-3.4 6-3.2 3.4.3 5.4 3.8 3.8 7.2C19.5 16.4 12 21 12 21z",
  music: "M9 3v10.6A4 4 0 1 0 11 17V7h7V3H9zm9 10.6A4 4 0 1 0 20 17v-7h-2v3.6z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z",
  playlist: "M3 6h12v2H3V6zm0 4h12v2H3v-2zm0 4h8v2H3v-2zm14-2l5 3-5 3v-6z",
  trash: "M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 13H7L6 8z",
  more: "M6 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  search: "M10 3a7 7 0 1 0 4.2 12.6l4.8 4.8 1.5-1.5-4.8-4.8A7 7 0 0 0 10 3zm0 2.2A4.8 4.8 0 1 1 10 14.8 4.8 4.8 0 0 1 10 5.2z",
  remove: "M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5z",
};

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function uid() {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(message) {
  const root = $("#toastRoot");
  if (!root) return;
  const t = el("div", "toast", message);
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 280);
  }, 2200);
  while (root.children.length > 3) root.firstChild.remove();
}

/* ---------------- IndexedDB ---------------- */

const DB_NAME = "limurane";
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files");
      if (!db.objectStoreNames.contains("covers")) db.createObjectStore("covers");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbRequest(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

const idbPut = (store, key, value) => idbRequest(store, "readwrite", (os) => os.put(value, key));
const idbGet = (store, key) => idbRequest(store, "readonly", (os) => os.get(key));
const idbDel = (store, key) => idbRequest(store, "readwrite", (os) => os.delete(key));
const idbGetAll = (store) => idbRequest(store, "readonly", (os) => os.getAll());

/* ---------------- Состояние ---------------- */

const LS_KEY = "limurane.state";

const state = {
  tracks: new Map(),
  playlists: [],
  favorites: [],
  view: "home",
  viewData: null,
  query: "",
  prevView: "home",
  objectUrls: new Map(),
  coverUrls: new Map(),
  volume: 0.9,
  muted: false,
  history: [],
  cloud: [],
  cloudResults: [],
  cloudLoading: false,
  player: {
    queue: [],
    position: -1,
    shuffle: false,
    repeat: "off",
    playingId: null,
  },
};

function saveState() {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        playlists: state.playlists,
        favorites: state.favorites,
        shuffle: state.player.shuffle,
        repeat: state.player.repeat,
        volume: state.volume,
      })
    );
  } catch (e) {
    console.warn("Не удалось сохранить состояние", e);
  }
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.playlists)) state.playlists = data.playlists;
    if (Array.isArray(data.favorites)) state.favorites = data.favorites;
    state.player.shuffle = !!data.shuffle;
    state.player.repeat = data.repeat === "all" || data.repeat === "one" ? data.repeat : "off";
    if (typeof data.volume === "number" && data.volume >= 0 && data.volume <= 1) state.volume = data.volume;
  } catch (e) {
    console.warn("Не удалось прочитать сохранённое состояние", e);
  }
}

/* Облако (Internet Archive) и история прослушивания */
const CLOUD_KEY = "limurane.cloud";
const HISTORY_KEY = "limurane.history";

function saveCloud() {
  try {
    localStorage.setItem(CLOUD_KEY, JSON.stringify(state.cloud.slice(0, 200)));
  } catch (e) {
    console.warn("Облако не сохранено", e);
  }
}

function loadCloud() {
  try {
    const raw = localStorage.getItem(CLOUD_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const t of arr) {
      if (t && t.id && t.source === "cloud" && t.url && !state.tracks.has(t.id)) {
        state.tracks.set(t.id, t);
      }
    }
    state.cloud = arr.filter((t) => t && t.id && state.tracks.has(t.id));
  } catch (e) {
    console.warn("Облако не загружено", e);
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 60)));
  } catch (e) {
    console.warn("История не сохранена", e);
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) state.history = arr.filter((x) => typeof x === "string");
  } catch (e) {
    console.warn("История не загружена", e);
  }
}

/* ---------------- Чтение тегов ID3v2 ---------------- */

function syncSafe(a, o) {
  return (a[o] << 21) | (a[o + 1] << 14) | (a[o + 2] << 7) | a[o + 3];
}

async function readTags(file) {
  const tags = { title: null, artist: null, album: null, cover: null };
  try {
    const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
    if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return tags; // нет "ID3"
    const version = head[3];
    const flags = head[5];
    const tagEnd = Math.min(10 + syncSafe(head, 6), head.length);
    let offset = 10;
    if (flags & 0x40) {
      const extSize = version >= 4 ? syncSafe(head, 10) : (head[10] << 24) | (head[11] << 16) | (head[12] << 8) | head[13];
      offset += extSize;
    }

    while (offset + 10 <= tagEnd) {
      const id = String.fromCharCode(head[offset], head[offset + 1], head[offset + 2], head[offset + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = version >= 4 ? syncSafe(head, offset + 4) : (head[offset + 4] << 24) | (head[offset + 5] << 16) | (head[offset + 6] << 8) | head[offset + 7];
      if (size <= 0 || offset + 10 + size > tagEnd) break;
      const body = head.subarray(offset + 10, offset + 10 + size);

      if (id === "TIT2") tags.title = decodeText(body);
      else if (id === "TPE1") tags.artist = decodeText(body);
      else if (id === "TALB") tags.album = decodeText(body);
      else if (id === "APIC" && body.length > 20 && !tags.cover) tags.cover = extractPicture(body);

      offset += 10 + size;
      if (tags.title && tags.artist && tags.album && tags.cover) break;
    }
  } catch (e) {
    console.warn("Ошибка чтения тегов", e);
  }
  return tags;
}

function decodeText(bytes) {
  try {
    if (!bytes.length) return null;
    const enc = bytes[0];
    const payload = bytes.subarray(1);
    let text;
    if (enc === 0) text = new TextDecoder("latin1").decode(payload);
    else if (enc === 3) text = new TextDecoder("utf-8").decode(payload);
    else if (enc === 1) {
      if (payload[0] === 0xff && payload[1] === 0xfe) text = new TextDecoder("utf-16le").decode(payload.subarray(2));
      else if (payload[0] === 0xfe && payload[1] === 0xff) text = new TextDecoder("utf-16be").decode(payload.subarray(2));
      else text = new TextDecoder("utf-16le").decode(payload);
    } else text = new TextDecoder("utf-16be").decode(payload);
    text = text.replace(/\0+$/g, "").trim();
    return text || null;
  } catch {
    return null;
  }
}

function extractPicture(body) {
  try {
    let i = 1;
    while (i < body.length && body[i] !== 0) i++;
    const mime = new TextDecoder("latin1").decode(body.subarray(1, i)).trim() || "image/jpeg";
    i++;
    i++;
    if (body[0] === 1 || body[0] === 2) {
      while (i + 1 < body.length && !(body[i] === 0 && body[i + 1] === 0)) i += 2;
      i += 2;
    } else {
      while (i < body.length && body[i] !== 0) i++;
      i++;
    }
    if (i >= body.length) return null;
    const type = mime.includes("png") ? "image/png" : "image/jpeg";
    return new Blob([body.subarray(i)], { type });
  } catch {
    return null;
  }
}

/* ---------------- Библиотека ---------------- */

async function addFiles(fileList) {
  const files = Array.from(fileList).filter(
    (f) => f.type.startsWith("audio/") || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i.test(f.name)
  );
  if (!files.length) {
    toast("Среди выбранных файлов нет аудио");
    return;
  }
  toast(`Обработка ${files.length} файл(ов)…`);

  for (const file of files) {
    const id = uid();
    const tags = await readTags(file);
    const fallbackTitle = file.name.replace(/\.[^.]+$/, "");
    const duration = await probeDuration(file);

    const meta = {
      id,
      title: tags.title || fallbackTitle,
      artist: tags.artist || "Неизвестный исполнитель",
      album: tags.album || "Без альбома",
      duration,
      added: Date.now(),
      hasCover: false,
      fileName: file.name,
    };

    await idbPut("files", id, { blob: file, name: file.name, meta });
    if (tags.cover) {
      try {
        await idbPut("covers", id, tags.cover);
        meta.hasCover = true;
        await idbPut("files", id, { blob: file, name: file.name, meta });
      } catch (e) {
        console.warn("Обложка не сохранена", e);
      }
    }
    state.tracks.set(id, meta);
  }

  saveState();
  render();
  refreshSidebar();
  toast(`Добавлено в библиотеку: ${files.length}`);
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    const done = (d) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : 0);
    };
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = url;
    setTimeout(() => done(a.duration), 8000);
  });
}

async function ensureTrackUrl(id) {
  const t = state.tracks.get(id);
  if (t && t.source === "cloud") return t.url;
  if (state.objectUrls.has(id)) return state.objectUrls.get(id);
  const rec = await idbGet("files", id);
  if (!rec || !rec.blob) return "";
  const url = URL.createObjectURL(rec.blob);
  state.objectUrls.set(id, url);
  return url;
}

async function getCoverUrl(id) {
  const t = state.tracks.get(id);
  if (t && t.source === "cloud") {
    if (!state.coverUrls.has(id) && t.coverUrl) state.coverUrls.set(id, t.coverUrl);
    return state.coverUrls.get(id) || null;
  }
  if (state.coverUrls.has(id)) return state.coverUrls.get(id);
  if (!state.tracks.get(id)?.hasCover) return null;
  const blob = await idbGet("covers", id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  state.coverUrls.set(id, url);
  return url;
}

function deleteTrack(id) {
  const t = state.tracks.get(id);
  if (!t) return;
  /* Spotify-треки удаляет их модуль (метаданные без файлов) */
  if (t.source === "spotify" && window.SpotifyViews) {
    SpotifyViews.onTrackDeleted(id);
    return;
  }
  const isCloud = t.source === "cloud";
  state.tracks.delete(id);
  state.cloud = state.cloud.filter((c) => c.id !== id);
  saveCloud();
  state.favorites = state.favorites.filter((fid) => fid !== id);
  state.playlists.forEach((p) => (p.trackIds = p.trackIds.filter((x) => x !== id)));
  if (!isCloud) {
    idbDel("files", id).catch(() => {});
    idbDel("covers", id).catch(() => {});
  }
  const url = state.objectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    state.objectUrls.delete(id);
  }
  const cov = state.coverUrls.get(id);
  if (cov) {
    URL.revokeObjectURL(cov);
    state.coverUrls.delete(id);
  }
  if (state.player.playingId === id) stopPlayback();
  saveState();
  render();
  refreshSidebar();
  toast(`Трек «${t.title}» удалён`);
}

function stopPlayback() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  state.player.playingId = null;
  state.player.position = -1;
  updatePlayerUI();
}

/* ---------------- Воспроизведение ---------------- */

const audio = $("#audio");

/* Безопасный запуск воспроизведения: play() может не вернуть Promise */
function safePlay(el = audio) {
  try {
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch {
    /* игнорируем */
  }
}

function playTrack(id, queueIds) {
  const queue = queueIds && queueIds.length ? [...queueIds] : [id];
  if (!queue.includes(id)) queue.unshift(id);
  state.player.queue = queue;
  state.player.position = queue.indexOf(id);
  playCurrent();
}

async function playCurrent() {
  const { queue, position } = state.player;
  if (position < 0 || position >= queue.length) return;
  const id = queue[position];
  const track = state.tracks.get(id);
  if (!track) {
    state.player.queue = queue.filter((x) => x !== id);
    state.player.position = Math.min(position, state.player.queue.length - 1);
    if (state.player.queue.length) playCurrent();
    else stopPlayback();
    return;
  }
  if (position !== queue.indexOf(id)) return; // пользователь уже переключился

  /* Audio Spotify Web API не отдаётся — открываем страницу трека */
  if (track.source === "spotify") {
    toast("Аудио Spotify в API недоступно — открываю страницу трека");
    window.open(track.url, "_blank", "noopener");
    return;
  }

  const url = await ensureTrackUrl(id);
  if (!url) {
    toast("Файл трека недоступен");
    return;
  }
  audio.src = url;
  audio.volume = state.muted ? 0 : state.volume;
  safePlay();
  state.player.playingId = id;
  $("#timeCur").textContent = "0:00";
  $("#timeTotal").textContent = track.duration ? fmtTime(track.duration) : "0:00";
  const seek = $("#seek");
  seek.value = 0;
  paintRange(seek, "var(--accent)");
  updatePlayerUI();
  updateMediaSession(track);
}

function togglePlay() {
  if (!state.player.playingId) {
    const ids = currentViewTrackIds();
    if (ids.length) playTrack(shuffleFirst(ids), state.player.shuffle ? shuffleOrder(ids) : ids);
    else if (state.tracks.size) playTrack(shuffleFirst([...state.tracks.keys()]), [...state.tracks.keys()]);
    return;
  }
  if (audio.paused) safePlay();
  else audio.pause();
}

function shuffleFirst(ids) {
  return state.player.shuffle ? ids[Math.floor(Math.random() * ids.length)] : ids[0];
}

function shuffleOrder(ids) {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function nextTrack(auto = false) {
  const p = state.player;
  if (!p.queue.length) return;
  if (p.repeat === "one" && auto) {
    audio.currentTime = 0;
    safePlay();
    return;
  }
  let pos = p.position + 1;
  if (pos >= p.queue.length) {
    if (p.repeat === "all" || !auto) pos = 0;
    else {
      audio.pause();
      return;
    }
  }
  p.position = pos;
  playCurrent();
}

function prevTrack() {
  const p = state.player;
  if (!p.queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  p.position = p.position <= 0 ? p.queue.length - 1 : p.position - 1;
  playCurrent();
}

function toggleShuffle() {
  const p = state.player;
  p.shuffle = !p.shuffle;
  if (p.queue.length) {
    if (p.shuffle) {
      const current = p.playingId || p.queue[p.position];
      const rest = p.queue.filter((x) => x !== current);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      p.queue = current ? [current, ...rest] : rest;
      p.position = current ? 0 : -1;
    } else {
      const ctx = currentViewTrackIds();
      const ordered = ctx.filter((id) => p.queue.includes(id));
      p.queue = ordered.length ? ordered : p.queue;
      p.position = Math.max(0, p.queue.indexOf(p.playingId));
    }
  }
  updatePlayerUI();
  saveState();
  toast(p.shuffle ? "Перемешивание включено" : "Перемешивание выключено");
}

function cycleRepeat() {
  const p = state.player;
  p.repeat = p.repeat === "off" ? "all" : p.repeat === "all" ? "one" : "off";
  updatePlayerUI();
  saveState();
  toast(p.repeat === "off" ? "Повтор выключен" : p.repeat === "all" ? "Повтор списка" : "Повтор трека");
}

function seekBy(sec) {
  if (Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + sec), audio.duration);
  }
}

/* ---------------- UI плеера ---------------- */

function updatePlayerUI() {
  const p = state.player;
  const track = p.playingId ? state.tracks.get(p.playingId) : null;

  $("#npTitle").textContent = track ? track.title : "Ничего не играет";
  $("#npArtist").textContent = track ? track.artist : "Limurane";

  const playBtn = $("#btnPlay");
  const isPlaying = !audio.paused && !!p.playingId;
  playBtn.classList.toggle("playing", isPlaying);
  playBtn.setAttribute("aria-pressed", String(isPlaying));
  playBtn.setAttribute("aria-label", isPlaying ? "Пауза" : "Играть");

  const cover = $("#npCover");
  cover.replaceChildren();
  if (track && state.coverUrls.has(track.id)) {
    const img = el("img");
    img.alt = "";
    img.src = state.coverUrls.get(track.id);
    cover.appendChild(img);
  } else {
    cover.appendChild(svgUse(ICONS.music));
  }

  const favBtn = $("#npFav");
  favBtn.disabled = !track;
  favBtn.classList.toggle("liked", !!(track && state.favorites.includes(track.id)));

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch { /* no-op */ }
  }

  $("#btnShuffle").classList.toggle("on", p.shuffle);
  $("#btnShuffle").setAttribute("aria-pressed", String(p.shuffle));

  const rep = $("#btnRepeat");
  rep.classList.toggle("on", p.repeat !== "off");
  rep.setAttribute("aria-pressed", String(p.repeat !== "off"));
  rep.title = p.repeat === "off" ? "Повтор: выкл" : p.repeat === "all" ? "Повтор: весь список" : "Повтор: текущий трек";
  $(".repeat-badge", rep).hidden = p.repeat !== "one";

  document.querySelectorAll(".track.playing").forEach((row) => row.classList.remove("playing"));
  if (p.playingId) document.querySelectorAll(`.track[data-id="${p.playingId}"]`).forEach((row) => row.classList.add("playing"));
}

audio.addEventListener("play", updatePlayerUI);
audio.addEventListener("pause", updatePlayerUI);
audio.addEventListener("ended", () => nextTrack(true));

/* История прослушивания */
audio.addEventListener("play", () => {
  const id = state.player.playingId;
  if (!id) return;
  state.history = [id, ...state.history.filter((x) => x !== id)].slice(0, 60);
  saveHistory();
});

audio.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(audio.duration)) $("#timeTotal").textContent = fmtTime(audio.duration);
});

audio.addEventListener("timeupdate", () => {
  const seek = $("#seek");
  if (!seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    seek.value = (audio.currentTime / audio.duration) * 100;
    paintRange(seek, "var(--accent)");
    $("#timeCur").textContent = fmtTime(audio.currentTime);
  }
});

/* Перемотка */

let seeking = false;

$("#seek").addEventListener("input", (e) => {
  seeking = true;
  const pct = Number(e.target.value);
  paintRange(e.target, "var(--accent)");
  if (Number.isFinite(audio.duration)) $("#timeCur").textContent = fmtTime((pct / 100) * audio.duration);
});

$("#seek").addEventListener("change", (e) => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(e.target.value) / 100) * audio.duration;
  seeking = false;
});

/* Громкость */

function paintRange(input, color) {
  const min = Number(input.min) || 0;
  const max = Number(input.max);
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.background = `linear-gradient(to right, ${color} 0%, #33334a ${pct}%)`;
}

function applyVolumeUI() {
  const vol = $("#volume");
  vol.value = state.volume;
  paintRange(vol, "var(--text)");
  audio.volume = state.muted ? 0 : state.volume;
  $("#btnMute").classList.toggle("muted", state.muted);
}

$("#volume").addEventListener("input", (e) => {
  state.volume = Number(e.target.value);
  state.muted = state.volume === 0;
  applyVolumeUI();
  saveState();
});

$("#btnMute").addEventListener("click", () => {
  state.muted = !state.muted;
  applyVolumeUI();
  saveState();
});

/* Кнопки плеера */

$("#btnPlay").addEventListener("click", togglePlay);
$("#btnNext").addEventListener("click", () => nextTrack(false));
$("#btnPrev").addEventListener("click", prevTrack);
$("#btnShuffle").addEventListener("click", toggleShuffle);
$("#btnRepeat").addEventListener("click", cycleRepeat);
$("#npFav").addEventListener("click", () => {
  if (state.player.playingId) toggleFavorite(state.player.playingId);
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea") || e.target.isContentEditable) return;
  switch (e.code) {
    case "Space":
      e.preventDefault();
      togglePlay();
      break;
    case "ArrowRight":
      e.preventDefault();
      e.shiftKey ? nextTrack(false) : seekBy(5);
      break;
    case "ArrowLeft":
      e.preventDefault();
      e.shiftKey ? prevTrack() : seekBy(-5);
      break;
    case "ArrowUp":
      e.preventDefault();
      state.volume = Math.min(1, state.volume + 0.05);
      state.muted = false;
      applyVolumeUI();
      saveState();
      break;
    case "ArrowDown":
      e.preventDefault();
      state.volume = Math.max(0, state.volume - 0.05);
      applyVolumeUI();
      saveState();
      break;
  }
});

/* MediaSession */

function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: state.coverUrls.has(track.id) ? [{ src: state.coverUrls.get(track.id), sizes: "512x512" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => safePlay());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => prevTrack());
    navigator.mediaSession.setActionHandler("seekbackward", () => seekBy(-10));
    navigator.mediaSession.setActionHandler("seekforward", () => seekBy(10));
  } catch {
    /* нет поддержки */
  }
}

/* ---------------- Избранное ---------------- */

function toggleFavorite(id) {
  const i = state.favorites.indexOf(id);
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push(id);
  saveState();
  render();
  refreshSidebar();
  updatePlayerUI();
}

/* ---------------- Плейлисты ---------------- */

function createPlaylist(name, trackIds = []) {
  const pl = { id: uid(), name: name.trim() || "Новый плейлист", trackIds: [...trackIds], created: Date.now() };
  state.playlists.push(pl);
  saveState();
  refreshSidebar();
  return pl;
}

function deletePlaylist(id) {
  const i = state.playlists.findIndex((p) => p.id === id);
  if (i < 0) return;
  const [pl] = state.playlists.splice(i, 1);
  if (state.view === "playlist" && state.viewData === id) navigate("home");
  saveState();
  refreshSidebar();
  render();
  toast(`Плейлист «${pl.name}» удалён`);
}

function addToPlaylist(playlistId, trackId) {
  const pl = state.playlists.find((p) => p.id === playlistId);
  const track = state.tracks.get(trackId);
  if (!pl || !track) return;
  if (pl.trackIds.includes(trackId)) {
    toast(`«${track.title}» уже есть в «${pl.name}»`);
    return;
  }
  pl.trackIds.push(trackId);
  saveState();
  refreshSidebar();
  render();
  toast(`Добавлено в «${pl.name}»`);
}

let pendingPlaylistAction = null;
let pendingTrackForNewPlaylist = null;

function openPlaylistModal(mode = "create", playlist = null) {
  const modal = $("#playlistModal");
  $("#playlistModalTitle").textContent = mode === "create" ? "Новый плейлист" : "Переименовать плейлист";
  $("#playlistSubmit").textContent = mode === "create" ? "Создать" : "Сохранить";
  $("#playlistNameInput").value = mode === "create" ? "" : playlist.name;
  pendingPlaylistAction = { mode, playlist };
  modal.showModal();
  $("#playlistNameInput").focus();
}

$("#playlistForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("#playlistNameInput").value.trim();
  if (!name) return;
  const modal = $("#playlistModal");
  if (pendingPlaylistAction.mode === "create") {
    const trackIds = pendingTrackForNewPlaylist ? [pendingTrackForNewPlaylist] : [];
    const pl = createPlaylist(name, trackIds);
    pendingTrackForNewPlaylist = null;
    pendingPlaylistAction = null;
    modal.close();
    if (trackIds.length) toast(`Добавлено в «${pl.name}»`);
    else toast(`Плейлист «${pl.name}» создан`);
    navigate("playlist", pl.id);
  } else if (pendingPlaylistAction.playlist) {
    pendingPlaylistAction.playlist.name = name;
    pendingPlaylistAction = null;
    modal.close();
    saveState();
    refreshSidebar();
    render();
    toast("Плейлист переименован");
  }
});

$("#playlistCancel").addEventListener("click", () => {
  pendingPlaylistAction = null;
  pendingTrackForNewPlaylist = null;
  $("#playlistModal").close();
});

$("#btnNewPlaylist").addEventListener("click", () => openPlaylistModal());

/* ---------------- Контекстное меню ---------------- */

function closeMenus() {
  $("#menuRoot").replaceChildren();
}

function showMenu(x, y, items) {
  closeMenus();
  const menu = el("div", "ctx-menu");
  for (const item of items) {
    if (item.label) {
      menu.appendChild(el("div", "ctx-label", item.label));
      continue;
    }
    const btn = el("button", "ctx-item" + (item.danger ? " danger" : ""));
    if (item.icon) btn.appendChild(svgUse(ICONS[item.icon]));
    btn.appendChild(el("span", null, item.text));
    btn.addEventListener("click", () => {
      closeMenus();
      item.action();
    });
    menu.appendChild(btn);
  }
  $("#menuRoot").appendChild(menu);
  menu.style.left = Math.min(x, innerWidth - menu.offsetWidth - 8) + "px";
  menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 8) + "px";
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".ctx-menu") && !e.target.closest("[data-menu]")) closeMenus();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenus();
});

function trackMenuItems(track) {
  const items = [
    {
      text: state.favorites.includes(track.id) ? "Убрать из избранного" : "В избранное",
      icon: "heart",
      action: () => toggleFavorite(track.id),
    },
  ];

  items.push({ label: "Добавить в плейлист" });
  if (!state.playlists.length) {
    items.push({ text: "Плейлистов пока нет", action: () => openPlaylistModal() });
  } else {
    for (const pl of state.playlists) {
      items.push({ text: pl.name, icon: "playlist", action: () => addToPlaylist(pl.id, track.id) });
    }
  }
  items.push({
    text: "Создать плейлист с этим треком…",
    icon: "plus",
    action: () => {
      pendingTrackForNewPlaylist = track.id;
      openPlaylistModal();
    },
  });

  if (state.view === "playlist") {
    const pl = state.playlists.find((p) => p.id === state.viewData);
    if (pl && pl.trackIds.includes(track.id)) {
      items.push({
        text: "Убрать из плейлиста",
        icon: "remove",
        action: () => {
          pl.trackIds = pl.trackIds.filter((x) => x !== track.id);
          saveState();
          refreshSidebar();
          render();
          toast(`Убрано из «${pl.name}»`);
        },
      });
    }
  }

  items.push({
    text: "Удалить из библиотеки",
    icon: "trash",
    danger: true,
    action: () => {
      if (confirm(`Удалить «${track.title}» из библиотеки? Файл будет удалён безвозвратно.`)) deleteTrack(track.id);
    },
  });
  return items;
}

/* ---------------- Построение элементов ---------------- */

async function attachCover(container, trackId) {
  const url = await getCoverUrl(trackId);
  if (!url || !container.isConnected) return;
  container.replaceChildren();
  const img = el("img");
  img.alt = "";
  img.src = url;
  img.loading = "lazy";
  container.appendChild(img);
}

function makeTrackRow(track, index, queueIds) {
  const row = el("div", "track");
  row.dataset.id = track.id;

  const numWrap = el("div", "track-numwrap");
  const num = el("div", "track-num", String(index + 1));
  const eq = el("div", "track-eq");
  eq.appendChild(el("i"));
  eq.appendChild(el("i"));
  eq.appendChild(el("i"));
  numWrap.appendChild(num);
  numWrap.appendChild(eq);
  row.appendChild(numWrap);

  const cover = el("div", "track-cover");
  cover.appendChild(svgUse(ICONS.music));
  attachCover(cover, track.id);
  row.appendChild(cover);

  const main = el("div", "track-main");
  main.appendChild(el("div", "track-title", track.title));
  main.appendChild(el("div", "track-artist", track.artist));
  row.appendChild(main);

  row.appendChild(el("div", "track-album", track.album));

  const actions = el("div", "track-actions");

  const favBtn = el("button", "icon-btn small fav-btn");
  favBtn.classList.toggle("liked", state.favorites.includes(track.id));
  favBtn.title = state.favorites.includes(track.id) ? "Убрать из избранного" : "В избранное";
  favBtn.setAttribute("aria-label", favBtn.title);
  favBtn.appendChild(svgUse(ICONS.heart));
  favBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(track.id);
  });
  actions.appendChild(favBtn);

  const moreBtn = el("button", "icon-btn small");
  moreBtn.dataset.menu = "1";
  moreBtn.title = "Ещё";
  moreBtn.setAttribute("aria-label", "Действия с треком");
  moreBtn.appendChild(svgUse(ICONS.more));
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = moreBtn.getBoundingClientRect();
    showMenu(r.right - 220, r.bottom + 6, trackMenuItems(track));
  });
  actions.appendChild(moreBtn);

  row.appendChild(actions);

  row.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    playTrack(track.id, queueIds);
  });

  return row;
}

function makeTrackList(trackIds) {
  const list = el("div", "track-list");
  trackIds.forEach((id, i) => {
    const t = state.tracks.get(id);
    if (t) list.appendChild(makeTrackRow(t, i, trackIds));
  });
  return list;
}

function makeEmptyState({ icon, title, text, actionLabel, actionFn }) {
  const wrap = el("div", "empty");
  const ic = el("div", "empty-icon");
  ic.appendChild(svgUse(icon));
  wrap.appendChild(ic);
  wrap.appendChild(el("h3", null, title));
  wrap.appendChild(el("p", null, text));
  if (actionLabel) {
    const btn = el("button", "btn primary", actionLabel);
    btn.addEventListener("click", actionFn);
    wrap.appendChild(btn);
  }
  return wrap;
}

function makeSection(title, moreLabel, moreFn) {
  const sec = el("section", "section");
  const head = el("div", "section-head");
  head.appendChild(el("h2", "section-title", title));
  if (moreLabel && moreFn) {
    const more = el("button", "section-more", moreLabel);
    more.addEventListener("click", moreFn);
    head.appendChild(more);
  }
  sec.appendChild(head);
  return sec;
}

/* ---------------- Виды (страницы) ---------------- */

const viewEl = $("#view");

function navigate(view, data = null) {
  closeMenus();
  if (state.view !== "search") state.prevView = state.view;
  state.view = view;
  state.viewData = data;
  render();
  refreshSidebar();
  viewEl.scrollTop = 0;
}

function currentViewTrackIds() {
  /* Виды Spotify не имеют локальной очереди треков */
  if (state.view.startsWith("spotify-")) return [];
  switch (state.view) {
    case "favorites":
      return state.favorites.filter((id) => state.tracks.has(id));
    case "album":
      return albumGroups().get(state.viewData)?.ids ?? [];
    case "playlist": {
      const pl = state.playlists.find((p) => p.id === state.viewData);
      return pl ? pl.trackIds.filter((id) => state.tracks.has(id)) : [];
    }
    case "search":
      return searchTracks().map((t) => t.id);
    case "cloud":
      return [...state.tracks.values()].filter((t) => t.source === "cloud").map((t) => t.id);
    default:
      return [...state.tracks.keys()];
  }
}

function albumGroups() {
  const map = new Map();
  for (const t of state.tracks.values()) {
    const key = `${t.album}||${t.artist}`;
    if (!map.has(key)) map.set(key, { album: t.album, artist: t.artist, ids: [], coverId: null });
    const g = map.get(key);
    g.ids.push(t.id);
    if (!g.coverId && t.hasCover) g.coverId = t.id;
  }
  map.forEach((g) => g.ids.sort((a, b) => (state.tracks.get(a)?.added || 0) - (state.tracks.get(b)?.added || 0)));
  return map;
}

function searchTracks() {
  const q = state.query.toLowerCase();
  return [...state.tracks.values()].filter(
    (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q)
  );
}

function render() {
  viewEl.replaceChildren();
  if (state.query) return renderSearch();
  /* Виды Spotify рисует их модуль */
  if (state.view.startsWith("spotify-") && window.SpotifyViews && SpotifyViews.views[state.view]) {
    return SpotifyViews.views[state.view]();
  }
  switch (state.view) {
    case "favorites":
      return renderFavorites();
    case "album":
      return renderAlbum();
    case "playlist":
      return renderPlaylist();
    case "cloud":
      return renderCloud();
    default:
      return renderHome();
  }
}

/* --- Главная --- */

function renderHome() {
  const tracks = [...state.tracks.values()];
  if (!tracks.length) {
    viewEl.appendChild(
      makeEmptyState({
        icon: ICONS.music,
        title: "Библиотека пуста",
        text: "Загрузите свои аудиофайлы — Limurane прочитает теги и обложки и соберёт вашу медиатеку. Файлы останутся в браузере и сохранятся после перезагрузки страницы.",
        actionLabel: "Добавить треки",
        actionFn: () => $("#fileInput").click(),
      })
    );
    return;
  }

  viewEl.appendChild(makeHero("Главная", "Библиотека", `${tracks.length} трек(ов)`, null));

  const albums = albumGroups();
  if (albums.size) {
    const sec = makeSection("Альбомы");
    const grid = el("div", "grid");
    let count = 0;
    for (const g of albums.values()) {
      grid.appendChild(makeAlbumCard(g));
      count++;
      if (count >= 8) break;
    }
    sec.appendChild(grid);
    if (albums.size > 8) {
      const more = el("button", "section-more", `Показать все альбомы (${albums.size}) →`);
      more.style.marginTop = "12px";
      more.addEventListener("click", () => {
        grid.replaceChildren();
        for (const g of albums.values()) grid.appendChild(makeAlbumCard(g));
        more.remove();
      });
      sec.appendChild(more);
    }
    viewEl.appendChild(sec);
  }

  const secPl = makeSection("Плейлисты", "Создать", () => openPlaylistModal());
  if (state.playlists.length) {
    const grid = el("div", "grid");
    for (const pl of state.playlists) grid.appendChild(makePlaylistCard(pl));
    secPl.appendChild(grid);
  } else {
    const empty = el("p", null, "Плейлистов пока нет — создайте первый или щёлкните ⋯ у любого трека.");
    empty.style.color = "var(--text-dim)";
    empty.style.fontSize = "14px";
    empty.style.padding = "4px 0 10px";
    secPl.appendChild(empty);
  }
  viewEl.appendChild(secPl);

  const secAll = makeSection("Все треки");
  const ids = [...state.tracks.keys()];
  secAll.appendChild(makeTrackList(ids));
  viewEl.appendChild(secAll);
}

function makeHero(kicker, title, metaText, coverContainer) {
  const hero = el("div", "hero");
  let cv = coverContainer;
  if (!cv) {
    cv = el("div", "hero-placeholder big");
    cv.appendChild(svgUse(ICONS.music));
  }
  hero.appendChild(cv);
  const text = el("div", "hero-text");
  text.appendChild(el("div", "hero-kicker", kicker));
  text.appendChild(el("h1", "hero-title", title));
  if (metaText) text.appendChild(el("div", "hero-meta", metaText));
  hero.appendChild(text);
  return hero;
}

function makeAlbumCard(g) {
  const card = el("div", "card");
  const cover = el("div", "card-cover");
  cover.appendChild(svgUse(ICONS.music));
  if (g.coverId) attachCover(cover, g.coverId);
  const play = el("button", "card-play");
  play.setAttribute("aria-label", `Играть альбом ${g.album}`);
  play.appendChild(svgUse(ICONS.play));
  cover.appendChild(play);
  card.appendChild(cover);

  card.appendChild(el("div", "card-title", g.album));
  card.appendChild(el("div", "card-sub", `${g.artist} · ${g.ids.length}`));

  card.addEventListener("click", (e) => {
    if (e.target.closest(".card-play")) {
      playTrack(g.ids[0], g.ids);
      return;
    }
    navigate("album", `${g.album}||${g.artist}`);
  });
  return card;
}

function makePlaylistCard(pl) {
  const card = el("div", "card");
  const cover = el("div", "card-cover");
  cover.appendChild(svgUse(ICONS.playlist));
  const firstWithCover = pl.trackIds.map((id) => state.tracks.get(id)).find((t) => t && t.hasCover);
  if (firstWithCover) attachCover(cover, firstWithCover.id);
  const play = el("button", "card-play");
  play.setAttribute("aria-label", `Играть плейлист ${pl.name}`);
  play.appendChild(svgUse(ICONS.play));
  cover.appendChild(play);
  card.appendChild(cover);

  card.appendChild(el("div", "card-title", pl.name));
  card.appendChild(el("div", "card-sub", `Плейлист · ${pl.trackIds.length}`));

  card.addEventListener("click", (e) => {
    if (e.target.closest(".card-play")) {
      if (pl.trackIds.length) playTrack(pl.trackIds[0], pl.trackIds);
      else toast("В этом плейлисте нет треков");
      return;
    }
    navigate("playlist", pl.id);
  });
  return card;
}

/* --- Альбом --- */

function renderAlbum() {
  const g = albumGroups().get(state.viewData);
  if (!g) {
    navigate("home");
    return;
  }
  viewEl.appendChild(makeViewBack());
  const hero = el("div", "hero");
  const coverWrap = el("div", "hero-cover");
  coverWrap.appendChild(svgUse(ICONS.music));
  if (g.coverId) attachCover(coverWrap, g.coverId);
  hero.appendChild(coverWrap);
  const text = el("div", "hero-text");
  text.appendChild(el("div", "hero-kicker", "Альбом"));
  text.appendChild(el("h1", "hero-title", g.album));
  text.appendChild(el("div", "hero-meta"));
  $(".hero-meta", text).append(
    el("b", null, g.artist),
    document.createTextNode(` · ${g.ids.length} трек(ов)`)
  );
  const actions = el("div", "hero-actions");
  actions.appendChild(makeActionBtn("Играть", "Играть альбом", () => playTrack(g.ids[0], g.ids)));
  const favAll = el("button", "btn ghost", "Всё в избранное");
  favAll.addEventListener("click", () => {
    let added = 0;
    g.ids.forEach((id) => {
      if (!state.favorites.includes(id)) {
        state.favorites.push(id);
        added++;
      }
    });
    if (added) {
      saveState();
      render();
      refreshSidebar();
      toast(`Добавлено в избранное: ${added}`);
    } else toast("Все треки уже в избранном");
  });
  actions.appendChild(favAll);
  text.appendChild(actions);
  hero.appendChild(text);
  viewEl.appendChild(hero);

  const sec = makeSection("Треки альбома");
  sec.appendChild(makeTrackList(g.ids));
  viewEl.appendChild(sec);
}

function makeViewBack() {
  const back = el("button", "view-back", "← Назад");
  back.addEventListener("click", goBack);
  return back;
}

function makeActionBtn(text, label, fn) {
  const btn = el("button", "btn primary", text);
  btn.setAttribute("aria-label", label);
  btn.addEventListener("click", fn);
  return btn;
}

/* --- Плейлист --- */

function renderPlaylist() {
  const pl = state.playlists.find((p) => p.id === state.viewData);
  if (!pl) {
    navigate("home");
    return;
  }
  const ids = pl.trackIds.filter((id) => state.tracks.has(id));

  viewEl.appendChild(makeViewBack());

  const hero = el("div", "hero");
  const coverWrap = el("div", "hero-cover card-stacked");
  const inner = el("div", "card-cover");
  inner.appendChild(svgUse(ICONS.playlist));
  const firstWithCover = ids.map((id) => state.tracks.get(id)).find((t) => t && t.hasCover);
  if (firstWithCover) attachCover(inner, firstWithCover.id);
  coverWrap.appendChild(inner);
  hero.appendChild(coverWrap);

  const text = el("div", "hero-text");
  text.appendChild(el("div", "hero-kicker", "Плейлист"));
  text.appendChild(el("h1", "hero-title", pl.name));
  const dur = ids.reduce((acc, id) => acc + (state.tracks.get(id)?.duration || 0), 0);
  text.appendChild(el("div", "hero-meta"));
  $(".hero-meta", text).append(document.createTextNode(`${ids.length} трек(ов) · ${fmtTime(dur)}`));

  const actions = el("div", "hero-actions");
  const playBtn = makeActionBtn("Играть", `Играть плейлист ${pl.name}`, () => {
    if (ids.length) playTrack(ids[0], ids);
    else toast("Добавьте треки через ⋯ у любого трека");
  });
  actions.appendChild(playBtn);

  const renameBtn = el("button", "btn ghost", "Переименовать");
  renameBtn.addEventListener("click", () => openPlaylistModal("rename", pl));
  actions.appendChild(renameBtn);

  const delBtn = el("button", "btn ghost danger", "Удалить");
  delBtn.addEventListener("click", () => {
    if (confirm(`Удалить плейлист «${pl.name}»? Треки останутся в библиотеке.`)) deletePlaylist(pl.id);
  });
  actions.appendChild(delBtn);
  text.appendChild(actions);
  hero.appendChild(text);
  viewEl.appendChild(hero);

  const sec = makeSection("Треки плейлиста");
  if (ids.length) sec.appendChild(makeTrackList(ids));
  else {
    const hint = el("p", null, "Пока пусто. Щёлкните ⋯ рядом с любым треком в библиотеке и выберите «Добавить в плейлист».");
    hint.style.color = "var(--text-dim)";
    hint.style.fontSize = "14px";
    sec.appendChild(hint);
  }
  viewEl.appendChild(sec);
}

/* --- Избранное --- */

function renderFavorites() {
  const ids = state.favorites.filter((id) => state.tracks.has(id));
  const hero = el("div", "hero");
  const coverWrap = el("div", "hero-placeholder big");
  const heart = svgUse(ICONS.heart);
  heart.style.color = "var(--accent)";
  coverWrap.appendChild(heart);
  hero.appendChild(coverWrap);

  const text = el("div", "hero-text");
  text.appendChild(el("div", "hero-kicker", "Коллекция"));
  text.appendChild(el("h1", "hero-title", "Избранное"));
  text.appendChild(el("div", "hero-meta"));
  $(".hero-meta", text).append(document.createTextNode(`${ids.length} трек(ов)`));
  const actions = el("div", "hero-actions");
  const playBtn = el("button", "btn primary", "Играть");
  playBtn.setAttribute("aria-label", "Играть избранное");
  playBtn.addEventListener("click", () => {
    if (ids.length) playTrack(ids[0], ids);
    else toast("Избранное пусто");
  });
  actions.appendChild(playBtn);
  text.appendChild(actions);
  hero.appendChild(text);
  viewEl.appendChild(hero);

  const sec = makeSection("Любимые треки");
  if (ids.length) sec.appendChild(makeTrackList(ids));
  else {
    sec.appendChild(
      makeEmptyState({
        icon: ICONS.heart,
        title: "Здесь появятся любимые треки",
        text: "Нажимайте на сердечко у трека или в нижнем плеере, чтобы сохранить его в избранное. Избранное сохраняется после перезагрузки страницы.",
      })
    );
  }
  viewEl.appendChild(sec);
}

/* --- Поиск --- */

function renderSearch() {
  const q = state.query;

  if (!state.tracks.size || !searchTracks().length) {
    viewEl.appendChild(
      makeEmptyState({
        icon: ICONS.search,
        title: "Ничего не найдено",
        text: `По запросу «${q}» ничего нет. Проверьте раскладку или поищите по названию трека, исполнителю или альбому.`,
      })
    );
    return;
  }

  const found = searchTracks();
  const head = el("div", "view-header");
  head.appendChild(el("h1", "section-title", `Результаты: «${q}»`));
  viewEl.appendChild(head);

  const secT = makeSection("Треки");
  secT.appendChild(makeTrackList(found.map((t) => t.id)));
  viewEl.appendChild(secT);

  const albums = new Map();
  for (const g of albumGroups().values()) {
    if (g.album.toLowerCase().includes(q.toLowerCase()) || g.artist.toLowerCase().includes(q.toLowerCase())) {
      albums.set(g.album + g.artist, g);
    }
  }
  if (albums.size) {
    const secA = makeSection("Альбомы");
    const grid = el("div", "grid");
    for (const g of albums.values()) grid.appendChild(makeAlbumCard(g));
    secA.appendChild(grid);
    viewEl.appendChild(secA);
  }

  const pls = state.playlists.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  if (pls.length) {
    const secP = makeSection("Плейлисты");
    const grid = el("div", "grid");
    for (const pl of pls) grid.appendChild(makePlaylistCard(pl));
    secP.appendChild(grid);
    viewEl.appendChild(secP);
  }
}

/* ---------------- Облако (Internet Archive) ---------------- */

const ARCHIVE = "https://archive.org";
let cloudQuery = "";

async function fetchJSON(url) {
  if (typeof fetch !== "function") throw new Error("fetch недоступен");
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  return resp.json();
}

function parseLength(len) {
  if (!len) return 0;
  if (typeof len === "number" && Number.isFinite(len)) return Math.round(len * 10) / 10;
  if (String(len).includes(":")) {
    const parts = String(len).split(":").map(Number);
    if (parts.some(Number.isNaN)) return 0;
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  const sec = parseFloat(len);
  return Number.isFinite(sec) ? Math.round(sec * 10) / 10 : 0;
}

const CLOUD_PRESETS = [
  { label: "Нетлейблы (CC)", q: 'collection:netlabels' },
  { label: "Электроника", q: 'collection:netlabels AND subject:"electronic"' },
  { label: "Хип-хоп", q: 'collection:netlabels AND subject:"hip hop"' },
  { label: "Олдскул", q: 'collection:78rpm_and_early_cinema OR collection:oldtimeradio' },
  { label: "Рейв/Jungle", q: 'collection:netlabels AND (subject:jungle OR subject:rave)' },
];

async function cloudSearch(q) {
  /* Spotify подключается параллельным поиском (модуль spotify.js) */
  if (window.SpotifyViews && typeof SpotifyViews.cloudHook === "function") SpotifyViews.cloudHook(q);
  cloudQuery = q;
  state.cloudLoading = true;
  state.cloudResults = [];
  render();
  try {
    const expr = q.trim()
      ? `(mediatype:audio) AND (${q.trim()})`
      : "(mediatype:audio) AND (collection:netlabels)";
    const url =
      `${ARCHIVE}/advancedsearch.php?q=${encodeURIComponent(expr)}` +
      `&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=creator&fl%5B%5D=downloads` +
      `&rows=24&page=1&output=json&sort%5B%5D=downloads+desc`;
    const data = await fetchJSON(url);
    const docs = (data.response && data.response.docs) || [];
    state.cloudResults = docs.map((d) => ({
      identifier: d.identifier,
      title: d.title || d.identifier,
      creator: Array.isArray(d.creator) ? d.creator.join(", ") : d.creator || "",
      downloads: d.downloads || 0,
    }));
  } catch (e) {
    console.warn("Поиск в облаке не удался", e);
    toast("Облако недоступно: " + e.message);
  }
  state.cloudLoading = false;
  render();
}

async function cloudLoadItem(doc) {
  toast("Загружаю альбом из архива…");
  try {
    const meta = await fetchJSON(`${ARCHIVE}/metadata/${encodeURIComponent(doc.identifier)}`);
    const files = (meta.files || [])
      .filter((f) => f.format && f.format.includes("MP3") && /\.mp3$/i.test(f.name || ""))
      .slice(0, 12);
    if (!files.length) {
      toast("В этом альбоме нет MP3 на воспроизведение");
      return;
    }
    const creator =
      doc.creator ||
      (Array.isArray(meta.metadata && meta.metadata.creator)
        ? meta.metadata.creator.join(", ")
        : (meta.metadata && meta.metadata.creator) || "Из архива");
    const album = doc.title;
    const ids = [];
    for (const f of files) {
      const id = "c" + Math.abs(
        [...`${doc.identifier}/${f.name}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7)
      ).toString(36);
      if (state.tracks.has(id)) {
        ids.push(id);
        continue;
      }
      const baseName = (f.title || f.name.replace(/\.[^.]+$/, "")).replace(/^\d+[\s.\-_]+/, "");
      const trackTitle = files.length > 1 ? `${doc.title} — ${baseName}` : baseName === doc.title ? doc.title : `${doc.title} · ${baseName}`;
      const tmeta = {
        id,
        title: trackTitle.slice(0, 120),
        artist: creator,
        album,
        duration: parseLength(f.length),
        added: Date.now(),
        hasCover: false,
        fileName: f.name,
        source: "cloud",
        coverUrl: `${ARCHIVE}/services/img/${encodeURIComponent(doc.identifier)}`,
        url: `${ARCHIVE}/download/${encodeURIComponent(doc.identifier)}/${encodeURIComponent(f.name)}`,
      };
      state.cloud.push(tmeta);
      state.tracks.set(id, tmeta);
      state.coverUrls.set(id, tmeta.coverUrl);
      ids.push(id);
    }
    saveCloud();
    render();
    refreshSidebar();
    if (ids.length) playTrack(ids[0], ids);
  } catch (e) {
    console.warn("Альбом из облака не загрузился", e);
    toast("Альбом недоступен: " + e.message);
  }
}

function renderCloud() {
  const head = el("div", "cloud-head");
  head.appendChild(el("div", "hero-kicker", "Облако"));
  const title = el("h1", "hero-title", "Internet Archive");
  title.style.fontSize = "clamp(22px, 4.5vw, 32px)";
  head.appendChild(title);
  head.appendChild(
    el("p", "cloud-note", "Открытая фонотека archive.org: CC-музыка, нетлейблы, олдскул. Играет через ваш плеер — обложки, избранное и плейлисты работают как обычно.")
  );
  viewEl.appendChild(head);

  /* Поисковая строка */
  const form = el("form", "cloud-search");
  form.setAttribute("role", "search");
  const input = el("input");
  input.type = "search";
  input.placeholder = "Поиск в архиве: исполнитель, трек, коллекция…";
  input.value = cloudQuery;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Поиск в Internet Archive");
  const btn = el("button", "btn primary", "Найти");
  btn.type = "submit";
  form.appendChild(input);
  form.appendChild(btn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    cloudSearch(input.value);
  });
  viewEl.appendChild(form);

  /* Быстрые подборки */
  const chips = el("div", "cloud-chips");
  CLOUD_PRESETS.forEach((p) => {
    const chip = el("button", "chip", p.label);
    chip.addEventListener("click", () => cloudSearch(p.q));
    chips.appendChild(chip);
  });
  viewEl.appendChild(chips);

  if (state.cloudLoading) {
    const spin = el("div", "spinner-wrap");
    const s = el("div", "spinner");
    spin.appendChild(s);
    spin.appendChild(el("span", null, "Ищу в архиве…"));
    viewEl.appendChild(spin);
    return;
  }

  if (cloudQuery && state.cloudResults.length) {
    const sec = makeSection("Найдено в архиве", "сброс", () => {
      cloudQuery = "";
      state.cloudResults = [];
      render();
    });
    const grid = el("div", "grid");
    for (const doc of state.cloudResults) grid.appendChild(makeCloudCard(doc));
    sec.appendChild(grid);
    viewEl.appendChild(sec);
  } else if (cloudQuery) {
    viewEl.appendChild(
      makeEmptyState({
        icon: ICONS.search,
        title: "В архиве такого не нашлось",
        text: "Попробуйте другое слово или откройте готовые подборки выше.",
      })
    );
  }

  /* Строка подключения и результаты Spotify (модуль spotify.js) */
  if (window.SpotifyViews) viewEl.appendChild(SpotifyViews.cloudExtras());

  /* История прослушивания */
  const histIds = state.history.filter((id) => state.tracks.has(id));
  const secHist = makeSection("Недавно играло", histIds.length ? "очистить" : null, () => {
    state.history = [];
    saveHistory();
    render();
  });
  if (histIds.length) {
    secHist.appendChild(makeTrackList(histIds));
  } else {
    const hint = el("p", null, "Пока пусто. Включите что-нибудь из архива или библиотеки — свежие треки будут появляться здесь.");
    hint.style.color = "var(--text-dim)";
    hint.style.fontSize = "14px";
    secHist.appendChild(hint);
  }
  viewEl.appendChild(secHist);
}

function makeCloudCard(doc) {
  const card = el("div", "card");
  const cover = el("div", "card-cover");
  const img = el("img");
  img.alt = "";
  img.loading = "lazy";
  img.src = `${ARCHIVE}/services/img/${encodeURIComponent(doc.identifier)}`;
  img.onerror = () => img.remove();
  cover.appendChild(img);
  card.appendChild(cover);
  card.appendChild(el("div", "card-title", doc.title));
  card.appendChild(el("div", "card-sub", doc.creator || "из архива"));
  card.addEventListener("click", () => cloudLoadItem(doc));
  return card;
}

/* ---------------- Боковая панель ---------------- */

function refreshSidebar() {
  const nav = $("#sideNav");
  if (nav) {
    nav.querySelectorAll(".side-link").forEach((b) => b.classList.toggle("active", b.dataset.nav === state.view));
  }

  const list = $("#sidePlaylists");
  if (!list) return;
  list.replaceChildren();

  if (!state.playlists.length) {
    const p = el("div", "ctx-empty", "Плейлистов нет");
    p.style.padding = "4px 12px";
    list.appendChild(p);
  }
  for (const pl of state.playlists) {
    const b = el("button", "side-playlist");
    if (state.view === "playlist" && state.viewData === pl.id) b.classList.add("active");
    const cov = el("div", "mini-cover");
    b.appendChild(cov);
    b.appendChild(el("span", "pl-name", pl.name));
    b.appendChild(el("span", "pl-count", String(pl.trackIds.length)));
    b.addEventListener("click", () => {
      closeSidebar();
      navigate("playlist", pl.id);
    });
    list.appendChild(b);
  }

  const favCount = $("#favCount");
  const n = state.favorites.filter((id) => state.tracks.has(id)).length;
  favCount.hidden = n === 0;
  favCount.textContent = String(n);

  const cloudCount = $("#cloudCount");
  if (cloudCount) {
    const cn = state.cloud.length;
    cloudCount.hidden = cn === 0;
    cloudCount.textContent = String(cn);
  }
}

/* ---------------- Навигационные события ---------------- */

$("#sideNav").addEventListener("click", (e) => {
  const btn = e.target.closest(".side-link");
  if (!btn) return;
  closeSidebar();
  if (state.query) {
    state.query = "";
    $("#searchInput").value = "";
    $("#searchClear").hidden = true;
  }
  navigate(btn.dataset.nav);
});

$("#btnBurger").addEventListener("click", () => {
  $("#sidebar").classList.add("open");
  $("#sidebarBackdrop").hidden = false;
});

$("#btnUploadSide").addEventListener("click", () => {
  closeSidebar();
  $("#fileInput").click();
});
$("#btnUpload").addEventListener("click", () => $("#fileInput").click());

function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebarBackdrop").hidden = true;
}

$("#sidebarBackdrop").addEventListener("click", closeSidebar);

function goBack() {
  if (state.query) {
    state.query = "";
    $("#searchInput").value = "";
    $("#searchClear").hidden = true;
    navigate(state.prevView);
  } else navigate("home");
}

$("#btnBack").addEventListener("click", goBack);

/* Поиск */

const searchInput = $("#searchInput");
searchInput.addEventListener("input", () => {
  state.query = searchInput.value.trim();
  $("#searchClear").hidden = !state.query;
  $("#btnBack").hidden = !state.query && !["album", "playlist"].includes(state.view);
  render();
});

$("#searchClear").addEventListener("click", () => {
  searchInput.value = "";
  state.query = "";
  $("#searchClear").hidden = true;
  $("#btnBack").hidden = !["album", "playlist"].includes(state.view);
  render();
  searchInput.focus();
});

/* Загрузка файлов */

const fileInput = $("#fileInput");
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) addFiles(fileInput.files);
  fileInput.value = "";
});

document.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
});

document.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }
});

/* ---------------- Инициализация ---------------- */

async function loadLibrary() {
  try {
    loadCloud();
    loadHistory();
    const records = await idbGetAll("files");
    for (const rec of records) {
      if (!rec || !rec.meta) continue;
      state.tracks.set(rec.meta.id, rec.meta);
    }
    state.favorites = state.favorites.filter((id) => state.tracks.has(id));
  } catch (e) {
    console.warn("Библиотека не загружена", e);
  }
}

function init() {
  loadSavedState();
  $("#btnShuffle").classList.toggle("on", state.player.shuffle);
  const rep = $("#btnRepeat");
  rep.classList.toggle("on", state.player.repeat !== "off");
  $(".repeat-badge", rep).hidden = state.player.repeat !== "one";
  applyVolumeUI();
  paintRange($("#seek"), "var(--accent)");
}

async function boot() {
  init();
  refreshSidebar();
  render();
  await loadLibrary();
  refreshSidebar();
  render();
}

boot();
