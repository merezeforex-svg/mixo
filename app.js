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
  /invalid login/i.test(m) ? "Wrong email or password."
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
  $("#pUser").textContent = p.username ? "@" + p.username : "@username";
  $("#pBio").textContent = p.bio || "Add a bio";
  $("#pBio").classList.toggle("hint", !p.bio);
  setLoc($("#pCountry"), p.country, MIXO.user ? "Detecting your country..." : "Add your location");
  $("#pCountry").classList.toggle("hint", !p.country);
  const bi = $("#pBannerImg");
  if (p.banner_url) { bi.src = p.banner_url; bi.classList.remove("hidden"); $("#pBanner").classList.add("custom"); }
  else { bi.classList.add("hidden"); $("#pBanner").classList.remove("custom"); }
}

function enterApp() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  fillProfile();
  ensureCountry();
  startInbox();
  loadSocial().finally(() => { renderFeed(); loadMyPosts(); refreshMyStats(); });
}
$("#previewBtn").onclick = enterApp;

$("#logoutBtn").onclick = async () => {
  if (sb) await sb.auth.signOut();
  pauseAll();
  stopInbox();
  $("#feed").innerHTML = "";
  MIXO.user = null;
  MIXO.profile = null;
  fillProfile();
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  showForm("login");
  go("home");
};

// ---------- navigation ----------
const state = { liked: new Set(), following: new Set(), prev: "home" };
const social = { likes: new Set(), saves: new Set(), following: new Set() };

function go(page) {
  $$(".page").forEach((p) => p.classList.toggle("on", p.id === page));
  $$("#nav [data-page]").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  if (page === "home") { if (MIXO.current) MIXO.current.play().catch(() => {}); }
  else pauseAll();
  if (page === "profile") loadMyPosts();
  if (page === "explore") loadExplore();
  if (page === "inbox") refreshInbox();
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
    const ins = await sb.from("posts").insert({ user_id: MIXO.user.id, type: "video", caption: e.target.caption.value.trim(), media_url: url });
    if (ins.error) { await sb.storage.from("videos").remove([path]); throw ins.error; }
    uploading = false;
    closePost();
    go("home");
    await renderFeed();
    toast("Posted!");
    loadMyPosts();
  } catch (err) {
    postMsg.textContent = niceError(err.message);
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
    video: { facingMode: cam.facing, width: { ideal: 1080 }, height: { ideal: 1920 } },
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
async function openCamera() {
  if (!MIXO.user) return toast("Log in with your account to post");
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
    cam.rec = new MediaRecorder(cam.stream, Object.assign({ videoBitsPerSecond: 3000000 }, mime ? { mimeType: mime } : {}));
  } catch (err) { return toast("This browser can't record video here."); }
  cam.chunks = [];
  cam.rec.ondataavailable = (e) => { if (e.data && e.data.size) cam.chunks.push(e.data); };
  cam.rec.onstop = camFinish;
  cam.rec.start(250);
  cam.t0 = Date.now();
  camUi("rec");
  $("#camTime").classList.remove("hidden");
  const loop = () => {
    const t = (Date.now() - cam.t0) / 1000;
    setRing(t / cam.max);
    $("#camTime").textContent = "0:" + String(Math.floor(t)).padStart(2, "0");
    if (t >= cam.max) return camStopRec();
    cam.raf = requestAnimationFrame(loop);
  };
  loop();
}
function camStopRec() {
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
  if (cam.timer) camCountdown(3); else camStartRec();
};
$("#camClose").onclick = camClose;
$("#camErrClose").onclick = camClose;
$("#camErrBtn").onclick = () => $("#camNative").click();
$("#camUp").onclick = () => $("#postFile").click();
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
  toast(cam.timer ? "3 second timer on" : "Timer off");
};
$$("#camModes button").forEach((b) => (b.onclick = () => {
  cam.max = +b.dataset.s;
  $$("#camModes button").forEach((x) => x.classList.toggle("on", x === b));
}));
$("#camRetake").onclick = () => { $("#camRevVid").pause(); $("#camReview").classList.add("hidden"); };
$("#camNext").onclick = () => {
  const f = cam.file;
  camClose();
  openPost();
  handleVideoFile(f);
};

// ---------- connect + profile ----------
$("#findBtn").onclick = () => toast("Real voice matching goes live in Stage 7");
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
  toast(on ? "Following @" + uname : "Unfollowed @" + uname);
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
  listUsers = r.data.map((x) => x.p).filter(Boolean);
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
    ${mine ? `<button class="more" data-act="more" aria-label="Delete or more">${icon("more")}</button>` : ""}
    ${isVid ? `<div class="pill"><span class="arr"><i></i><i></i></span><span class="pt">Pull down to lock 2x speed</span></div>` : ""}
    <div class="info">
      <div class="user">@${esc(v.user)}</div>
      ${v.caption && type !== "topic" ? `<p class="cap">${esc(v.caption)}</p>` : ""}
      ${type === "video" ? `<div class="snd">${icon("music")}<span>${esc(v.sound)}</span></div>` : ""}
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
      ${type === "video" ? `<div class="disc" data-act="sound">${icon("music")}</div>` : ""}
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
  if (vid.muted) { MIXO.sound = true; $$("video.vid").forEach((x) => (x.muted = false)); toast("Sound on"); return; }
  if (vid.paused) { vid.play().catch(() => {}); clip.classList.remove("paused"); }
  else { vid.pause(); clip.classList.add("paused"); }
}

$("#feed").addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const clip = el.closest(".clip");
  const v = videos.find((x) => x.id == clip.dataset.id);
  const act = el.dataset.act;

  if (act === "profile") openCreator(v);
  else if (act === "follow") toggleFollow(v.uid, v.user); else if (act === "like") { if (MIXO.user) toggleLike(v.id); else setLike(v, !state.liked.has(v.id)); }
  else if (act === "save") {
    toggleSave(v.id);
  } else if (act === "comment") { if (MIXO.user) openComments(v.id); else toast("Log in to comment"); }
  else if (act === "share") toast("Sharing comes in Stage 4");
  else if (act === "sound") toast("Sound pages come in Stage 4");
  else if (act === "more") deletePost(v.id);
});

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
const socialErr = (err) => /follows/.test(err.message || "") ? "Run mixo_follows.sql in Supabase first." : /parent_id|image_url/.test(err.message || "") ? "Run mixo_comments.sql in Supabase first."
  : /post_(likes|saves|comments)/.test(err.message || "") ? "Run mixo_social.sql in Supabase first." : niceError(err.message);

async function loadSocial() {
  social.likes = new Set(); social.saves = new Set(); social.following = new Set();
  if (!MIXO.user || !sb) return;
  const [l, s, f] = await Promise.all([
    sb.from("post_likes").select("post_id").eq("user_id", MIXO.user.id),
    sb.from("post_saves").select("post_id").eq("user_id", MIXO.user.id),
    sb.from("follows").select("following_id").eq("follower_id", MIXO.user.id),
  ]);
  if (!f.error) social.following = new Set(f.data.map((r) => r.following_id));
  if (!l.error) social.likes = new Set(l.data.map((r) => String(r.post_id)));
  if (!s.error) social.saves = new Set(s.data.map((r) => String(r.post_id)));
}

function normPost(r) {
  const p = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) || {};
  const o = { id: r.id, uid: r.user_id, type: r.type, text: r.caption || "", img: r.media_url, time: r.created_at,
    user: p.username || "user", name: p.display_name || p.username || "User", avatar: p.avatar_url,
    bio: p.bio || "", country: p.country || "", likes: cnt(r.post_likes), comments: cnt(r.post_comments),
    profile: { following: 0, followers: 0, likes: 0 } };
  postCache.set(String(r.id), o);
  return o;
}
const POST_COLS = "id,user_id,type,caption,media_url,created_at,profiles!user_id(username,display_name,avatar_url,bio,country)";
async function fetchPosts(types) {
  let r = await sb.from("posts").select(POST_COLS + ",post_likes(count),post_comments(count)").in("type", types).order("created_at", { ascending: false }).limit(60);
  if (r.error) r = await sb.from("posts").select(POST_COLS).in("type", types).order("created_at", { ascending: false }).limit(60);
  if (r.error) throw r.error;
  return r.data.map(normPost);
}
async function fetchOne(id) {
  let r = await sb.from("posts").select(POST_COLS + ",post_likes(count),post_comments(count)").eq("id", id).maybeSingle();
  if (r.error) r = await sb.from("posts").select(POST_COLS).eq("id", id).maybeSingle();
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
      ${mine ? `<button class="pc-more" data-pa="more" aria-label="Delete or more">${icon("more")}</button>` : ""}
      <div class="pc-h" data-pa="profile"><b>${esc(p.name)}</b><span>@${esc(p.user)} &middot; ${ago(p.time)}</span></div>
      ${p.text ? `<p class="pc-t">${esc(p.text)}</p>` : ""}
      ${p.type === "photo" ? `<img class="pc-img" src="${esc(p.img)}" alt="" loading="lazy">` : ""}
      <div class="pc-a">
        <button data-pa="comment">${icon("comment")}<span>${p.comments ? fmt(p.comments) : ""}</span></button>
        <button data-pa="like" class="${social.likes.has(k) ? "on" : ""}">${icon("heart")}<span>${p.likes ? fmt(p.likes) : ""}</span></button>
        <button data-pa="save" class="${social.saves.has(k) ? "on" : ""}">${icon("save")}</button>
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
  toast(on ? "Saved" : "Removed from saved");
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
  let r = await run(POST_COLS + ",post_likes(count),post_comments(count)");
  if (r.error) r = await run(POST_COLS);
  if (r.error) throw r.error;
  return r.data.map(normPost);
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
  let r = await sb.from("post_comments").select(COM_BASE + ",image_url,parent_id").eq("post_id", comId).order("created_at", { ascending: true });
  if (r.error) r = await sb.from("post_comments").select(COM_BASE).eq("post_id", comId).order("created_at", { ascending: true });
  if (r.error) { comList.innerHTML = `<p class="cmt-empty">${esc(socialErr(r.error))}</p>`; return; }
  if (!r.data.length) { comList.innerHTML = '<p class="cmt-empty">No comments yet. Be the first.</p>'; return; }
  const me = MIXO.user && MIXO.user.id, owner = (postCache.get(String(comId)) || {}).uid;
  const kids = {};
  r.data.filter((c) => c.parent_id).forEach((c) => (kids[c.parent_id] = kids[c.parent_id] || []).push(c));
  const one = (c, topId) => {
    const p = (Array.isArray(c.profiles) ? c.profiles[0] : c.profiles) || {};
    const u = p.username || "user";
    const av = p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(u[0].toUpperCase());
    return `<div class="cmt"><div class="pc-av sm">${av}</div><div class="cb"><b>@${esc(u)}</b><span>${ago(c.created_at)}</span>${c.body ? `<p>${esc(c.body)}</p>` : ""}${c.image_url ? `<img class="cmt-img" src="${esc(c.image_url)}" alt="" loading="lazy">` : ""}<button type="button" class="cmt-rep" data-top="${esc(topId)}" data-user="${esc(u)}">Reply</button>${(c.user_id === me || owner === me) ? `<button type="button" class="cmt-del" data-cid="${esc(c.id)}" data-own="${c.user_id === me ? 1 : 0}" data-img="${esc(c.image_url || "")}" aria-label="Delete comment">${icon("trash")}</button>` : ""}</div></div>`;
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
  else if (a === "more") deletePost(id);
  else if (a === "profile") { const p = postCache.get(id); if (p && !(MIXO.user && p.uid === MIXO.user.id)) { $("#viewSheet").classList.add("hidden"); openCreator(p); } }
}
$("#viewBody").addEventListener("click", cardTap);
$("#viewSheet").onclick = (e) => { if (e.target.id === "viewSheet") $("#viewSheet").classList.add("hidden"); };
async function openPostView(id) {
  try {
    const p = await fetchOne(id);
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
  toast("Post deleted");
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
  const p = postCache.get(String(comId));
  const c = await sb.from("post_comments").select("id", { count: "exact", head: true }).eq("post_id", comId);
  if (p && !c.error && typeof c.count === "number") { p.comments = c.count; paintPost(comId); }
  toast("Comment deleted");
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
const videoTile = (p) => `<div class="pt" data-id="${esc(p.id)}" data-type="video"><video src="${esc(p.img)}#t=0.1" muted playsinline preload="metadata"></video>${MIXO.user && p.uid === MIXO.user.id ? `<button class="pt-more" data-pt="more" aria-label="Delete or more">${icon("more")}</button>` : ""}</div>`;
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
  go("home");
  const c = $(`.clip[data-id="${t.dataset.id}"]`);
  if (c) c.scrollIntoView(); else toast("Open it from the feed");
});

// ============ INBOX: real messages, instant delivery, message requests ============
const inbox = { convs: [], profiles: new Map(), unread: new Map(), tab: "msg", loaded: false, error: "" };
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
  const [cr, ur] = await Promise.all([
    sb.from("conversations").select("*").order("last_message_at", { ascending: false }).limit(100),
    sb.from("messages").select("conversation_id").is("read_at", null).neq("sender_id", meId()).limit(1000),
  ]);
  if (cr.error) { inbox.error = inboxErr(cr.error); return renderInbox(); }
  inbox.error = "";
  inbox.convs = cr.data || [];
  inbox.unread = new Map();
  (ur.data || []).forEach((r) => inbox.unread.set(r.conversation_id, (inbox.unread.get(r.conversation_id) || 0) + 1));
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
    const prev = (c.last_sender === meId() ? "You: " : "") + (c.last_message || "");
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
async function openChat(user) {
  if (!sb || !MIXO.user) return toast("Log in with a real account to send messages.");
  if (!user || user.id === meId()) return;
  if (!inbox.loaded) await refreshInbox();
  inbox.profiles.set(user.id, { ...(inbox.profiles.get(user.id) || {}), ...user });
  chat.uid = user.id;
  chat.user = inbox.profiles.get(user.id);
  chat.conv = inbox.convs.find((c) => otherOf(c) === user.id) || null;
  chat.msgs = [];
  chat.open = true;
  $("#chatName").textContent = chat.user.display_name || chat.user.username || "User";
  $("#chatUser").textContent = "@" + (chat.user.username || "user");
  setAv($("#chatAv"), chat.user.avatar_url, chat.user.username);
  $("#chatInput").value = "";
  autoGrow();
  $("#chat").classList.remove("hidden");
  renderChat(true);
  fitChat();
  await loadChatMsgs();
}
function closeChat() {
  chat.open = false; chat.uid = null; chat.conv = null; chat.msgs = [];
  $("#chat").classList.add("hidden");
  $("#chatInput").blur();
  refreshInboxSoon();
}
async function loadChatMsgs() {
  if (!chat.conv) return;
  const id = chat.conv.id;
  const r = await sb.from("messages").select("*").eq("conversation_id", id).order("created_at", { ascending: false }).limit(100);
  if (!chat.open || !chat.conv || chat.conv.id !== id) return;
  if (r.error) return toast(inboxErr(r.error));
  chat.msgs = (r.data || []).reverse();
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

function renderChat(stick) {
  const body = $("#chatBody");
  const near = body.scrollHeight - body.scrollTop - body.clientHeight < 90;
  const me = meId();
  const t = (d) => new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  let html = "";
  chat.msgs.forEach((m, i) => {
    const mine = m.sender_id === me, next = chat.msgs[i + 1];
    html += `<div class="bub ${mine ? "me" : "them"}">${esc(m.body)}</div>`;
    if (!next || next.sender_id !== m.sender_id || new Date(next.created_at) - new Date(m.created_at) > 300000) {
      html += `<div class="bmeta ${mine ? "me" : "them"}">${mine && !next && m.read_at ? "Seen" : t(m.created_at)}</div>`;
    }
  });
  if (!chat.msgs.length) {
    const c = chat.conv, who = esc((chat.user && chat.user.username) || "them");
    html = `<p class="hint c">${c && isReq(c) ? "Loading..." : `Say hello to @${who}.<br>If they don't follow you, it goes to their message requests.`}</p>`;
  }
  body.innerHTML = html;
  if (stick || near) body.scrollTop = body.scrollHeight;

  const c = chat.conv;
  const incoming = !!(c && isReq(c));
  const locked = !!(c && c.initiator === me && c.status !== "accepted" && chat.msgs.some((m) => m.sender_id === me));
  $("#chatReq").classList.toggle("hidden", !incoming);
  $("#chatLock").classList.toggle("hidden", !locked);
  $("#chatForm").classList.toggle("hidden", incoming || locked);
}

$("#chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const inp = $("#chatInput"), text = inp.value.trim();
  if (!text || chat.sending || !chat.uid) return;
  chat.sending = true; inp.value = ""; autoGrow();
  const { data, error } = await sb.rpc("send_message", { p_to: chat.uid, p_body: text });
  chat.sending = false;
  if (error) { inp.value = text; autoGrow(); return toast(inboxErr(error)); }
  if (chat.open) {
    addMsg(data);
    await refreshInbox();
    if (chat.open) { chat.conv = inbox.convs.find((c) => c.id === data.conversation_id) || chat.conv; renderChat(true); }
  }
});
$("#chatSend").addEventListener("pointerdown", (e) => e.preventDefault()); // keeps the keyboard open
$("#chatBack").onclick = closeChat;
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
  if (ok) { toast("Request accepted"); loadChatMsgs(); }
  else { closeChat(); toast("Request rejected"); }
}
$("#chatAccept").onclick = () => answerReq(true);
$("#chatReject").onclick = () => answerReq(false);

const autoGrow = () => { const t = $("#chatInput"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; };
$("#chatInput").addEventListener("input", autoGrow);

// keep the input above the phone keyboard
function fitChat() {
  const vv = window.visualViewport;
  if (!vv || !chat.open) return;
  const c = $("#chat");
  c.style.height = vv.height + "px";
  c.style.top = vv.offsetTop + "px";
  const b = $("#chatBody");
  b.scrollTop = b.scrollHeight;
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

// ----- instant delivery (Supabase Realtime), with a slow fallback if it ever drops -----
async function onMsgEvent(p) {
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
      addMsg(m);
      if (m.sender_id !== meId()) markRead();
    }
  }
  refreshInboxSoon();
}
function startInbox() {
  if (!sb || !MIXO.user || rtChannel) return;
  refreshInbox();
  rtChannel = sb.channel("inbox-" + meId())
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, onMsgEvent)
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, refreshInboxSoon)
    .subscribe((s) => { rtOK = s === "SUBSCRIBED"; });
  pollTimer = setInterval(() => {
    if (rtOK || document.hidden) return;
    refreshInbox();
    if (chat.open) loadChatMsgs();
  }, 8000);
}
function stopInbox() {
  if (rtChannel && sb) sb.removeChannel(rtChannel);
  rtChannel = null; rtOK = false;
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