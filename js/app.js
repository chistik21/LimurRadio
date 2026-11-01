/* ============================================================
   Упоротая волна — интернет-радио
   Потоки: UPWAVE (AzuraCast), Radio Record (AAC+), SomaFM (MP3).
   Живые обложки и история — js/live.js (RadioLive).
   Состояние (избранное, громкость, последняя волна) — localStorage.
   ============================================================ */

"use strict";

/* ---------------- Утилиты ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* Уважаем системную настройку «уменьшить движение» */
const CALM = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Тонкий указатель — можно включать курсорные эффекты стекла */
const FINE = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/* Диагностика на устройстве: ошибка показывается на экране, а не тонет в консоли */
window.addEventListener("error", (e) => {
  const msg = (e && (e.error && e.error.message || e.message)) || "неизвестная ошибка";
  const root = $("#toastRoot");
  if (!root) return;
  toast("Ошибка: " + msg, true);
}, true);

window.addEventListener("unhandledrejection", (e) => {
  const reason = e && e.reason;
  const msg = (reason && (reason.message || String(reason))) || "отказ обещания";
  toast("Ошибка: " + msg, true);
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(path, cls = "") {
  const wrap = el("span", "ic" + (cls ? " " + cls : ""));
  wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  return wrap;
}

const ICON = {
  heart: "M12 20.3 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8A4.7 4.7 0 0 1 19.4 13L12 20.3z",
  play: "M9 5.4v13.2c0 .8.9 1.3 1.6.9l10-6.6c.6-.4.6-1.4 0-1.8l-10-6.6c-.7-.5-1.6 0-1.6.9z",
  pause: "M8 5h3.2v14H8V5zm4.8 0H16v14h-3.2V5z",
  note: "M9 18.2a3.1 3.1 0 1 1 1.8-2.8V5l9-1.9v3.3l-7.2 1.5v7.1A3.1 3.1 0 0 1 9 18.2z",
  shazam: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm-4.2 6.6c.4 0 .7.3.7.7v2.1a.7.7 0 0 1-1.4 0V9.3c0-.4.3-.7.7-.7zm8.4-1.4c.4 0 .7.3.7.7v5.5a.7.7 0 0 1-1.4 0V9.9c0-.4.3-.7.7-.7zM12 8.2c.4 0 .7.3.7.7v6.2a.7.7 0 0 1-1.4 0V8.9c0-.4.3-.7.7-.7zm-2.1 2.2c.4 0 .7.3.7.7v2.4a.7.7 0 0 1-1.4 0v-2.4c0-.4.3-.7.7-.7zm4.2-.8c.4 0 .7.3.7.7v4.1a.7.7 0 0 1-1.4 0v-4.1c0-.4.3-.7.7-.7z",
  waves: "M3 12h2.2l1.6-5.4L9.4 18 12 6l2.4 9.5 1.9-5.6 1.2 2.1H21",
  radio: "M3 8.2 15.8 4.4l.6 2-3.1.9H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.2a1 1 0 0 1 0-1zM5 9v9h14V9H5zm9.4 2.2a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zm0 1.8a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM7 10h4.6v1.8H7V10z",
  sparkle: "M12 2.6l1.9 5.1 5.1 1.9-5.1 1.9L12 16.6l-1.9-5.1L5 9.6l5.1-1.9L12 2.6zM18.4 14.4l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3zM5.2 14.8l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z",
  heartCrack: "M12 20.3 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8A4.7 4.7 0 0 1 19.4 13L12 20.3zM12 6.8l-1.4 3 2.2 1.6-1.6 2.4 1.2 2.3",
};

function toast(message, isError = false) {
  const root = $("#toastRoot");
  if (!root) return;
  const t = el("div", "toast glass-chrome-flat" + (isError ? " error" : ""));
  t.textContent = message;
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 320);
  }, 2600);
  while (root.children.length > 3) root.firstChild.remove();
}

/* ---------------- Волны ---------------- */

const STATIONS = [
  { id: "volna",   name: "Упоротая волна",     genre: "музыка всех направлений", stream: "https://stream.net-fm.ru/listen/upwaveradio/stream128", color: "#8fa6d8", mood: "main", origin: "upwave", quality: "128 kbps", nowplaying: "https://stream.net-fm.ru/api/nowplaying/upwaveradio" },
  { id: "volna-hq", name: "Упоротая волна HQ", genre: "максимум качества",       stream: "https://stream.net-fm.ru/listen/upwaveradio/stream320", color: "#9d8fd6", mood: "main", origin: "upwave", quality: "320 kbps", nowplaying: "https://stream.net-fm.ru/api/nowplaying/upwaveradio" },

  { id: "gop",     name: "Гоп FM",             genre: "хардбасс на весь двор",  stream: "https://radiorecord.hostingradio.ru/gop96.aacp",     color: "#d68fae", mood: "loud", origin: "record", quality: "AAC+" },
  { id: "hbass",   name: "Hard Bass",          genre: "качает фундамент",       stream: "https://radiorecord.hostingradio.ru/hbass96.aacp",   color: "#d8907e", mood: "loud", origin: "record", quality: "AAC+" },
  { id: "rave",    name: "Rave FM",            genre: "рейв без прав",          stream: "https://radiorecord.hostingradio.ru/rave96.aacp",   color: "#8fb4d8", mood: "loud", origin: "record", quality: "AAC+" },
  { id: "ps",      name: "Pirate Station",     genre: "днб-корсары",            stream: "https://radiorecord.hostingradio.ru/ps96.aacp",     color: "#7fa8c8", mood: "loud", origin: "record", quality: "AAC+" },
  { id: "dub",     name: "Dubstep",            genre: "вайбры фундамента",      stream: "https://radiorecord.hostingradio.ru/dub96.aacp",    color: "#cdb894", mood: "loud", origin: "record", quality: "AAC+" },
  { id: "techno",  name: "Techno",             genre: "бетонный пульс",         stream: "https://radiorecord.hostingradio.ru/techno96.aacp", color: "#9d8fd6", mood: "loud", origin: "record", quality: "AAC+" },
  { id: "goa",     name: "GOA / PSY",          genre: "психонавтика",           stream: "https://radiorecord.hostingradio.ru/goa96.aacp",    color: "#82c4b8", mood: "loud", origin: "record", quality: "AAC+" },

  { id: "chil",    name: "Chill-Out",          genre: "плавно и туманно",       stream: "https://radiorecord.hostingradio.ru/chil96.aacp",   color: "#8fb4d8", mood: "calm", origin: "record", quality: "AAC+" },
  { id: "chillh",  name: "Chill House",        genre: "дом, но расслабленный",  stream: "https://radiorecord.hostingradio.ru/chillhouse96.aacp", color: "#8fc0d8", mood: "calm", origin: "record", quality: "AAC+" },
  { id: "lofih",   name: "Lo-Fi House",        genre: "шершавый винил",         stream: "https://radiorecord.hostingradio.ru/lofihouse96.aacp", color: "#b9a8d6", mood: "calm", origin: "record", quality: "AAC+" },
  { id: "soma-gs", name: "Groove Salad",       genre: "амбиент и эмбиент-биты", stream: "https://ice1.somafm.com/groovesalad-256-mp3",       color: "#82c4b8", mood: "calm", origin: "soma", quality: "MP3 256" },
  { id: "soma-dc", name: "DEF CON Radio",      genre: "для хакеров и не только", stream: "https://ice1.somafm.com/defcon-256-mp3",           color: "#8fc0d8", mood: "calm", origin: "soma", quality: "MP3 256" },

  { id: "sd90",    name: "Супердискотека 90-х", genre: "дискотека из детства",  stream: "https://radiorecord.hostingradio.ru/sd9096.aacp",  color: "#d8a87a", mood: "olds", origin: "record", quality: "AAC+" },
  { id: "y1980",   name: "Record 80-х",        genre: "синт-волны и круиз",     stream: "https://radiorecord.hostingradio.ru/198096.aacp",  color: "#d68fae", mood: "olds", origin: "record", quality: "AAC+" },
  { id: "rus",     name: "Russian Mix",        genre: "ностальгия по-нашему",   stream: "https://radiorecord.hostingradio.ru/rus96.aacp",   color: "#8fa6d8", mood: "olds", origin: "record", quality: "AAC+" },
  { id: "soma-80", name: "Underground 80s",    genre: "подпольные восьмидесятые", stream: "https://ice1.somafm.com/u80s-256-mp3",           color: "#9d8fd6", mood: "olds", origin: "soma", quality: "MP3 256" },
];

const SECTIONS = [
  { key: "main", title: "Главная волна", hint: "то самое радио", icon: ICON.sparkle },
  { key: "loud", title: "Жарко-упорото", hint: "соседи напишут заявление", icon: ICON.waves },
  { key: "calm", title: "Нормально-упорото", hint: "мозг медленно выходит в окно", icon: ICON.note },
  { key: "olds", title: "Олды тут", hint: "классика, что вертится", icon: ICON.radio },
];

const MOOD_COLORS = { main: "#8fa6d8", loud: "#d8907e", calm: "#82c4b8", olds: "#d8a87a" };

const state = {
  playingId: null,
  paused: false,
  view: null,
  favorites: [],
  volume: 0.9,
  muted: false,
  onlyFav: false,
  query: "",
  lastChannel: null,
};

const LS_KEY = "uporota.state";

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      favorites: state.favorites,
      volume: state.volume,
      muted: state.muted,
      lastChannel: state.lastChannel,
    }));
  } catch (e) {
    console.warn("не удалось сохранить", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.favorites)) state.favorites = d.favorites.filter((id) => stationById(id));
    if (typeof d.volume === "number") state.volume = Math.min(1, Math.max(0, d.volume));
    state.muted = !!d.muted;
    if (typeof d.lastChannel === "string") state.lastChannel = d.lastChannel;
  } catch (e) {
    console.warn("не удалось прочитать", e);
  }
}

const stationById = (id) => STATIONS.find((s) => s.id === id) || null;

/* Обложка волны: живая из эфира, иначе цветной градиент станции */
function stationArt(st) {
  const live = window.RadioLive && window.RadioLive.now(st.id);
  if (st.nowplaying && live && live.art) return live.art;
  return "";
}

const ORIGIN_LABEL = { upwave: "UPWAVE RADIO", record: "Radio Record", soma: "SomaFM" };

/* ---------------- Радиовещание ---------------- */

const audio = $("#radio");

function safePlay() {
  try {
    const p = audio.play();
    if (p && typeof p.catch === "function") p.catch((e) => {
      console.warn("play blocked:", e && e.name);
      setStatus("err", "нажми play ещё раз — браузер стесняется");
    });
  } catch {
    /* некоторые окружения не умеют */
  }
}

let reconnectTimer = null;
let reconnectAttempt = 0;
const BACKOFF = [0, 1000, 3000, 7000, 15000, 30000];

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/* Статус живёт в «пилюле» плеера: вид точки + текст */
function setStatus(kind, text) {
  const dot = $("#npDot");
  if (dot) dot.className = "dot" + (kind ? " " + kind : "");
  const label = $("#npStatus");
  if (label) label.textContent = text;
  document.body.classList.toggle("is-live", kind === "live");
}

function playStation(id, { fromTable = false } = {}) {
  const st = stationById(id);
  if (!st) {
    toast("Такой волны нет в эфире");
    return;
  }

  // повторный клик по выбранной волне = пауза
  if (state.playingId === id && fromTable && !audio.paused) {
    audio.pause();
    return;
  }

  clearReconnect();
  reconnectAttempt = 0;

  // сброс источника, чтобы поток перезапустился с живого края
  audio.pause();
  audio.removeAttribute("src");
  audio.load();

  state.playingId = id;
  state.lastChannel = id;
  state.paused = false;
  saveState();

  audio.src = st.stream;
  audio.volume = state.muted ? 0 : state.volume;
  updatePlayerUI();
  updateMediaSession(st);
  setStatus("wait", "ловим сигнал");
  startNowPlayingPoll();
  safePlay();

  $("#npBtn").disabled = false;
  paintStage(st);
}

function togglePlay() {
  if (!state.playingId) {
    // продолжить последнюю волну или выбрать случайную
    const id = stationById(state.lastChannel) ? state.lastChannel : STATIONS[Math.floor(Math.random() * STATIONS.length)].id;
    playStation(id);
    return;
  }
  if (audio.paused || state.paused) {
    // в живой поток мы попадаем с середины — пересоздаём src
    const st = stationById(state.playingId);
    audio.src = st.stream;
    audio.volume = state.muted ? 0 : state.volume;
    safePlay();
    state.paused = false;
    setStatus("wait", "ловим сигнал");
    startNowPlayingPoll();
  } else {
    audio.pause();
    state.paused = true;
    setStatus("", "пауза");
  }
  updatePlayerUI();
}

function nextStation(dir) {
  const list = visibleStations().length ? visibleStations() : STATIONS;
  if (!state.playingId) {
    playStation(list[0].id);
    return;
  }
  const ids = list.map((s) => s.id);
  let i = ids.indexOf(state.playingId);
  if (i < 0) i = 0;
  i = (i + dir + ids.length) % ids.length;
  playStation(ids[i], { fromTable: true });
}

/* События аудио → статусы */

audio.addEventListener("playing", () => {
  document.body.classList.add("broadcasting");
  setStatus("live", "в эфире");
  updatePlayerUI();
  startVisualizer();
});

audio.addEventListener("pause", () => {
  document.body.classList.remove("broadcasting");
  if (!state.paused) setStatus("", "пауза");
  updatePlayerUI();
});

audio.addEventListener("waiting", () => setStatus("wait", "буферизация"));

audio.addEventListener("error", () => {
  if (!state.playingId) return;
  const attempt = Math.min(reconnectAttempt, BACKOFF.length - 1);
  if (reconnectAttempt >= BACKOFF.length - 1) {
    setStatus("err", "волна умерла, выбери другую");
    toast("Поток не отвечает — волна уплыла");
    return;
  }
  const delay = BACKOFF[attempt + 1];
  reconnectAttempt++;
  setStatus("err", `пересоединяюсь (${reconnectAttempt}/5)`);
  clearReconnect();
  reconnectTimer = setTimeout(() => {
    const st = stationById(state.playingId);
    if (!st) return;
    audio.src = st.stream;
    audio.volume = state.muted ? 0 : state.volume;
    safePlay();
  }, delay);
});

audio.addEventListener("stalled", () => setStatus("wait", "поток притормозил"));

/* «Сейчас в эфире» — AzuraCast через RadioLive; этому же источнику верим
   больше, чем нашим служебным статусам */
function startNowPlayingPoll() {
  const st = state.playingId ? stationById(state.playingId) : null;
  if (!st || !window.RadioLive) return;
  window.RadioLive.start(st);
}

/* Плеер: кнопки */

$("#btnPlay").addEventListener("click", togglePlay);
$("#btnNext").addEventListener("click", () => nextStation(1));
$("#btnPrev").addEventListener("click", () => nextStation(-1));

$("#npBtn").addEventListener("click", () => {
  if (state.playingId) togglePlay();
});

$("#npFav").addEventListener("click", () => {
  if (state.playingId) toggleFavorite(state.playingId);
});

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea") || e.target.isContentEditable) return;
  switch (e.code) {
    case "Space":
      e.preventDefault();
      togglePlay();
      break;
    case "ArrowRight":
      if (e.shiftKey) {
        e.preventDefault();
        nextStation(1);
      }
      break;
    case "ArrowLeft":
      if (e.shiftKey) {
        e.preventDefault();
        nextStation(-1);
      }
      break;
  }
});

/* Громкость */

function paintRange(input) {
  const pct = Number(input.value) * 100;
  input.style.setProperty("--pct", pct + "%");
}

function applyVolumeUI() {
  const vol = $("#volume");
  vol.value = state.volume;
  paintRange(vol);
  audio.volume = state.muted ? 0 : state.volume;
  $("#btnMute").classList.toggle("muted", state.muted);
}

/* Громкость: не больше одного setVolume на кадр */
let volumeFrame = 0;
let pendingVolume = null;

function pushVolume() {
  if (pendingVolume === null) return;
  const v = pendingVolume;
  pendingVolume = null;
  audio.volume = state.muted ? 0 : v;
}

$("#volume").addEventListener("input", (e) => {
  state.volume = Number(e.target.value);
  state.muted = state.volume === 0;
  applyVolumeUI();
  pendingVolume = state.volume;
  if (CALM) {
    pushVolume();
    return;
  }
  if (!volumeFrame) {
    volumeFrame = requestAnimationFrame(() => {
      volumeFrame = 0;
      pushVolume();
    });
  }
});

$("#volume").addEventListener("change", saveState);

$("#btnMute").addEventListener("click", () => {
  state.muted = !state.muted;
  applyVolumeUI();
  saveState();
});

/* Избранное */

function toggleFavorite(id) {
  const i = state.favorites.indexOf(id);
  const st = stationById(id);
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push(id);
  saveState();
  if (state.onlyFav) render({ instant: true });
  else {
    document.querySelectorAll(`.station[data-id="${id}"]`).forEach((card) => {
      card.classList.toggle("liked", i < 0);
      const heart = card.querySelector(".fav-mini");
      if (heart) heart.setAttribute("aria-pressed", String(i < 0));
    });
  }
  refreshSidebar();
  updatePlayerUI();
  if (st) toast(i >= 0 ? `${st.name} — убрана из избранного` : `${st.name} — в избранном`);
}

/* MediaSession */

function updateMediaSession(st) {
  if (!("mediaSession" in navigator)) return;
  try {
    const meta = window.RadioLive && window.RadioLive.now(st.id);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: (meta && meta.title) || st.name,
      artist: (meta && meta.artist) || st.genre,
      album: st.name,
      artwork: (meta && meta.art) ? [{ src: meta.art, sizes: "512x512" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => safePlay());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => nextStation(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => nextStation(-1));
    navigator.mediaSession.setActionHandler("stop", () => audio.pause());
  } catch {
    /* нет поддержки */
  }
}

/* ---------------- Атмосфера и цвет ---------------- */

const atmos = $("#atmos");
let atmosHue = null;

/* Цвет обложки перетекает в фон медленно: два слоя — уходящий и новый */
function paintAtmosphere(art, color, fallback) {
  const tone = (color && color.hsl) || null;
  const rgba = (a) => (color && color.rgb ? `rgb(${color.rgb} / ${a})` : fallback + Math.round(a * 255).toString(16).padStart(2, "0"));
  if (tone === atmosHue) return;
  atmosHue = tone;

  const root = document.documentElement;
  if (color && color.rgb) {
    root.style.setProperty("--art-rgb", color.rgb);
    root.style.setProperty("--art-hsl", color.hsl);
    atmos.style.setProperty("--a1", rgba(0.34));
    atmos.style.setProperty("--a2", rgba(0.22));
    atmos.style.setProperty("--a3", rgba(0.16));
  } else {
    root.style.setProperty("--art-rgb", "143 166 216");
    root.style.setProperty("--art-hsl", "220 45% 70%");
    atmos.style.setProperty("--a1", hexA(fallback, 0.3));
    atmos.style.setProperty("--a2", hexA(fallback, 0.18));
    atmos.style.setProperty("--a3", hexA(fallback, 0.12));
  }
  document.body.classList.toggle("has-art", !!art);
}

function hexA(hex, a) {
  const s = String(hex || "#8fa6d8").replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${r} ${g} ${b} / ${a})`;
}

/* ---------------- Сцена: обложка, трек, станция ---------------- */

const stageArt = new WeakMap(); // элемент обложки → текущий url

function artNode(url, st, cls) {
  const box = el("span", "art " + cls);
  box.style.setProperty("--st", st ? st.color : "#8fa6d8");
  const img = el("img");
  img.alt = "";
  img.decoding = "async";
  img.loading = "lazy";
  if (url) {
    img.src = url;
    img.crossOrigin = "anonymous";
  }
  box.appendChild(img);
  box.appendChild(el("span", "art-fallback"));
  stageArt.set(box, url || "");
  if (url) box.classList.add("has-src");
  return box;
}

/* Плавная смена обложки: новый кадр проявляется поверх старого */
function swapArt(box, url) {
  if (!box) return;
  if ((stageArt.get(box) || "") === (url || "")) return;
  stageArt.set(box, url || "");
  const old = box.querySelector(".art-frame.is-in");
  if (!url) {
    box.classList.remove("has-src");
    if (old) old.remove();
    return;
  }
  const frame = el("span", "art-frame" + (CALM ? " is-in" : ""));
  const img = el("img");
  img.alt = "";
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.onload = () => {
    frame.classList.add("is-in");
    if (old) {
      old.classList.add("is-out");
      setTimeout(() => old.remove(), 700);
    }
  };
  frame.appendChild(img);
  img.src = url;
  box.appendChild(frame);
  box.classList.add("has-src");
  frame.classList.add("is-in");
}

/* Трек меняется «вверх-вниз»: старое уезжает, новое появляется.
   Высота при этом фиксируется, чтобы сцена не дёргалась. */
function slideLine(text) {
  const box = el("span", "slide");
  box.appendChild(el("span", "slide-line is-in", text));
  return box;
}

function updateSlide(host, text, nudgeClass) {
  if (!host || !host.firstChild) return;
  const box = host.firstChild;
  const current = box.querySelector(".slide-line.is-in");
  if (!current || current.textContent === text) return;
  if (CALM) {
    current.textContent = text;
    return;
  }
  const h = current.offsetHeight;
  if (h) box.style.height = h + "px";
  current.classList.remove("is-in");
  current.classList.add("is-out");
  const next = el("span", "slide-line", text);
  box.appendChild(next);
  requestAnimationFrame(() => next.classList.add("is-in"));
  setTimeout(() => {
    current.remove();
    box.style.height = "";
  }, 560);
  if (nudgeClass) {
    host.classList.remove(nudgeClass);
    void host.offsetWidth;
    host.classList.add(nudgeClass);
    setTimeout(() => host.classList.remove(nudgeClass), 900);
  }
}

function describeNow(st) {
  const meta = window.RadioLive && window.RadioLive.now(st.id);
  if (meta && meta.title) return meta;
  return null;
}

/* ---------------- Рендеринг ---------------- */

const viewEl = $("#view");

/* Синонимы для поиска: ищется и по-русски, и латиницей */
const SEARCH_ALIASES = {
  volna: "главная upwave упоротая",
  "volna-hq": "главная hq качество 320",
  gop: "гоп хардбасс hardbass двор хард-басс",
  hbass: "хардбасс hardbass басс",
  rave: "рейв rave",
  ps: "днб dnb drum and bass",
  dub: "даб dubstep",
  techno: "техно",
  goa: "психоделика psy trance гоа",
  chil: "чил chillout",
  chillh: "чил хаус chillhouse",
  lofih: "лофай lofi lo-fi винил",
  "soma-gs": "сома джаз эмбиент",
  "soma-dc": "хакеры defcon",
  sd90: "дискотека девяностые 90",
  y1980: "восьмидесятые 80 синт",
  rus: "русское ностальгия",
  "soma-80": "подполье 80 восьмидесятые",
};

const SECTION_TITLES = { main: "главная волна", loud: "жарко", calm: "спокойное чил", olds: "олды ретро классика" };

const SEARCH_INDEX = new Map();

/* Одна строка на волну: имя, жанр, раздел, синонимы. Собирается один раз */
function searchText(st) {
  let v = SEARCH_INDEX.get(st.id);
  if (!v) {
    v = [st.name, st.genre, SECTION_TITLES[st.mood] || "", SEARCH_ALIASES[st.id] || ""]
      .join(" ")
      .toLowerCase();
    SEARCH_INDEX.set(st.id, v);
  }
  return v;
}

function visibleStations() {
  const q = state.query.toLowerCase();
  let list = STATIONS;
  if (state.onlyFav) list = list.filter((s) => state.favorites.includes(s.id));
  if (q) list = list.filter((s) => searchText(s).includes(q));
  if (state.onlyFav || q) return list;
  return [];
}

/* Перерисовать экран плавно: старый уходит, новый входит.
   При вводе в поиске заменяем мгновенно, иначе список мерцает. */
function render({ instant = false } = {}) {
  if (instant || CALM) {
    viewEl.replaceChildren();
    draw();
    return;
  }
  const scroll = viewEl.scrollTop;
  viewEl.classList.add("is-leaving");
  setTimeout(() => {
    viewEl.replaceChildren();
    draw();
    viewEl.scrollTop = scroll;
    viewEl.classList.remove("is-leaving");
  }, 90);
}

/* Раскладка текущего экрана */
function draw() {
  const searching = state.query || state.onlyFav;

  if (searching) {
    const list = visibleStations();
    if (!list.length) {
      viewEl.appendChild(emptyState());
      return;
    }
    const wrap = el("section", "section");
    wrap.appendChild(sectionHead(
      state.onlyFav ? "Избранное" : `Поиск: «${state.query}»`,
      `${list.length} ${plural(list.length, "волна", "волны", "волн")}`
    ));
    const grid = el("div", "grid");
    list.forEach((s, i) => {
      const card = stationCard(s);
      card.style.setProperty("--i", String(Math.min(i, 12)));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    viewEl.appendChild(wrap);
    return;
  }

  let stations = state.view ? STATIONS.filter((s) => s.mood === state.view) : STATIONS;
  if (state.view === "main") stations = STATIONS;

  const hero = buildHero();
  viewEl.appendChild(hero);

  const recent = buildRecent();
  if (recent) viewEl.appendChild(recent);

  const popular = buildPopular();
  if (popular) viewEl.appendChild(popular);

  if (state.view) {
    const sec = SECTIONS.find((s) => s.key === state.view);
    if (sec) {
      const block = el("section", "section");
      block.appendChild(sectionHead(sec.title, sec.hint));
      block.appendChild(stationGrid(stations));
      viewEl.appendChild(block);
    }
  } else {
    for (const sec of SECTIONS) {
      const group = STATIONS.filter((s) => s.mood === sec.key);
      if (!group.length) continue;
      const block = el("section", "section");
      block.appendChild(sectionHead(sec.title, sec.hint));
      block.appendChild(stationGrid(group));
      viewEl.appendChild(block);
    }
  }

  refreshSidebar();
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function sectionHead(title, hint, action) {
  const head = el("div", "section-head");
  const text = el("div", "section-text");
  text.appendChild(el("h2", "section-title", title));
  if (hint) text.appendChild(el("p", "section-hint", hint));
  head.appendChild(text);
  if (action) head.appendChild(action);
  return head;
}

function stationGrid(list) {
  const grid = el("div", "grid");
  list.forEach((s, i) => {
    const card = stationCard(s);
    card.style.setProperty("--i", String(Math.min(i, 12)));
    grid.appendChild(card);
  });
  return grid;
}

/* ---------- Главная сцена ---------- */

function buildHero() {
  const st = state.playingId ? stationById(state.playingId) : null;
  const hero = el("section", "hero");

  const stage = el("div", "hero-stage");
  stage.id = "heroStage";

  const glow = el("div", "hero-glow");
  glow.id = "heroGlow";
  stage.appendChild(glow);

  const artBox = el("div", "hero-art");
  artBox.id = "heroArt";
  const inner = el("div", "hero-art-inner");
  inner.appendChild(artNode(st ? stationArt(st) : "", st, "hero-art-img"));
  artBox.appendChild(inner);
  artBox.appendChild(el("div", "hero-art-sheen"));
  const badge = el("div", "hero-art-badge");
  badge.id = "heroBadge";
  badge.appendChild(el("i", "dot"));
  badge.appendChild(el("span", null, "LIVE"));
  artBox.appendChild(badge);
  const eq = el("div", "hero-eq");
  for (let i = 0; i < 5; i++) eq.appendChild(el("i"));
  artBox.appendChild(eq);
  artBox.addEventListener("click", () => {
    if (!state.playingId) {
      playStation("volna", { fromTable: true });
      return;
    }
    if (audio.paused || state.paused) togglePlay();
  });
  stage.appendChild(artBox);

  const info = el("div", "hero-info");
  const kicker = el("div", "hero-kicker");
  kicker.id = "heroKicker";
  kicker.textContent = st ? ORIGIN_LABEL[st.origin] || "эфир" : "живое радио";
  info.appendChild(kicker);

  const title = el("h1", "hero-track");
  title.id = "heroTrack";
  title.appendChild(slideLine(st ? st.name : "Упоротая волна"));
  info.appendChild(title);

  const artist = el("p", "hero-artist");
  artist.id = "heroArtist";
  artist.appendChild(slideLine(st ? st.genre : "хардбасс, рейв, транс, чил и диски из лета-2004"));
  info.appendChild(artist);

  const stationLine = el("div", "hero-station");
  stationLine.id = "heroStation";
  info.appendChild(stationLine);

  const progress = el("div", "hero-progress");
  progress.id = "heroProgress";
  progress.hidden = true;
  progress.appendChild(el("i"));
  info.appendChild(progress);

  const actions = el("div", "hero-actions");
  const playBtn = el("button", "btn primary");
  playBtn.id = "heroPlay";
  playBtn.innerHTML = `<span class="btn-ic">${icon(st && !audio.paused && !state.paused ? ICON.pause : ICON.play).innerHTML}</span><span class="btn-label">${st && !audio.paused && !state.paused ? "Пауза" : "Слушать"}</span>`;
  playBtn.addEventListener("click", togglePlay);
  actions.appendChild(playBtn);

  const favBtn = el("button", "btn ghost");
  favBtn.id = "heroFav";
  favBtn.innerHTML = `<span class="btn-ic">${icon(ICON.heart).innerHTML}</span><span class="btn-label">${st && state.favorites.includes(st.id) ? "В избранном" : "В избранное"}</span>`;
  favBtn.addEventListener("click", () => {
    if (!state.playingId) return toast("Сначала выбери волну");
    toggleFavorite(state.playingId);
  });
  actions.appendChild(favBtn);

  const shuffle = el("button", "icon-btn ghost-icon");
  shuffle.setAttribute("aria-label", "Случайная волна");
  shuffle.innerHTML = icon(ICON.sparkle).innerHTML;
  shuffle.addEventListener("click", () => {
    const random = STATIONS[Math.floor(Math.random() * STATIONS.length)];
    playStation(random.id, { fromTable: true });
    toast(`${random.name} — погнали`);
  });
  actions.appendChild(shuffle);
  info.appendChild(actions);

  stage.appendChild(info);
  hero.appendChild(stage);
  return hero;
}

/* ---------- Карточка волны ---------- */

function stationCard(st) {
  const card = el("button", "station glass" + (state.favorites.includes(st.id) ? " liked" : ""));
  card.dataset.id = st.id;
  card.style.setProperty("--st", st.color);
  card.setAttribute("aria-label", `${st.name}. ${st.genre}`);

  const cover = el("span", "station-cover");
  const url = (window.RadioLive && stationArt(st)) || "";
  if (url) {
    cover.appendChild(artNode(url, st, "card-art"));
  } else {
    const ph = el("span", "station-mono");
    ph.innerHTML = icon(ICON[st.origin === "soma" ? "radio" : "waves"]).innerHTML;
    ph.appendChild(el("span", "station-initials", initials(st.name)));
    cover.appendChild(ph);
  }
  const live = el("span", "station-live");
  live.appendChild(el("i", "dot"));
  live.appendChild(document.createTextNode("LIVE"));
  cover.appendChild(live);
  card.appendChild(cover);

  const body = el("span", "station-body");
  body.appendChild(el("span", "station-name", st.name));
  body.appendChild(el("span", "station-genre", st.genre));
  const meta = el("span", "station-meta");
  meta.appendChild(el("span", "station-badge", ORIGIN_LABEL[st.origin] || "эфир"));
  meta.appendChild(el("span", "station-quality", st.quality || ""));
  body.appendChild(meta);
  card.appendChild(body);

  const heart = el("span", "fav-mini");
  heart.setAttribute("role", "button");
  heart.setAttribute("tabindex", "0");
  heart.setAttribute("aria-label", state.favorites.includes(st.id) ? "Убрать из избранного" : "В избранное");
  heart.setAttribute("aria-pressed", String(state.favorites.includes(st.id)));
  heart.innerHTML = icon(ICON.heart).innerHTML;
  heart.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(st.id);
  });
  heart.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      e.preventDefault();
      toggleFavorite(st.id);
    }
  });
  card.appendChild(heart);

  if (state.playingId === st.id) card.classList.add("live");

  card.addEventListener("click", () => playStation(st.id, { fromTable: true }));
  return card;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/* ---------- Недавно играло ---------- */

function buildRecent() {
  const list = (window.RadioLive && window.RadioLive.history()) || [];
  const block = el("section", "section section-recent");
  block.id = "recentSection";
  if (!list.length) {
    block.hidden = true;
    block.appendChild(sectionHead("Недавно играло", "как только поймаем эфир UPWAVE", null));
    block.appendChild(el("p", "section-hint", "История появится, когда в эфире сменится трек."));
    return block;
  }
  block.hidden = false;
  const action = el("button", "link-btn", "Слушать UPWAVE");
  action.addEventListener("click", () => {
    const id = state.view === "main" ? "volna-hq" : "volna";
    playStation(id, { fromTable: true });
  });
  block.appendChild(sectionHead("Недавно играло", "история живого эфира", action));

  const row = el("div", "track-row");
  list.slice(0, 12).forEach((t, i) => {
    const item = el("button", "track-card glass");
    item.style.setProperty("--i", String(Math.min(i, 10)));
    const stn = stationById(t.stationId);
    item.style.setProperty("--st", stn ? stn.color : "#8fa6d8");

    const art = el("span", "track-art");
    if (t.art) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.crossOrigin = "anonymous";
      img.src = t.art;
      img.onerror = () => img.remove();
      art.appendChild(img);
    } else {
      art.appendChild(icon(ICON.note));
    }
    item.appendChild(art);

    const text = el("span", "track-text");
    text.appendChild(el("span", "track-title", t.title));
    text.appendChild(el("span", "track-artist", t.artist || "неизвестный исполнитель"));
    item.appendChild(text);

    const go = el("span", "track-go");
    go.innerHTML = icon(ICON.play).innerHTML;
    item.appendChild(go);

    item.setAttribute("aria-label", `Слушать ${stn ? stn.name : "UPWAVE"}`);
    item.addEventListener("click", () => {
      if (stn) playStation(stn.id, { fromTable: true });
      else toast("Этот трек был на другой волне");
    });
    row.appendChild(item);
  });
  block.appendChild(row);
  return block;
}

/* ---------- Популярные волны ---------- */

function buildPopular() {
  const block = el("section", "section section-popular");
  block.appendChild(sectionHead("Популярные волны", "с чего начинают все", null));
  const picks = ["volna", "gop", "chil", "soma-gs", "techno", "sd90"]
    .map(stationById)
    .filter(Boolean);
  const row = el("div", "mini-row");
  picks.forEach((s, i) => {
    const b = el("button", "mini-card glass" + (state.playingId === s.id ? " live" : ""));
    b.dataset.id = s.id;
    b.style.setProperty("--i", String(Math.min(i, 8)));
    b.style.setProperty("--st", s.color);
    const art = el("span", "mini-art");
    const url = (window.RadioLive && stationArt(s)) || "";
    if (url) {
      const img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.crossOrigin = "anonymous";
      img.src = url;
      art.appendChild(img);
    } else {
      art.appendChild(el("span", "mini-initials", initials(s.name)));
    }
    b.appendChild(art);
    const text = el("span", "mini-text");
    text.appendChild(el("span", "mini-name", s.name));
    text.appendChild(el("span", "mini-genre", s.genre));
    b.appendChild(text);
    b.appendChild(icon(ICON.play, "mini-play"));
    b.addEventListener("click", () => playStation(s.id, { fromTable: true }));
    row.appendChild(b);
  });
  block.appendChild(row);
  return block;
}

function emptyState() {
  const empty = el("div", "empty glass");
  const ico = icon(state.onlyFav ? ICON.heart : ICON.waves, "empty-ico");
  empty.appendChild(ico);
  empty.appendChild(el("h3", null, state.onlyFav ? "Избранное пусто" : "Ничего не нащупали"));
  empty.appendChild(el("p", null, state.onlyFav
    ? "Жми на сердечко у любой волны — она поселится здесь и переживёт перезагрузку."
    : "Такой волны нет. Попробуй «хардбасс», «гоп» или «чил»."));
  const back = el("button", "btn primary", "Показать все волны");
  back.dataset.action = "clear";
  empty.appendChild(back);
  return empty;
}

/* ---------- Сайдбар ---------- */

function refreshSidebar() {
  const list = $("#sideMoods");
  const links = $$("#sideNav .side-link");
  if (!list) return;

  links.forEach((b) => {
    const on = b.dataset.nav === "favorites" ? state.onlyFav : !state.onlyFav && !state.view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-current", on ? "page" : "false");
  });
  $("#topFav").setAttribute("aria-pressed", String(state.onlyFav));

  const allCount = $("#allCount");
  if (allCount) allCount.textContent = String(STATIONS.length);

  const favCount = $("#favCount");
  if (favCount) {
    favCount.hidden = state.favorites.length === 0;
    favCount.textContent = String(state.favorites.length);
  }

  list.replaceChildren();
  for (const sec of SECTIONS) {
    const n = STATIONS.filter((s) => s.mood === sec.key).length;
    const on = !state.onlyFav && state.view === sec.key;
    const b = el("button", "side-playlist" + (on ? " active" : ""));
    b.dataset.mood = sec.key;
    b.style.setProperty("--st", MOOD_COLORS[sec.key] || "#8fa6d8");
    b.appendChild(icon(sec.icon || ICON.waves, "pl-ic"));
    b.appendChild(el("span", "pl-name", sec.title));
    b.appendChild(el("span", "pl-count", String(n)));
    list.appendChild(b);
  }
}

document.addEventListener("click", (e) => {
  const mood = e.target.closest("[data-mood]");
  if (mood) {
    const key = mood.dataset.mood;
    state.query = "";
    state.onlyFav = false;
    state.view = state.view === key ? null : key;
    const input = $("#searchInput");
    if (input) input.value = "";
    closeSidebar();
    render();
  }
});

function closeSidebar() {
  const sb = $("#sidebar");
  const bd = $("#sidebarBackdrop");
  if (sb) sb.classList.remove("open");
  if (bd) bd.hidden = true;
  document.body.classList.remove("menu-open");
}

function clearFilters() {
  state.query = "";
  state.onlyFav = false;
  state.view = null;
  const input = $("#searchInput");
  if (input) input.value = "";
  const clear = $("#searchClear");
  if (clear) clear.hidden = true;
  render();
}

/* ---------------- Плеер: отображение ---------------- */

let lastPlayerArt = null;

function updatePlayerUI() {
  const st = state.playingId ? stationById(state.playingId) : null;
  const playBtn = $("#btnPlay");
  const isPlaying = !audio.paused && !state.paused && !!st;

  const art = $("#npArt");
  const url = st ? stationArt(st) : "";
  art.classList.toggle("empty", !st);
  art.style.setProperty("--st", st ? st.color : "#8fa6d8");
  if (st) {
    art.classList.add("has-src");
    if (url && lastPlayerArt !== url) {
      lastPlayerArt = url;
      art.style.backgroundImage = `url("${url}")`;
    } else if (!url) {
      lastPlayerArt = null;
      art.style.backgroundImage = "";
      art.classList.remove("has-src");
    }
  } else {
    lastPlayerArt = null;
    art.style.backgroundImage = "";
    art.classList.remove("has-src");
  }

  playBtn.disabled = !st;
  playBtn.classList.toggle("playing", isPlaying);
  playBtn.setAttribute("aria-label", isPlaying ? "Пауза" : "Играть");

  const favBtn = $("#npFav");
  favBtn.disabled = !st;
  favBtn.classList.toggle("liked", !!(st && state.favorites.includes(st.id)));

  $$(".station").forEach((card) => card.classList.toggle("live", !!st && card.dataset.id === st.id));
  $$(".mini-card").forEach((card) => card.classList.toggle("live", !!st && card.dataset.id === st.id));

  const heroPlay = $("#heroPlay");
  if (heroPlay) {
    const label = heroPlay.querySelector(".btn-label");
    const iconBox = heroPlay.querySelector(".btn-ic");
    if (label) label.textContent = !st ? "Слушать" : isPlaying ? "Пауза" : "Продолжить";
    if (iconBox) iconBox.innerHTML = icon(isPlaying ? ICON.pause : ICON.play).innerHTML;
  }

  const heroFav = $("#heroFav");
  if (heroFav) {
    const onFav = !!(st && state.favorites.includes(st.id));
    heroFav.classList.toggle("liked", onFav);
    const label = heroFav.querySelector(".btn-label");
    if (label) label.textContent = onFav ? "В избранном" : "В избранное";
  }

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch { /* no-op */ }
  }
}

/* Обновились данные эфира — сцена, «сейчас играет» и фон */
function onLive(kind, stationId) {
  if (kind === "tick") {
    if (stationId === state.playingId) paintLiveMeta();
    return;
  }
  if (kind === "history") {
    refreshRecent();
    return;
  }
  if (stationId !== state.playingId) {
    if (kind === "art") refreshCards();
    return;
  }
  paintStage(stationById(stationId));
  updatePlayerUI();
  refreshCards();
  paintLiveMeta();
  if (kind === "art") {
    const st = stationById(stationId);
    updateMediaSession(st);
  }
}

/* Перекрасить догрузившиеся обложки без полной перерисовки */
function refreshCards() {
  $$(".station").forEach((card) => {
    const st = stationById(card.dataset.id);
    if (!st) return;
    const url = stationArt(st);
    const cover = card.querySelector(".station-cover");
    if (!cover) return;
    if (url && !cover.querySelector(".card-art")) {
      cover.querySelector(".station-mono")?.remove();
      cover.insertBefore(artNode(url, st, "card-art"), cover.firstChild);
    } else if (url) {
      const box = cover.querySelector(".card-art");
      const img = box && box.querySelector("img");
      if (box && img && img.src !== url) img.src = url;
    }
  });
  $$(".mini-card").forEach((card) => {
    const st = stationById(card.dataset.id);
    if (!st) return;
    const url = stationArt(st);
    const art = card.querySelector(".mini-art");
    if (!art) return;
    let img = art.querySelector("img");
    if (url && !img) {
      art.querySelector(".mini-initials")?.remove();
      img = el("img");
      img.alt = "";
      img.loading = "lazy";
      img.crossOrigin = "anonymous";
      img.src = url;
      art.appendChild(img);
    } else if (url && img && img.src !== url) {
      img.src = url;
    }
  });
}

function refreshRecent() {
  const old = $("#recentSection");
  const fresh = buildRecent();
  if (old && old.parentNode) old.replaceWith(fresh);
  else if (fresh && viewEl && !state.query && !state.onlyFav) {
    const hero = viewEl.querySelector(".hero");
    if (hero && hero.nextSibling) viewEl.insertBefore(fresh, hero.nextSibling);
  }
}

/* Сцена: обложка, название, исполнитель, прогресс, фон */
function paintStage(st) {
  const artBox = $("#heroArt");
  const artImgBox = artBox && artBox.querySelector(".hero-art-img");
  if (artBox && st) {
    swapArt(artImgBox, stationArt(st));
  }
  paintLiveMeta();
  if (st) paintAtmosphere(stationArt(st), window.RadioLive && window.RadioLive.now(st.id)?.color, st.color);
}

function paintLiveMeta() {
  const st = state.playingId ? stationById(state.playingId) : null;
  const meta = st ? describeNow(st) : null;

  const status = $("#npStatus");
  const wasWhat = status ? status.dataset.what : "";
  const nextWhat = meta ? "live" : "idle";
  if (status && wasWhat !== nextWhat && meta) setStatus(audio.paused ? "" : "live", audio.paused ? "пауза" : "в эфире");

  const kicker = $("#heroKicker");
  if (kicker) kicker.textContent = st ? (ORIGIN_LABEL[st.origin] || "эфир") : "живое радио";

  updateSlide($("#heroTrack"), meta ? meta.title : st ? st.name : "Упоротая волна", "hero-nudge");
  updateSlide($("#heroArtist"), meta ? (meta.artist || "неизвестный исполнитель") : st ? st.genre : "хардбасс, рейв, транс, чил и диски из лета-2004");

  const heroStation = $("#heroStation");
  if (heroStation) {
    heroStation.replaceChildren();
    if (st) {
      heroStation.appendChild(el("span", "hero-station-name", st.name));
      heroStation.appendChild(el("span", "hero-dot"));
      heroStation.appendChild(el("span", "hero-station-genre", st.genre));
      if (meta && meta.album) {
        heroStation.appendChild(el("span", "hero-dot"));
        heroStation.appendChild(el("span", "hero-station-album", meta.album));
      }
    } else {
      heroStation.appendChild(el("span", "hero-station-genre", "выбери волну ниже — заиграет сразу"));
    }
  }

  const progress = $("#heroProgress");
  if (progress) {
    const show = !!(meta && meta.duration > 0);
    progress.hidden = !show;
    if (show) {
      progress.querySelector("i").style.width = Math.round(meta.progress * 100) + "%";
    }
  }

  /* сводка в плеере */
  const npTitle = $("#npTitle");
  const npSub = $("#npSub");
  if (npTitle) npTitle.textContent = meta ? meta.title : st ? st.name : "Волна не выбрана";
  if (npSub) npSub.textContent = meta ? (meta.artist || st.genre) : st ? st.genre : "выбери волну и жми play";

  const listeners = $("#npListeners");
  if (listeners) {
    const n = meta && meta.listeners;
    listeners.hidden = !n;
    if (n) listeners.textContent = `${n} ${plural(n, "слушатель", "слушателя", "слушателей")}`;
  }

  /* мини-плеер в топбаре */
  const topTitle = $("#topMiniTitle");
  const topSub = $("#topMiniSub");
  if (topTitle) topTitle.textContent = meta ? meta.title : st ? st.name : "Упоротая волна";
  if (topSub) topSub.textContent = meta ? (meta.artist || st.name) : st ? st.genre : "живое радио";

  const topArt = $("#topMiniArt");
  if (topArt) {
    const url = st ? stationArt(st) : "";
    const marker = topArt.dataset.url || "";
    if (marker !== (url || "none")) {
      topArt.dataset.url = url || "none";
      topArt.style.backgroundImage = url ? `url("${url}")` : "";
    }
    topArt.style.setProperty("--st", st ? st.color : "#8fa6d8");
  }

  if (status) status.dataset.what = nextWhat;

  const badge = $("#heroBadge");
  if (badge) {
    const on = st && !audio.paused && !state.paused;
    badge.classList.toggle("on", !!on);
  }
}

/* ---------------- Визуализация звука ---------------- */

const viz = $("#viz");
const vctx = viz ? viz.getContext("2d") : null;
let analyser = null;
let audioCtx = null;
let vizData = null;
let vizBars = new Float32Array(48);
let vizFrame = 0;
let vizFallback = 0;
let vizLast = 0;

function ensureAudioGraph() {
  if (audioCtx || !vctx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    audioCtx = new Ctx();
    const src = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    vizData = new Uint8Array(analyser.frequencyBinCount);
  } catch (e) {
    audioCtx = null;
    analyser = null;
  }
}

function sizeViz() {
  if (!viz) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = viz.clientWidth || 240;
  const h = viz.clientHeight || 28;
  if (viz.width === Math.round(w * dpr) && viz.height === Math.round(h * dpr)) return;
  viz.width = Math.round(w * dpr);
  viz.height = Math.round(h * dpr);
}

function startVisualizer() {
  if (CALM || !vctx) return;
  ensureAudioGraph();
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  if (!vizFrame) {
    vizLast = 0;
    vizFrame = requestAnimationFrame(stepVisualizer);
  }
}

function stopVisualizer() {
  if (vizFrame) cancelAnimationFrame(vizFrame);
  vizFrame = 0;
}

function stepVisualizer(now) {
  /* держим не больше 30 кадров в секунду — телефону легче */
  if (now - vizLast < 32) {
    vizFrame = requestAnimationFrame(stepVisualizer);
    return;
  }
  vizLast = now;
  sizeViz();
  const ctx = vctx;
  if (!ctx) return;
  const w = viz.width;
  const h = viz.height;
  ctx.clearRect(0, 0, w, h);

  const playing = !audio.paused && !state.paused;

  if (analyser && playing) {
    analyser.getByteFrequencyData(vizData);
    const n = vizBars.length;
    const step = Math.floor(vizData.length / n) || 1;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < step; k++) sum += vizData[i * step + k] || 0;
      const v = Math.min(1, (sum / step / 255) * 1.35);
      vizBars[i] += (v - vizBars[i]) * 0.28;
    }
  } else {
    /* без анализатора (или на паузе) — спокойный визуальный ритм */
    for (let i = 0; i < vizBars.length; i++) {
      const wave = Math.sin(now / 520 + i * 0.42) * Math.sin(now / 1300 + i * 0.17);
      const target = playing ? 0.16 + Math.abs(wave) * 0.3 : 0.05;
      vizBars[i] += (target - vizBars[i]) * 0.08;
    }
  }

  const n = vizBars.length;
  const gap = 2 * (window.devicePixelRatio || 1);
  const bw = Math.max(1.5, (w - gap * (n - 1)) / n);
  const hue = getComputedStyle(document.documentElement).getPropertyValue("--art-rgb").trim() || "143 166 216";
  ctx.fillStyle = playing ? `rgb(${hue} / 0.72)` : "rgb(245 245 247 / 0.16)";
  for (let i = 0; i < n; i++) {
    const v = vizBars[i];
    const bh = Math.max(2 * (window.devicePixelRatio || 1), v * h);
    const x = i * (bw + gap);
    const y = (h - bh) / 2;
    const r = Math.min(bw / 2, bh / 2, 3);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, bw, bh, r) : ctx.rect(x, y, bw, bh);
    ctx.fill();
  }

  if (!playing && !document.hidden) {
    /* на паузе не нужно гонять кадры вечно — гасим после затухания */
    const settled = vizBars.every((v) => Math.abs(v - 0.05) < 0.006);
    if (settled) {
      vizFrame = 0;
      return;
    }
  }
  vizFrame = requestAnimationFrame(stepVisualizer);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopVisualizer();
  else if (!audio.paused && !state.paused) startVisualizer();
});

/* ---------------- Курсор и стекло ---------------- */

/* Наведение: стекло чуть наклоняется к курсору — не параллакс, а «живость» */
if (FINE && !CALM) {
  let raf = 0;
  let target = null;
  let lastEvt = null;

  document.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    lastEvt = e;
    const card = e.target.closest(".station, .mini-card, .track-card, .hero-art");
    target = card || null;
    document.documentElement.style.setProperty("--mx", (e.clientX / window.innerWidth) * 100 + "%");
    document.documentElement.style.setProperty("--my", (e.clientY / window.innerHeight) * 100 + "%");
    if (!raf) raf = requestAnimationFrame(applyTilt);
  }, { passive: true });

  document.addEventListener("pointerleave", () => {
    target = null;
    if (!raf) raf = requestAnimationFrame(applyTilt);
  });

  function applyTilt() {
    raf = 0;
    if (!lastEvt) return;
    const box = target && target.getBoundingClientRect();
    $$(".station.tilting, .mini-card.tilting, .track-card.tilting, .hero-art.tilting").forEach((card) => {
      card.style.setProperty("--tx", "0deg");
      card.style.setProperty("--ty", "0deg");
      card.style.setProperty("--ox", "50%");
      card.style.setProperty("--oy", "40%");
      card.classList.remove("tilting");
    });
    if (!box || !target) return;
    const px = (lastEvt.clientX - box.left) / box.width;
    const py = (lastEvt.clientY - box.top) / box.height;
    target.style.setProperty("--tx", ((py - 0.5) * -3.4).toFixed(2) + "deg");
    target.style.setProperty("--ty", ((px - 0.5) * 3.4).toFixed(2) + "deg");
    target.style.setProperty("--ox", (px * 100).toFixed(1) + "%");
    target.style.setProperty("--oy", (py * 100).toFixed(1) + "%");
    target.classList.add("tilting");
  }
}

/* Нажатие: стекло «проседает» — короткая вспышка тени */
document.addEventListener("pointerdown", (e) => {
  const t = e.target.closest("button, .fav-mini, .side-playlist, .side-app");
  if (!t) return;
  t.classList.add("pressed");
}, { passive: true });

["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
  document.addEventListener(ev, (e) => {
    const t = e.target.closest && e.target.closest(".pressed");
    if (t) setTimeout(() => t.classList.remove("pressed"), 90);
  }, { passive: true })
);

/* ---------------- Навигация, поиск и фильтры ---------------- */

$("#searchInput").addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  const clear = $("#searchClear");
  if (clear) clear.hidden = !state.query;
  render({ instant: true });
});

$("#searchClear").addEventListener("click", () => clearFilters());

$("#sideNav").addEventListener("click", (e) => {
  const btn = e.target.closest(".side-link");
  if (!btn) return;
  if (btn.dataset.nav === "favorites") {
    state.onlyFav = !state.onlyFav;
    state.view = null;
  } else {
    state.onlyFav = false;
    state.view = null;
  }
  state.query = "";
  const input = $("#searchInput");
  if (input) input.value = "";
  const clear = $("#searchClear");
  if (clear) clear.hidden = true;
  closeSidebar();
  render();
});

$("#topFav").addEventListener("click", () => {
  state.onlyFav = !state.onlyFav;
  state.view = null;
  state.query = "";
  $("#searchInput").value = "";
  render();
});

$("#btnBurger").addEventListener("click", () => {
  $("#sidebar").classList.add("open");
  $("#sidebarBackdrop").hidden = false;
  document.body.classList.add("menu-open");
});

$("#sidebarBackdrop").addEventListener("click", closeSidebar);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSidebar();
});

$("#topMini").addEventListener("click", (e) => {
  e.preventDefault();
  togglePlay();
});

$("#btnLast").addEventListener("click", () => {
  closeSidebar();
  if (state.lastChannel && stationById(state.lastChannel)) playStation(state.lastChannel, { fromTable: true });
  else toast("Прошлой волны пока не было");
});

/* ---------------- Пасхалки ---------------- */

/* Konami-код → ХАРДБАСС-РЕЖИМ */
const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "KeyB", "KeyA"];
let konamiBuffer = [];
let hype = false;

function toggleHype() {
  hype = !hype;
  document.body.classList.toggle("hype", hype);
  if (hype) {
    playStation("hbass", { fromTable: true });
    toast("ХАРДБАСС-РЕЖИМ АКТИВИРОВАН");
  } else {
    const st = stationById(state.playingId);
    if (st) playStation(st.id, { fromTable: true });
    toast("Успокоились. Волна в норме");
  }
}

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  konamiBuffer.push(e.code);
  if (konamiBuffer.length > KONAMI.length) konamiBuffer.shift();
  if (konamiBuffer.join("|") === KONAMI.join("|")) {
    konamiBuffer = [];
    toggleHype();
  }
});

/* на телефоне: 4 пальца на экране = конами */
document.addEventListener("touchstart", (e) => {
  if (e.touches && e.touches.length >= 4) {
    e.preventDefault();
    toggleHype();
  }
}, { passive: false });

/* или долгое удержание статуса эфира */
let dotHoldTimer = null;

function armDotHold() {
  clearTimeout(dotHoldTimer);
  dotHoldTimer = setTimeout(() => toggleHype(), 850);
}

function disarmDotHold() {
  clearTimeout(dotHoldTimer);
}

const npDot = $("#npDot");
npDot.addEventListener("touchstart", armDotHold, { passive: true });
["touchend", "touchcancel", "touchmove"].forEach((ev) => npDot.addEventListener(ev, disarmDotHold));
npDot.addEventListener("mousedown", armDotHold);
["mouseup", "mouseleave", "mouseout"].forEach((ev) => npDot.addEventListener(ev, disarmDotHold));
npDot.style.cursor = "pointer";

/* 5 кликов по логотипу → ворона */
const CROW_LINES = [
  "Кар-кар! Упорота возрастает",
  "Ворона одобряет выбор эфира",
  "Что, слабо ещё раз пять раз?",
  "Волна круче, чем кажется",
  "Кар! Кто-то нажал ещё раз — и не зря",
];
let crowClicks = 0;
let crowResetTimer = null;

function releaseCrow() {
  const crow = el("div", "crow", Math.random() > 0.8 ? "🐦‍🔥" : "🐦‍⬛");
  crow.style.top = 12 + Math.random() * 45 + "vh";
  document.body.appendChild(crow);
  setTimeout(() => crow.remove(), 4200);
  toast(CROW_LINES[Math.floor(Math.random() * CROW_LINES.length)]);
}

$("#brandMark").addEventListener("click", () => {
  crowClicks++;
  clearTimeout(crowResetTimer);
  crowResetTimer = setTimeout(() => (crowClicks = 0), 1800);
  if (crowClicks >= 5) {
    crowClicks = 0;
    releaseCrow();
  }
});

/* ---------------- Запуск ---------------- */

function init() {
  loadState();
  applyVolumeUI();

  viewEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-action='clear']")) clearFilters();
  });

  render();
  refreshSidebar();
  updatePlayerUI();

  if (window.RadioLive) {
    window.RadioLive.onChange((kind, id) => {
      try {
        onLive(kind, id);
      } catch (e) {
        console.warn(e);
      }
    });
  }

  // восстановить последнюю волну (без автоплея — браузеры его блокируют)
  const last = state.lastChannel && stationById(state.lastChannel);
  if (last) {
    state.playingId = last.id;
    updatePlayerUI();
    paintStage(last);
    updateMediaSession(last);
    setStatus("", "жми play — продолжим эфир");
    $("#npBtn").disabled = false;
    window.RadioLive && window.RadioLive.start(last);
  } else {
    paintAtmosphere("", null, "#8fa6d8");
    document.documentElement.style.setProperty("--art-rgb", "143 166 216");
  }

  window.addEventListener("resize", () => {
    if (!CALM && (vizFrame === 0)) {
      sizeViz();
    }
  }, { passive: true });
}

init();
