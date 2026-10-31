/* ============================================================
   Упоротая волна — интернет-радио
   Чистый JavaScript. Потоки: Radio Record (AAC+), SomaFM (MP3).
   Состояние (избранное, громкость, последняя волна) — localStorage.
   ============================================================ */

"use strict";

/* ---------------- Утилиты ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);

/* Диагностика на устройстве: любая ошибка показывается на экране */
window.addEventListener("error", (e) => {
  const msg = (e && (e.error && e.error.message || e.message)) || "неизвестная ошибка";
  const root = $("#toastRoot");
  if (!root) return;
  const t = el("div", "toast", "⚠️ " + msg);
  t.style.borderColor = "#ff2ea6";
  root.appendChild(t);
}, true);

window.addEventListener("unhandledrejection", (e) => {
  const root = $("#toastRoot");
  if (!root) return;
  const reason = e && e.reason;
  const msg = (reason && (reason.message || String(reason))) || "отказ обещания";
  const t = el("div", "toast", "⚠️ JS: " + msg);
  t.style.borderColor = "#ffcf2e";
  root.appendChild(t);
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toast(message) {
  const root = $("#toastRoot");
  if (!root) return;
  const t = el("div", "toast", message);
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 280);
  }, 2400);
  while (root.children.length > 3) root.firstChild.remove();
}

/* ---------------- Волны ---------------- */

const STATIONS = [
  // 🌀 Главная волна — реальная станция UPWAVE RADIO
  { id: "volna",   name: "Упоротая волна",     genre: "музыка всех направлений · UPWAVE", stream: "https://stream.net-fm.ru/listen/upwaveradio/stream128", emoji: "🌀", color: "#ff2ea6", mood: "main", origin: "upwave", nowplaying: "https://stream.net-fm.ru/api/nowplaying/upwaveradio" },
  { id: "volna-hq", name: "Упоротая волна HQ", genre: "320 kbps · максимум качества", stream: "https://stream.net-fm.ru/listen/upwaveradio/stream320", emoji: "💠", color: "#ff5ecb", mood: "main", origin: "upwave", nowplaying: "https://stream.net-fm.ru/api/nowplaying/upwaveradio" },

  // 🔥 Жарко-упорото
  { id: "gop",     name: "Гоп FM",             genre: "хардбасс на весь двор",  stream: "https://radiorecord.hostingradio.ru/gop96.aacp",     emoji: "😎", color: "#ff2ea6", mood: "loud", origin: "record" },
  { id: "hbass",   name: "Hard Bass",          genre: "качает фундамент",       stream: "https://radiorecord.hostingradio.ru/hbass96.aacp",   emoji: "🔊", color: "#ff5252", mood: "loud", origin: "record" },
  { id: "rave",    name: "Rave FM",            genre: "рейв без прав",          stream: "https://radiorecord.hostingradio.ru/rave96.aacp",   emoji: "🌀", color: "#9dff2e", mood: "loud", origin: "record" },
  { id: "ps",      name: "Pirate Station",     genre: "днб-корсары",            stream: "https://radiorecord.hostingradio.ru/ps96.aacp",     emoji: "🏴‍☠️", color: "#2ea6ff", mood: "loud", origin: "record" },
  { id: "dub",     name: "Dubstep",            genre: "вайбры фундамента",      stream: "https://radiorecord.hostingradio.ru/dub96.aacp",    emoji: "💥", color: "#ffcf2e", mood: "loud", origin: "record" },
  { id: "techno",  name: "Techno",             genre: "бетонный пульс",         stream: "https://radiorecord.hostingradio.ru/techno96.aacp", emoji: "🏭", color: "#b06cff", mood: "loud", origin: "record" },
  { id: "goa",     name: "GOA/PSY",            genre: "психонавтика",           stream: "https://radiorecord.hostingradio.ru/goa96.aacp",    emoji: "🍄", color: "#2effc3", mood: "loud", origin: "record" },

  // 🧘 Нормально-упорото
  { id: "chil",    name: "Chill-Out",          genre: "плавно и туманно",       stream: "https://radiorecord.hostingradio.ru/chil96.aacp",   emoji: "🌫️", color: "#2ea6ff", mood: "calm", origin: "record" },
  { id: "chillh",  name: "Chill House",        genre: "дом, но расслабленный",  stream: "https://radiorecord.hostingradio.ru/chillhouse96.aacp", emoji: "🛋️", color: "#7bbcff", mood: "calm", origin: "record" },
  { id: "lofih",   name: "Lo-Fi House",        genre: "шершавый винил",         stream: "https://radiorecord.hostingradio.ru/lofihouse96.aacp", emoji: "📼", color: "#c2a2ff", mood: "calm", origin: "record" },
  { id: "soma-gs", name: "Groove Salad",       genre: "кислотно-овощной джаз",  stream: "https://ice1.somafm.com/groovesalad-256-mp3",       emoji: "🥗", color: "#9dff2e", mood: "calm", origin: "soma" },
  { id: "soma-dc", name: "DEF CON Radio",      genre: "для хакеров и не только", stream: "https://ice1.somafm.com/defcon-256-mp3",           emoji: "💻", color: "#2effe0", mood: "calm", origin: "soma" },

  // 🕺 Олды тут
  { id: "sd90",    name: "Супердискотека 90-х", genre: "дискотека из детства",  stream: "https://radiorecord.hostingradio.ru/sd9096.aacp",  emoji: "📀", color: "#ff8a2e", mood: "olds", origin: "record" },
  { id: "y1980",   name: "Record 80-х",        genre: "синт-волны и круиз",     stream: "https://radiorecord.hostingradio.ru/198096.aacp",  emoji: "🚙", color: "#ff2ea6", mood: "olds", origin: "record" },
  { id: "rus",     name: "Russian Mix",        genre: "почём сейчас ностальгия", stream: "https://radiorecord.hostingradio.ru/rus96.aacp",   emoji: "🇷🇺", color: "#568cff", mood: "olds", origin: "record" },
  { id: "soma-80", name: "Underground 80s",    genre: "подпольные восьмидесятые", stream: "https://ice1.somafm.com/u80s-256-mp3",           emoji: "🛸", color: "#2effe0", mood: "olds", origin: "soma" },
];

const SECTIONS = [
  { key: "main", title: "🌀 Главная волна", hint: "то самое радио" },
  { key: "loud", title: "🔥 Жарко-упорото", hint: "соседи напишут заявление" },
  { key: "calm", title: "🧘 Нормально-упорото", hint: "мозг медленно выходит в окно" },
  { key: "olds", title: "📼 Олды тут", hint: "классика, что вертится" },
];

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
    if (Array.isArray(d.favorites)) state.favorites = d.favorites;
    if (typeof d.volume === "number") state.volume = Math.min(1, Math.max(0, d.volume));
    state.muted = !!d.muted;
    if (typeof d.lastChannel === "string") state.lastChannel = d.lastChannel;
  } catch (e) {
    console.warn("не удалось прочитать", e);
  }
}

const stationById = (id) => STATIONS.find((s) => s.id === id) || null;

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

function setStatus(kind, text) {
  const dot = $("#npDot");
  dot.className = "dot" + (kind ? " " + kind : "");
  $("#npStatus").textContent = text;
}

function playStation(id, { fromTable = false } = {}) {
  const st = stationById(id);
  if (!st) {
    toast("Такой волны нет в эфире");
    return;
  }

  // повторный клик по выбранной волне = пауза/продолжить
  if (state.playingId === id && fromTable && !audio.paused) {
    audio.pause();
    return;
  }

  clearReconnect();
  reconnectAttempt = 0;

  // сброс текущего источника, чтобы поток перезапустился с живого края
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
  setStatus("wait", "ловим сигнал…");
  startNowPlayingPoll();
  safePlay();

  document.querySelectorAll(".station.live").forEach((c) => c.classList.remove("live"));
  if (fromTable) document.querySelectorAll(`.station[data-id="${id}"]`).forEach((c) => c.classList.add("live"));

  $("#npBtn").disabled = false;
}

function togglePlay() {
  if (!state.playingId) {
    // продолжить последнюю волну или выбрать случайную
    const id = stationById(state.lastChannel) ? state.lastChannel : STATIONS[Math.floor(Math.random() * STATIONS.length)].id;
    playStation(id);
    return;
  }
  if (audio.paused || state.paused) {
    // радио мы попадаем в середину живого потока — пересоздаём src для «live» эффекта
    const st = stationById(state.playingId);
    audio.src = st.stream;
    audio.volume = state.muted ? 0 : state.volume;
    safePlay();
    state.paused = false;
    setStatus("wait", "ловим сигнал…");
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
});

audio.addEventListener("pause", () => {
  document.body.classList.remove("broadcasting");
  if (!state.paused) setStatus("", "пауза");
  updatePlayerUI();
});

audio.addEventListener("waiting", () => {
  setStatus("wait", "буферизация…");
});

audio.addEventListener("error", () => {
  if (!state.playingId) return;
  const attempt = Math.min(reconnectAttempt, BACKOFF.length - 1);
  if (reconnectAttempt >= BACKOFF.length - 1) {
    setStatus("err", "волна умерла. выбери другую");
    toast("Поток не отвечает — волна уплыла");
    return;
  }
  const delay = BACKOFF[attempt + 1];
  reconnectAttempt++;
  setStatus("err", `сигнал потерян, пересоединяюсь (${reconnectAttempt}/5)…`);
  clearReconnect();
  reconnectTimer = setTimeout(() => {
    const st = stationById(state.playingId);
    if (!st) return;
    audio.src = st.stream;
    audio.volume = state.muted ? 0 : state.volume;
    safePlay();
  }, delay);
});

audio.addEventListener("stalled", () => setStatus("wait", "поток тупит…"));

/* «Сейчас в эфире» — AzuraCast API для станций, которые его отдадают */
let npPollTimer = null;

function startNowPlayingPoll() {
  stopNowPlayingPoll();
  const st = state.playingId ? stationById(state.playingId) : null;
  if (!st || !st.nowplaying) return;
  const poll = () => {
    if (typeof fetch !== "function") return;
    const current = st; // замыкание на станцию
    fetch(current.nowplaying)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const song = d && d.now_playing && d.now_playing.song;
        if (state.playingId === current.id && song && !state.paused && song.title) {
          setStatus("live", song.artist ? `${song.title} — ${song.artist}` : song.title);
        }
      })
      .catch(() => {}); /* без CORS/офлайн — просто оставляем «в эфире» */
  };
  poll();
  npPollTimer = setInterval(poll, 20000);
}

function stopNowPlayingPoll() {
  if (npPollTimer) {
    clearInterval(npPollTimer);
    npPollTimer = null;
  }
}


/* Плеер: кнопки */

$("#btnPlay").addEventListener("click", togglePlay);
$("#btnNext").addEventListener("click", () => nextStation(1));
$("#btnPrev").addEventListener("click", () => nextStation(-1));

$("#npBtn").addEventListener("click", () => {
  if (state.playingId) audio.paused ? togglePlay() : audio.pause();
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
      e.shiftKey && (e.preventDefault(), nextStation(1));
      break;
    case "ArrowLeft":
      e.shiftKey && (e.preventDefault(), nextStation(-1));
      break;
  }
});

/* Громкость */

function paintRange(input, color) {
  const pct = Number(input.value) * 100;
  input.style.background = `linear-gradient(to right, ${color} ${pct}%, #2d1a44 ${pct}%)`;
}

function applyVolumeUI() {
  const vol = $("#volume");
  vol.value = state.volume;
  paintRange(vol, "var(--acid)");
  audio.volume = state.muted ? 0 : state.volume;
  const muteBtn = $("#btnMute");
  muteBtn.classList.toggle("muted", state.muted);
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

/* Избранное */

function toggleFavorite(id) {
  const i = state.favorites.indexOf(id);
  if (i >= 0) state.favorites.splice(i, 1);
  else state.favorites.push(id);
  saveState();
  render();
  updatePlayerUI();
}

/* MediaSession */

function updateMediaSession(st) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${st.name} — Упоротая волна`,
      artist: "интернет-радио",
      album: st.genre,
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

/* ---------------- Рендеринг ---------------- */

const viewEl = $("#view");

function visibleStations() {
  const q = state.query.toLowerCase();
  let list = STATIONS;
  if (state.onlyFav) list = list.filter((s) => state.favorites.includes(s.id));
  if (q) {
    list = list.filter((s) => s.name.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q));
  }
  if (state.onlyFav || q) return list;
  return [];
}

function render() {
  viewEl.replaceChildren();

  const searching = state.query || state.onlyFav;

  if (searching) {
    const list = visibleStations();
    if (!list.length) {
      const empty = el("div", "empty");
      empty.appendChild(el("div", "empty-emoji", state.onlyFav ? "💔" : "🕳️"));
      empty.appendChild(el("h3", null, state.onlyFav ? "Избранное пусто" : "Ничего не нащупали"));
      empty.appendChild(el("p", null, state.onlyFav
        ? "Жми на сердечко у любой волны — она поселится здесь и переживёт перезагрузку."
        : "Такой волны нет. Попробуй «хардбасс», «гоп» или «чил»."));
      viewEl.appendChild(empty);
      return;
    }
    const grid = el("div", "grid");
    list.forEach((s) => grid.appendChild(stationCard(s)));
    viewEl.appendChild(grid);
    return;
  }

  // hero
  const hero = el("div", "hero");
  hero.appendChild(el("h1", "hero-title", "УПОРОТАЯ ВОЛНА"));
  const sub = el("p", "hero-sub");
  sub.append(
    document.createTextNode("Интернет-радио из реально живых потоков. Хардбасс, рейв, транс, чил и диски из лета-2004. "),
    el("b", null, "Кликни волну")
  );
  hero.appendChild(sub);

  const actions = el("div", "hero-actions");
  const playBtn = el("button", "btn primary", "Случайная волна 🎲");
  playBtn.addEventListener("click", () => {
    const random = STATIONS[Math.floor(Math.random() * STATIONS.length)];
    playStation(random.id, { fromTable: true });
    toast(`${random.emoji} ${random.name} — погнали`);
  });
  const lastBtn = el("button", "btn ghost", "Продолжить прошлую");
  lastBtn.addEventListener("click", () => {
    if (state.lastChannel && stationById(state.lastChannel)) playStation(state.lastChannel, { fromTable: true });
    else toast("Прошлой волны пока не было");
  });
  actions.appendChild(playBtn);
  actions.appendChild(lastBtn);
  hero.appendChild(actions);

  const marquee = el("div", "marquee");
  const track = el("div", "marquee-track");
  const line = "эфир предварён барабанной дробью · ворона смотрит на тебя · громкость крути как знаешь · потоки чистые, без регистрации · ";
  track.textContent = line + line;
  marquee.appendChild(track);
  hero.appendChild(marquee);
  viewEl.appendChild(hero);

  // фильтры
  const chips = el("div", "chips");
  const chipAll = el("button", "chip small" + (!state.view && !state.query && !state.onlyFav ? " on" : ""), "Все волны");
  chipAll.addEventListener("click", () => clearFilters());
  chips.appendChild(chipAll);
  for (const sec of SECTIONS) {
    const chip = el("button", "chip small" + (state.view === sec.key ? " on" : ""), sec.title.replace(/^\S+\s/, ""));
    chip.addEventListener("click", () => {
      state.query = "";
      $("#searchInput").value = "";
      state.onlyFav = false;
      $("#favChip").classList.remove("on");
      $("#favChip").setAttribute("aria-pressed", "false");
      state.view = state.view === sec.key ? null : sec.key;
      render();
    });
    chips.appendChild(chip);
  }
  viewEl.appendChild(chips);

  // секции
  const filtered = state.view ? STATIONS.filter((s) => s.mood === state.view) : STATIONS;
  for (const sec of SECTIONS) {
    const stations = filtered.filter((s) => s.mood === sec.key);
    if (!stations.length) continue;
    const section = el("section", "section");
    section.appendChild(el("h2", "section-title", sec.title));
    const grid = el("div", "grid");
    stations.forEach((s) => grid.appendChild(stationCard(s)));
    section.appendChild(grid);
    viewEl.appendChild(section);
  }
}

function clearFilters() {
  state.query = "";
  state.onlyFav = false;
  state.view = null;
  $("#searchInput").value = "";
  const fc = $("#favChip");
  fc.classList.remove("on");
  fc.setAttribute("aria-pressed", "false");
  render();
}

function stationCard(st) {
  const card = el("button", "station");
  card.dataset.id = st.id;
  card.style.setProperty("--st", st.color);
  card.style.setProperty("--acid-glow", st.color + "22");

  card.appendChild(el("span", "glow"));

  const head = el("div", "station-head");
  const art = el("span", "station-emoji", st.emoji);
  head.appendChild(art);
  const titles = el("div", "");
  titles.style.minWidth = "0";
  titles.appendChild(el("div", "station-name", st.name));
  titles.appendChild(el("div", "station-genre", st.genre));
  head.appendChild(titles);
  card.appendChild(head);

  const foot = el("div", "station-foot");
  foot.appendChild(el("span", "station-badge", st.origin === "soma" ? "soma fm" : st.origin === "upwave" ? "upwaveradio.ru" : "radio record"));

  const eq = el("span", "pulse");
  eq.appendChild(el("i"));
  eq.appendChild(el("i"));
  eq.appendChild(el("i"));
  foot.appendChild(eq);

  const heart = el("span", "fav-mini" + (state.favorites.includes(st.id) ? " liked" : ""));
  heart.setAttribute("role", "button");
  heart.setAttribute("aria-label", "В избранное");
  heart.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.8-9.2C.6 8.4 2.6 4.9 6 4.6c2-.2 3.9.9 6 3.2 2.1-2.3 4-3.4 6-3.2 3.4.3 5.4 3.8 3.8 7.2C19.5 16.4 12 21 12 21z"/></svg>';
  foot.appendChild(heart);
  card.appendChild(foot);

  if (state.playingId === st.id) card.classList.add("live");

  heart.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(st.id);
  });

  card.addEventListener("click", () => playStation(st.id, { fromTable: true }));
  return card;
}

function updatePlayerUI() {
  const st = state.playingId ? stationById(state.playingId) : null;
  const playBtn = $("#btnPlay");
  const isPlaying = !audio.paused && !state.paused && !!st;

  $("#npTitle").textContent = st ? `${st.emoji} ${st.name}` : "Волна не выбрана";
  $("#npArt").textContent = st ? st.emoji : "📻";

  playBtn.disabled = !st;
  playBtn.classList.toggle("playing", isPlaying);
  playBtn.setAttribute("aria-label", isPlaying ? "Пауза" : "Играть");

  const favBtn = $("#npFav");
  favBtn.disabled = !st;
  favBtn.classList.toggle("liked", !!(st && state.favorites.includes(st.id)));

  document.querySelectorAll(".station").forEach((card) => {
    card.classList.toggle("live", !!st && card.dataset.id === st.id);
  });

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch { /* no-op */ }
  }
}

/* ---------------- Поиск и фильтры ---------------- */

$("#searchInput").addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  render();
});

$("#favChip").addEventListener("click", () => {
  state.onlyFav = !state.onlyFav;
  const chip = $("#favChip");
  chip.classList.toggle("on", state.onlyFav);
  chip.setAttribute("aria-pressed", String(state.onlyFav));
  render();
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
    playStation(state.lastChannel === "hbass" ? state.lastChannel : "hbass", { fromTable: true });
    toast("ХАРДБАСС-РЕЖИМ АКТИВИРОВАН 🐦‍🔥");
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

/* или долгое удержание статуса «в эфире» */
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

$(".brand-mark").addEventListener("click", () => {
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

  const chip = $("#favChip");
  chip.classList.toggle("on", state.onlyFav);
  chip.setAttribute("aria-pressed", String(state.onlyFav));

  render();
  updatePlayerUI();

  // восстановить последнюю волну (без автоплея — браузеры его блокируют)
  const last = state.lastChannel && stationById(state.lastChannel);
  if (last) {
    state.playingId = last.id;
    updatePlayerUI();
    setStatus("", "жми play — продолжим эфир");
    $("#npBtn").disabled = false;
  }
}

init();
