// ============ MIXO frontend (camera, delete posts and comments) ============
const MAX_SECONDS = 30; // longest video allowed while testing on free storage
const MAX_MB = 50;      // Supabase free plan file size limit

// ---------- Supabase connection (these two values are safe to keep in the app) ----------
const SUPABASE_URL = "https://jnmfvroicwqpbvdzbpsb.supabase.co";
const SUPABASE_KEY = "sb_publishable_S8-JLr_YEm79fo289mhNNA_xJU8oKSl";
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const MIXO = { backendReady: !!sb, user: null, profile: null };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const icon = (n) => `<svg class="ic"><use href="#i-${n}"/></svg>`;
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "K" : n);

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}

// ---------- splash: full-screen logo, then fade into the app ----------
window.addEventListener("load", async () => {
  let session = null;
  if (sb) {
    try { session = (await sb.auth.getSession()).data.session; } catch (e) {}
    if (session) await loadMe(session.user);
  }
  setTimeout(() => {
    if (session) enterApp(); else $("#auth").classList.remove("hidden");
    const s = $("#splash");
    s.classList.add("hide");
    setTimeout(() => s.remove(), 800);
  }, 2200);
});

// ---------- login / sign up / forgot ----------
const say = (m) => ($("#authMsg").textContent = m);

function showForm(id) {
  ["login", "signup", "forgot"].forEach((f) => $("#" + f).classList.toggle("hidden", f !== id));
  $$("#authTabs button").forEach((b) => b.classList.toggle("on", b.dataset.f === id));
  $("#authTabs").classList.toggle("hidden", id === "forgot");
  say("");
}
$$("#authTabs button").forEach((b) => (b.onclick = () => showForm(b.dataset.f)));
$("#forgotLink").onclick = () => showForm("forgot");
$("#backLogin").onclick = () => showForm("login");

// show / hide password
$$(".eye").forEach((b) => (b.onclick = () => {
  const input = b.previousElementSibling;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  b.innerHTML = icon(show ? "eye" : "eyeoff");
}));

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const validUser = (u) => /^[a-z0-9_.]{3,20}$/.test(u);

function checkForm(id, f) {
  if (id === "signup" && !validUser(f.username.value.trim().toLowerCase()))
    return "Username: 3-20 letters, numbers, _ or .";
  if (!validEmail(f.email.value.trim())) return "Enter a valid email address.";
  if (id !== "forgot" && f.password.value.length < 8) return "Password needs at least 8 characters.";
  return "";
}

const niceError = (m = "") =>
  /^blocked$/i.test(m) ? "You can't follow this person."
  : /invalid login/i.test(m) ? "Wrong email or password."
  : /already registered|already been registered/i.test(m) ? "That email already has an account. Try logging in."
  : /database error/i.test(m) ? "That username is taken. Try another."
  : /rate limit/i.test(m) ? "Too many tries. Wait a few minutes and try again."
  : /banner_url/i.test(m) ? "Banner isn't set up yet. Run the banner SQL in Supabase first."
  : /relation .*does not exist|schema cache|could not find the table/i.test(m) ? "Posts aren't set up yet. Run the posts SQL in Supabase first."
  : /exceeded|too large|payload/i.test(m) ? "That video is too big. Keep it under 50 MB."
  : /bucket not found/i.test(m) ? "Storage isn't set up yet. Run the storage SQL in Supabase."
  : /row-level security/i.test(m) ? "Not allowed. Check that the storage SQL ran correctly."
  : /fetch|network/i.test(m) ? "Can't reach the server. Check your internet."
  : m || "Something went wrong. Try again.";

async function handleAuth(id, form) {
  const email = form.email.value.trim();
  const btn = $(".btn", form);
  btn.disabled = true;
  say("");
  try {
    if (id === "login") {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: form.password.value });
      if (error) throw error;
      await loadMe(data.user);
      enterApp();
    } else if (id === "signup") {
      const username = form.username.value.trim().toLowerCase();
      const { data: taken } = await sb.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken) throw new Error("That username is taken. Try another.");
      const { data, error } = await sb.auth.signUp({ email, password: form.password.value, options: { data: { username } } });
      if (error) throw error;
      if (!data.session) { say("Check your email to confirm your account, then log in."); return; }
      await loadMe(data.user);
      enterApp();
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if (error) throw error;
      say("If that email has an account, a reset link is on its way.");
    }
  } catch (err) {
    say(niceError(err.message));
  } finally {
    btn.disabled = false;
  }
}

["login", "signup", "forgot"].forEach((id) => {
  $("#" + id).addEventListener("submit", (e) => {
    e.preventDefault();
    const err = checkForm(id, e.target);
    if (err) return say(err);
    if (!sb) return say("Can't reach the server. Check your internet and reload.");
    handleAuth(id, e.target);
  });
});

async function loadMe(user) {
  MIXO.user = user;
  try {
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    MIXO.profile = data;
  } catch (e) {}
}

function paintAvatar(el, p, name) {
  if (p && p.avatar_url) el.innerHTML = `<img src="${p.avatar_url}" alt="">`;
  else el.textContent = (name || "M")[0].toUpperCase();
}

// shows the pin for a country, or the custom Earth logo
function setLoc(el, country, empty) {
  const earth = country === "Earth";
  el.textContent = country || empty;
  const ic = el.previousElementSibling;
  if (!ic) return;
  ic.classList.toggle("earth", earth);
  ic.firstElementChild.setAttribute("href", earth ? "#i-earth" : "#i-pin");
}

function fillProfile() {
  const p = MIXO.profile || {};
  const name = p.display_name || p.username || "Your name";
  paintAvatar($("#pAvatar"), p, p.display_name || p.username);
  $("#pName").textContent = name;
  if (typeof CX !== "undefined" && CX.premium) $("#pName").insertAdjacentHTML("beforeend", crownHTML("in"));
  $("#pUser").textContent = p.username ? "@" + p.username : "@username";
  $("#pBio").textContent = p.bio || "Add a bio";
  $("#pBio").classList.toggle("hint", !p.bio);
  setLoc($("#pCountry"), p.country, MIXO.user ? "Detecting your country..." : "Add your location");
  $("#pCountry").classList.toggle("hint", !p.country);
  const bi = $("#pBannerImg");
  if (p.banner_url) { bi.src = p.banner_url; bi.classList.remove("hidden"); $("#pBanner").classList.add("custom"); }
  else { bi.classList.add("hidden"); $("#pBanner").classList.remove("custom"); }
  if (typeof cxPaintMe === "function" && typeof CX !== "undefined") cxPaintMe();
}

function enterApp() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  fillProfile();
  ensureCountry();
  startInbox();
  loadPremium();
  loadSocial().finally(() => { renderFeed(); loadMyPosts(); refreshMyStats(); openFromHash(); });
}
$("#previewBtn").onclick = enterApp;

$("#logoutBtn").onclick = async () => {
  $("#setSheet").classList.add("hidden");
  if (sb) await sb.auth.signOut();
  pauseAll();
  stopInbox();
  $("#feed").innerHTML = "";
  MIXO.user = null;
  MIXO.profile = null;
  CX.premium = false; CX.until = null; CX.quota = null; CX.recent = []; CX.views = 0; premCache.clear();
  fillProfile();
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  showForm("login");
  go("home");
};

// ---------- navigation ----------
const state = { liked: new Set(), following: new Set(), prev: "home" };
const social = { likes: new Set(), saves: new Set(), following: new Set(), blocked: new Set() };

function go(page) {
  $$(".page").forEach((p) => p.classList.toggle("on", p.id === page));
  $$("#nav [data-page]").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  if (page === "home") { if (MIXO.current) MIXO.current.play().catch(() => {}); }
  else pauseAll();
  if (page === "profile") loadMyPosts();
  if (page === "explore") loadExplore();
  if (page === "inbox") refreshInbox();
  if (page === "connect") connectEnter(); else connectLeave();
}
$$("#nav [data-page]").forEach((b) => (b.onclick = () => go(b.dataset.page)));

$$(".page .seg").forEach((seg) => {
  seg.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    $$("button", seg).forEach((b) => b.classList.toggle("on", b === e.target));
  });
});

// ---------- create sheet ----------
$("#createBtn").onclick = () => $("#sheet").classList.remove("hidden");
$("#sheet").onclick = (e) => {
  if (e.target.id === "sheet") $("#sheet").classList.add("hidden");
  const opt = e.target.closest(".opt");
  if (opt) {
    $("#sheet").classList.add("hidden");
    if (opt.dataset.kind === "video") openCamera();
    else if (opt.dataset.kind === "photo") openPhoto();
    else openTopic();
  }
};

// ---------- post a video ----------
const postSheet = $("#postSheet"), postVid = $("#postVid"), postMsg = $("#postMsg");
let picked = null, uploading = false;

function resetPost() {
  picked = null;
  if (postVid.src) URL.revokeObjectURL(postVid.src);
  postVid.removeAttribute("src");
  postVid.load();
  postVid.classList.add("hidden");
  $("#postPick").classList.remove("has");
  $("#postForm").reset();
  postMsg.textContent = "";
}
function openPost() {
  if (!MIXO.user) return toast("Log in with your account to post");
  resetPost();
  postSheet.classList.remove("hidden");
}
function closePost() {
  if (uploading) return;
  postSheet.classList.add("hidden");
  resetPost();
}
$("#postCancel").onclick = closePost;
postSheet.onclick = (e) => { if (e.target.id === "postSheet") closePost(); };
$("#postPick").onclick = () => $("#postFile").click();

$("#postFile").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (postSheet.classList.contains("hidden")) { camClose(); openPost(); }
  handleVideoFile(file);
};
$("#camNative").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  camClose();
  openPost();
  handleVideoFile(file);
};
function handleVideoFile(file) {
  postMsg.textContent = "";
  if (file.size > MAX_MB * 1048576) { postMsg.textContent = "That video is over " + MAX_MB + " MB. Pick a shorter one."; return; }
  const url = URL.createObjectURL(file);
  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.onloadedmetadata = () => {
    const d = probe.duration;
    URL.revokeObjectURL(url);
    if (isFinite(d) && d > MAX_SECONDS + 0.5) { postMsg.textContent = "Videos can be up to " + MAX_SECONDS + " seconds. Yours is " + Math.round(d) + "s."; return; }
    picked = file;
    if (postVid.src) URL.revokeObjectURL(postVid.src);
    postVid.src = URL.createObjectURL(file);
    postVid.classList.remove("hidden");
    $("#postPick").classList.add("has");
    postVid.play().catch(() => {});
  };
  probe.onerror = () => { URL.revokeObjectURL(url); postMsg.textContent = "Couldn't read that video. Try an MP4."; };
  probe.src = url;
}

$("#postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!picked) { postMsg.textContent = "Choose a video first."; return; }
  const btn = $("#postSubmit");
  btn.disabled = true;
  uploading = true;
  postMsg.textContent = "Uploading... keep this open.";
  let path = "";
  try {
    const ext = (picked.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
    path = MIXO.user.id + "/" + Date.now() + "." + ext;
    const up = await sb.storage.from("videos").upload(path, picked, { contentType: picked.type || "video/mp4" });
    if (up.error) throw up.error;
    const url = sb.storage.from("videos").getPublicUrl(path).data.publicUrl;
    const ins = await sb.from("posts").insert(Object.assign({ user_id: MIXO.user.id, type: "video", caption: e.target.caption.value.trim(), media_url: url }, picked._sound ? { sound_id: picked._sound.id } : {}));
    if (ins.error) { await sb.storage.from("videos").remove([path]); throw ins.error; }
    uploading = false;
    closePost();
    go("home");
    await renderFeed();
    toast("Posted!");
    loadMyPosts();
  } catch (err) {
    postMsg.textContent = /sound_id/i.test(err.message || "") ? "Run mixo_sounds.sql in Supabase first." : niceError(err.message);
  } finally {
    uploading = false;
    btn.disabled = false;
  }
});

// ---------- camera: opens first when you tap Video post ----------
const cam = { stream: null, rec: null, chunks: [], facing: "user", max: 15, timer: false, torch: false, t0: 0, raf: 0, cd: 0, file: null, url: "", busy: false };
const camEl = $("#cam"), camVid = $("#camVid");
const REC_C = 289.03;
const CAM_MIMES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
const setRing = (p) => { $("#camProg").style.strokeDashoffset = REC_C * (1 - Math.min(1, Math.max(0, p))); };
const camUi = (s) => { camEl.dataset.state = s; };
function camFail(msg) { $("#camErrTxt").textContent = msg; $("#camErr").classList.remove("hidden"); }

async function camStart() {
  camStop();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: cam.facing, width: { ideal: 1280 }, height: { ideal: 960 } },
    audio: true
  });
  cam.stream = stream;
  camVid.srcObject = stream;
  camVid.classList.toggle("mirror", cam.facing === "user");
  try { await camVid.play(); } catch (e) {}
  const track = stream.getVideoTracks()[0];
  const caps = (track && track.getCapabilities && track.getCapabilities()) || {};
  cam.torch = false;
  $("#camFlash").classList.toggle("hidden", !caps.torch);
  $("#camFlash").classList.remove("on");
  $("#camErr").classList.add("hidden");
}
function camStop() {
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  camVid.srcObject = null;
}
async function openCamera(opts) {
  if (!MIXO.user) return toast("Log in with your account to post");
  cam.reply = (opts && opts.reply) || null;
  cam.sound = (opts && opts.sound) || null;
  cam.sndDur = 0;
  cam.mix = null;
  paintCamSound();
  pauseAll();
  camEl.classList.remove("hidden");
  camUi("idle");
  $("#camReview").classList.add("hidden");
  $("#camTime").classList.add("hidden");
  $("#camCount").classList.add("hidden");
  $("#camErr").classList.add("hidden");
  setRing(0);
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    return camFail("This browser can't open the camera here. Use your phone's camera instead.");
  }
  try { await camStart(); }
  catch (err) {
    camFail(err && err.name === "NotAllowedError"
      ? "Camera or microphone access is blocked. Allow it in your browser settings, or use your phone's camera."
      : "Couldn't start the camera. Use your phone's camera instead.");
  }
}
function camClose() {
  soundOff();
  if (cam.rec && cam.rec.state === "recording") { cam.rec.onstop = null; try { cam.rec.stop(); } catch (e) {} }
  cancelAnimationFrame(cam.raf);
  clearTimeout(cam.cd);
  cam.busy = false;
  camStop();
  if (cam.url) { URL.revokeObjectURL(cam.url); cam.url = ""; }
  const rv = $("#camRevVid");
  rv.pause();
  rv.removeAttribute("src");
  $("#camCount").classList.add("hidden");
  camEl.classList.add("hidden");
  if ($("#home").classList.contains("on") && MIXO.current) MIXO.current.play().catch(() => {});
}

function camStartRec() {
  const mime = CAM_MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || "";
  try {
    cam.rec = new MediaRecorder(cam.sound && cam.mix ? cam.mix : cam.stream, Object.assign({ videoBitsPerSecond: 3000000 }, mime ? { mimeType: mime } : {}));
  } catch (err) { return toast("This browser can't record video here."); }
  cam.chunks = [];
  cam.rec.ondataavailable = (e) => { if (e.data && e.data.size) cam.chunks.push(e.data); };
  cam.rec.onstop = camFinish;
  cam.rec.start(250);
  if (cam.sound && cam.sndEl) { try { cam.sndEl.currentTime = 0; } catch (e) {} cam.sndEl.play().catch(() => {}); }
  cam.t0 = Date.now();
  camUi("rec");
  $("#camTime").classList.remove("hidden");
  const loop = () => {
    const t = (Date.now() - cam.t0) / 1000;
    setRing(t / camLim());
    $("#camTime").textContent = "0:" + String(Math.floor(t)).padStart(2, "0");
    if (t >= camLim()) return camStopRec();
    cam.raf = requestAnimationFrame(loop);
  };
  loop();
}
function camStopRec() {
  soundOff();
  cancelAnimationFrame(cam.raf);
  if (cam.rec && cam.rec.state === "recording") cam.rec.stop();
}
function camFinish() {
  camUi("idle");
  $("#camTime").classList.add("hidden");
  setRing(0);
  if (Date.now() - cam.t0 < 800) return toast("Too short. Record a little longer.");
  const type = (cam.rec.mimeType || "video/mp4").split(";")[0];
  cam.file = new File(cam.chunks, "mixo-" + Date.now() + "." + (type.indexOf("mp4") > -1 ? "mp4" : "webm"), { type });
  if (cam.url) URL.revokeObjectURL(cam.url);
  cam.url = URL.createObjectURL(cam.file);
  const rv = $("#camRevVid");
  rv.src = cam.url;
  rv.play().catch(() => {});
  $("#camReview").classList.remove("hidden");
}
function camCountdown(n) {
  cam.busy = true;
  const c = $("#camCount");
  c.classList.remove("hidden");
  const tick = () => {
    if (n === 0) { c.classList.add("hidden"); cam.busy = false; camStartRec(); return; }
    c.textContent = n;
    n--;
    c.classList.remove("pop");
    void c.offsetWidth;
    c.classList.add("pop");
    cam.cd = setTimeout(tick, 1000);
  };
  tick();
}

$("#camRec").onclick = () => {
  if (cam.rec && cam.rec.state === "recording") return camStopRec();
  if (!cam.stream || cam.busy) return;
  if (cam.sound) soundUnlock();
  if (cam.timer) camCountdown(3); else camStartRec();
};
$("#camClose").onclick = camClose;
$("#camErrClose").onclick = camClose;
$("#camErrBtn").onclick = () => $("#camNative").click();
$("#camUp").onclick = () => (cam.reply ? $("#vrFile") : $("#postFile")).click();
$("#camFlip").onclick = async () => {
  if (cam.busy || (cam.rec && cam.rec.state === "recording")) return;
  cam.facing = cam.facing === "user" ? "environment" : "user";
  try { await camStart(); } catch (err) { toast("Couldn't switch the camera."); }
};
$("#camFlash").onclick = async () => {
  const track = cam.stream && cam.stream.getVideoTracks()[0];
  if (!track) return;
  cam.torch = !cam.torch;
  try { await track.applyConstraints({ advanced: [{ torch: cam.torch }] }); $("#camFlash").classList.toggle("on", cam.torch); }
  catch (err) { cam.torch = false; toast("Flash isn't available."); }
};
$("#camTimer").onclick = () => {
  cam.timer = !cam.timer;
  $("#camTimer").classList.toggle("on", cam.timer);
};
$$("#camModes button").forEach((b) => (b.onclick = () => {
  cam.max = +b.dataset.s;
  $$("#camModes button").forEach((x) => x.classList.toggle("on", x === b));
}));
$("#camRetake").onclick = () => { $("#camRevVid").pause(); $("#camReview").classList.add("hidden"); };
$("#camNext").onclick = () => {
  const f = cam.file;
  if (cam.sound && !cam.reply) f._sound = { id: cam.sound.id, name: cam.sound.name };
  if (cam.reply) { const r = cam.reply; camClose(); return sendVideoReply(r, f); }
  camClose();
  openPost();
  handleVideoFile(f);
};

// ---------- sounds: use someone's sound on your video ----------
const snd = { id: "", root: null, audio: null };
let spRows = [];
const camLim = () => (cam.sndDur ? Math.min(cam.max, cam.sndDur) : cam.max);
const sndTitle = (name) => name + " - Original sound";

function paintCamSound() {
  $("#camSound").classList.toggle("hidden", !!cam.reply);
  $("#camSoundTxt").textContent = cam.sound ? sndTitle(cam.sound.name) : "Add sound";
  $("#camSoundX").classList.toggle("hidden", !cam.sound);
  $("#camSound").classList.toggle("on", !!cam.sound);
}
$("#camSound").onclick = (e) => {
  if (cam.rec && cam.rec.state === "recording") return;
  if (e.target.closest("#camSoundX")) { cam.sound = null; cam.sndDur = 0; cam.mix = null; paintCamSound(); return; }
  openSoundPicker();
};

// runs inside the Record tap so the phone allows the audio to play
function soundUnlock() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!cam.ctx) cam.ctx = new AC();
    if (cam.ctx.state === "suspended") cam.ctx.resume();
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    el.src = cam.sound.url;
    el.onloadedmetadata = () => { if (isFinite(el.duration)) cam.sndDur = el.duration; };
    const src = cam.ctx.createMediaElementSource(el);
    const dest = cam.ctx.createMediaStreamDestination();
    src.connect(dest);
    src.connect(cam.ctx.destination);
    cam.sndEl = el;
    cam.mix = new MediaStream([...cam.stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    el.play().then(() => el.pause()).catch(() => {});
  } catch (err) {
    cam.mix = null;
    cam.sndEl = null;
    cam.sound = null;
    paintCamSound();
    toast("Couldn't load that sound. Recording without it.");
  }
}
function soundOff() { if (cam.sndEl) { try { cam.sndEl.pause(); } catch (e) {} } }

async function openSoundPicker() {
  const body = $("#spBody");
  $("#sndPick").classList.remove("hidden");
  body.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const list = await queryPosts((q) => q.eq("type", "video").order("created_at", { ascending: false }).limit(40));
    spRows = list.map((p) => ({ id: String(p.id), url: p.img, name: p.name, avatar: p.avatar, time: p.time }));
  } catch (e) { body.innerHTML = `<p class="hint">Couldn't load sounds.</p>`; return; }
  body.innerHTML = spRows.length
    ? spRows.map((x, i) => `<button type="button" class="lrow" data-i="${i}"><div class="lav"></div><div class="ltx"><b>${esc(sndTitle(x.name))}</b><span>${ago(x.time)}</span></div></button>`).join("")
    : '<p class="hint">No sounds yet.<br>Post a video and it becomes a sound.</p>';
  $$("#spBody .lav").forEach((el, i) => setAv(el, spRows[i].avatar, spRows[i].name));
}
$("#sndPick").addEventListener("click", (e) => {
  if (e.target.id === "sndPick") return $("#sndPick").classList.add("hidden");
  const row = e.target.closest(".lrow");
  if (!row) return;
  const s = spRows[+row.dataset.i];
  cam.sound = { id: s.id, url: s.url, name: s.name };
  cam.sndDur = 0;
  cam.mix = null;
  paintCamSound();
  $("#sndPick").classList.add("hidden");
});

function stopSndPreview() {
  if (snd.audio) { snd.audio.pause(); snd.audio = null; }
  $("#sndPlay use").setAttribute("href", "#i-play");
  $("#sndWave").classList.remove("on");
}
function closeSound() {
  stopSndPreview();
  $("#sndPage").classList.add("hidden");
}

async function openSound(id) {
  if (!sb || !MIXO.user) return toast("Log in with your account to open sounds");
  pauseAll();
  snd.id = String(id);
  snd.root = null;
  $("#sndPage").classList.remove("hidden");
  $("#sndGrid").innerHTML = '<p class="snd-hint">Loading...</p>';
  ["#sndCount", "#sndCreators", "#sndLikes"].forEach((k) => ($(k).textContent = "-"));
  const root = await fetchOne(id).catch(() => null);
  if (!root) { closeSound(); return toast("That sound isn't available anymore."); }
  snd.root = root;
  setAv($("#sndAv"), root.avatar, root.user);
  $("#sndName").textContent = root.name;
  $("#sndSub").textContent = "@" + root.user + " \u00b7 " + new Date(root.time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  let list = [];
  try {
    list = await queryPosts((q) => q.eq("type", "video").or(`id.eq.${id},sound_id.eq.${id}`).order("created_at", { ascending: false }).limit(60));
  } catch (e) { list = []; }
  if (!list.some((p) => String(p.id) === snd.id)) list.unshift(root);
  list.sort((a, b) => (String(b.id) === snd.id) - (String(a.id) === snd.id));
  $("#sndCount").textContent = fmt(list.length);
  $("#sndCreators").textContent = fmt(new Set(list.map((p) => p.uid)).size);
  $("#sndLikes").textContent = fmt(list.reduce((n, p) => n + (p.likes || 0), 0));
  $("#sndGrid").innerHTML = list.map((p) => `<button type="button" class="snt" data-id="${esc(p.id)}"><video src="${esc(p.img)}#t=0.1" muted playsinline preload="metadata"></video>${String(p.id) === snd.id ? "<em>Original</em>" : ""}<span class="sl">${icon("heart")}${fmt(p.likes || 0)}</span></button>`).join("");
}

$("#sndWave").innerHTML = Array.from({ length: 24 }, (_, i) => `<i style="--h:${6 + Math.round(Math.abs(Math.sin(i * 1.7)) * 14)}px;--d:${i * 50}ms"></i>`).join("");
$("#sndBack").onclick = closeSound;
$("#sndPage").addEventListener("click", (e) => { if (e.target.id === "sndPage") closeSound(); });
$("#sndOwner").onclick = () => { const r = snd.root; if (r) { closeSound(); openCreator(r); } };
$("#sndPlay").onclick = () => {
  if (snd.audio) return stopSndPreview();
  if (!snd.root) return;
  snd.audio = new Audio(snd.root.img);
  snd.audio.onended = stopSndPreview;
  snd.audio.play().catch(stopSndPreview);
  $("#sndPlay use").setAttribute("href", "#i-pause");
  $("#sndWave").classList.add("on");
};
$("#sndUse").onclick = () => {
  const r = snd.root;
  if (!r) return;
  closeSound();
  openCamera({ sound: { id: String(r.id), url: r.img, name: r.name } });
};
$("#sndGrid").addEventListener("click", (e) => {
  const t = e.target.closest(".snt");
  if (!t) return;
  stopSndPreview();
  openVidCard(t.dataset.id);
});

// ---------- video card: a video opens small, with its buttons (not full screen) ----------
function closeVidCard() {
  $("#vcSheet").classList.add("hidden");
  $("#vcCard").innerHTML = "";
}
async function openVidCard(id) {
  if (!sb) return;
  pauseAll();
  let p = postCache.get(String(id));
  if (!p) { try { p = await fetchOne(id); } catch (err) { return toast(socialErr(err)); } }
  Object.assign(p, { src: p.img, caption: p.text, sound: "Original sound" });
  $("#vcCard").innerHTML = clipHTML(p);
  $("#vcSheet").classList.remove("hidden");
  const vid = $("#vcCard video.vid");
  if (!vid) return;
  vid.muted = !MIXO.sound;
  vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
}
$("#vcClose").onclick = closeVidCard;
$("#vcSheet").addEventListener("click", (e) => { if (e.target.id === "vcSheet") closeVidCard(); });
$("#vcCard").addEventListener("click", clipClick);
$("#vcCard").addEventListener("click", (e) => {
  const clip = e.target.closest(".clip");
  if (clip && !e.target.closest("[data-act], .info")) tapVideo(clip);
});

$("#sndStory").onclick = () => toast("Stories are coming soon");

// ---------- connect + profile ----------
// ---------- edit profile ----------

// ---------- country: found automatically, locked, or Earth ----------
let countryChoice = "real";
const regionName = (cc) => { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(String(cc).toUpperCase()) || ""; } catch (e) { return ""; } };
const getPosition = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error("no geolocation"));
  navigator.geolocation.getCurrentPosition(res, rej, { timeout: 10000, maximumAge: 3600000 });
});
// only the country is kept, never the coordinates
async function detectCountry() {
  try {
    const pos = await getPosition();
    const r = await fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + pos.coords.latitude + "&longitude=" + pos.coords.longitude + "&localityLanguage=en");
    const j = await r.json();
    const name = (j.countryCode && regionName(j.countryCode)) || j.countryName;
    if (name) return name;
  } catch (e) {}
  try { // location blocked: fall back to the network's country
    const r = await fetch("https://api.country.is/");
    const j = await r.json();
    if (j.country) return regionName(j.country);
  } catch (e) {}
  return "";
}
async function ensureCountry() {
  const p = MIXO.profile;
  if (!sb || !MIXO.user || !p || p.real_country) return;
  const name = await detectCountry();
  if (!name) return toast("Couldn't find your country. We'll try again next time.");
  const { data, error } = await sb.from("profiles").update({ real_country: name, country: name }).eq("id", MIXO.user.id).select().single();
  if (error) return toast(/real_country/.test(error.message) ? "Run mixo_country.sql in Supabase first." : niceError(error.message));
  MIXO.profile = data;
  fillProfile();
  toast("Your country is set to " + name);
}
function paintCountryPick() {
  const real = (MIXO.profile || {}).real_country;
  $("#cpReal").textContent = real || "Not found yet";
  $('#countryPick [data-v="real"]').disabled = !real;
  if (!real) countryChoice = "earth";
  $$("#countryPick button").forEach((b) => b.classList.toggle("on", b.dataset.v === countryChoice));
}
$("#countryPick").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  countryChoice = b.dataset.v;
  paintCountryPick();
});

function openEdit() {
  if (!MIXO.user) return toast("Log in with your account to edit your profile");
  const p = MIXO.profile || {};
  const f = $("#editForm");
  f.display_name.value = p.display_name || "";
  f.bio.value = p.bio || "";
  countryChoice = p.country === "Earth" ? "earth" : "real";
  paintCountryPick();
  paintEdit();
  $("#editMsg").textContent = "";
  $("#editSheet").classList.remove("hidden");
}
$("#editBtn").onclick = openEdit;
$("#editCancel").onclick = () => $("#editSheet").classList.add("hidden");
$("#editSheet").onclick = (e) => { if (e.target.id === "editSheet") $("#editSheet").classList.add("hidden"); };

// ---------- profile photo + banner (with crop and adjust) ----------
function paintEdit() {
  const p = MIXO.profile || {};
  paintAvatar($("#editAv"), p, p.display_name || p.username);
  $("#editBanner").style.backgroundImage = p.banner_url ? `url("${p.banner_url}")` : "";
}

// Opens the crop screen. Resolves with a JPEG blob, or null if cancelled.
function openCropper(file, kind) {
  return new Promise((resolve, reject) => {
    const box = $("#cropper"), stage = $("#cropStage"), img = $("#cropImg");
    const frame = $("#cropFrame"), zoom = $("#cropZoom");
    const banner = kind === "banner";
    const [outW, outH] = banner ? [1200, 420] : [512, 512];
    const url = URL.createObjectURL(file);
    const ac = new AbortController();
    const pts = new Map();
    let fw, fh, min, s = 1, x = 0, y = 0, lastDist = 0;

    const finish = () => { box.classList.add("hidden"); URL.revokeObjectURL(url); ac.abort(); img.removeAttribute("src"); };
    const draw = () => {
      const mw = Math.max(0, (img.naturalWidth * s - fw) / 2);
      const mh = Math.max(0, (img.naturalHeight * s - fh) / 2);
      x = Math.min(mw, Math.max(-mw, x));
      y = Math.min(mh, Math.max(-mh, y));
      img.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${s})`;
    };
    const setScale = (ns, fromSlider) => {
      s = Math.min(min * 5, Math.max(min, ns));
      if (!fromSlider) zoom.value = Math.round((Math.log(s / min) / Math.log(5)) * 100);
      draw();
    };

    $("#cropTitle").textContent = banner ? "Adjust banner" : "Adjust photo";
    box.classList.remove("hidden");

    img.onload = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      img.style.width = nw + "px";
      img.style.height = nh + "px";
      fw = banner ? stage.clientWidth - 28 : Math.min(stage.clientWidth, stage.clientHeight) * 0.8;
      fh = banner ? fw * (outH / outW) : fw;
      frame.style.width = fw + "px";
      frame.style.height = fh + "px";
      frame.className = "cframe " + (banner ? "wide" : "round");
      min = Math.max(fw / nw, fh / nh);
      x = 0; y = 0;
      zoom.value = 0;
      setScale(min);
    };
    img.onerror = () => { finish(); reject(new Error("Could not read that picture.")); };
    img.src = url;

    const opt = { signal: ac.signal };
    stage.addEventListener("pointerdown", (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastDist = 0;
    }, opt);
    stage.addEventListener("pointermove", (e) => {
      const prev = pts.get(e.pointerId);
      if (!prev) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        x += e.clientX - prev.x;
        y += e.clientY - prev.y;
        draw();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist) setScale((s * d) / lastDist);
        lastDist = d;
      }
    }, opt);
    const up = (e) => { pts.delete(e.pointerId); lastDist = 0; };
    stage.addEventListener("pointerup", up, opt);
    stage.addEventListener("pointercancel", up, opt);
    stage.addEventListener("wheel", (e) => { e.preventDefault(); setScale(s * (e.deltaY < 0 ? 1.08 : 0.92)); }, { signal: ac.signal, passive: false });

    zoom.oninput = () => setScale(min * Math.pow(5, zoom.value / 100), true);
    $("#cropCancel").onclick = () => { finish(); resolve(null); };
    $("#cropDone").onclick = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight;
      const cv = document.createElement("canvas");
      cv.width = outW;
      cv.height = outH;
      cv.getContext("2d").drawImage(img, nw / 2 - x / s - fw / (2 * s), nh / 2 - y / s - fh / (2 * s), fw / s, fh / s, 0, 0, outW, outH);
      cv.toBlob((b) => {
        finish();
        b ? resolve(b) : reject(new Error("Could not save that picture."));
      }, "image/jpeg", 0.88);
    };
  });
}

async function uploadPicture(blob, kind) {
  const col = kind === "banner" ? "banner_url" : "avatar_url";
  const path = MIXO.user.id + "/" + kind + ".jpg";
  const up = await sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
  const res = await sb.from("profiles").update({ [col]: url }).eq("id", MIXO.user.id).select().single();
  if (res.error) throw res.error;
  MIXO.profile = res.data;
  fillProfile();
  paintEdit();
}

[["#photoBtn", "#photoIn", "avatar", "Photo updated."], ["#bannerBtn", "#bannerIn", "banner", "Banner updated."]]
  .forEach(([btn, input, kind, done]) => {
    $(btn).onclick = () => $(input).click();
    $(input).onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const msg = $("#editMsg");
      msg.textContent = "";
      try {
        const blob = await openCropper(file, kind);
        if (!blob) return;
        msg.textContent = "Uploading...";
        await uploadPicture(blob, kind);
        msg.textContent = done;
      } catch (err) {
        msg.textContent = niceError(err.message);
      }
    };
  });

$("#editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, msg = $("#editMsg"), btn = $("#editSave");
  const display_name = f.display_name.value.trim();
  if (!display_name) { msg.textContent = "Enter a display name."; return; }
  btn.disabled = true;
  msg.textContent = "";
  try {
    const upd = { display_name, bio: f.bio.value.trim() };
    const real = (MIXO.profile || {}).real_country;
    if (countryChoice === "earth") upd.country = "Earth";
    else if (real) upd.country = real;
    const { data, error } = await sb.from("profiles")
      .update(upd)
      .eq("id", MIXO.user.id).select().single();
    if (error) throw error;
    MIXO.profile = data;
    fillProfile();
    $("#editSheet").classList.add("hidden");
    toast("Profile saved");
  } catch (err) {
    msg.textContent = niceError(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- follow + like (shared by feed and creator page) ----------
// ---------- follow (saved in the database) ----------
function paintFollow(uid) {
  const on = social.following.has(uid);
  $$(`.creator[data-uid="${uid}"]`).forEach((c) => {
    c.classList.toggle("following", on);
    const p = $(".plus", c);
    if (!p) return;
    p.innerHTML = icon(on ? "check" : "plus");
    p.classList.remove("pop");
    void p.offsetWidth;
    p.classList.add("pop");
  });
  const cf = $("#cFollow");
  if (cf.dataset.uid === uid) {
    cf.textContent = on ? "Following" : "Follow";
    cf.classList.toggle("is-on", on);
  }
}

async function toggleFollow(uid, uname) {
  if (!MIXO.user) return toast("Log in with your account to follow");
  if (!uid) return toast("This is just a preview post");
  if (uid === MIXO.user.id) return;
  const on = !social.following.has(uid);
  on ? social.following.add(uid) : social.following.delete(uid);
  paintFollow(uid);
  const r = on
    ? await sb.from("follows").insert({ following_id: uid })
    : await sb.from("follows").delete().eq("follower_id", MIXO.user.id).eq("following_id", uid);
  if (r.error && r.error.code !== "23505") {
    on ? social.following.delete(uid) : social.following.add(uid);
    paintFollow(uid);
    return toast(socialErr(r.error));
  }
  refreshMyStats();
  if ($("#cFollow").dataset.uid === uid) refreshCreatorStats(uid);
}

async function loadStats(uid) {
  const head = { count: "exact", head: true };
  const [a, b, c] = await Promise.all([
    sb.from("follows").select("follower_id", head).eq("follower_id", uid),
    sb.from("follows").select("follower_id", head).eq("following_id", uid),
    sb.from("post_likes").select("post_id,posts!inner(user_id)", head).eq("posts.user_id", uid),
  ]);
  return { following: a.count || 0, followers: b.count || 0, likes: c.count || 0 };
}
function showStats(prefix, s) {
  $("#" + prefix + "Following").textContent = fmt(s.following);
  $("#" + prefix + "Followers").textContent = fmt(s.followers);
  $("#" + prefix + "Likes").textContent = fmt(s.likes);
}
async function refreshMyStats() {
  if (!sb || !MIXO.user) return;
  try { showStats("p", await loadStats(MIXO.user.id)); } catch (e) {}
}
async function refreshCreatorStats(uid) {
  if (!sb || !uid) return;
  try {
    const s = await loadStats(uid);
    if ($("#cFollow").dataset.uid === uid) showStats("c", s);
  } catch (e) {}
}

// ---------- followers / following lists ----------
let listUsers = [];
async function openList(kind, uid) {
  if (!sb || !uid) return;
  const followers = kind === "followers";
  $("#lsTitle").textContent = followers ? "Followers" : "Following";
  $("#lsBody").innerHTML = '<p class="hint">Loading...</p>';
  $("#listSheet").classList.remove("hidden");
  const r = await sb.from("follows")
    .select("p:profiles!" + (followers ? "follower_id" : "following_id") + "(id,username,display_name,avatar_url,bio,country)")
    .eq(followers ? "following_id" : "follower_id", uid)
    .order("created_at", { ascending: false }).limit(100);
  if (r.error) { $("#lsBody").innerHTML = `<p class="hint">${esc(socialErr(r.error))}</p>`; return; }
  listUsers = r.data.map((x) => x.p).filter((p) => p && !social.blocked.has(p.id));
  $("#lsBody").innerHTML = listUsers.length
    ? listUsers.map((p, i) => `<button type="button" class="lrow" data-i="${i}"><div class="lav"></div><div class="ltx"><b>${esc(p.display_name || p.username)}</b><span>@${esc(p.username)}</span></div></button>`).join("")
    : `<p class="hint">${followers ? "No followers yet." : "Not following anyone yet."}</p>`;
  $$("#lsBody .lav").forEach((el, i) => setAv(el, listUsers[i].avatar_url, listUsers[i].username));
}
$("#listSheet").addEventListener("click", (e) => {
  if (e.target.id === "listSheet") return $("#listSheet").classList.add("hidden");
  const row = e.target.closest(".lrow");
  if (!row) return;
  const p = listUsers[+row.dataset.i];
  $("#listSheet").classList.add("hidden");
  openCreator({ uid: p.id, user: p.username, name: p.display_name || p.username, avatar: p.avatar_url,
    bio: p.bio || "", country: p.country || "", profile: { following: 0, followers: 0, likes: 0 } });
});
$("#profile .statcard").addEventListener("click", (e) => {
  const d = e.target.closest("[data-list]");
  if (d && MIXO.user) openList(d.dataset.list, MIXO.user.id);
});
$("#creator .statcard").addEventListener("click", (e) => {
  const d = e.target.closest("[data-list]");
  const u = $("#cFollow").dataset.uid;
  if (d && u) openList(d.dataset.list, u);
});

function setLike(v, on) {
  on ? state.liked.add(v.id) : state.liked.delete(v.id);
  const b = $(`.clip[data-id="${v.id}"] [data-act="like"]`);
  if (!b) return;
  b.classList.toggle("on", on);
  $(".n", b).textContent = fmt(v.likes + (on ? 1 : 0));
}

// ---------- creator profile page ----------
function openCreator(v) {
  if (MIXO.user && v.uid && v.uid === MIXO.user.id) return go("profile");
  state.prev = $(".page.on")?.id || "home";
  setAv($("#cAvatar"), v.avatar, v.user);
  $("#cName").textContent = v.name;
  $("#cUser").textContent = "@" + v.user;
  showStats("c", v.profile || { following: 0, followers: 0, likes: 0 });
  $("#cBio").textContent = v.bio || "";
  setLoc($("#cCountry"), v.country, "Not set");
  $("#cFollow").dataset.uid = v.uid || "";
  paintFollow(v.uid || "");
  go("creator");
  if (v.uid) refreshCreatorStats(v.uid);
  cUid = v.uid || ""; cTab = 0;
  $$("#cTabs button").forEach((x, n) => x.classList.toggle("on", n === 0));
  $("#cPrev").classList.toggle("hidden", !!v.uid);
  $("#cTabs").classList.toggle("hidden", !v.uid);
  $("#cBanner").classList.remove("custom");
  $("#cBannerImg").classList.add("hidden");
  $("#cGrid").innerHTML = "";
  if (v.uid && sb) { loadCreatorProfile(v.uid); loadCreatorPosts(); }
}
$("#backBtn").onclick = () => go(state.prev || "home");
$("#cFollow").onclick = (e) => toggleFollow(e.currentTarget.dataset.uid, $("#cUser").textContent.replace("@", ""));

// ---------- home feed ----------
const DEMO = [
  { id: 1, user: "mixo.team", name: "MIXO Team", caption: "This is where short videos will play.",
    sound: "Original sound", likes: 1280, comments: 64, bio: "Creating vibes | Music, videos, good energy", country: "United States", profile: { following: 12, followers: 2400, likes: 18600 } }
];
let videos = [];
let io;

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function setAv(el, url, name) {
  el.textContent = "";
  if (url) { const i = new Image(); i.alt = ""; i.src = url; el.appendChild(i); }
  else el.textContent = (name || "M")[0].toUpperCase();
}

function clipHTML(v) {
  const fol = !!(v.uid && social.following.has(v.uid));
  const liked = MIXO.user ? social.likes.has(String(v.id)) : state.liked.has(v.id);
  const mine = !!(MIXO.user && v.uid && v.uid === MIXO.user.id);
  const av = v.avatar ? `<img src="${esc(v.avatar)}" alt="">` : esc((v.user || "M")[0].toUpperCase());
  const type = v.type || "video";
  const isVid = type === "video" && v.src;
  const videoMedia = `<video class="vid" src="${esc(v.src)}" loop muted playsinline webkit-playsinline disablepictureinpicture disableremoteplayback controlslist="nofullscreen nodownload noremoteplayback" preload="metadata"></video><div class="pp"><svg class="ic" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>`;
  const media = type === "photo" ? `<img class="pimg" src="${esc(v.src)}" alt="" draggable="false">`
    : type === "topic" ? `<div class="topic" style="background:${topicBg(v.id)}"><p>${esc(v.caption)}</p></div>`
    : v.src ? videoMedia : `<div class="bg"></div><span class="tag">Preview layout</span>`;
  return `
  <article class="clip" data-id="${esc(v.id)}">
    ${media}
    ${mine || (MIXO.user && v.uid) ? `<button class="more" data-act="more" aria-label="${mine ? "Delete or more" : "More"}">${icon("more")}</button>` : ""}
    ${isVid ? `<div class="pill"><span class="arr"><i></i><i></i></span><span class="pt">Pull down to lock 2x speed</span></div>` : ""}
    <div class="info">
      <div class="user">@${esc(v.user)}</div>
      ${v.caption && type !== "topic" ? `<p class="cap">${esc(v.caption)}</p>` : ""}
      ${type === "video" ? `<div class="snd" data-act="sound">${icon("music")}<span>${esc(v.snd ? v.snd.name + " - Original sound" : (v.name ? "Original sound - " + v.name : v.sound))}</span></div>` : ""}
    </div>
    <div class="rail">
      <div class="creator ${fol ? "following" : ""} ${mine ? "solo" : ""}" data-uid="${esc(v.uid || "")}">
        <div class="av" data-act="profile" role="button" aria-label="Open profile">${av}</div>
        ${mine ? "" : `<button class="plus" data-act="follow" aria-label="Follow">${icon(fol ? "check" : "plus")}</button>`}
      </div>
      <button data-act="like" class="${liked ? "on" : ""}">${icon("heart")}<span class="n">${fmt(MIXO.user ? v.likes : v.likes + (liked ? 1 : 0))}</span></button>
      <button data-act="comment">${icon("comment")}<span>${fmt(v.comments)}</span></button>
      <button data-act="save" class="${social.saves.has(String(v.id)) ? "on" : ""}">${icon("save")}<span>Save</span></button>
      <button data-act="share">${icon("share")}<span>Share</span></button>
      ${type === "video" ? `<div class="disc" data-act="sound"><span class="dc">${v.snd && v.snd.avatar ? `<img src="${esc(v.snd.avatar)}" alt="">` : av}</span></div>` : ""}
    </div>
  </article>`;
}

const TOPIC_BG = ["linear-gradient(135deg,#0b1f66,#1f5bff)", "linear-gradient(135deg,#3a0f66,#7a3bff)", "linear-gradient(135deg,#06425a,#19b6d3)", "linear-gradient(135deg,#5a0f3a,#e8497a)", "linear-gradient(135deg,#0f4a2e,#2fbf7a)", "linear-gradient(135deg,#5a3a0f,#f2a03b)"];
function topicBg(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return TOPIC_BG[h % TOPIC_BG.length]; }
const emptyFeed = (msg) => `<div class="empty"><svg class="ic big"><use href="#i-video"/></svg><p>${msg}</p></div>`;

async function renderFeed() {
  const feed = $("#feed");
  pauseAll();
  if (!MIXO.user || !sb) {
    videos = DEMO;
    feed.innerHTML = videos.map(clipHTML).join("");
    return;
  }
  feed.innerHTML = emptyFeed("Loading videos...");
  try {
    const list = await queryPosts((q) => q.eq("type", "video").order("created_at", { ascending: false }).limit(30));
    videos = list.map((o) => Object.assign(o, { src: o.img, caption: o.text, sound: "Original sound" }));
    // your own posts first, then everyone else's (newest first in each group)
    videos.sort((a, b) => (b.uid === MIXO.user.id) - (a.uid === MIXO.user.id));
  } catch (err) {
    videos = [];
    feed.innerHTML = emptyFeed(esc(niceError(err.message)));
    return;
  }
  if (!videos.length) { feed.innerHTML = emptyFeed("No posts yet.<br>Tap + to post the first one."); return; }
  feed.innerHTML = videos.map(clipHTML).join("");
  feed.scrollTop = 0;
  watchVideos();
}

// autoplay the video that fills the screen, pause the rest
function watchVideos() {
  if (io) io.disconnect();
  MIXO.current = null;
  io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const vid = en.target;
      if (en.isIntersecting) {
        MIXO.current = vid;
        vid.muted = !MIXO.sound;
        vid.closest(".clip").classList.remove("paused");
        vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
      } else {
        vid.pause();
        vid.currentTime = 0;
        endHold(vid.closest(".clip"));
      }
    });
  }, { root: $("#feed"), threshold: 0.7 });
  $$("#feed video.vid").forEach((v) => { v.playsInline = true; v.setAttribute("playsinline", ""); io.observe(v); });
}
function pauseAll() { $$("video.vid").forEach((v) => v.pause()); }
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseAll(); else if ($("#home").classList.contains("on") && MIXO.current) MIXO.current.play().catch(() => {}); });

// tap video: first tap turns sound on, later taps pause / play
function tapVideo(clip) {
  const vid = $("video.vid", clip);
  if (!vid) return;
  if (vid.muted) { MIXO.sound = true; $$("video.vid").forEach((x) => (x.muted = false)); return; }
  if (vid.paused) { vid.play().catch(() => {}); clip.classList.remove("paused"); }
  else { vid.pause(); clip.classList.add("paused"); }
}

function clipClick(e) {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const clip = el.closest(".clip");
  const v = videos.find((x) => x.id == clip.dataset.id) || postCache.get(String(clip.dataset.id));
  if (!v) return;
  const act = el.dataset.act;
  const inCard = !!el.closest("#vcCard");

  if (act === "profile") { if (inCard) { closeVidCard(); closeSound(); } openCreator(v); }
  else if (act === "follow") toggleFollow(v.uid, v.user); else if (act === "like") { if (MIXO.user) toggleLike(v.id); else setLike(v, !state.liked.has(v.id)); }
  else if (act === "save") {
    toggleSave(v.id);
  } else if (act === "comment") { if (MIXO.user) openComments(v.id); else toast("Log in to comment"); }
  else if (act === "share") sharePost(v.id);
  else if (act === "sound") {
    const sid = String(v.soundId || v.id);
    if (inCard) { closeVidCard(); if (!$("#sndPage").classList.contains("hidden") && snd.id === sid) return; }
    openSound(sid);
  }
  else if (act === "more") postMore(v);
}
$("#feed").addEventListener("click", clipClick);

// ---------- double tap: love animation ----------
function burst(clip, e) {
  const r = clip.getBoundingClientRect();
  const h = document.createElement("div");
  h.className = "heart-pop";
  h.style.left = e.clientX - r.left + "px";
  h.style.top = e.clientY - r.top + "px";
  h.innerHTML = `<svg viewBox="0 0 24 24"><use href="#i-love"/></svg>`;
  clip.appendChild(h);
  setTimeout(() => h.remove(), 900);
}

let lastTap = 0, lastX = 0, lastY = 0, tapTimer;
$("#feed").addEventListener("pointerup", (e) => {
  if (justHeld || hold) return;
  if (e.target.closest("[data-act], .info")) { lastTap = 0; return; }
  const clip = e.target.closest(".clip");
  if (!clip) return;
  const now = Date.now();
  if (now - lastTap < 320 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 70) {
    clearTimeout(tapTimer);
    const v = videos.find((x) => x.id == clip.dataset.id);
    if (MIXO.user) { if (!social.likes.has(String(v.id))) toggleLike(v.id); }
    else if (!state.liked.has(v.id)) setLike(v, true);
    burst(clip, e);
    if (navigator.vibrate) navigator.vibrate(12);
    lastTap = 0;
    return;
  }
  lastTap = now; lastX = e.clientX; lastY = e.clientY;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => tapVideo(clip), 330);
});

// remove the old canvas-player switch if an earlier version saved it
try { localStorage.removeItem("mixoCanvas"); } catch (err) {}

// ---------- hold = 2x speed, pull down = lock (pill fades after 3s) ----------
let hTimer, pillTimer, hold = false, hLocked = false, hPulled = false, hY = 0, hX = 0, hClip = null, justHeld = false;
const hVid = (c) => $("video.vid", c);
function speed(c, r) { const v = hVid(c); if (v) v.playbackRate = r; }
function pillShow(c, text, locked) {
  const p = $(".pill", c); if (!p) return;
  clearTimeout(pillTimer);
  $(".pt", p).textContent = text;
  p.classList.toggle("locked", !!locked);
  p.classList.add("show");
}
function pillHide(c) { const p = c && $(".pill", c); if (p) p.classList.remove("show"); }
function endHold(c) { // reset everything for a clip (used when it scrolls away)
  clearTimeout(pillTimer); clearTimeout(hTimer);
  if (c) { pillHide(c); speed(c, 1); }
  hLocked = false; hold = false; hPulled = false;
}
const feedEl = $("#feed");
feedEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest("[data-act], .info")) return;
  const clip = e.target.closest(".clip");
  if (!clip || !hVid(clip)) return;
  hClip = clip; hY = e.clientY; hX = e.clientX; hPulled = false;
  clearTimeout(hTimer);
  hTimer = setTimeout(() => {
    hold = true;
    try { clip.setPointerCapture(e.pointerId); } catch (err) {}
    if (hLocked) pillShow(clip, "Pull down for normal speed", true);
    else { speed(clip, 2); pillShow(clip, "Pull down to lock 2x speed", false); }
    if (navigator.vibrate) navigator.vibrate(10);
  }, 300);
});
feedEl.addEventListener("pointermove", (e) => {
  if (!hold) { if (Math.hypot(e.clientX - hX, e.clientY - hY) > 12) clearTimeout(hTimer); return; }
  if (hPulled || e.clientY - hY <= 70) return;
  hPulled = true;
  if (navigator.vibrate) navigator.vibrate(20);
  if (!hLocked) {                       // lock 2x, show the pill 3s, then fade
    hLocked = true;
    pillShow(hClip, "2x speed locked", true);
    pillTimer = setTimeout(() => pillHide(hClip), 3000);
  } else {                              // back to normal
    hLocked = false;
    speed(hClip, 1);
    pillShow(hClip, "Normal speed", false);
    pillTimer = setTimeout(() => pillHide(hClip), 1200);
  }
});
const holdEnd = () => {
  clearTimeout(hTimer);
  if (!hold) return;
  hold = false;
  justHeld = true; setTimeout(() => (justHeld = false), 400);
  if (!hPulled) {                       // released without pulling
    if (!hLocked) speed(hClip, 1);
    pillHide(hClip);
  }
};
feedEl.addEventListener("pointerup", holdEnd);
feedEl.addEventListener("pointercancel", holdEnd);
feedEl.addEventListener("touchmove", (e) => { if (hold) e.preventDefault(); }, { passive: false });
feedEl.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------- photo post (image + description) ----------
const photoSheet = $("#photoSheet"), photoMsg = $("#photoMsg"), photoPrev = $("#photoPrev");
let photoBlob = null;
function resetPhoto() {
  photoBlob = null;
  if (photoPrev.src) URL.revokeObjectURL(photoPrev.src);
  photoPrev.removeAttribute("src");
  photoPrev.classList.add("hidden");
  $("#photoPick").classList.remove("has");
  $("#photoForm").reset();
  photoMsg.textContent = "";
}
function openPhoto() {
  if (!MIXO.user) return toast("Log in with your account to post");
  resetPhoto();
  photoSheet.classList.remove("hidden");
}
function closePhoto() {
  if (uploading) return;
  photoSheet.classList.add("hidden");
  resetPhoto();
}
$("#photoCancel").onclick = closePhoto;
photoSheet.onclick = (e) => { if (e.target.id === "photoSheet") closePhoto(); };
$("#photoPick").onclick = () => $("#photoFile").click();
$("#photoFile").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  photoMsg.textContent = "";
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1440 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    cv.toBlob((b) => {
      if (!b) { photoMsg.textContent = "Couldn't read that photo."; return; }
      photoBlob = b;
      if (photoPrev.src) URL.revokeObjectURL(photoPrev.src);
      photoPrev.src = URL.createObjectURL(b);
      photoPrev.classList.remove("hidden");
      $("#photoPick").classList.add("has");
    }, "image/jpeg", 0.85);
  };
  img.onerror = () => { URL.revokeObjectURL(url); photoMsg.textContent = "Couldn't read that photo. Try a JPG or PNG."; };
  img.src = url;
};
$("#photoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!photoBlob) { photoMsg.textContent = "Choose a photo first."; return; }
  const btn = $("#photoSubmit");
  btn.disabled = true; uploading = true;
  photoMsg.textContent = "Uploading...";
  let path = "";
  try {
    path = MIXO.user.id + "/post-" + Date.now() + ".jpg";
    const up = await sb.storage.from("avatars").upload(path, photoBlob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    const ins = await sb.from("posts").insert({ user_id: MIXO.user.id, type: "photo", caption: e.target.caption.value.trim(), media_url: url });
    if (ins.error) { await sb.storage.from("avatars").remove([path]); throw ins.error; }
    uploading = false;
    closePhoto();
    setExTab(0);
    go("explore");
    toast("Posted!");
    loadMyPosts();
  } catch (err) {
    photoMsg.textContent = niceError(err.message);
  } finally {
    uploading = false; btn.disabled = false;
  }
});

// ---------- topic post (text only, no image) ----------
const topicSheet = $("#topicSheet"), topicMsg = $("#topicMsg"), topicText = $("#topicText");
function openTopic() {
  if (!MIXO.user) return toast("Log in with your account to post");
  $("#topicForm").reset();
  $("#topicCount").textContent = "0";
  topicMsg.textContent = "";
  topicSheet.classList.remove("hidden");
}
function closeTopic() { if (!uploading) topicSheet.classList.add("hidden"); }
$("#topicCancel").onclick = closeTopic;
topicSheet.onclick = (e) => { if (e.target.id === "topicSheet") closeTopic(); };
topicText.addEventListener("input", () => { $("#topicCount").textContent = topicText.value.length; });
$("#topicForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = topicText.value.trim();
  if (!text) { topicMsg.textContent = "Write something first."; return; }
  const btn = $("#topicSubmit");
  btn.disabled = true; uploading = true;
  topicMsg.textContent = "Posting...";
  try {
    const ins = await sb.from("posts").insert({ user_id: MIXO.user.id, type: "topic", caption: text, media_url: "" });
    if (ins.error) throw ins.error;
    uploading = false;
    closeTopic();
    setExTab(1);
    go("explore");
    toast("Posted!");
    loadMyPosts();
  } catch (err) {
    topicMsg.textContent = niceError(err.message);
  } finally {
    uploading = false; btn.disabled = false;
  }
});


// ---------- social: likes / saves / comments ----------
const postCache = new Map();
const cnt = (x) => (Array.isArray(x) && x[0] && x[0].count) || 0;
function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 604800) return Math.floor(s / 86400) + "d";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const socialErr = (err) => /follows/.test(err.message || "") ? "Run mixo_follows.sql in Supabase first." : /parent_id|image_url|video_url|only the poster/.test(err.message || "") ? "Run mixo_comments.sql in Supabase first."
  : /post_(likes|saves|comments)/.test(err.message || "") ? "Run mixo_social.sql in Supabase first." : niceError(err.message);

async function loadSocial() {
  social.likes = new Set(); social.saves = new Set(); social.following = new Set(); social.blocked = new Set();
  if (!MIXO.user || !sb) return;
  const [l, s, f] = await Promise.all([
    sb.from("post_likes").select("post_id").eq("user_id", MIXO.user.id),
    sb.from("post_saves").select("post_id").eq("user_id", MIXO.user.id),
    sb.from("follows").select("following_id").eq("follower_id", MIXO.user.id),
  ]);
  if (!f.error) social.following = new Set(f.data.map((r) => r.following_id));
  if (!l.error) social.likes = new Set(l.data.map((r) => String(r.post_id)));
  if (!s.error) social.saves = new Set(s.data.map((r) => String(r.post_id)));
  const bl = await sb.from("blocks").select("blocked_id").eq("blocker_id", MIXO.user.id);
  if (!bl.error) social.blocked = new Set(bl.data.map((r) => r.blocked_id));
}

function sndOf(r) {
  const s = Array.isArray(r.sound) ? r.sound[0] : r.sound;
  if (!s) return null;
  const p = (Array.isArray(s.profiles) ? s.profiles[0] : s.profiles) || {};
  return { id: s.id, uid: s.user_id, name: p.display_name || p.username || "user", avatar: p.avatar_url };
}
function normPost(r) {
  const p = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) || {};
  const o = { id: r.id, uid: r.user_id, type: r.type, text: r.caption || "", img: r.media_url, time: r.created_at,
    user: p.username || "user", name: p.display_name || p.username || "User", avatar: p.avatar_url,
    bio: p.bio || "", country: p.country || "", likes: cnt(r.post_likes), comments: cnt(r.post_comments), views: Number(r.views) || 0, soundId: r.sound_id || null, snd: sndOf(r),
    profile: { following: 0, followers: 0, likes: 0 } };
  postCache.set(String(r.id), o);
  return o;
}
const SND_COLS = ",sound_id,sound:posts!sound_id(id,user_id,profiles!user_id(username,display_name,avatar_url))";
const POST_COLS = "id,user_id,type,caption,media_url,created_at,profiles!user_id(username,display_name,avatar_url,bio,country)";
async function fetchPosts(types) {
  const q = (cols) => sb.from("posts").select(cols).in("type", types).order("created_at", { ascending: false }).limit(60);
  let r = await q(POST_COLS + SND_COLS + ",views,post_likes(count),post_comments(count)");
  if (r.error) r = await q(POST_COLS + ",views,post_likes(count),post_comments(count)");
  if (r.error) r = await q(POST_COLS + ",post_likes(count),post_comments(count)");
  if (r.error) r = await q(POST_COLS);
  if (r.error) throw r.error;
  return r.data.map(normPost).filter((p) => !social.blocked.has(p.uid));
}
async function fetchOne(id) {
  const q = (cols) => sb.from("posts").select(cols).eq("id", id).maybeSingle();
  let r = await q(POST_COLS + SND_COLS + ",views,post_likes(count),post_comments(count)");
  if (r.error) r = await q(POST_COLS + ",views,post_likes(count),post_comments(count)");
  if (r.error) r = await q(POST_COLS + ",post_likes(count),post_comments(count)");
  if (r.error) r = await q(POST_COLS);
  if (r.error || !r.data) throw r.error || new Error("Post not found");
  return normPost(r.data);
}

function postCard(p) {
  const k = String(p.id);
  const mine = !!(MIXO.user && p.uid && p.uid === MIXO.user.id);
  const av = p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : esc((p.user || "U")[0].toUpperCase());
  return `<article class="pc" data-id="${esc(k)}">
    <div class="pc-av" data-pa="profile">${av}</div>
    <div class="pc-main">
      ${mine || (MIXO.user && p.uid) ? `<button class="pc-more" data-pa="more" aria-label="${mine ? "Delete or more" : "More"}">${icon("more")}</button>` : ""}
      <div class="pc-h" data-pa="profile"><b>${esc(p.name)}</b><span>@${esc(p.user)} &middot; ${ago(p.time)}</span></div>
      ${p.text ? `<p class="pc-t">${esc(p.text)}</p>` : ""}
      ${p.type === "photo" ? `<img class="pc-img" src="${esc(p.img)}" alt="" loading="lazy">` : ""}
      <div class="pc-a">
        <button data-pa="comment">${icon("comment")}<span>${p.comments ? fmt(p.comments) : ""}</span></button>
        <button data-pa="like" class="${social.likes.has(k) ? "on" : ""}">${icon("heart")}<span>${p.likes ? fmt(p.likes) : ""}</span></button>
        <button data-pa="save" class="${social.saves.has(k) ? "on" : ""}">${icon("save")}</button>
        <button data-pa="share">${icon("share")}</button>
      </div>
    </div>
  </article>`;
}
function paintPost(k) {
  k = String(k);
  const p = postCache.get(k);
  $$(`.pc[data-id="${k}"]`).forEach((c) => {
    $('[data-pa="like"]', c).classList.toggle("on", social.likes.has(k));
    $('[data-pa="save"]', c).classList.toggle("on", social.saves.has(k));
    if (p) {
      $('[data-pa="like"] span', c).textContent = p.likes ? fmt(p.likes) : "";
      $('[data-pa="comment"] span', c).textContent = p.comments ? fmt(p.comments) : "";
    }
  });
  $$(`.clip[data-id="${k}"] [data-act="save"]`).forEach((b) => b.classList.toggle("on", social.saves.has(k)));
  $$(`.clip[data-id="${k}"] [data-act="like"]`).forEach((b) => {
    b.classList.toggle("on", social.likes.has(k));
    $(".n", b).textContent = fmt(p ? p.likes : 0);
  });
  $$(`.clip[data-id="${k}"] [data-act="comment"] span`).forEach((s) => (s.textContent = fmt(p ? p.comments : 0)));
}
async function toggleLike(id) {
  if (!MIXO.user || !sb) return toast("Log in to like");
  const k = String(id), p = postCache.get(k), on = !social.likes.has(k);
  on ? social.likes.add(k) : social.likes.delete(k);
  if (p) p.likes = Math.max(0, p.likes + (on ? 1 : -1));
  paintPost(k);
  const r = on ? await sb.from("post_likes").insert({ post_id: id })
               : await sb.from("post_likes").delete().eq("post_id", id).eq("user_id", MIXO.user.id);
  if (r.error) {
    on ? social.likes.delete(k) : social.likes.add(k);
    if (p) p.likes = Math.max(0, p.likes + (on ? -1 : 1));
    paintPost(k); toast(socialErr(r.error));
  }
}
async function toggleSave(id) {
  if (!MIXO.user || !sb) return toast("Log in to save");
  const k = String(id), on = !social.saves.has(k);
  on ? social.saves.add(k) : social.saves.delete(k);
  paintPost(k);
  const r = on ? await sb.from("post_saves").insert({ post_id: id })
               : await sb.from("post_saves").delete().eq("post_id", id).eq("user_id", MIXO.user.id);
  if (r.error) { on ? social.saves.delete(k) : social.saves.add(k); paintPost(k); toast(socialErr(r.error)); }
  else if (pTab === 3 && $("#profile").classList.contains("on")) loadMyPosts();
}

function compressImage(file, max, q = 0.85) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that photo"))), "image/jpeg", q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Couldn't read that photo")); };
    img.src = url;
  });
}
async function queryPosts(mod) {
  const run = (cols) => mod(sb.from("posts").select(cols));
  let r = await run(POST_COLS + SND_COLS + ",views,post_likes(count),post_comments(count)");
  if (r.error) r = await run(POST_COLS + ",views,post_likes(count),post_comments(count)");
  if (r.error) r = await run(POST_COLS + ",post_likes(count),post_comments(count)");
  if (r.error) r = await run(POST_COLS);
  if (r.error) throw r.error;
  return r.data.map(normPost).filter((p) => !social.blocked.has(p.uid));
}

// comments sheet (replies + pictures)
const comSheet = $("#comSheet"), comList = $("#comList");
let comId = null, comReply = null, comImg = null;
const COM_BASE = "id,user_id,body,created_at,profiles!user_id(username,avatar_url)";
function clearReply() { comReply = null; $("#comReply").classList.add("hidden"); }
function clearComImg() {
  comImg = null;
  const img = $("#comPrev img");
  if (img.src) URL.revokeObjectURL(img.src);
  img.removeAttribute("src");
  $("#comPrev").classList.add("hidden");
}
function setReply(id, user) {
  comReply = { id, user };
  $("#comReply span").textContent = "Replying to @" + user;
  $("#comReply").classList.remove("hidden");
  $("#comIn").value = "@" + user + " ";
  $("#comIn").focus();
}
async function loadComments() {
  comList.innerHTML = '<p class="cmt-empty">Loading...</p>';
  const q = (cols) => sb.from("post_comments").select(cols).eq("post_id", comId).order("created_at", { ascending: true });
  let r = await q(COM_BASE + ",image_url,parent_id,video_url");
  if (r.error) r = await q(COM_BASE + ",image_url,parent_id");
  if (r.error) r = await q(COM_BASE);
  if (r.error) { comList.innerHTML = `<p class="cmt-empty">${esc(socialErr(r.error))}</p>`; return; }
  r.data = r.data.filter((c) => !social.blocked.has(c.user_id));
  if (!r.data.length) { comList.innerHTML = '<p class="cmt-empty">No comments yet. Be the first.</p>'; return; }
  const me = MIXO.user && MIXO.user.id, owner = (postCache.get(String(comId)) || {}).uid;
  const kids = {};
  r.data.filter((c) => c.parent_id).forEach((c) => (kids[c.parent_id] = kids[c.parent_id] || []).push(c));
  const one = (c, topId) => {
    const p = (Array.isArray(c.profiles) ? c.profiles[0] : c.profiles) || {};
    const u = p.username || "user";
    const av = p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(u[0].toUpperCase());
    return `<div class="cmt"><div class="pc-av sm">${av}</div><div class="cb"><b>@${esc(u)}</b><span>${ago(c.created_at)}</span>${c.body ? `<p>${esc(c.body)}</p>` : ""}${c.image_url ? `<img class="cmt-img" src="${esc(c.image_url)}" alt="" loading="lazy">` : ""}${c.video_url ? `<video class="cmt-vid" src="${esc(c.video_url)}" controls playsinline preload="metadata"></video>` : ""}<button type="button" class="cmt-rep" data-top="${esc(topId)}" data-user="${esc(u)}">Reply</button>${(owner === me && c.user_id !== me) ? `<button type="button" class="cmt-vrep" data-top="${esc(topId)}" data-user="${esc(u)}">Reply with video</button>` : ""}${(c.user_id === me || owner === me) ? `<button type="button" class="cmt-del" data-cid="${esc(c.id)}" data-own="${c.user_id === me ? 1 : 0}" data-img="${esc(c.image_url || "")}" data-vid="${esc(c.video_url || "")}" aria-label="Delete comment">${icon("trash")}</button>` : ""}</div></div>`;
  };
  comList.innerHTML = r.data.filter((c) => !c.parent_id).map((c) =>
    one(c, c.id) + (kids[c.id] ? `<div class="cmt-kids">${kids[c.id].map((k) => one(k, c.id)).join("")}</div>` : "")).join("");
  comList.scrollTop = comList.scrollHeight;
}
function openComments(id) {
  if (!MIXO.user || !sb) return toast("Log in to comment");
  comId = id;
  clearReply(); clearComImg();
  $("#comIn").value = "";
  comSheet.classList.remove("hidden");
  loadComments();
}
comSheet.onclick = (e) => { if (e.target.id === "comSheet") comSheet.classList.add("hidden"); };
comList.addEventListener("click", (e) => {
  const d = e.target.closest(".cmt-del");
  if (d) return deleteComment(d);
  const v = e.target.closest(".cmt-vrep");
  if (v) return openCamera({ reply: { parent: v.dataset.top, user: v.dataset.user } });
  const b = e.target.closest(".cmt-rep");
  if (b) setReply(b.dataset.top, b.dataset.user);
});
$("#comReply button").onclick = () => { clearReply(); $("#comIn").value = ""; };
$("#comPrev button").onclick = clearComImg;
$("#comAttach").onclick = () => $("#comFile").click();
$("#comFile").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    comImg = await compressImage(f, 1080, 0.82);
    const img = $("#comPrev img");
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(comImg);
    $("#comPrev").classList.remove("hidden");
  } catch (err) { toast(err.message); }
};
$("#comForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = $("#comIn").value.trim();
  if (!body && !comImg) return;
  const btn = $("#comSend");
  btn.disabled = true;
  try {
    const row = { post_id: comId, body };
    if (comImg) {
      const path = MIXO.user.id + "/comment-" + Date.now() + ".jpg";
      const up = await sb.storage.from("avatars").upload(path, comImg, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      row.image_url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }
    if (comReply) row.parent_id = comReply.id;
    const r = await sb.from("post_comments").insert(row);
    if (r.error) throw r.error;
    $("#comIn").value = ""; clearReply(); clearComImg();
    const p = postCache.get(String(comId));
    if (p) { p.comments++; paintPost(comId); }
    loadComments();
  } catch (err) { toast(socialErr(err)); }
  finally { btn.disabled = false; }
});

// shared tap handling for post cards (Explore + post viewer)
function cardTap(e) {
  const el = e.target.closest("[data-pa]");
  const card = e.target.closest(".pc");
  if (!el || !card) return;
  const id = card.dataset.id, a = el.dataset.pa;
  if (a === "like") toggleLike(id);
  else if (a === "save") toggleSave(id);
  else if (a === "comment") openComments(id);
  else if (a === "share") sharePost(id);
  else if (a === "more") postMore(postCache.get(id) || { id });
  else if (a === "profile") { const p = postCache.get(id); if (p && !(MIXO.user && p.uid === MIXO.user.id)) { $("#viewSheet").classList.add("hidden"); openCreator(p); } }
}
$("#viewBody").addEventListener("click", cardTap);
$("#viewSheet").onclick = (e) => { if (e.target.id === "viewSheet") $("#viewSheet").classList.add("hidden"); };
async function openPostView(id) {
  try {
    const p = await fetchOne(id);
    if (p.type === "video") return openVidCard(p.id);
    $("#viewBody").innerHTML = postCard(p);
    $("#viewSheet").classList.remove("hidden");
  } catch (err) { toast(socialErr(err)); }
}

// ---------- delete posts and comments ----------
function confirmBox(title, text, okLabel) {
  return new Promise((resolve) => {
    const s = $("#confirmSheet");
    const tm = String(title).match(/^(\S+)\s+(.+)$/);
    $("#cfTitle").innerHTML = tm ? esc(tm[1]) + ' <span class="gr">' + esc(tm[2]) + "</span>" : esc(title);
    $("#cfText").textContent = text;
    $("#cfYesTxt").textContent = okLabel || "Delete";
    s.classList.remove("hidden");
    const done = (v) => { s.classList.add("hidden"); resolve(v); };
    $("#cfYes").onclick = () => done(true);
    $("#cfNo").onclick = () => done(false);
    s.onclick = (e) => { if (e.target === s) done(false); };
  });
}
const delErr = (err) => /foreign key|violates/i.test((err && err.message) || "") ? "Run mixo_delete.sql in Supabase first." : socialErr(err);
function storagePath(url, bucket) {
  const part = String(url || "").split("/object/public/" + bucket + "/")[1];
  return part ? decodeURIComponent(part.split("?")[0]) : "";
}

async function deletePost(id) {
  const k = String(id);
  const p = postCache.get(k);
  if (!sb || !MIXO.user || !p || p.uid !== MIXO.user.id) return toast("You can only delete your own posts");
  const ok = await confirmBox("Delete this post?", "This can't be undone. Its likes and comments are deleted too.", "Delete");
  if (!ok) return;
  const r = await sb.from("posts").delete().eq("id", id).eq("user_id", MIXO.user.id).select("id");
  if (r.error) return toast(delErr(r.error));
  if (!r.data || !r.data.length) return toast("Couldn't delete. Run mixo_delete.sql in Supabase first.");
  if (p.type !== "topic") {
    const bucket = p.type === "video" ? "videos" : "avatars";
    const path = storagePath(p.img, bucket);
    if (path) sb.storage.from(bucket).remove([path]);
  }
  postCache.delete(k);
  social.likes.delete(k);
  social.saves.delete(k);
  $$(`.clip[data-id="${k}"], .pc[data-id="${k}"], .pt[data-id="${k}"]`).forEach((el) => el.remove());
  $("#viewSheet").classList.add("hidden");
  videos = videos.filter((v) => String(v.id) !== k);
  if (!$$("#feed .clip").length) $("#feed").innerHTML = emptyFeed("No posts yet.<br>Tap + to post the first one.");
  if ($("#profile").classList.contains("on")) loadMyPosts();
}

async function deleteComment(btn) {
  const ok = await confirmBox("Delete this comment?", "Replies to it are deleted too.", "Delete");
  if (!ok) return;
  const r = await sb.from("post_comments").delete().eq("id", btn.dataset.cid).select("id");
  if (r.error) return toast(delErr(r.error));
  if (!r.data || !r.data.length) return toast("Couldn't delete. Run mixo_delete.sql in Supabase first.");
  if (btn.dataset.own === "1" && btn.dataset.img) {
    const path = storagePath(btn.dataset.img, "avatars");
    if (path) sb.storage.from("avatars").remove([path]);
  }
  if (btn.dataset.own === "1" && btn.dataset.vid) {
    const vp = storagePath(btn.dataset.vid, "videos");
    if (vp) sb.storage.from("videos").remove([vp]);
  }
  const p = postCache.get(String(comId));
  const c = await sb.from("post_comments").select("id", { count: "exact", head: true }).eq("post_id", comId);
  if (p && !c.error && typeof c.count === "number") { p.comments = c.count; paintPost(comId); }
  loadComments();
}

// ---------- explore: Pictures / Topics / Trending ----------
let exTab = 0; // 0 = pictures, 1 = topics, 2 = trending
const exEmpty = (msg) => `<div class="empty"><svg class="ic big"><use href="#i-explore"/></svg><p>${msg}</p></div>`;
function setExTab(i) {
  exTab = i;
  $$("#explore .seg button").forEach((b, n) => b.classList.toggle("on", n === i));
}
async function loadExplore() {
  const box = $("#exGrid"), tab = exTab;
  if (!box) return;
  if (!MIXO.user || !sb) { box.innerHTML = exEmpty("Log in to explore posts."); return; }
  box.innerHTML = exEmpty("Loading...");
  try {
    let list = await fetchPosts(tab === 0 ? ["photo"] : tab === 1 ? ["topic"] : ["photo", "topic"]);
    if (tab !== exTab) return;
    if (tab === 2) list.sort((a, b) => (b.likes * 2 + b.comments) - (a.likes * 2 + a.comments) || new Date(b.time) - new Date(a.time));
    box.innerHTML = list.length ? '<div class="pcl">' + list.map(postCard).join("") + "</div>"
      : exEmpty(["No pictures yet.<br>Photo posts will appear here.", "No topics yet.<br>Topics will appear here.", "Nothing trending yet."][tab]);
  } catch (err) { if (tab === exTab) box.innerHTML = exEmpty(esc(socialErr(err))); }
}
$$("#explore .seg button").forEach((b, i) => b.addEventListener("click", () => { exTab = i; loadExplore(); }));
$("#exGrid").addEventListener("click", cardTap);

// ---------- profile: Videos / Topics / Photos / Saved ----------
let pTab = 0, sTab = 0;
const P_TYPES = ["video", "topic", "photo"];
const videoTile = (p) => `<div class="pt" data-id="${esc(p.id)}" data-type="video"><video src="${esc(p.img)}#t=0.1" muted playsinline preload="metadata"></video><span class="pt-v">${icon("play")}<span class="vwn">${fmt(p.views || 0)}</span></span>${MIXO.user && p.uid === MIXO.user.id ? `<button class="pt-more" data-pt="more" aria-label="Delete or more">${icon("more")}</button>` : ""}</div>`;
async function loadMyPosts() {
  const g = $("#pGrid");
  if (!g) return;
  $("#sSub").classList.toggle("hidden", pTab !== 3);
  const tab = pTab, sub = sTab;
  if (!MIXO.user || !sb) { g.innerHTML = '<div class="pempty">Log in to see your posts.</div>'; return; }
  const type = P_TYPES[tab === 3 ? sub : tab];
  let list = [];
  try {
    if (tab === 3) {
      const s = await sb.from("post_saves").select("post_id").eq("user_id", MIXO.user.id).order("created_at", { ascending: false });
      if (s.error) throw s.error;
      const ids = s.data.map((r) => r.post_id);
      if (ids.length) {
        list = await queryPosts((q) => q.in("id", ids).eq("type", type));
        const ord = new Map(ids.map((id, i) => [String(id), i]));
        list.sort((x, y) => ord.get(String(x.id)) - ord.get(String(y.id)));
      }
    } else {
      list = await queryPosts((q) => q.eq("user_id", MIXO.user.id).eq("type", type).order("created_at", { ascending: false }));
    }
  } catch (err) {
    if (tab === pTab && sub === sTab) g.innerHTML = `<div class="pempty">${esc(socialErr(err))}</div>`;
    return;
  }
  if (tab !== pTab || sub !== sTab) return;
  if (!list.length) {
    const word = { video: "videos", topic: "topics", photo: "photos" }[type];
    g.innerHTML = `<div class="pempty">${tab === 3 ? `No saved ${word} yet.<br>Tap the save icon on a post.` : `No ${word} yet.`}</div>`;
    return;
  }
  g.innerHTML = type === "video"
    ? '<div class="pgrid">' + list.map(videoTile).join("") + "</div>"
    : '<div class="pcl pcl-p">' + list.map(postCard).join("") + "</div>";
}
$$("#pTabs button").forEach((b, i) => b.addEventListener("click", () => {
  pTab = i;
  $$("#pTabs button").forEach((x, n) => x.classList.toggle("on", n === i));
  loadMyPosts();
}));
$$("#sSub button").forEach((b, i) => b.addEventListener("click", () => {
  sTab = i;
  $$("#sSub button").forEach((x, n) => x.classList.toggle("on", n === i));
  loadMyPosts();
}));
$("#pGrid").addEventListener("click", (e) => {
  const mb = e.target.closest(".pt-more");
  if (mb) { e.stopPropagation(); return deletePost(mb.closest(".pt").dataset.id); }
  if (e.target.closest(".pc")) return cardTap(e);
  const t = e.target.closest(".pt");
  if (!t) return;
  const pv = postCache.get(String(t.dataset.id));
  if (pv && pv.type === "video") return openVidCard(pv.id);
  go("home");
  const c = $(`.clip[data-id="${t.dataset.id}"]`);
  if (c) c.scrollIntoView(); else toast("Open it from the feed");
});

// ============ INBOX: real messages, instant delivery, message requests ============
const inbox = { convs: [], profiles: new Map(), unread: new Map(), lastKind: new Map(), tab: "msg", loaded: false, error: "" };
const chat = { uid: null, conv: null, user: null, msgs: [], open: false, sending: false };
let rtChannel = null, rtOK = false, inboxTimer = null, pollTimer = null;

const meId = () => (MIXO.user ? MIXO.user.id : null);
const otherOf = (c) => (c.user_a === meId() ? c.user_b : c.user_a);
const isReq = (c) => c.status === "request" && c.initiator !== meId();   // someone wrote to me first
const isMsg = (c) => c.status === "accepted" || c.initiator === meId();   // normal chats + ones I started

function inboxErr(e) {
  const m = (e && e.message) || "";
  if (/request pending/i.test(m)) return "Request sent. You can write more once they accept.";
  if (/message not allowed/i.test(m)) return "You can't message this person.";
  if (/slow down/i.test(m)) return "Slow down a little.";
  if (/dm closed/i.test(m)) return "This person isn't accepting messages.";
  if (/does not exist|schema cache|could not find the (table|function)|send_message|respond_request|mark_read/i.test(m)) return "Run mixo_inbox.sql in Supabase first.";
  return niceError(m);
}

function setBadge(n) {
  const b = $("#inBadge");
  b.textContent = n > 9 ? "9+" : n;
  b.classList.toggle("hidden", !n);
}

async function refreshInbox() {
  if (!sb || !MIXO.user) return renderInbox();
  const [cr, ur, lr] = await Promise.all([
    sb.from("conversations").select("*").order("last_message_at", { ascending: false }).limit(100),
    sb.from("messages").select("conversation_id").is("read_at", null).neq("sender_id", meId()).limit(1000),
    sb.from("messages").select("conversation_id,kind,created_at").in("kind", ["image", "voice"]).order("created_at", { ascending: false }).limit(300),
  ]);
  if (cr.error) { inbox.error = inboxErr(cr.error); return renderInbox(); }
  inbox.error = "";
  inbox.convs = (cr.data || []).filter((c) => !social.blocked.has(otherOf(c)));
  inbox.unread = new Map();
  (ur.data || []).forEach((r) => inbox.unread.set(r.conversation_id, (inbox.unread.get(r.conversation_id) || 0) + 1));
  inbox.lastKind = new Map();
  (lr.data || []).forEach((r) => { if (!inbox.lastKind.has(r.conversation_id)) inbox.lastKind.set(r.conversation_id, r); });
  const need = [...new Set(inbox.convs.map(otherOf))].filter((id) => !inbox.profiles.has(id));
  if (need.length) {
    const pr = await sb.from("profiles").select("id,username,display_name,avatar_url,bio,country").in("id", need);
    (pr.data || []).forEach((p) => inbox.profiles.set(p.id, p));
  }
  inbox.loaded = true;
  renderInbox();
  if (chat.open) {
    const c = inbox.convs.find((x) => otherOf(x) === chat.uid);
    if (c) { chat.conv = c; renderChat(); }
  }
}
const refreshInboxSoon = () => { clearTimeout(inboxTimer); inboxTimer = setTimeout(refreshInbox, 300); };

// what the Inbox list shows under a name: the text, 📷 for a photo, 🎙️ for a voice note (no "You:")
function previewOf(c) {
  const k = inbox.lastKind.get(c.id);
  if (k && Math.abs(new Date(k.created_at) - new Date(c.last_message_at)) < 5000) return k.kind === "image" ? "📷" : "🎙️";
  const t = (c.last_message || "").trim();
  if (/^(📷|🖼️)?\s*(photo|picture|image)s?$/i.test(t)) return "📷";
  if (/^(🎙️|🎤)?\s*voice(\s*(note|message))?$/i.test(t)) return "🎙️";
  return t;
}

function renderInbox() {
  const reqs = inbox.convs.filter(isReq);
  const msgs = inbox.convs.filter(isMsg);
  const unreadMsgs = msgs.reduce((n, c) => n + (inbox.unread.get(c.id) || 0), 0);
  setBadge(unreadMsgs + reqs.length);
  $("#inTabMsg").classList.toggle("on", inbox.tab === "msg");
  $("#inTabReq").classList.toggle("on", inbox.tab === "req");
  $("#inTabReq").innerHTML = "Requests" + (reqs.length ? ` <i class="bdg">${reqs.length}</i>` : "");
  const list = inbox.tab === "req" ? reqs : msgs;
  const box = $("#inList");
  if (inbox.error) { box.innerHTML = `<p class="hint c">${esc(inbox.error)}</p>`; return; }
  if (!list.length) {
    box.innerHTML = `<div class="empty">${icon("inbox").replace('class="ic"', 'class="ic big"')}<p>${inbox.tab === "req" ? "No message requests." : MIXO.user ? "No messages yet.<br>Follow people and say hello." : "Log in to see your messages."}</p></div>`;
    return;
  }
  box.innerHTML = list.map((c) => {
    const p = inbox.profiles.get(otherOf(c)) || {};
    const n = inbox.unread.get(c.id) || 0;
    const prev = previewOf(c);
    return `<button type="button" class="irow" data-c="${esc(c.id)}"><div class="iav"></div><div class="itx"><b>${esc(p.display_name || p.username || "User")}</b><span class="${n ? "new" : ""}">${esc(prev)}</span></div><div class="imeta"><small>${ago(c.last_message_at)}</small>${n ? `<i class="bdg">${n}</i>` : ""}</div></button>`;
  }).join("");
  $$("#inList .iav").forEach((el, i) => { const p = inbox.profiles.get(otherOf(list[i])) || {}; setAv(el, p.avatar_url, p.username); });
}
$("#inTabMsg").addEventListener("click", () => { inbox.tab = "msg"; renderInbox(); });
$("#inTabReq").addEventListener("click", () => { inbox.tab = "req"; renderInbox(); });
$("#inList").addEventListener("click", (e) => {
  const row = e.target.closest(".irow");
  if (!row) return;
  const c = inbox.convs.find((x) => x.id === row.dataset.c);
  if (c && inbox.profiles.get(otherOf(c))) openChat(inbox.profiles.get(otherOf(c)));
});

// ----- chat screen -----
const CALLS_READY = true;
let callCh = null;
const REACTS = ["❤️", "😂", "😮", "😢", "🔥", "👍"];
const signed = new Map();
const vr = { rec: null, chunks: [], stream: null, t0: 0, tick: 0, send: false };
let online = new Set(), presCh = null, vAud = null, vSrc = "", lpTimer = 0, rxFor = null;
chat.reacts = new Map();

const fmtDur = (s) => Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");
const autoGrow = () => { const t = $("#chatInput"); t.style.height = "46px"; t.style.height = Math.min(Math.max(t.scrollHeight, 46), 120) + "px"; };
const syncSend = () => $("#chatSend").classList.toggle("mic", !($("#chatInput").value.trim() || vr.rec));
const msgCap = () => (typeof CX !== "undefined" && CX.premium ? 3 : 1);
const iAmLocked = () => { const c = chat.conv, me = meId(); return !!(c && c.initiator === me && c.status !== "accepted" && chat.msgs.filter((m) => m.sender_id === me).length >= msgCap()); };
const showLimit = () => { $("#limitTxt").textContent = "You can only send up to " + (msgCap() === 1 ? "one message" : msgCap() + " messages") + " until user accepts"; $("#limitModal").classList.remove("hidden"); };
$("#limitOk").onclick = () => $("#limitModal").classList.add("hidden");
const paintOnline = () => {
  const on = !!(chat.open && online.has(chat.uid));
  $("#chatDot").classList.toggle("hidden", !on);
  $("#chatStat").textContent = on ? " · Online" : "";
  $("#chatCall").classList.toggle("off", !(on && chat.conv && chat.conv.status === "accepted"));
};

async function signMedia(list) {
  const need = [...new Set(list.filter((m) => m.media_url && !signed.has(m.media_url)).map((m) => m.media_url))];
  if (!need.length) return;
  const r = await sb.storage.from("chat").createSignedUrls(need, 3600);
  (r.data || []).forEach((x) => { if (x.signedUrl) signed.set(x.path, x.signedUrl); });
}
async function loadReacts() {
  const ids = chat.msgs.map((m) => m.id);
  chat.reacts = new Map();
  if (!ids.length) return;
  const r = await sb.from("message_reactions").select("message_id,user_id,emoji").in("message_id", ids);
  (r.data || []).forEach((x) => setReact(x.message_id, x.user_id, x.emoji));
}
function setReact(mid, uid, emoji) {
  const list = (chat.reacts.get(mid) || []).filter((r) => r.user_id !== uid);
  if (emoji) list.push({ user_id: uid, emoji });
  chat.reacts.set(mid, list);
}

async function openChat(user) {
  if (!sb || !MIXO.user) return toast("Log in with a real account to send messages.");
  if (!user || user.id === meId()) return;
  if (!inbox.loaded) await refreshInbox();
  inbox.profiles.set(user.id, { ...(inbox.profiles.get(user.id) || {}), ...user });
  chat.uid = user.id;
  chat.user = inbox.profiles.get(user.id);
  chat.conv = inbox.convs.find((c) => otherOf(c) === user.id) || null;
  chat.msgs = [];
  chat.reacts = new Map();
  chat.open = true;
  $("#chatName").textContent = chat.user.display_name || chat.user.username || "User";
  $("#chatUser").textContent = "@" + (chat.user.username || "user");
  paintChatCrown(user.id);
  setAv($("#chatAv"), chat.user.avatar_url, chat.user.username);
  $("#chatInput").value = "";
  autoGrow(); syncSend(); paintOnline();
  $("#chat").classList.remove("hidden", "recording");
  renderChat(true);
  fitChat();
  await loadChatMsgs();
}
function closeChat() {
  if (vr.rec) voiceStop(false);
  if (vAud) { vAud.pause(); vAud = null; vSrc = ""; }
  chat.open = false; chat.uid = null; chat.conv = null; chat.msgs = [];
  $("#chat").classList.add("hidden");
  $("#chatInput").blur();
  $("#reactBar").classList.add("hidden");
  paintOnline();
  refreshInboxSoon();
}
async function loadChatMsgs() {
  if (!chat.conv) return;
  const id = chat.conv.id;
  const r = await sb.from("messages").select("*").eq("conversation_id", id).order("created_at", { ascending: false }).limit(100);
  if (!chat.open || !chat.conv || chat.conv.id !== id) return;
  if (r.error) return toast(inboxErr(r.error));
  chat.msgs = (r.data || []).reverse();
  await signMedia(chat.msgs);
  await loadReacts();
  if (!chat.open || !chat.conv || chat.conv.id !== id) return;
  renderChat(true);
  markRead();
}
function addMsg(m) {
  if (!m || chat.msgs.some((x) => x.id === m.id)) return;
  chat.msgs.push(m);
  renderChat(true);
}
async function markRead() {
  if (!chat.open || !chat.conv) return;
  if (!chat.msgs.some((m) => m.sender_id !== meId() && !m.read_at)) return;
  chat.msgs.forEach((m) => { if (m.sender_id !== meId()) m.read_at = m.read_at || new Date().toISOString(); });
  inbox.unread.delete(chat.conv.id);
  renderInbox();
  await sb.rpc("mark_read", { p_conv: chat.conv.id });
}

function bubbleHTML(m) {
  const mine = m.sender_id === meId();
  let inner;
  if (m.kind === "image") inner = `<img src="${esc(signed.get(m.media_url) || "")}" alt="" data-full>`;
  else if (m.kind === "voice") inner = `<button type="button" class="vplay" data-src="${esc(signed.get(m.media_url) || "")}" aria-label="Play">${icon("play").replace('class="ic"', 'class="ic pl"')}${icon("pause").replace('class="ic"', 'class="ic pa"')}</button><div class="vbar"><i></i></div><span class="vdur">${fmtDur(m.media_secs || 0)}</span>`;
  else inner = esc(m.body);
  const groups = {};
  (chat.reacts.get(m.id) || []).forEach((r) => (groups[r.emoji] = groups[r.emoji] || []).push(r.user_id));
  const chips = Object.keys(groups).map((e) => `<button type="button" class="rxc ${groups[e].includes(meId()) ? "mine" : ""}" data-e="${esc(e)}">${e}${groups[e].length > 1 ? " " + groups[e].length : ""}</button>`).join("");
  return `<div class="bw ${mine ? "me" : "them"}" data-m="${esc(m.id)}"><div class="bub ${m.kind || "text"}">${inner}</div>${chips ? `<div class="rx">${chips}</div>` : ""}</div>`;
}
function renderChat(stick) {
  const body = $("#chatBody");
  const near = body.scrollHeight - body.scrollTop - body.clientHeight < 90;
  const me = meId();
  const t = (d) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  let html = "";
  chat.msgs.forEach((m, i) => {
    const mine = m.sender_id === me, next = chat.msgs[i + 1];
    html += bubbleHTML(m);
    if (!next || next.sender_id !== m.sender_id || new Date(next.created_at) - new Date(m.created_at) > 300000) {
      html += `<div class="bmeta ${mine ? "me" : "them"}">${mine && !next && m.read_at ? "Seen" : t(m.created_at)}</div>`;
    }
  });
  body.innerHTML = html;
  $("#chat").classList.toggle("ch-empty", !chat.msgs.length);
  if (stick || near) body.scrollTop = body.scrollHeight;
  if (vAud) { const b = $(`.vplay[data-src="${CSS.escape(vSrc)}"]`); if (b) b.classList.toggle("on", !vAud.paused); }
  const incoming = !!(chat.conv && isReq(chat.conv));
  $("#chatReq").classList.toggle("hidden", !incoming);
  $("#chatForm").classList.toggle("hidden", incoming);
  paintOnline();
}

// ----- sending: text, photos, voice notes -----
async function afterSend(data) {
  await signMedia([data]);
  if (!chat.open) return;
  addMsg(data);
  await refreshInbox();
  if (chat.open) { chat.conv = inbox.convs.find((c) => c.id === data.conversation_id) || chat.conv; renderChat(true); }
}
$("#chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (vr.rec) return voiceStop(true);
  const inp = $("#chatInput"), text = inp.value.trim();
  if (!text) return voiceStart();
  if (chat.sending || !chat.uid) return;
  if (iAmLocked()) return showLimit();
  chat.sending = true; inp.value = ""; autoGrow(); syncSend();
  const { data, error } = await sb.rpc("send_message", { p_to: chat.uid, p_body: text, p_kind: "text" });
  chat.sending = false;
  if (error) { inp.value = text; autoGrow(); syncSend(); return /request pending/i.test(error.message || "") ? showLimit() : toast(inboxErr(error)); }
  await afterSend(data);
});
$("#chatSend").addEventListener("pointerdown", (e) => e.preventDefault()); // keeps the keyboard open
$("#chatInput").addEventListener("input", () => { autoGrow(); syncSend(); });

async function sendMedia(kind, blob, ext, type, secs) {
  if (chat.sending || !chat.uid) return;
  chat.sending = true;
  try {
    const path = meId() + "/" + (kind === "image" ? "img-" : "voice-") + Date.now() + "." + ext;
    const up = await sb.storage.from("chat").upload(path, blob, { contentType: type });
    if (up.error) throw up.error;
    const { data, error } = await sb.rpc("send_message", { p_to: chat.uid, p_body: "", p_kind: kind, p_media: path, p_secs: secs });
    if (error) { sb.storage.from("chat").remove([path]); throw error; }
    await afterSend(data);
  } catch (err) {
    const m = (err && err.message) || "";
    if (/request pending/i.test(m)) showLimit();
    else toast(/bucket not found/i.test(m) ? "Run mixo_update.sql in Supabase first." : inboxErr(err));
  } finally { chat.sending = false; }
}
$("#chatPlus").onclick = () => { if (iAmLocked()) return showLimit(); $("#chatImg").click(); };
$("#chatImg").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !chat.uid) return;
  if (iAmLocked()) return showLimit();
  try { await sendMedia("image", await compressImage(f, 1280, 0.8), "jpg", "image/jpeg", null); }
  catch (err) { toast("Couldn't send that photo."); }
};

async function voiceStart() {
  if (iAmLocked()) return showLimit();
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast("Voice notes aren't supported on this browser.");
  try { vr.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (err) { return toast("Allow the microphone to send voice notes."); }
  const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
  vr.rec = new MediaRecorder(vr.stream, mime ? { mimeType: mime } : {});
  vr.chunks = []; vr.send = false;
  vr.rec.ondataavailable = (e) => { if (e.data && e.data.size) vr.chunks.push(e.data); };
  vr.rec.onstop = voiceDone;
  vr.rec.start(250);
  vr.t0 = Date.now();
  $("#chatRecT").textContent = "0:00";
  $("#chat").classList.add("recording");
  syncSend();
  vr.tick = setInterval(() => { const s = (Date.now() - vr.t0) / 1000; $("#chatRecT").textContent = fmtDur(s); if (s >= 120) voiceStop(true); }, 200);
}
function voiceStop(send) { vr.send = send; if (vr.rec && vr.rec.state === "recording") vr.rec.stop(); }
async function voiceDone() {
  clearInterval(vr.tick);
  if (vr.stream) vr.stream.getTracks().forEach((t) => t.stop());
  const secs = (Date.now() - vr.t0) / 1000;
  const type = ((vr.rec && vr.rec.mimeType) || "audio/mp4").split(";")[0];
  const chunks = vr.chunks, send = vr.send;
  vr.rec = null; vr.stream = null;
  $("#chat").classList.remove("recording");
  syncSend();
  if (!send || secs < 0.7) return;
  await sendMedia("voice", new Blob(chunks, { type }), type.indexOf("mp4") > -1 ? "m4a" : "webm", type, Math.round(secs));
}
$("#chatRecX").onclick = () => voiceStop(false);

// ----- playing voice notes, opening photos, emoji reactions -----
function playVoice(btn) {
  const src = btn.dataset.src;
  if (!src) return;
  if (vAud && vSrc === src) { vAud.paused ? vAud.play() : vAud.pause(); return; }
  if (vAud) vAud.pause();
  $$(".vplay.on").forEach((b) => b.classList.remove("on"));
  vAud = new Audio(src); vSrc = src;
  const el = () => $(`.vplay[data-src="${CSS.escape(src)}"]`);
  vAud.onplay = () => { const b = el(); if (b) b.classList.add("on"); };
  vAud.onpause = () => { const b = el(); if (b) b.classList.remove("on"); };
  vAud.ontimeupdate = () => { const b = el(); if (b && vAud.duration) b.parentElement.querySelector(".vbar i").style.width = (vAud.currentTime / vAud.duration * 100) + "%"; };
  vAud.onended = () => { const b = el(); if (b) { b.classList.remove("on"); b.parentElement.querySelector(".vbar i").style.width = "0"; } };
  vAud.play().catch(() => toast("Couldn't play that voice note."));
}
async function reactTo(mid, emoji) {
  if (!mid || !sb) return;
  const me = meId(), cur = ((chat.reacts.get(mid) || []).find((r) => r.user_id === me) || {}).emoji;
  setReact(mid, me, cur === emoji ? null : emoji);
  renderChat();
  const r = await sb.rpc("react_message", { p_msg: mid, p_emoji: emoji });
  if (r.error) { setReact(mid, me, cur || null); renderChat(); toast(/does not exist|schema cache|could not find/i.test(r.error.message || "") ? "Run mixo_update.sql in Supabase first." : inboxErr(r.error)); }
}
async function deleteMsg(mid) {
  const m = chat.msgs.find((x) => x.id === mid);
  if (!m || m.sender_id !== meId()) return;
  if (!(await confirmBox("Delete message?", "It's removed for everyone. They won't be told.", "Delete"))) return;
  chat.msgs = chat.msgs.filter((x) => x.id !== mid);
  renderChat();
  const r = await sb.rpc("delete_message", { p_msg: mid });
  if (r.error) {
    chat.msgs.push(m); chat.msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); renderChat();
    return toast(/does not exist|schema cache|could not find/i.test(r.error.message || "") ? "Run mixo_delete_message.sql in Supabase first." : inboxErr(r.error));
  }
  if (m.media_url) sb.storage.from("chat").remove([m.media_url]);
  refreshInbox();
}
function hideReactBar() { $("#reactBar").classList.add("hidden"); }
function showReactBar(bw) {
  rxFor = bw.dataset.m;
  const bar = $("#reactBar");
  bar.innerHTML = REACTS.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join("")
    + (bw.classList.contains("me") ? `<button type="button" class="rdel" data-del="1" aria-label="Delete for everyone">${icon("trash")}</button>` : "");
  bar.classList.remove("hidden");
  const r = bw.getBoundingClientRect(), w = bar.offsetWidth;
  bar.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8) + "px";
  bar.style.top = Math.max(80, r.top - 58) + "px";
  if (navigator.vibrate) navigator.vibrate(10);
}
const chatBody = $("#chatBody");
chatBody.addEventListener("pointerdown", (e) => {
  const bw = e.target.closest(".bw");
  if (!bw || e.target.closest(".rxc") || e.target.closest(".vplay")) return;
  clearTimeout(lpTimer);
  lpTimer = setTimeout(() => showReactBar(bw), 380);
});
["pointerup", "pointermove", "pointercancel", "scroll"].forEach((ev) => chatBody.addEventListener(ev, () => clearTimeout(lpTimer), true));
chatBody.addEventListener("contextmenu", (e) => e.preventDefault());
chatBody.addEventListener("dblclick", (e) => { const bw = e.target.closest(".bw"); if (bw) reactTo(bw.dataset.m, "❤️"); });
chatBody.addEventListener("click", (e) => {
  const v = e.target.closest(".vplay");
  if (v) return playVoice(v);
  const chip = e.target.closest(".rxc");
  if (chip) return reactTo(chip.closest(".bw").dataset.m, chip.dataset.e);
  const img = e.target.closest("img[data-full]");
  if (img) { $("#lbVid").classList.add("hidden"); $("#lbImg").classList.remove("hidden"); $("#lbImg").src = img.src; $("#lightbox").classList.remove("hidden"); }
});
$("#lightbox").onclick = (e) => {
  if (e.target.id === "lbVid") return;
  const v = $("#lbVid"); v.pause(); v.removeAttribute("src");
  $("#lightbox").classList.add("hidden");
};
$("#reactBar").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  hideReactBar();
  if (b.dataset.del) return deleteMsg(rxFor);
  reactTo(rxFor, b.dataset.e);
});
document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#reactBar")) hideReactBar(); }, true);

// ============ VOICE CALLS: WebRTC audio, signalling saved in the database ============
// To make calls also connect on mobile data, paste your free TURN servers here
// (metered.ca -> TURN Server -> Add Credential -> Show ICE Servers Array).
const TURN_SERVERS = [];
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }].concat(TURN_SERVERS) };
const call = { id: null, peer: null, pc: null, stream: null, role: "", state: "idle", t0: 0, tick: 0, ring: 0, queue: [], seen: new Set() };
const callAudio = $("#callAudio");

function callShow(mode, peerId, info) {
  const p = inbox.profiles.get(peerId) || {};
  callCard(info || null);
  $("#clSkip").classList.toggle("hidden", !(mode === "out" && info && info.connect));
  setAv($("#clAv"), p.avatar_url, p.username);
  $("#clName").textContent = p.display_name || p.username || "User";
  $("#callUI").dataset.mode = mode;
  $("#callUI").classList.remove("hidden");
  cxRetrack();
}
const callStat = (t) => { $("#clStat").textContent = t; };
const callErr = (e) => (/calls|call_signals|schema cache/i.test((e && e.message) || "") ? "Run mixo_calls.sql in Supabase first." : "Couldn't start the call.");
const sendSignal = (kind, data) => sb.from("call_signals").insert({ call_id: call.id, kind, data });
const micOpts = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

function callCleanup() {
  const prevState = call.state;
  agoraLeave();
  clearTimeout(call.ring);
  clearInterval(call.tick);
  if (call.pc) { try { call.pc.close(); } catch (e) {} }
  if (call.stream) call.stream.getTracks().forEach((t) => t.stop());
  callAudio.srcObject = null;
  Object.assign(call, { id: null, peer: null, pc: null, stream: null, role: "", state: "idle", queue: [], seen: new Set() });
  $("#callUI").classList.add("hidden");
  $("#clMute").classList.remove("on");
  cxRetrack();
  cxAfterCall(prevState);
}
async function callEnd(status) {
  const id = call.id;
  callCleanup();
  if (id && sb) await sb.from("calls").update({ status, ended_at: new Date().toISOString() }).eq("id", id);
}

function callLive() {
  if (call.state === "live") return;
  clearTimeout(call.ring);
  call.state = "live";
  call.t0 = Date.now();
  $("#callUI").dataset.mode = "live";
  call.tick = setInterval(() => callStat(fmtDur((Date.now() - call.t0) / 1000)), 500);
}
function makePc() {
  const pc = new RTCPeerConnection(ICE);
  call.pc = pc;
  call.stream.getTracks().forEach((t) => pc.addTrack(t, call.stream));
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal("ice", e.candidate.toJSON()); };
  pc.ontrack = (e) => { callAudio.srcObject = e.streams[0]; callAudio.play().catch(() => {}); };
  pc.onconnectionstatechange = () => {
    if (call.pc !== pc) return;
    if (pc.connectionState === "connected") callLive();
    else if (pc.connectionState === "failed") { toast("The call couldn't connect. Mobile networks may need a TURN server."); callEnd("ended"); }
    else if (pc.connectionState === "disconnected") setTimeout(() => { if (call.pc === pc && pc.connectionState === "disconnected") callEnd("ended"); }, 6000);
  };
}
async function applySignal(s) {
  if (!call.pc || call.seen.has(s.id) || s.sender_id === meId()) return;
  call.seen.add(s.id);
  try {
    if (s.kind === "ice") {
      if (call.pc.remoteDescription) await call.pc.addIceCandidate(s.data); else call.queue.push(s.data);
    } else {
      await call.pc.setRemoteDescription(s.data);
      for (const c of call.queue.splice(0)) await call.pc.addIceCandidate(c);
    }
  } catch (e) {}
}

async function startCall() {
  if (!sb || !MIXO.user) return;
  if (call.state !== "idle") return toast("You're already in a call.");
  const c = chat.conv;
  if (!c || c.status !== "accepted") return toast("You can call once your message request is accepted.");
  if (!online.has(chat.uid)) return toast("They're offline right now.");
  if (!window.RTCPeerConnection || !navigator.mediaDevices) return toast("Calls aren't supported in this browser.");
  const peer = chat.uid;
  call.state = "starting";
  try { await callMic(); }
  catch (e) { call.state = "idle"; return toast("Allow the microphone to make calls."); }
  const ins = await sb.from("calls").insert({ callee_id: peer }).select().single();
  if (ins.error) { callCleanup(); return toast(callErr(ins.error)); }
  call.id = ins.data.id;
  call.peer = peer;
  call.role = "caller";
  call.state = "ringing";
  callShow("out", peer);
  callStat("Calling...");
  try { await callOffer(); } catch (e) { toast("Couldn't start the call."); return callEnd("ended"); }
  call.ring = setTimeout(() => { if (call.state === "ringing") { toast("No answer."); callEnd("missed"); } }, 45000);
}

async function onCallInsert(p) {
  const row = p.new;
  if (!row || row.callee_id !== meId() || row.status !== "ringing") return;
  if (Date.now() - new Date(row.created_at).getTime() > 45000) return;
  if (call.state !== "idle") { sb.from("calls").update({ status: "busy" }).eq("id", row.id); return; }
  call.state = "incoming";
  call.id = row.id;
  call.peer = row.caller_id;
  call.role = "callee";
  let info = null;
  {
    let r = await sb.from("profiles").select("id,username,display_name,avatar_url,connect_card,premium_until").eq("id", row.caller_id).maybeSingle();
    if (r.error) r = await sb.from("profiles").select("id,username,display_name,avatar_url").eq("id", row.caller_id).maybeSingle();
    if (r.data) {
      inbox.profiles.set(r.data.id, Object.assign({}, inbox.profiles.get(r.data.id) || {}, r.data));
      if (r.data.connect_card) { const c = cardOf(r.data); info = { frame: c.frame, prem: isPrem(r.data), int: c.int, intro: c.intro }; }
      else if (isPrem(r.data)) info = { frame: "neon", prem: true, int: [], intro: "" };
    }
  }
  if (call.id !== row.id) return;
  callShow("in", row.caller_id, info);
  if (info) sb.rpc("record_card_view", { p_owner: row.caller_id });
  callStat("Incoming voice call");
  if (navigator.vibrate) navigator.vibrate([300, 200, 300, 200, 300]);
  call.ring = setTimeout(() => { if (call.state === "incoming") callCleanup(); }, 45000);
}
function onCallUpdate(p) {
  const row = p.new;
  if (!row || row.id !== call.id) return;
  if (["declined", "busy", "ended", "missed"].includes(row.status)) {
    const live = call.state === "live";
    const auto = CX && CX.state === "calling";
    if (row.status === "declined") { if (!auto) toast("Call declined."); }
    else if (row.status === "busy") { if (!auto) toast("They're on another call."); }
    else if (row.status === "ended" && live) toast("Call ended.");
    callCleanup();
  } else if (row.status === "active" && call.role === "caller" && call.state !== "live") callStat("Connecting...");
}
function onSignal(p) {
  const s = p.new;
  if (s && s.call_id === call.id) applySignal(s);
}

$("#clAccept").onclick = async () => {
  if (call.state !== "incoming") return;
  clearTimeout(call.ring);
  call.state = "answering";
  try { await callMic(); }
  catch (e) { toast("Allow the microphone to answer."); return callEnd("declined"); }
  if (callProvider() === "agora") {
    try { await agoraJoin(); } catch (e) { toast("Couldn't answer the call."); return callEnd("ended"); }
    await sb.from("calls").update({ status: "active", answered_at: new Date().toISOString() }).eq("id", call.id);
    call.state = "connecting";
    $("#callUI").dataset.mode = "live";
    callStat("Connecting...");
    return;
  }
  makePc();
  const sigs = await sb.from("call_signals").select("*").eq("call_id", call.id).order("id");
  const rows = sigs.data || [];
  const offer = rows.find((s) => s.kind === "offer");
  if (!offer) { toast("The call ended."); return callCleanup(); }
  await applySignal(offer);
  for (const s of rows) if (s.kind === "ice") await applySignal(s);
  try {
    const ans = await call.pc.createAnswer();
    await call.pc.setLocalDescription(ans);
    await sendSignal("answer", { type: ans.type, sdp: ans.sdp });
  } catch (e) { toast("Couldn't answer the call."); return callEnd("ended"); }
  await sb.from("calls").update({ status: "active", answered_at: new Date().toISOString() }).eq("id", call.id);
  call.state = "connecting";
  $("#callUI").dataset.mode = "live";
  callStat("Connecting...");
};
$("#clDecline").onclick = () => callEnd("declined");
$("#clHang").onclick = () => { CX.next = false; callEnd(call.state === "ringing" ? "missed" : "ended"); };
$("#clMute").onclick = () => {
  if (!call.stream && !ag.track) return;
  const on = $("#clMute").classList.toggle("on");
  if (ag.track) ag.track.setEnabled(!on);
  if (call.stream) call.stream.getAudioTracks().forEach((t) => { t.enabled = !on; });
};

// ----- header buttons -----
$("#chatBack").onclick = closeChat;
$("#chatCall").onclick = startCall;
$("#chatWho").onclick = () => {
  const p = chat.user;
  if (!p) return;
  closeChat();
  openCreator({ uid: p.id, user: p.username, name: p.display_name || p.username, avatar: p.avatar_url,
    bio: p.bio || "", country: p.country || "", profile: { following: 0, followers: 0, likes: 0 } });
};
async function answerReq(ok) {
  if (!chat.conv) return;
  const id = chat.conv.id;
  const r = await sb.rpc("respond_request", { p_conv: id, p_accept: ok });
  if (r.error) return toast(inboxErr(r.error));
  await refreshInbox();
  if (ok) { loadChatMsgs(); }
  else { closeChat(); }
}
$("#chatAccept").onclick = () => answerReq(true);
$("#chatReject").onclick = () => answerReq(false);

// keep the input above the phone keyboard
function fitChat() {
  const vv = window.visualViewport;
  if (!vv || !chat.open) return;
  const c = $("#chat");
  c.style.height = vv.height + "px";
  c.style.top = vv.offsetTop + "px";
  chatBody.scrollTop = chatBody.scrollHeight;
}
if (window.visualViewport) { visualViewport.addEventListener("resize", fitChat); visualViewport.addEventListener("scroll", fitChat); }

// Message button on someone's profile
$("#cMsg").onclick = () => {
  const uid = $("#cFollow").dataset.uid;
  if (!MIXO.user || !uid) return toast("Log in with a real account to send messages.");
  const country = $("#cCountry").textContent;
  openChat({ id: uid, username: $("#cUser").textContent.replace("@", ""), display_name: $("#cName").textContent,
    avatar_url: ($("#cAvatar img") || {}).src || "", bio: $("#cBio").textContent, country: country === "Not set" ? "" : country });
};

// ----- instant delivery (Supabase Realtime), plus the green "online" dot -----
async function onMsgEvent(p) {
  if (p.eventType === "DELETE") {   // the other person deleted a message: it just disappears, no notice
    const id = p.old && p.old.id;
    if (id && chat.msgs.some((x) => x.id === id)) { chat.msgs = chat.msgs.filter((x) => x.id !== id); renderChat(); }
    refreshInboxSoon();
    return;
  }
  const m = p.new;
  if (!m || !m.id) return;
  if (p.eventType === "UPDATE") {
    const x = chat.msgs.find((q) => q.id === m.id);
    if (x) { x.read_at = m.read_at; renderChat(); }
    return;
  }
  if (p.eventType !== "INSERT") return;
  if (chat.open) {
    if (!chat.conv && m.sender_id === chat.uid) {
      await refreshInbox();
      chat.conv = inbox.convs.find((c) => c.id === m.conversation_id) || chat.conv;
    }
    if (chat.conv && m.conversation_id === chat.conv.id) {
      await signMedia([m]);
      addMsg(m);
      if (m.sender_id !== meId()) markRead();
    }
  }
  refreshInboxSoon();
}
function onReactEvent(p) {
  const row = p.eventType === "DELETE" ? p.old : p.new;
  if (!row || !row.message_id || !chat.open || !chat.msgs.some((m) => m.id === row.message_id)) return;
  setReact(row.message_id, row.user_id, p.eventType === "DELETE" ? null : row.emoji);
  renderChat();
}
function startInbox() {
  if (!sb || !MIXO.user || rtChannel) return;
  refreshInbox();
  rtChannel = sb.channel("inbox-" + meId())
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, onMsgEvent)
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, refreshInboxSoon)
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, onReactEvent)
    .subscribe((s) => { rtOK = s === "SUBSCRIBED"; });
  presCh = sb.channel("mixo-online", { config: { presence: { key: meId() } } });
  presCh.on("presence", { event: "sync" }, () => { online = new Set(Object.keys(presCh.presenceState())); paintOnline(); if (typeof cxRenderRecent === "function") cxRenderRecent(); })
    .subscribe(async (s) => { if (s === "SUBSCRIBED") await presCh.track({ at: Date.now() }); });
  callCh = sb.channel("calls-" + meId())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls" }, onCallInsert)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls" }, onCallUpdate)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals" }, onSignal)
    .subscribe();
  pollTimer = setInterval(() => {
    if (rtOK || document.hidden) return;
    refreshInbox();
    if (chat.open) loadChatMsgs();
  }, 8000);
}
function stopInbox() {
  connectLeave();
  if (call.state !== "idle") callEnd("ended");
  if (sb) { if (rtChannel) sb.removeChannel(rtChannel); if (presCh) sb.removeChannel(presCh); if (callCh) sb.removeChannel(callCh); }
  rtChannel = null; presCh = null; callCh = null; rtOK = false; online = new Set();
  clearInterval(pollTimer);
  inbox.convs = []; inbox.unread = new Map(); inbox.loaded = false; inbox.error = ""; inbox.tab = "msg";
  closeChat();
  renderInbox();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !MIXO.user) return;
  refreshInbox();
  if (chat.open) loadChatMsgs();
});
renderInbox();

// ============ SAFETY: block, report, privacy settings, delete account ============
const safeErr = (e) => {
  const m = (e && e.message) || "";
  return /does not exist|schema cache|could not find|dm_privacy|block_user|report_content|delete_my_account|"blocks"/i.test(m)
    ? "Run mixo_safety.sql in Supabase first." : /slow down/i.test(m) ? "Slow down a little." : niceError(m);
};
const isBlocked = (uid) => social.blocked.has(uid);
function postMore(p) {
  if (!p) return;
  if (MIXO.user && p.uid === MIXO.user.id) deletePost(p.id);
  else openActions({ uid: p.uid, user: p.user, postId: p.id });
}

// ----- the ... menu: report / block -----
let actCtx = null;
function openActions(ctx) {
  if (!MIXO.user || !sb) return toast("Log in with a real account first.");
  if (!ctx || !ctx.uid) return toast("Not available in the preview.");
  if (ctx.uid === meId()) return;
  actCtx = ctx;
  const user = ctx.user || "user", blocked = isBlocked(ctx.uid);
  $("#actTitle").textContent = "@" + user;
  $("#actBody").innerHTML =
    (ctx.postId ? `<button type="button" class="opt" data-a="rpost">${icon("flag")}Report this post</button>` : "") +
    `<button type="button" class="opt" data-a="ruser">${icon("flag")}Report @${esc(user)}</button>` +
    `<button type="button" class="opt danger" data-a="block">${icon("block")}${blocked ? "Unblock" : "Block"} @${esc(user)}</button>` +
    `<button type="button" class="opt" data-a="x">Cancel</button>`;
  $("#actSheet").classList.remove("hidden");
}
$("#actSheet").addEventListener("click", (e) => {
  const s = $("#actSheet");
  if (e.target === s) return s.classList.add("hidden");
  const b = e.target.closest("[data-a]");
  if (!b) return;
  s.classList.add("hidden");
  const c = actCtx;
  if (!c) return;
  const a = b.dataset.a, user = c.user || "user";
  if (a === "rpost") openReport({ uid: c.uid, user, type: "post", id: String(c.postId) });
  else if (a === "ruser") openReport({ uid: c.uid, user, type: "user", id: c.uid });
  else if (a === "block") isBlocked(c.uid) ? unblockUser(c.uid, user) : blockUserFlow(c.uid, user);
});
$("#cMore").onclick = () => openActions({ uid: $("#cFollow").dataset.uid, user: $("#cUser").textContent.replace("@", "") });
$("#chatMore").onclick = () => openActions({ uid: chat.uid, user: (chat.user || {}).username });

async function blockUserFlow(uid, user) {
  const ok = await confirmBox("Block @" + user + "?", "They can't message or follow you, and you won't see their posts. They aren't told.", "Block");
  if (!ok) return;
  const r = await sb.rpc("block_user", { p_user: uid });
  if (r.error) return toast(safeErr(r.error));
  social.blocked.add(uid);
  social.following.delete(uid);
  videos = videos.filter((v) => v.uid !== uid);
  $$(".clip[data-id], .pc[data-id], .pt[data-id]").forEach((el) => {
    const p = postCache.get(el.dataset.id);
    if (p && p.uid === uid) el.remove();
  });
  if (chat.open && chat.uid === uid) closeChat();
  if ($("#creator").classList.contains("on") && $("#cFollow").dataset.uid === uid) go(state.prev && state.prev !== "creator" ? state.prev : "home");
  if (!$$("#feed .clip").length) $("#feed").innerHTML = emptyFeed("No posts yet.<br>Tap + to post the first one.");
  refreshInbox();
  toast("Blocked @" + user);
}
async function unblockUser(uid, user) {
  const r = await sb.rpc("unblock_user", { p_user: uid });
  if (r.error) return toast(safeErr(r.error));
  social.blocked.delete(uid);
  toast("Unblocked @" + user);
  refreshInbox();
  renderFeed();
}

// ----- report -----
const REASONS = ["Spam", "Harassment or bullying", "Nudity or sexual content", "Violence or hate", "Scam or fake account", "Something else"];
let rep = null, repReason = "";
function openReport(ctx) {
  rep = ctx; repReason = "";
  $("#repWho").textContent = ctx.type === "post" ? "Report a post by @" + ctx.user : "Report @" + ctx.user;
  $("#repReasons").innerHTML = REASONS.map((r) => `<button type="button" data-r="${esc(r)}">${esc(r)}</button>`).join("");
  $("#repDetails").value = "";
  $("#repMsg").textContent = "";
  $("#reportSheet").classList.remove("hidden");
}
$("#repReasons").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  repReason = b.dataset.r;
  $$("#repReasons button").forEach((x) => x.classList.toggle("on", x === b));
});
$("#repCancel").onclick = () => $("#reportSheet").classList.add("hidden");
$("#reportSheet").addEventListener("click", (e) => { if (e.target.id === "reportSheet") $("#reportSheet").classList.add("hidden"); });
$("#repSend").onclick = async () => {
  if (!rep) return;
  if (!repReason) { $("#repMsg").textContent = "Pick a reason."; return; }
  $("#repMsg").textContent = "Sending...";
  const r = await sb.rpc("report_content", { p_user: rep.uid, p_type: rep.type, p_id: rep.id, p_reason: repReason, p_details: $("#repDetails").value.trim() });
  if (r.error) { $("#repMsg").textContent = safeErr(r.error); return; }
  $("#reportSheet").classList.add("hidden");
  toast("Thanks. We'll review your report.");
};

// ----- settings: blocked list, log out, delete account -----
$("#setBtn").onclick = () => {
  if (!MIXO.user) return toast("Log in with a real account first.");
  $("#setSheet").classList.remove("hidden");
};
$("#setClose").onclick = () => $("#setSheet").classList.add("hidden");
$("#setSheet").addEventListener("click", (e) => { if (e.target.id === "setSheet") $("#setSheet").classList.add("hidden"); });

$("#setBlocked").onclick = async () => {
  $("#setSheet").classList.add("hidden");
  const body = $("#blkBody");
  body.innerHTML = '<p class="hint">Loading...</p>';
  $("#blkSheet").classList.remove("hidden");
  const r = await sb.from("blocks").select("blocked_id").eq("blocker_id", meId());
  if (r.error) { body.innerHTML = `<p class="hint">${esc(safeErr(r.error))}</p>`; return; }
  const ids = r.data.map((x) => x.blocked_id);
  if (!ids.length) { body.innerHTML = '<p class="hint">You haven\'t blocked anyone.</p>'; return; }
  const pr = await sb.from("profiles").select("id,username,display_name,avatar_url").in("id", ids);
  const list = pr.data || [];
  body.innerHTML = list.map((p) => `<div class="lrow"><div class="lav"></div><div class="ltx"><b>${esc(p.display_name || p.username)}</b><span>@${esc(p.username)}</span></div><button type="button" class="pbtn line" data-u="${esc(p.id)}" data-n="${esc(p.username)}">Unblock</button></div>`).join("");
  $$("#blkBody .lav").forEach((el, i) => setAv(el, list[i].avatar_url, list[i].username));
};
$("#blkBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-u]");
  if (!b) return;
  await unblockUser(b.dataset.u, b.dataset.n);
  if (!isBlocked(b.dataset.u)) {
    b.closest(".lrow").remove();
    if (!$("#blkBody .lrow")) $("#blkBody").innerHTML = '<p class="hint">You haven\'t blocked anyone.</p>';
  }
});
$("#blkSheet").addEventListener("click", (e) => { if (e.target.id === "blkSheet") $("#blkSheet").classList.add("hidden"); });

$("#setDelete").onclick = async () => {
  $("#setSheet").classList.add("hidden");
  if (!(await confirmBox("Delete account?", "Your profile, posts, comments, messages and followers are deleted for good. This can't be undone.", "Delete"))) return;
  if (!(await confirmBox("Really delete?", "Last chance. Everything will be gone.", "Yes, delete"))) return;
  toast("Deleting...");
  try { // remove my uploaded videos and pictures first
    for (const bucket of ["videos", "avatars", "chat"]) {
      const ls = await sb.storage.from(bucket).list(meId(), { limit: 1000 });
      if (ls.data && ls.data.length) await sb.storage.from(bucket).remove(ls.data.map((f) => meId() + "/" + f.name));
    }
  } catch (e) {}
  const r = await sb.rpc("delete_my_account");
  if (r.error) return toast(safeErr(r.error));
  await $("#logoutBtn").onclick();
  toast("Your account was deleted.");
};


// ============ SHARE ============
async function sharePost(id) {
  const p = postCache.get(String(id)) || {};
  const url = location.href.split("#")[0] + "#post=" + encodeURIComponent(id);
  try {
    if (navigator.share) { await navigator.share({ title: "MIXO", text: p.text || "Watch this on MIXO", url }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); toast("Link copied"); }
  catch (e) {
    const t = document.createElement("textarea");
    t.value = url; document.body.appendChild(t); t.select();
    try { document.execCommand("copy"); toast("Link copied"); } catch (e2) { toast("Couldn't copy the link."); }
    t.remove();
  }
}
function openFromHash() {
  const m = location.hash.match(/^#post=(.+)$/);
  if (!m || !MIXO.user) return;
  history.replaceState(null, "", location.href.split("#")[0]);
  openPostView(decodeURIComponent(m[1]));
}

// ============ VIEWS (footprints) ============
const viewedSet = new Set();
function paintViews(id) {
  const p = postCache.get(String(id));
  if (!p) return;
  $$(`[data-id="${id}"] .vwn`).forEach((el) => (el.textContent = fmt(p.views || 0)));
}
async function recordView(id) {
  id = String(id);
  if (!MIXO.user || !sb || viewedSet.has(id)) return;
  const p = postCache.get(id);
  if (!p || p.uid === MIXO.user.id) return;
  viewedSet.add(id);
  const r = await sb.rpc("record_view", { p_post: id });
  if (!r.error && r.data === true) { p.views = (p.views || 0) + 1; paintViews(id); }
}
if ("IntersectionObserver" in window) {
  const viewObs = new IntersectionObserver((es) => es.forEach((en) => {
    if (!en.isIntersecting) return;
    viewObs.unobserve(en.target);
    recordView(en.target.dataset.id);
  }), { threshold: 0.6 });
  const watch = (n) => {
    if (n.nodeType !== 1) return;
    if (n.matches(".clip[data-id], .pc[data-id]")) viewObs.observe(n);
    n.querySelectorAll(".clip[data-id], .pc[data-id]").forEach((x) => viewObs.observe(x));
  };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(watch))).observe($("#app"), { childList: true, subtree: true });
}

// ============ VIDEO REPLIES (only the person who posted the video) ============
$("#vrFile").onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f || !cam.reply) return;
  const r = cam.reply;
  camClose();
  sendVideoReply(r, f);
};
async function sendVideoReply(r, file) {
  if (!file || !r) return;
  if (file.size > 60 * 1024 * 1024) return toast("That video is too big. Keep it under 60 MB.");
  toast("Posting video reply...");
  const ext = (file.name && file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "")) || (file.type.indexOf("mp4") > -1 ? "mp4" : "webm");
  const path = meId() + "/reply-" + Date.now() + "." + ext;
  const up = await sb.storage.from("videos").upload(path, file, { contentType: file.type || "video/mp4" });
  if (up.error) return toast("Couldn't upload that video.");
  const url = sb.storage.from("videos").getPublicUrl(path).data.publicUrl;
  const ins = await sb.from("post_comments").insert({ post_id: comId, body: "", parent_id: r.parent, video_url: url });
  if (ins.error) {
    sb.storage.from("videos").remove([path]);
    return toast(/video_url|schema cache/i.test(ins.error.message || "") ? "Run mixo_update.sql in Supabase first." : /only the poster/i.test(ins.error.message || "") ? "Only the person who posted can reply with video." : socialErr(ins.error));
  }
  const p = postCache.get(String(comId));
  const c = await sb.from("post_comments").select("id", { count: "exact", head: true }).eq("post_id", comId);
  if (p && !c.error && typeof c.count === "number") { p.comments = c.count; paintPost(comId); }
  toast("Video reply posted");
  loadComments();
}


// ============ OTHER PEOPLE'S PROFILES: banner + posts ============
let cUid = "", cTab = 0;
async function loadCreatorProfile(uid) {
  const cols = "username,display_name,avatar_url,bio,country";
  let r = await sb.from("profiles").select(cols + ",banner_url").eq("id", uid).maybeSingle();
  if (r.error) r = await sb.from("profiles").select(cols).eq("id", uid).maybeSingle();
  if (r.error || !r.data || cUid !== uid) return;
  const p = r.data;
  if (p.banner_url) { $("#cBannerImg").src = p.banner_url; $("#cBannerImg").classList.remove("hidden"); $("#cBanner").classList.add("custom"); }
  if (p.display_name || p.username) $("#cName").textContent = p.display_name || p.username;
  if (p.username) $("#cUser").textContent = "@" + p.username;
  setAv($("#cAvatar"), p.avatar_url, p.username);
  $("#cBio").textContent = p.bio || "";
  setLoc($("#cCountry"), p.country, "Not set");
}
async function loadCreatorPosts() {
  const g = $("#cGrid"), tab = cTab, uid = cUid;
  if (!uid || !sb) { g.innerHTML = ""; return; }
  const type = P_TYPES[tab];
  g.innerHTML = '<div class="pempty">Loading...</div>';
  let list = [];
  try { list = await queryPosts((q) => q.eq("user_id", uid).eq("type", type).order("created_at", { ascending: false })); }
  catch (err) { if (tab === cTab && uid === cUid) g.innerHTML = `<div class="pempty">${esc(socialErr(err))}</div>`; return; }
  if (tab !== cTab || uid !== cUid) return;
  if (!list.length) { g.innerHTML = `<div class="pempty">No ${{ video: "videos", topic: "topics", photo: "photos" }[type]} yet.</div>`; return; }
  g.innerHTML = type === "video"
    ? '<div class="pgrid">' + list.map(videoTile).join("") + "</div>"
    : '<div class="pcl pcl-p">' + list.map(postCard).join("") + "</div>";
}
$$("#cTabs button").forEach((b, i) => b.addEventListener("click", () => {
  cTab = i;
  $$("#cTabs button").forEach((x, n) => x.classList.toggle("on", n === i));
  loadCreatorPosts();
}));
function openVideo(url) {
  const v = $("#lbVid");
  $("#lbImg").classList.add("hidden");
  v.classList.remove("hidden");
  v.src = url;
  $("#lightbox").classList.remove("hidden");
  v.play().catch(() => {});
}
$("#cGrid").addEventListener("click", (e) => {
  if (e.target.closest(".pc")) return cardTap(e);
  const t = e.target.closest(".pt");
  if (!t) return;
  const p = postCache.get(String(t.dataset.id));
  if (p) openVidCard(p.id);
});


// ============ CONNECT: swipe through people online, Start Talking, your card, filters + MIXO Premium ============
// Voice calls run on Agora. Paste your Agora App ID below (console.agora.io -> Project -> App ID).
// Token function: deploy supabase/functions/agora-token (included) so calls stay secure. If you leave
// App ID empty, calls fall back to the old peer-to-peer WebRTC.
var AGORA = { appId: "", tokenFn: "agora-token" };
// Payments: paste your Stripe Payment Links here (one per plan). Premium itself lives in premium_users.
var PAY_LINKS = { weekly: "", monthly: "", yearly: "" };
var PLANS = [
  { id: "weekly", name: "Weekly", price: "2.99", sub: "No discount" },
  { id: "monthly", name: "Monthly", price: "7.99", save: "Save 38%" },
  { id: "yearly", name: "Yearly", price: "49.99", sub: "About $4.17 a month", save: "Save 68%", note: "48% cheaper than monthly", badge: "BEST VALUE" },
];
var PL = { sel: "yearly" };
var FREE_CONNECTS = 5, FREE_SKIPS = 3, MAX_INTERESTS = 5;

var FRAMES = [{"id": "neon", "name": "Neon", "premium": false, "anim": "static"}, {"id": "aqua", "name": "Aqua", "premium": false, "anim": "static"}, {"id": "rose", "name": "Rose", "premium": false, "anim": "static"}, {"id": "aurora", "name": "Aurora", "premium": true, "anim": "spin"}, {"id": "gold", "name": "Gold", "premium": true, "anim": "spin"}, {"id": "inferno", "name": "Inferno", "premium": true, "anim": "spin"}, {"id": "ocean", "name": "Ocean", "premium": true, "anim": "spin"}, {"id": "galaxy", "name": "Galaxy", "premium": true, "anim": "spin"}, {"id": "candy", "name": "Candy", "premium": true, "anim": "spin"}, {"id": "matrix", "name": "Matrix", "premium": true, "anim": "spin"}, {"id": "lava", "name": "Lava", "premium": true, "anim": "pulse"}, {"id": "rainbow", "name": "Rainbow", "premium": true, "anim": "spin"}, {"id": "diamond", "name": "Diamond", "premium": true, "anim": "pulse"}, {"id": "sakura", "name": "Sakura", "premium": true, "anim": "pulse"}, {"id": "glitch", "name": "Glitch", "premium": true, "anim": "hue"}];
// every interest has its own hand-drawn icon (#x-<id> in index.html)
var INTERESTS = [["gaming","Gaming"],["music","Music"],["adventures","Adventures"],["movies","Movies"],["sports","Sports"],["fitness","Fitness"],["travel","Travel"],["food","Food"],["art","Art"],["tech","Tech"],["books","Books"],["anime","Anime"],["fashion","Fashion"],["pets","Pets"],["photography","Photo"],["cars","Cars"],["comedy","Comedy"],["dance","Dance"],["science","Science"],["languages","Languages"],["business","Business"],["cooking","Cooking"],["nature","Nature"],["spirituality","Mindful"]];
var LANG_CODES = ["en","es","fr","de","pt","it","ru","ar","hi","bn","ur","zh","ja","ko","tr","id","vi","th","fa","nl","pl","sv","uk","ro","el","he","sw","ta","te","mr","pa","ms","fil","cs","hu"];
var LOOKING = { chat: "Chat", friends: "Friends", language: "Language" };

var svgI = (id) => `<svg class="x"><use href="#x-${id}"/></svg>`;
var intName = (id) => { const x = INTERESTS.find((i) => i[0] === id); return x ? x[1] : id; };
var intChip = (id) => `<span class="chip">${svgI(id)}${esc(intName(id))}</span>`;
var langName = (c) => { try { return new Intl.DisplayNames(["en"], { type: "language" }).of(c) || c; } catch (e) { return c; } };
var myLang = () => (navigator.language || "en").split("-")[0].toLowerCase();
var crownHTML = (cls) => `<b class="crown-b ${cls || "in"}"><svg class="x"><use href="#x-crown"/></svg></b>`;

// every country name (English); the filter shows the two-letter code instead of a flag emoji
var CC = (function () {
  const m = new Map();
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for (const a of A) for (const b of A) {
      const n = dn.of(a + b);
      if (n && n !== a + b && !/Unknown|European Union|United Nations|Eurozone|Pseudo/i.test(n)) m.set(n, a + b);
    }
  } catch (e) {}
  return m;
})();

// ---------- card data ----------
function cardOf(p) {
  const c = (p && p.connect_card) || {};
  return {
    int: Array.isArray(c.int) ? c.int.filter((x) => INTERESTS.some((i) => i[0] === x)).slice(0, MAX_INTERESTS) : [],
    look: LOOKING[c.look] ? c.look : "chat",
    intro: String(c.intro || "").slice(0, 60),
    frame: c.frame || "neon",
    lang: c.lang || "",
  };
}
function paintFrame(el, id, prem) {
  if (!el) return;
  const f = FRAMES.find((x) => x.id === id);
  const use = !f || (f.premium && !prem) ? FRAMES[0] : f;
  el.dataset.frame = use.id;
  el.dataset.anim = use.anim === "static" ? "" : use.anim;
}
const isPrem = (p) => !!(p && p.premium_until && new Date(p.premium_until) > new Date());
const premCache = new Map();
async function premiumOf(uid) {
  if (!uid) return false;
  if (uid === meId()) return CX.premium;
  if (premCache.has(uid)) return premCache.get(uid);
  let v = false;
  try {
    const r = await sb.from("profiles").select("premium_until").eq("id", uid).maybeSingle();
    v = !r.error && isPrem(r.data);
  } catch (e) {}
  premCache.set(uid, v);
  return v;
}
async function paintChatCrown(uid) {
  const prem = await premiumOf(uid);
  if (!prem || chat.uid !== uid) return;
  const n = $("#chatName");
  if (n && !$(".crown-b", n)) n.insertAdjacentHTML("beforeend", crownHTML("in chat-crown"));
}

// ---------- state ----------
function cxLoadFilt() {
  try {
    const j = JSON.parse(localStorage.getItem("mixo_cx_filter2") || "null");
    if (j) return { scope: j.scope === "country" ? "country" : "earth", countries: j.countries || [], langs: j.langs || [], interests: j.interests || [] };
  } catch (e) {}
  return { scope: "earth", countries: [], langs: [], interests: [] };
}
var CX = { ch: null, all: [], pool: [], deck: [], passed: new Set(), filt: cxLoadFilt(), premium: false, until: null, quota: null, state: "idle", tried: new Map(), t0: 0, next: true, busy: false, searchT: 0, tick: 0, recent: [], views: 0, init: false };
var ag = { client: null, track: null };

const cxFiltCustom = () => CX.premium && !!(CX.filt.countries.length || CX.filt.langs.length || CX.filt.interests.length);
function cxTrack() {
  const p = MIXO.profile || {}, c = cardOf(p);
  return CX.ch && CX.ch.track({ id: meId(), u: p.username || "", n: p.display_name || p.username || "", a: p.avatar_url || "", c: p.country || "", busy: call.state !== "idle",
    p: CX.premium ? 1 : 0, i: c.int, l: c.lang || myLang(), f: c.frame, t: c.intro });
}
function cxRetrack() { if (CX && CX.ch) cxTrack(); }

async function loadPremium() {
  CX.premium = false; CX.until = null;
  if (sb && MIXO.user) {
    const r = await sb.from("premium_users").select("plan,premium_until").eq("user_id", meId()).maybeSingle();
    if (r.data && new Date(r.data.premium_until) > new Date()) { CX.premium = true; CX.until = r.data.premium_until; }
  }
  fillProfile();
  cxApply();
  cxRetrack();
}
async function loadQuota() {
  if (!sb || !MIXO.user) return;
  const r = await sb.rpc("connect_quota2");
  CX.quota = r.error ? null : r.data;
  cxRenderQuota();
}

// ---------- paint: top-right circle (your card), start button, filters, quota ----------
function cxPaintMe() {
  if (!$("#cxRing")) return;
  const p = MIXO.profile || {}, c = cardOf(p);
  setAv($("#cxAv"), p.avatar_url, p.display_name || p.username);
  $("#cxCrown").classList.toggle("hidden", !CX.premium);
  paintFrame($("#cxRing"), c.frame, CX.premium);
}
const START_TXT = {
  idle: ["Start<br>Talking", "Tap to connect"],
  searching: ["Searching...", "Tap to cancel"],
  calling: ["Calling...", "Tap to cancel"],
};
function cxPaintStart() {
  const b = $("#cxStart");
  if (!b) return;
  b.dataset.state = CX.state;
  $("#cxStartT").innerHTML = START_TXT[CX.state][0];
  $("#cxStartS").innerHTML = START_TXT[CX.state][1];
}
function cxPaintFilters() {
  const custom = cxFiltCustom();
  $$("#cxFilters [data-scope]").forEach((b) => b.classList.toggle("on", !custom && CX.filt.scope === b.dataset.scope));
  $("#cxFPrem").classList.toggle("on", custom);
}
function cxRenderQuota() {
  const box = $("#cxQuotaBox");
  if (!box) return;
  box.classList.toggle("pro", CX.premium);
  if (CX.premium) { $("#cxQuotaTxt").innerHTML = "<em>Unlimited</em> connects"; $("#cxQuotaBar").style.width = "100%"; return; }
  const lim = CX.quota && CX.quota.limit ? CX.quota.limit : FREE_CONNECTS;
  const used = CX.quota ? CX.quota.used : 0, left = Math.max(0, lim - used);
  $("#cxQuotaTxt").innerHTML = `<em>${left}</em> of ${lim} connects left today`;
  $("#cxQuotaBar").style.width = Math.round((left / lim) * 100) + "%";
}

// ---------- presence + filtering ----------
function cxSync() {
  if (!CX.ch) return;
  const st = CX.ch.presenceState();
  CX.all = Object.keys(st).filter((k) => k !== meId()).map((k) => st[k][0])
    .filter((m) => m && m.id && !m.busy && !social.blocked.has(m.id));
  cxApply();
}
function cxPass(m) {
  const f = CX.filt;
  if (cxFiltCustom()) {
    if (f.countries.length && !f.countries.includes(m.c)) return false;
    if (f.langs.length && !f.langs.includes(m.l)) return false;
    if (f.interests.length && !(m.i || []).some((x) => f.interests.includes(x))) return false;
    return true;
  }
  if (f.scope === "country") {
    const p = MIXO.profile || {}, mine = p.real_country || p.country;
    return !!m.c && m.c !== "Earth" && m.c === mine;
  }
  return true;
}
function cxApply() {
  CX.pool = CX.all.filter(cxPass);
  cxPaintFilters();
  cxDeckSync();
  if (CX.state === "searching") cxSearch();
}

// ---------- the swipe deck: people online ----------
// Order stays put while you swipe; new people join at the end (Premium members go to the front of the unseen ones).
function cxDeckSync() {
  const ids = new Set(CX.pool.map((m) => m.id));
  const byId = new Map(CX.pool.map((m) => [m.id, m]));
  let deck = CX.deck.filter((m) => ids.has(m.id)).map((m) => byId.get(m.id));
  const have = new Set(deck.map((m) => m.id));
  const fresh = CX.pool.filter((m) => !have.has(m.id)).sort((a, b) => (b.p | 0) - (a.p | 0));
  deck = deck.concat(fresh);
  const same = deck.length === CX.deck.length && deck.every((m, i) => m.id === CX.deck[i].id && m.p === CX.deck[i].p && m.f === CX.deck[i].f && m.t === CX.deck[i].t);
  CX.deck = deck;
  if (!same || !$("#cxDeck").children.length) cxRenderDeck();
}
function personCard(m, idx) {
  const earth = !m.c || m.c === "Earth";
  const passed = CX.passed.has(m.id);
  return `<article class="pc${passed ? " passed" : ""}" data-id="${esc(m.id)}" data-i="${idx}">
    <div class="pc-top"><div class="cx-ring fr" data-frame="${esc(m.f || "neon")}"><span class="cx-av">${m.a ? `<img src="${esc(m.a)}" alt="">` : esc((m.n || "?")[0].toUpperCase())}</span></div>
      <div class="pc-info"><div class="pc-name"><span>${esc(m.n || m.u || "User")}</span>${m.p ? crownHTML("in") : ""}</div>
      <div class="pc-loc">${svgI(earth ? "globe" : "pin")}<span>${esc(earth ? "Worldwide" : m.c)}</span></div></div></div>
    <div class="pc-chips">${(m.i || []).slice(0, 3).map(intChip).join("")}</div>
    <p class="pc-intro">${m.t ? "\u201c" + esc(m.t) + "\u201d" : ""}</p>
    <button type="button" class="pc-call" data-a="call">${passed && !CX.premium ? svgI("lock") + "Premium to call" : svgI("phone") + "Call"}</button></article>`;
}
function cxRenderDeck() {
  const box = $("#cxDeck");
  if (!box) return;
  const keep = box.scrollLeft;
  box.innerHTML = CX.deck.length ? CX.deck.map(personCard).join("")
    : `<article class="pc empty"><div class="radar">${svgI("globe")}</div><b>No one online yet</b><span>Tap Start Talking and we'll<br>find someone for you.</span></article>`;
  CX.deck.forEach((m, i) => { const el = box.children[i]; if (el) { const r = el.querySelector(".cx-ring"); paintFrame(r, m.f, !!m.p); } });
  box.scrollLeft = keep;
}
// people you swipe past become "passed": calling them again needs Premium
function cxDeckScrolled() {
  const box = $("#cxDeck");
  if (!box || !CX.deck.length) return;
  const first = box.children[0], second = box.children[1];
  const step = second ? second.offsetLeft - first.offsetLeft : first.offsetWidth;
  const i = Math.max(0, Math.min(CX.deck.length - 1, Math.round(box.scrollLeft / Math.max(1, step))));
  let changed = false;
  for (let k = 0; k < i; k++) if (!CX.passed.has(CX.deck[k].id)) { CX.passed.add(CX.deck[k].id); changed = true; }
  if (!changed) return;
  [...box.children].forEach((el) => {
    const passed = CX.passed.has(el.dataset.id);
    el.classList.toggle("passed", passed);
    const b = el.querySelector(".pc-call");
    if (b) b.innerHTML = passed && !CX.premium ? svgI("lock") + "Premium to call" : svgI("phone") + "Call";
  });
}
async function cxDeckClick(e) {
  const b = e.target.closest('[data-a="call"]'), card = e.target.closest(".pc");
  if (!b || !card) return;
  const m = CX.deck.find((x) => x.id === card.dataset.id);
  if (!m) return;
  if (CX.passed.has(m.id) && !CX.premium) return openPlans("back");
  if (CX.state !== "idle") return toast("Finish this call first.");
  if (!sb || !MIXO.user) return toast("Log in to connect.");
  if (call.state !== "idle") return toast("You're already in a call.");
  if (!window.RTCPeerConnection || !navigator.mediaDevices) return toast("Calls aren't supported in this browser.");
  await loadQuota();
  if (!CX.premium && CX.quota && CX.quota.limit && CX.quota.used >= CX.quota.limit) return cxLimitHit();
  CX.tried = new Map(); CX.next = false; CX.t0 = Date.now(); CX.state = "searching";
  cxPaintStart();
  cxCall(m);
}

// ---------- enter / leave the page ----------
function cxInitOnce() {
  if (CX.init || !$("#cxStart")) return;
  CX.init = true;
  const L = [10, 16, 24, 34, 46, 60], mk = (a) => a.map((h, i) => `<i style="height:${h}px;animation-delay:${(i * 0.13).toFixed(2)}s"></i>`).join("");
  $(".cx-wave.l").innerHTML = mk(L);
  $(".cx-wave.r").innerHTML = mk(L.slice().reverse());
  let raf = 0;
  $("#cxDeck").addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(cxDeckScrolled); }, { passive: true });
  $("#cxDeck").addEventListener("click", cxDeckClick);
}
function connectEnter() {
  if (!CX) return;
  cxInitOnce();
  cxPaintMe(); cxPaintStart(); cxPaintFilters(); cxRenderQuota(); cxDeckSync();
  if (!sb || !MIXO.user) return;
  loadPremium();
  loadQuota();
  loadRecent();
  loadViewCount();
  clearInterval(CX.tick);
  CX.tick = setInterval(() => { if (CX.quota && CX.quota.resets_at && new Date(CX.quota.resets_at) < new Date()) loadQuota(); }, 30000);
  if (CX.ch) return;
  CX.ch = sb.channel("mixo-connect", { config: { presence: { key: meId() } } });
  CX.ch.on("presence", { event: "sync" }, cxSync).subscribe(async (s) => { if (s === "SUBSCRIBED") await cxTrack(); });
}
function connectLeave() {
  if (!CX) return;
  clearInterval(CX.tick);
  clearTimeout(CX.searchT);
  CX.next = false;
  if (CX.state === "searching") { CX.state = "idle"; cxPaintStart(); }
  if (CX.ch && sb) { try { sb.removeChannel(CX.ch); } catch (e) {} }
  CX.ch = null; CX.all = []; CX.pool = []; CX.deck = []; CX.passed = new Set();
}

// ---------- START TALKING: find someone online and ring them ----------
async function cxStartTap() {
  if (CX.state !== "idle") return cxCancel();
  if (!sb || !MIXO.user) return toast("Log in to connect.");
  if (call.state !== "idle") return toast("You're already in a call.");
  if (!window.RTCPeerConnection || !navigator.mediaDevices) return toast("Calls aren't supported in this browser.");
  await loadQuota();
  if (!CX.premium && CX.quota && CX.quota.limit && CX.quota.used >= CX.quota.limit) return cxLimitHit();
  CX.tried = new Map(); CX.next = true; CX.t0 = Date.now(); CX.state = "searching";
  cxPaintStart();
  cxSearch();
}
function cxCancel() {
  clearTimeout(CX.searchT);
  CX.next = false;
  const wasCalling = CX.state === "calling";
  CX.state = "idle";
  cxPaintStart();
  if (wasCalling && (call.state === "ringing" || call.state === "starting")) callEnd("missed");
}
function cxSearch() {
  clearTimeout(CX.searchT);
  if (CX.state !== "searching" || CX.busy || !CX.next) return;
  if (Date.now() - CX.t0 > 90000) { CX.state = "idle"; cxPaintStart(); return toast("No one is available right now. Try again soon."); }
  const now = Date.now();
  const list = CX.pool.filter((m) => !(CX.tried.get(m.id) > now - 60000))
    .map((m) => ({ m, r: Math.random() })).sort((a, b) => ((b.m.p | 0) - (a.m.p | 0)) || a.r - b.r).map((x) => x.m);   // Premium members are matched first
  if (!list.length) { CX.searchT = setTimeout(cxSearch, 2500); return; }
  cxCall(list[0]);
}
async function cxCall(m) {
  if (CX.busy) return;
  CX.busy = true;
  CX.tried.set(m.id, Date.now());
  call.state = "starting";
  try { await callMic(); }
  catch (e) { call.state = "idle"; CX.busy = false; CX.state = "idle"; cxPaintStart(); return toast("Allow the microphone to make calls."); }
  const r = await sb.rpc("connect_request2", { p_callee: m.id });
  if (r.error) {
    callCleanup(); CX.busy = false;
    const msg = r.error.message || "";
    if (/call_limit/.test(msg)) { CX.state = "idle"; cxPaintStart(); await loadQuota(); return cxLimitHit(); }
    if (/blocked|slow down/i.test(msg) && CX.next) { CX.state = "searching"; cxPaintStart(); CX.searchT = setTimeout(cxSearch, 1500); return; }
    CX.state = "idle"; cxPaintStart();
    return toast(/does not exist|schema cache|could not find/i.test(msg) ? "Run mixo_connect2.sql in Supabase first." : "Couldn't start the call.");
  }
  if (CX.state !== "searching") { // cancelled while we were setting up
    CX.busy = false;
    await sb.from("calls").update({ status: "missed", ended_at: new Date().toISOString() }).eq("id", r.data.call_id);
    return callCleanup();
  }
  CX.state = "calling";
  cxPaintStart();
  CX.quota = Object.assign({}, CX.quota || {}, { limit: r.data.limit, used: r.data.used, resets_at: r.data.resets_at });
  call.id = r.data.call_id; call.peer = m.id; call.role = "caller"; call.state = "ringing";
  inbox.profiles.set(m.id, { id: m.id, username: m.u, display_name: m.n, avatar_url: m.a });
  callShow("out", m.id, { frame: m.f, prem: !!m.p, int: m.i || [], intro: m.t || "", connect: CX.next });
  callStat("Connecting you...");
  sb.rpc("record_card_view", { p_owner: m.id });
  try { await callOffer(); }
  catch (e) { CX.busy = false; toast("Couldn't start the call."); return callEnd("ended"); }
  CX.busy = false;
  call.ring = setTimeout(() => { if (call.state === "ringing") callEnd("missed"); }, 20000);
}
// runs from callCleanup: decide what happens after a Connect call stops
function cxAfterCall(prev) {
  if (!CX || CX.state !== "calling") return;
  if (prev === "live") { CX.state = "idle"; cxPaintStart(); loadQuota(); loadRecent(); return; }
  if (CX.next) { CX.state = "searching"; cxPaintStart(); clearTimeout(CX.searchT); CX.searchT = setTimeout(cxSearch, 600); }
  else { CX.state = "idle"; cxPaintStart(); }
}
function cxLimitHit() { openPlans("limit"); }

// skip + rematch: Premium is unlimited, free members get a few a day
function cxSkipAllowed() {
  if (CX.premium) return true;
  const d = new Date().toDateString();
  let s = { d, n: 0 };
  try { const j = JSON.parse(localStorage.getItem("mixo_skips") || "null"); if (j && j.d === d) s = j; } catch (e) {}
  if (s.n >= FREE_SKIPS) return false;
  s.n++;
  try { localStorage.setItem("mixo_skips", JSON.stringify(s)); } catch (e) {}
  return true;
}
$("#clSkip").onclick = () => {
  if (CX.state !== "calling" || call.state !== "ringing") return;
  if (!cxSkipAllowed()) return openPlans("skip");
  CX.next = true;
  callEnd("missed");
};

// ---------- call screen: card strip, frame, crown ----------
function callCard(info) {
  const box = $("#clCard"), av = $(".cl-av");
  av.querySelectorAll(".crown-b").forEach((x) => x.remove());
  av.classList.add("fr");
  paintFrame(av, info && info.frame, !!(info && info.prem));
  if (!info) { box.classList.add("hidden"); return; }
  if (info.prem) av.insertAdjacentHTML("beforeend", crownHTML(""));
  const has = (info.int && info.int.length) || info.intro;
  box.classList.toggle("hidden", !has);
  $("#clChips").innerHTML = (info.int || []).slice(0, 3).map((id) => `<span>${esc(intName(id))}</span>`).join("");
  $("#clIntro").textContent = info.intro ? "\u201c" + info.intro + "\u201d" : "";
}

// ---------- AGORA (real voice) ----------
const callProvider = () => (AGORA.appId && window.AgoraRTC ? "agora" : "webrtc");
async function callMic() {
  if (callProvider() === "agora") ag.track = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
  else call.stream = await navigator.mediaDevices.getUserMedia(micOpts);
}
async function callOffer() {
  if (callProvider() === "agora") return agoraJoin();
  makePc();
  const offer = await call.pc.createOffer();
  await call.pc.setLocalDescription(offer);
  await sendSignal("offer", { type: offer.type, sdp: offer.sdp });
}
async function agoraJoin() {
  const AR = window.AgoraRTC;
  try { AR.setLogLevel(3); } catch (e) {}
  const channel = "mixo_" + call.id, client = AR.createClient({ mode: "rtc", codec: "vp8" });
  ag.client = client;
  client.on("user-published", async (user, type) => {
    try { await client.subscribe(user, type); } catch (e) { return; }
    if (type === "audio" && user.audioTrack) { user.audioTrack.play(); callLive(); }
  });
  client.on("user-left", () => { if (ag.client === client && call.state !== "idle") { toast("Call ended."); callEnd("ended"); } });
  client.on("connection-state-change", (cur) => { if (ag.client === client && cur === "DISCONNECTED" && call.state === "live") callEnd("ended"); });
  let token = null;
  if (AGORA.tokenFn) {
    try { const r = await sb.functions.invoke(AGORA.tokenFn, { body: { channel } }); if (r.data && r.data.token) token = r.data.token; } catch (e) {}
  }
  await client.join(AGORA.appId, channel, token, null);
  await client.publish([ag.track]);
}
function agoraLeave() {
  const t = ag.track, c = ag.client;
  ag.track = null; ag.client = null;
  try { if (t) { t.stop(); t.close(); } } catch (e) {}
  try { if (c) c.leave(); } catch (e) {}
}

// ---------- RECENT (clock button, top right) ----------
const agoTxt = (d) => { const a = ago(d); return a === "now" ? "just now" : /^\d+[mhd]$/.test(a) ? a + " ago" : a; };
function recentRow(r) {
  const p = r.p, name = p.display_name || p.username || "User", earth = !p.country || p.country === "Earth";
  const fol = social.following.has(r.id), on = online.has(r.id);
  return `<div class="rr" data-u="${esc(r.id)}"><div class="rr-top"><div class="rr-av"><div class="iav">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(name[0].toUpperCase())}</div>${on ? "<i></i>" : ""}</div>
    <div class="rr-info"><b><span>${esc(name)}</span>${isPrem(p) ? crownHTML("in") : ""}</b><small>${svgI(earth ? "globe" : "pin")}${esc(earth ? "Worldwide" : p.country)} &middot; ${agoTxt(r.at)}</small></div></div>
    <div class="rr-act"><button type="button" data-a="msg">${svgI("chat")}Message</button><button type="button" data-a="fol" class="${fol ? "on" : ""}">${svgI(fol ? "check" : "userplus")}${fol ? "Following" : "Follow"}</button><button type="button" data-a="rep" class="rp">${icon("warn")}Report</button><button type="button" data-a="blk" class="bk">${icon("block")}Block</button></div></div>`;
}
function cxRenderRecent() {
  const box = $("#recentAll");
  if (!box || $("#recentSheet").classList.contains("hidden")) return;
  const list = CX.recent.filter((r) => !social.blocked.has(r.id));
  box.innerHTML = list.length ? list.map(recentRow).join("") : `<div class="rr-empty">${MIXO.user ? "No one yet.<br>Tap Start Talking to meet someone." : "Log in to meet new people."}</div>`;
}
async function loadRecent() {
  if (!sb || !MIXO.user) { CX.recent = []; return cxRenderRecent(); }
  const r = await sb.from("calls").select("caller_id,callee_id,answered_at").not("answered_at", "is", null).order("answered_at", { ascending: false }).limit(80);
  if (r.error) { CX.recent = []; return cxRenderRecent(); }
  const seen = new Set(), rows = [];
  for (const c of r.data || []) {
    const id = c.caller_id === meId() ? c.callee_id : c.caller_id;
    if (!id || id === meId() || seen.has(id)) continue;
    seen.add(id); rows.push({ id, at: c.answered_at });
    if (rows.length >= 30) break;
  }
  if (!rows.length) { CX.recent = []; return cxRenderRecent(); }
  const cols = "id,username,display_name,avatar_url,bio,country";
  let pr = await sb.from("profiles").select(cols + ",premium_until").in("id", rows.map((x) => x.id));
  if (pr.error) pr = await sb.from("profiles").select(cols).in("id", rows.map((x) => x.id));
  const map = new Map((pr.data || []).map((p) => [p.id, p]));
  CX.recent = rows.filter((x) => map.has(x.id)).map((x) => Object.assign(x, { p: map.get(x.id) }));
  cxRenderRecent();
}
async function recentClick(e) {
  const b = e.target.closest("[data-a]"), row = e.target.closest(".rr");
  if (!b || !row) return;
  const r = CX.recent.find((x) => x.id === row.dataset.u);
  if (!r) return;
  const p = r.p, a = b.dataset.a;
  if (a === "msg") { $("#recentSheet").classList.add("hidden"); openChat(Object.assign({}, p)); }
  else if (a === "fol") { toggleFollow(p.id, p.username); cxRenderRecent(); }
  else if (a === "rep") openReport({ uid: p.id, user: p.username || "user", type: "user", id: p.id });
  else if (a === "blk") { await blockUserFlow(p.id, p.username || "user"); cxRenderRecent(); }
}
$("#recentAll").addEventListener("click", recentClick);
$("#cxRecentBtn").onclick = () => { $("#recentSheet").classList.remove("hidden"); cxRenderRecent(); };
$("#recentSheet").addEventListener("click", (e) => { if (e.target.id === "recentSheet") $("#recentSheet").classList.add("hidden"); });

// ---------- who viewed your card (Premium) ----------
async function loadViewCount() {
  const r = await sb.rpc("card_view_count");
  if (!r.error && typeof r.data === "number") { CX.views = r.data; $("#cdViewN").textContent = fmt(r.data); }
}
var viewers = [];
async function openViewers() {
  if (!MIXO.user) return toast("Log in to see your viewers.");
  if (!CX.premium) return openPlans("views");
  const body = $("#viewersBody");
  body.innerHTML = '<p class="hint">Loading...</p>';
  $("#viewersSheet").classList.remove("hidden");
  const r = await sb.rpc("my_card_viewers");
  if (r.error) { body.innerHTML = `<p class="hint">${esc(/does not exist|schema cache|could not find/i.test(r.error.message || "") ? "Run mixo_connect2.sql in Supabase first." : niceError(r.error.message))}</p>`; return; }
  viewers = r.data || [];
  body.innerHTML = viewers.length ? viewers.map((v, i) => `<button type="button" class="lrow" data-i="${i}"><div class="lav"></div><div class="ltx"><b>${esc(v.display_name || v.username)}</b><span>@${esc(v.username)} &middot; ${agoTxt(v.viewed_at)}</span></div></button>`).join("")
    : '<p class="hint">No views yet.<br>They show up when someone meets you.</p>';
  $$("#viewersBody .lav").forEach((el, i) => setAv(el, viewers[i].avatar_url, viewers[i].username));
}
$("#viewersSheet").addEventListener("click", (e) => {
  if (e.target.id === "viewersSheet") return $("#viewersSheet").classList.add("hidden");
  const row = e.target.closest(".lrow");
  if (!row) return;
  const v = viewers[+row.dataset.i];
  $("#viewersSheet").classList.add("hidden");
  openCreator({ uid: v.viewer_id, user: v.username, name: v.display_name || v.username, avatar: v.avatar_url, bio: "", country: "", profile: { following: 0, followers: 0, likes: 0 } });
});
$("#cdViews").onclick = openViewers;

// ---------- filters ----------
var FS = { scope: "earth", countries: new Set(), langs: new Set(), interests: new Set(), tab: "country", q: "" };
function openFilter() {
  if (!MIXO.user) return toast("Log in to use filters.");
  if (!CX.premium) return openPlans("filter");
  FS.scope = CX.filt.scope; FS.countries = new Set(CX.filt.countries); FS.langs = new Set(CX.filt.langs); FS.interests = new Set(CX.filt.interests);
  FS.tab = "country"; FS.q = "";
  $("#fsSearch").value = "";
  renderFilter();
  $("#cxSheet").classList.remove("hidden");
}
function fsItems() {
  const q = FS.q.trim().toLowerCase();
  if (FS.tab === "country") return [...CC.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => [n, n, c]).filter((x) => !q || x[1].toLowerCase().includes(q));
  if (FS.tab === "lang") return LANG_CODES.map((c) => [c, langName(c), c.toUpperCase()]).sort((a, b) => a[1].localeCompare(b[1])).filter((x) => !q || x[1].toLowerCase().includes(q));
  return INTERESTS.map((i) => [i[0], i[1], null]).filter((x) => !q || x[1].toLowerCase().includes(q));
}
const fsSet = () => (FS.tab === "country" ? FS.countries : FS.tab === "lang" ? FS.langs : FS.interests);
function fsCount() {
  const n = FS.countries.size + FS.langs.size + FS.interests.size;
  $("#fsSel").textContent = n ? n + " selected" : "Anyone";
}
function renderFilter() {
  $$("#fsScope button").forEach((b) => b.classList.toggle("on", b.dataset.s === FS.scope));
  $$("#fsTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === FS.tab));
  const set = fsSet();
  $("#fsList").innerHTML = fsItems().map((x) => `<button type="button" class="fs-row${set.has(x[0]) ? " on" : ""}" data-k="${esc(x[0])}">${x[2] === null ? svgI(x[0]) : `<span class="fs-fl">${esc(x[2])}</span>`}<span>${esc(x[1])}</span>${svgI("check")}</button>`).join("") || '<p class="fs-none">Nothing found</p>';
  fsCount();
}
$("#fsScope").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { FS.scope = b.dataset.s; renderFilter(); } });
$("#fsTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { FS.tab = b.dataset.t; FS.q = ""; $("#fsSearch").value = ""; renderFilter(); } });
$("#fsList").addEventListener("click", (e) => {
  const b = e.target.closest(".fs-row");
  if (!b) return;
  const set = fsSet(), k = b.dataset.k;
  set.has(k) ? set.delete(k) : set.add(k);
  b.classList.toggle("on", set.has(k));
  fsCount();
});
$("#fsSearch").addEventListener("input", (e) => { FS.q = e.target.value; renderFilter(); });
$("#fsClear").onclick = () => { FS.countries.clear(); FS.langs.clear(); FS.interests.clear(); renderFilter(); };
$("#fsApply").onclick = () => {
  CX.filt = { scope: FS.scope, countries: [...FS.countries], langs: [...FS.langs], interests: [...FS.interests] };
  try { localStorage.setItem("mixo_cx_filter2", JSON.stringify(CX.filt)); } catch (e) {}
  $("#cxSheet").classList.add("hidden");
  cxApply();
};
$("#cxSheet").addEventListener("click", (e) => { if (e.target.id === "cxSheet") $("#cxSheet").classList.add("hidden"); });
$("#cxFilters").addEventListener("click", (e) => {
  const s = e.target.closest("[data-scope]");
  if (s) {
    CX.filt.countries = []; CX.filt.langs = []; CX.filt.interests = [];
    CX.filt.scope = s.dataset.scope;
    try { localStorage.setItem("mixo_cx_filter2", JSON.stringify(CX.filt)); } catch (err) {}
    return cxApply();
  }
  if (e.target.closest("#cxFPrem")) openFilter();
});

// ---------- EDIT CARD (tap your circle, top right) ----------
var CD = { int: [], look: "chat", frame: "neon", country: "real", tab: "p" };
function cdPaintTop() {
  const p = MIXO.profile || {};
  setAv($("#cdAv"), p.avatar_url, p.display_name || p.username);
  paintFrame($("#cdRing"), CD.frame, CX.premium);
}
function cdPaintChips() {
  $("#cdInts").innerHTML = INTERESTS.map((i) => `<button type="button" class="it${CD.int.includes(i[0]) ? " on" : ""}${!CD.int.includes(i[0]) && CD.int.length >= MAX_INTERESTS ? " dis" : ""}" data-k="${i[0]}">${svgI(i[0])}${esc(i[1])}</button>`).join("");
  $("#cdIntN").textContent = CD.int.length + "/" + MAX_INTERESTS;
}
function cdPaintFrames() {
  $("#cdFrames").innerHTML = FRAMES.map((f) => `<button type="button" class="fb fr${f.premium && !CX.premium ? " lock" : ""}${CD.frame === f.id ? " sel" : ""}" data-id="${f.id}" data-frame="${f.id}" data-anim="${f.anim === "static" ? "" : f.anim}" aria-label="${f.name}"><i></i>${f.premium ? svgI("crown") : ""}</button>`).join("");
}
function cdPaintCountry() {
  const real = (MIXO.profile || {}).real_country;
  $("#cdReal").textContent = real || "Not found yet";
  $('#cdCountry [data-v="real"]').disabled = !real;
  if (!real) CD.country = "earth";
  $$("#cdCountry button").forEach((b) => b.classList.toggle("on", b.dataset.v === CD.country));
}
function cdTab(t) {
  CD.tab = t;
  $$("#cdTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
  $$("#cardForm .cd-pane").forEach((p) => p.classList.toggle("hidden", p.dataset.p !== t));
}
function openCard() {
  if (!MIXO.user) return toast("Log in with your account to edit your card");
  const p = MIXO.profile || {}, c = cardOf(p);
  CD = { int: c.int.slice(), look: c.look, frame: c.frame, country: p.country === "Earth" ? "earth" : "real", tab: "p" };
  if (!CX.premium && (FRAMES.find((f) => f.id === CD.frame) || {}).premium) CD.frame = "neon";
  $("#cdName").value = p.display_name || "";
  $("#cdIntro").value = c.intro;
  $("#cdIntroN").textContent = c.intro.length + "/60";
  $("#cdViewN").textContent = fmt(CX.views || 0);
  const sel = $("#cdLang");
  sel.innerHTML = LANG_CODES.map((l) => `<option value="${l}">${esc(langName(l))}</option>`).join("");
  const want = c.lang || myLang();
  sel.value = LANG_CODES.includes(want) ? want : "en";
  $$("#cdLook button").forEach((b) => b.classList.toggle("on", b.dataset.v === CD.look));
  cdPaintTop(); cdPaintChips(); cdPaintFrames(); cdPaintCountry(); cdTab("p");
  $("#cdMsg").textContent = "";
  $("#cardSheet").classList.remove("hidden");
}
function closeCard() { $("#cardSheet").classList.add("hidden"); }
$("#cxRing").onclick = openCard;
$("#cdTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) cdTab(b.dataset.t); });
$("#cdCancel").onclick = closeCard;
$("#cardSheet").addEventListener("click", (e) => { if (e.target.id === "cardSheet") closeCard(); });
$("#cdCountry").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b || b.disabled) return; CD.country = b.dataset.v; cdPaintCountry(); });
$("#cdLook").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; CD.look = b.dataset.v; $$("#cdLook button").forEach((x) => x.classList.toggle("on", x === b)); });
$("#cdInts").addEventListener("click", (e) => {
  const b = e.target.closest(".it");
  if (!b) return;
  const k = b.dataset.k, i = CD.int.indexOf(k);
  if (i > -1) CD.int.splice(i, 1);
  else if (CD.int.length >= MAX_INTERESTS) return toast("Pick up to " + MAX_INTERESTS + " interests");
  else CD.int.push(k);
  cdPaintChips();
});
$("#cdIntro").addEventListener("input", (e) => { $("#cdIntroN").textContent = e.target.value.length + "/60"; });
$("#cdFrames").addEventListener("click", (e) => {
  const b = e.target.closest(".fb");
  if (!b) return;
  const f = FRAMES.find((x) => x.id === b.dataset.id);
  if (f.premium && !CX.premium) return openPlans("frame");
  CD.frame = f.id;
  cdPaintFrames(); cdPaintTop();
});
$("#cdPhotoBtn").onclick = () => $("#cdPhotoIn").click();
$("#cdPhotoIn").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const blob = await openCropper(file, "avatar");
    if (!blob) return;
    $("#cdMsg").textContent = "Uploading photo...";
    await uploadPicture(blob, "avatar");
    $("#cdMsg").textContent = "";
    cdPaintTop();
  } catch (err) { $("#cdMsg").textContent = niceError(err.message); }
};
$("#cardForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#cdMsg"), btn = $("#cdSave");
  const display_name = $("#cdName").value.trim();
  if (!display_name) { cdTab("p"); msg.textContent = "Enter a display name."; return; }
  btn.disabled = true; msg.textContent = "Saving...";
  try {
    const frame = (FRAMES.find((f) => f.id === CD.frame) || {}).premium && !CX.premium ? "neon" : CD.frame;
    const card = { int: CD.int, look: CD.look, intro: $("#cdIntro").value.trim().slice(0, 60), frame, lang: $("#cdLang").value };
    const upd = { display_name, connect_card: card };
    const real = (MIXO.profile || {}).real_country;
    if (CD.country === "earth") upd.country = "Earth"; else if (real) upd.country = real;
    const { data, error } = await sb.from("profiles").update(upd).eq("id", meId()).select().single();
    if (error) throw error;
    MIXO.profile = data;
    fillProfile(); cxRetrack();
    closeCard();
    toast("Card saved");
  } catch (err) {
    msg.textContent = /connect_card/.test(err.message || "") ? "Run mixo_connect2.sql in Supabase first." : niceError(err.message);
  } finally { btn.disabled = false; }
});

// ---------- Premium screen ----------
const PL_ICON = { weekly: svgI("bolt"), monthly: svgI("globe"), yearly: svgI("globe") };
const PL_WHY = {
  filter: "Any country, language or interest is Premium",
  skip: "Free members get " + FREE_SKIPS + " skips a day",
  frame: "Animated frames are Premium",
  views: "Seeing who viewed you is Premium",
  back: "Calling people you passed is Premium",
};
function openPlans(why) {
  const st = $("#plStatus");
  let msg = "";
  if (CX.premium && CX.until) msg = "Premium until " + new Date(CX.until).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  else if (PL_WHY[why]) msg = PL_WHY[why];
  st.textContent = msg;
  st.classList.toggle("hidden", !msg);
  plansRender();
  $("#plans").scrollTop = 0;
  $("#plans").classList.remove("hidden");
}
function plansRender() {
  $("#plCards").innerHTML = PLANS.map((p) =>
    `<button type="button" class="pl-card${p.id === PL.sel ? " on" : ""}" data-id="${p.id}">${p.badge ? `<span class="pl-badge">${p.badge}</span>` : ""}<span class="pl-tick">${svgI("check")}</span>${PL_ICON[p.id]}<b class="n">${p.name}</b><b class="p">$${p.price}</b>${p.id === "yearly" ? `<small>${p.sub}</small>` : ""}${p.save ? `<span class="pl-save">${p.save}</span>` : ""}${p.id === "weekly" ? `<small>${p.sub}</small>` : ""}${p.note ? `<small>${p.note}</small>` : ""}</button>`
  ).join("");
  const p = PLANS.find((x) => x.id === PL.sel);
  $("#plGo").textContent = (CX.premium ? "EXTEND WITH " : "CONTINUE WITH ") + p.name.toUpperCase();
}
$("#plCards").addEventListener("click", (e) => {
  const b = e.target.closest(".pl-card");
  if (!b) return;
  PL.sel = b.dataset.id;
  plansRender();
});
$("#plClose").onclick = () => $("#plans").classList.add("hidden");
$("#plGo").onclick = () => {
  if (!MIXO.user) return toast("Log in to get Premium.");
  const link = PAY_LINKS[PL.sel];
  if (!link) return toast("Payments aren't connected yet.");
  location.href = link + (link.includes("?") ? "&" : "?") + "client_reference_id=" + encodeURIComponent(meId());
};

$("#cxStart").onclick = cxStartTap;
$("#cxPrem").onclick = () => openPlans();
$("#cxUpgrade").onclick = () => openPlans("limit");