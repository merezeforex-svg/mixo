// ============ MIXO frontend (Stage 3 - Part A: real video posts) ============
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

function fillProfile() {
  const p = MIXO.profile || {};
  const name = p.display_name || p.username || "Your name";
  paintAvatar($("#pAvatar"), p, p.display_name || p.username);
  $("#pName").textContent = name;
  $("#pUser").textContent = p.username ? "@" + p.username : "@username";
  $("#pBio").textContent = p.bio || "Add a bio";
  $("#pBio").classList.toggle("hint", !p.bio);
  $("#pCountry").textContent = p.country || "Add your location";
  $("#pCountry").classList.toggle("hint", !p.country);
  const bi = $("#pBannerImg");
  if (p.banner_url) { bi.src = p.banner_url; bi.classList.remove("hidden"); $("#pBanner").classList.add("custom"); }
  else { bi.classList.add("hidden"); $("#pBanner").classList.remove("custom"); }
}

function enterApp() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  fillProfile();
  loadSocial().finally(() => { renderFeed(); loadMyPosts(); });
}
$("#previewBtn").onclick = enterApp;

$("#logoutBtn").onclick = async () => {
  if (sb) await sb.auth.signOut();
  pauseAll();
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
const social = { likes: new Set(), saves: new Set() };
let pendingSound = null; // a sound picked with "Use sound"

function go(page) {
  $$(".page").forEach((p) => p.classList.toggle("on", p.id === page));
  $$("#nav [data-page]").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
  if (page === "home") resumeCurrent();
  else pauseAll();
  if (page === "profile") loadMyPosts();
  if (page === "explore") loadExplore();
}
$$("#nav [data-page]").forEach((b) => (b.onclick = () => go(b.dataset.page)));

$$(".page .seg").forEach((seg) => {
  seg.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    $$("button", seg).forEach((b) => b.classList.toggle("on", b === e.target));
  });
});

// ---------- create sheet ----------
$("#createBtn").onclick = () => openCamera();
$("#sheet").onclick = (e) => {
  if (e.target.id === "sheet") $("#sheet").classList.add("hidden");
  const opt = e.target.closest(".opt");
  if (opt) {
    $("#sheet").classList.add("hidden");
    if (opt.dataset.kind === "video") openPost();
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
  paintSoundChips();
}
function closePost() {
  if (uploading) return;
  postSheet.classList.add("hidden");
  resetPost();
  pendingSound = null;
  paintSoundChips();
}
$("#postCancel").onclick = closePost;
postSheet.onclick = (e) => { if (e.target.id === "postSheet") closePost(); };
$("#postPick").onclick = () => $("#postFile").click();

$("#postFile").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  postMsg.textContent = "";
  if (file.size > MAX_MB * 1048576) { postMsg.textContent = "That video is over " + MAX_MB + " MB. Pick a shorter one."; return; }
  const url = URL.createObjectURL(file);
  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.onloadedmetadata = () => {
    const d = probe.duration;
    URL.revokeObjectURL(url);
    if (d > MAX_SECONDS + 0.5) { postMsg.textContent = "Videos can be up to " + MAX_SECONDS + " seconds. Yours is " + Math.round(d) + "s."; return; }
    picked = file;
    if (postVid.src) URL.revokeObjectURL(postVid.src);
    postVid.src = URL.createObjectURL(file);
    postVid.classList.remove("hidden");
    $("#postPick").classList.add("has");
    postVid.play().catch(() => {});
  };
  probe.onerror = () => { URL.revokeObjectURL(url); postMsg.textContent = "Couldn't read that video. Try an MP4."; };
  probe.src = url;
};

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
    const row = { user_id: MIXO.user.id, type: "video", caption: e.target.caption.value.trim(), media_url: url };
    if (pendingSound) row.sound_id = pendingSound.id;
    const ins = await sb.from("posts").insert(row);
    if (ins.error) { await sb.storage.from("videos").remove([path]); throw ins.error; }
    uploading = false;
    closePost();
    go("home");
    await renderFeed();
    toast("Posted!");
    loadMyPosts();
  } catch (err) {
    postMsg.textContent = socialErr(err);
  } finally {
    uploading = false;
    btn.disabled = false;
  }
});

// ---------- connect + profile ----------
$("#findBtn").onclick = () => toast("Real voice matching goes live in Stage 7");
// ---------- edit profile ----------
const COUNTRIES = ["Afghanistan","Algeria","Argentina","Australia","Austria","Bangladesh","Belgium","Brazil","Cameroon","Canada","Chile","China","Colombia","Czechia","Denmark","Egypt","Ethiopia","Finland","France","Germany","Ghana","Greece","Hungary","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Japan","Jordan","Kenya","Lebanon","Malaysia","Mexico","Morocco","Nepal","Netherlands","New Zealand","Nigeria","Norway","Pakistan","Peru","Philippines","Poland","Portugal","Romania","Russia","Saudi Arabia","Senegal","Singapore","Somalia","South Africa","South Korea","Spain","Sri Lanka","Sudan","Sweden","Switzerland","Syria","Tanzania","Thailand","Tunisia","Turkey","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Venezuela","Vietnam","Yemen","Zimbabwe"];
$("#countries").innerHTML = COUNTRIES.map((c) => `<option value="${c}">`).join("");

function openEdit() {
  if (!MIXO.user) return toast("Log in with your account to edit your profile");
  const p = MIXO.profile || {};
  const f = $("#editForm");
  f.display_name.value = p.display_name || "";
  f.bio.value = p.bio || "";
  f.country.value = p.country || "";
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
    const { data, error } = await sb.from("profiles")
      .update({ display_name, bio: f.bio.value.trim(), country: f.country.value.trim() || null })
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
function setFollow(user, on) {
  on ? state.following.add(user) : state.following.delete(user);
  $$(`.creator[data-user="${user}"]`).forEach((c) => {
    c.classList.toggle("following", on);
    const p = $(".plus", c);
    p.innerHTML = icon(on ? "check" : "plus");
    p.classList.remove("pop");
    void p.offsetWidth;
    p.classList.add("pop");
  });
  const cf = $("#cFollow");
  if (cf.dataset.user === user) {
    cf.textContent = on ? "Following" : "Follow";
    cf.classList.toggle("is-on", on);
  }
}

function setLike(v, on) {
  on ? state.liked.add(v.id) : state.liked.delete(v.id);
  const b = $(`.clip[data-id="${v.id}"] [data-act="like"]`);
  if (!b) return;
  b.classList.toggle("on", on);
  $(".n", b).textContent = fmt(v.likes + (on ? 1 : 0));
}

// ---------- creator profile page ----------
function openCreator(v) {
  state.prev = $(".page.on")?.id || "home";
  setAv($("#cAvatar"), v.avatar, v.user);
  $("#cName").textContent = v.name;
  $("#cUser").textContent = "@" + v.user;
  $("#cFollowing").textContent = fmt(v.profile.following);
  $("#cFollowers").textContent = fmt(v.profile.followers);
  $("#cLikes").textContent = fmt(v.profile.likes);
  $("#cBio").textContent = v.bio;
  $("#cCountry").textContent = v.country || "Not set";
  $("#cFollow").dataset.user = v.user;
  setFollow(v.user, state.following.has(v.user));
  go("creator");
}
$("#backBtn").onclick = () => go(state.prev || "home");
$("#cMsg").onclick = () => toast("Messages come in Stage 5");
$("#cFollow").onclick = (e) => {
  const u = e.target.dataset.user;
  setFollow(u, !state.following.has(u));
};

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
  const fol = state.following.has(v.user);
  const liked = state.liked.has(v.id);
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
    ${isVid ? `<div class="pill"><span class="arr"><i></i><i></i></span><span class="pt">Pull down to lock 2x speed</span></div>` : ""}
    <div class="info">
      <div class="user">@${esc(v.user)}</div>
      ${v.caption && type !== "topic" ? `<p class="cap">${esc(v.caption)}</p>` : ""}
      ${type === "video" ? `<div class="snd" data-act="sound">${icon("music")}<span>${esc(v.sound)}</span></div>` : ""}
    </div>
    <div class="rail">
      <div class="creator ${fol ? "following" : ""}" data-user="${esc(v.user)}">
        <div class="av" data-act="profile" role="button" aria-label="Open profile">${av}</div>
        <button class="plus" data-act="follow" aria-label="Follow">${icon(fol ? "check" : "plus")}</button>
      </div>
      <button data-act="like" class="${liked ? "on" : ""}">${icon("heart")}<span class="n">${fmt(v.likes + (liked ? 1 : 0))}</span></button>
      <button data-act="comment">${icon("comment")}<span>${fmt(v.comments)}</span></button>
      <button data-act="save" class="${social.saves.has(String(v.id)) ? "on" : ""}">${icon("save")}<span>Save</span></button>
      <button data-act="share">${icon("share")}<span>Share</span></button>
      ${MIXO.user && v.uid === MIXO.user.id ? `<button data-act="delete">${icon("trash")}<span>Delete</span></button>` : ""}
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
    const FC = "id,user_id,type,caption,media_url,created_at,profiles!user_id(username,display_name,avatar_url,bio,country)";
    const qf = (cols) => sb.from("posts").select(cols).eq("type", "video").order("created_at", { ascending: false }).limit(30);
    let { data, error } = await qf(FC + ",sound_id");
    if (error) ({ data, error } = await qf(FC));
    if (error) throw error;
    const roots = {};
    const rids = [...new Set((data || []).map((r) => r.sound_id).filter(Boolean))];
    if (rids.length) {
      const rr = await sb.from("posts").select("id,media_url,profiles!user_id(username)").in("id", rids);
      (rr.data || []).forEach((x) => { const pp = Array.isArray(x.profiles) ? x.profiles[0] : x.profiles; roots[String(x.id)] = { src: x.media_url, user: (pp && pp.username) || "user" }; });
    }
    videos = (data || []).map((r) => {
      const p = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) || {};
      return { id: r.id, uid: r.user_id, type: r.type || "video", src: r.media_url, user: p.username || "user", name: p.display_name || p.username || "User",
        avatar: p.avatar_url, caption: r.caption || "", soundId: roots[String(r.sound_id)] ? r.sound_id : null, soundSrc: roots[String(r.sound_id)] ? roots[String(r.sound_id)].src : null,
        sound: roots[String(r.sound_id)] ? "Original sound \u00b7 @" + roots[String(r.sound_id)].user : "Original sound", likes: 0, comments: 0,
        bio: p.bio || "", country: p.country || "", profile: { following: 0, followers: 0, likes: 0 } };
    });
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

// one shared audio player for borrowed sounds
const SND = new Audio(); SND.loop = true; SND.preload = "auto";
const setSnd = (url) => { if (SND.src !== url) SND.src = url; };
const svOf = (vid) => videos.find((x) => x.id == vid.closest(".clip").dataset.id);
function startClip(vid) {
  const sv = svOf(vid);
  if (sv && sv.soundSrc) {
    vid.muted = true;
    setSnd(sv.soundSrc);
    try { SND.currentTime = 0; } catch (err) {}
    SND.muted = !MIXO.sound; SND.playbackRate = 1;
    SND.play().catch(() => {});
  } else { vid.muted = !MIXO.sound; SND.pause(); }
  vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
}
function resumeCurrent() {
  const vid = MIXO.current;
  if (!vid) return;
  vid.play().catch(() => {});
  const sv = svOf(vid);
  if (sv && sv.soundSrc) SND.play().catch(() => {});
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
        vid.closest(".clip").classList.remove("paused");
        startClip(vid);
      } else {
        vid.pause();
        if (MIXO.current === vid || !MIXO.current) SND.pause();
        vid.currentTime = 0;
        endHold(vid.closest(".clip"));
      }
    });
  }, { root: $("#feed"), threshold: 0.7 });
  $$("#feed video.vid").forEach((v) => {
    v.playsInline = true; v.setAttribute("playsinline", ""); io.observe(v);
    v.addEventListener("timeupdate", () => { // video looped: restart its borrowed sound too
      if (v.currentTime + 0.4 < (v._lt || 0) && MIXO.current === v) { const sv = svOf(v); if (sv && sv.soundSrc) { try { SND.currentTime = 0; } catch (err) {} } }
      v._lt = v.currentTime;
    });
  });
}
function pauseAll() { $$("video.vid").forEach((v) => v.pause()); SND.pause(); }
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseAll(); else if ($("#home").classList.contains("on")) resumeCurrent(); });

// tap video: first tap turns sound on, later taps pause / play
function tapVideo(clip) {
  const vid = $("video.vid", clip);
  if (!vid) return;
  const sv = svOf(vid), borrowed = !!(sv && sv.soundSrc);
  if (!MIXO.sound) {
    MIXO.sound = true;
    $$("video.vid").forEach((x) => { const s = svOf(x); x.muted = !!(s && s.soundSrc); });
    SND.muted = false;
    toast("Sound on");
    return;
  }
  if (vid.paused) { vid.play().catch(() => {}); if (borrowed) SND.play().catch(() => {}); clip.classList.remove("paused"); }
  else { vid.pause(); if (borrowed) SND.pause(); clip.classList.add("paused"); }
}

$("#feed").addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const clip = el.closest(".clip");
  const v = videos.find((x) => x.id == clip.dataset.id);
  const act = el.dataset.act;

  if (act === "profile") openCreator(v);
  else if (act === "follow") {
    const on = !state.following.has(v.user);
    setFollow(v.user, on);
    toast(on ? "Following @" + v.user : "Unfollowed @" + v.user);
  } else if (act === "like") setLike(v, !state.liked.has(v.id));
  else if (act === "save") {
    toggleSave(v.id);
  } else if (act === "comment") toast("Comments come in Stage 4");
  else if (act === "share") toast("Sharing comes in Stage 4");
  else if (act === "delete") deletePost(v.id);
  else if (act === "sound") openSound(v.soundId || v.id);
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
    if (!state.liked.has(v.id)) setLike(v, true);
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
function speed(c, r) { const v = hVid(c); if (v) { v.playbackRate = r; if (v === MIXO.current) SND.playbackRate = r; } }
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
const socialErr = (err) => /sound_id/.test(err.message || "") ? "Run mixo_sounds.sql in Supabase first." : /parent_id|image_url/.test(err.message || "") ? "Run mixo_comments.sql in Supabase first."
  : /post_(likes|saves|comments)/.test(err.message || "") ? "Run mixo_social.sql in Supabase first." : niceError(err.message);

async function loadSocial() {
  social.likes = new Set(); social.saves = new Set();
  if (!MIXO.user || !sb) return;
  const [l, s] = await Promise.all([
    sb.from("post_likes").select("post_id").eq("user_id", MIXO.user.id),
    sb.from("post_saves").select("post_id").eq("user_id", MIXO.user.id),
  ]);
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
  const k = String(p.id), own = MIXO.user && p.uid === MIXO.user.id;
  const av = p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : esc((p.user || "U")[0].toUpperCase());
  return `<article class="pc" data-id="${esc(k)}">
    <div class="pc-av" data-pa="profile">${av}</div>
    <div class="pc-main">
      ${own ? `<button class="pc-del" data-pa="delete" aria-label="Delete post">${icon("trash")}</button>` : ""}
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
  { const pp = postCache.get(String(comId)); if (pp) { pp.comments = r.data.length; paintPost(comId); } }
  if (!r.data.length) { comList.innerHTML = '<p class="cmt-empty">No comments yet. Be the first.</p>'; return; }
  const kids = {};
  r.data.filter((c) => c.parent_id).forEach((c) => (kids[c.parent_id] = kids[c.parent_id] || []).push(c));
  const one = (c, topId) => {
    const p = (Array.isArray(c.profiles) ? c.profiles[0] : c.profiles) || {};
    const u = p.username || "user";
    const av = p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="">` : esc(u[0].toUpperCase());
    return `<div class="cmt"><div class="pc-av sm">${av}</div><div class="cb"><b>@${esc(u)}</b><span>${ago(c.created_at)}</span>${c.body ? `<p>${esc(c.body)}</p>` : ""}${c.image_url ? `<img class="cmt-img" src="${esc(c.image_url)}" alt="" loading="lazy">` : ""}<div class="cmt-acts"><button type="button" class="cmt-rep" data-top="${esc(topId)}" data-user="${esc(u)}">Reply</button>${MIXO.user && c.user_id === MIXO.user.id ? `<button type="button" class="cmt-del" data-cid="${esc(c.id)}" data-img="${esc(c.image_url || "")}">Delete</button>` : ""}</div></div></div>`;
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
  const b = e.target.closest(".cmt-rep");
  if (b) { setReply(b.dataset.top, b.dataset.user); return; }
  const d = e.target.closest(".cmt-del");
  if (d) deleteComment(d.dataset.cid, d.dataset.img);
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
  else if (a === "delete") deletePost(id);
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
const videoTile = (p) => `<div class="pt" data-id="${esc(p.id)}" data-type="video"><video src="${esc(p.img)}#t=0.1" muted playsinline preload="metadata"></video>${MIXO.user && p.uid === MIXO.user.id ? `<button class="tile-del" data-del="${esc(p.id)}" aria-label="Delete">${icon("trash")}</button>` : ""}</div>`;
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
  const d = e.target.closest(".tile-del");
  if (d) { deletePost(d.dataset.del); return; }
  if (e.target.closest(".pc")) return cardTap(e);
  const t = e.target.closest(".pt");
  if (!t) return;
  go("home");
  const c = $(`.clip[data-id="${t.dataset.id}"]`);
  if (c) c.scrollIntoView(); else toast("Open it from the feed");
});


// ---------- delete posts + comments ----------
function confirmBox(title, text) {
  return new Promise((res) => {
    const sh = $("#confirmSheet");
    $("#cfTitle").textContent = title; $("#cfText").textContent = text;
    sh.classList.remove("hidden");
    const done = (v) => { sh.classList.add("hidden"); res(v); };
    $("#cfYes").onclick = () => done(true);
    $("#cfNo").onclick = () => done(false);
    sh.onclick = (e) => { if (e.target.id === "confirmSheet") done(false); };
  });
}
function removeFile(url) {
  const m = String(url || "").match(/\/object\/public\/([^/]+)\/(.+)$/);
  if (m) sb.storage.from(m[1]).remove([decodeURIComponent(m[2].split("?")[0])]).catch(() => {});
}
async function deletePost(id) {
  if (!MIXO.user || !sb) return;
  if (!(await confirmBox("Delete this post?", "It will be removed for good, along with its likes and comments."))) return;
  try {
    const r = await sb.from("posts").delete().eq("id", id).eq("user_id", MIXO.user.id).select("id,type,media_url");
    if (r.error) throw r.error;
    if (!r.data || !r.data.length) throw new Error("Not allowed. Run mixo_delete.sql in Supabase first.");
    removeFile(r.data[0].media_url);
    const k = String(id);
    postCache.delete(k); social.likes.delete(k); social.saves.delete(k);
    $$(`.pc[data-id="${k}"]`).forEach((c) => c.remove());
    $("#viewSheet").classList.add("hidden");
    if (r.data[0].type === "video") renderFeed();
    loadMyPosts();
    if ($("#explore").classList.contains("on")) loadExplore();
    toast("Deleted");
  } catch (err) { toast(socialErr(err)); }
}
async function deleteComment(cid, img) {
  if (!(await confirmBox("Delete this comment?", "Any replies to it will be deleted too."))) return;
  try {
    const r = await sb.from("post_comments").delete().eq("id", cid).eq("user_id", MIXO.user.id).select("id");
    if (r.error) throw r.error;
    if (!r.data || !r.data.length) throw new Error("Couldn't delete that comment.");
    removeFile(img);
    loadComments();
  } catch (err) { toast(socialErr(err)); }
}

// ---------- camera-first posting ----------
const cam = { stream: null, rec: null, chunks: [], mode: "15", facing: "environment", delay: 0, torch: false, t0: 0, raf: 0, busy: false, discard: false };
const camEl = $("#cam"), camVid = $("#camVid"), camRing = $("#camRing"), CIRC = 2 * Math.PI * 38;
camRing.style.strokeDasharray = CIRC; camRing.style.strokeDashoffset = CIRC;
const CAM_MAX = { "15": 15, "30": 30 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const camOpen = () => !camEl.classList.contains("hidden");

function openCamera() {
  if (!MIXO.user) return toast("Log in with your account to post");
  pauseAll();
  camEl.classList.remove("hidden");
  setCamMode(cam.mode === "text" ? "15" : cam.mode);
  startStream();
}
function closeCamera() {
  if (cam.rec) { cam.discard = true; stopRec(); }
  stopStream();
  camEl.classList.add("hidden");
  $("#camCount").classList.add("hidden");
  if ($("#home").classList.contains("on")) resumeCurrent();
}
function stopStream() {
  if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
  cam.stream = null; camVid.srcObject = null;
}
function camFallback(text) {
  stopStream();
  const m = $("#camMsg");
  m.textContent = text;
  m.classList.remove("hidden");
}
async function startStream() {
  stopStream();
  $("#camMsg").classList.add("hidden");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    return camFallback("Live camera isn't available here. Tap the big button to use your phone camera, or pick from your library.");
  const v = { facingMode: cam.facing, width: { ideal: 1080 }, height: { ideal: 1920 } };
  try {
    try { cam.stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: !pendingSound }); }
    catch (e1) { cam.stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); }
    if (!camOpen()) { stopStream(); return; }
    camVid.srcObject = cam.stream;
    camVid.classList.toggle("mirror", cam.facing === "user");
    camVid.play().catch(() => {});
  } catch (err) {
    camFallback("Camera access is blocked. Allow the camera for this site, or tap the big button to use your phone camera.");
  }
}
function setCamMode(m) {
  if (m === "text") { closeCamera(); openTopic(); return; }
  cam.mode = m;
  $$("#camModes button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  const photo = m === "photo";
  $("#camShutter").classList.toggle("photo", photo);
  $("#camPick").accept = photo ? "image/*" : "video/*";
  $("#camShot").accept = photo ? "image/*" : "video/*";
}
$$("#camModes button").forEach((b) => b.addEventListener("click", () => { if (!cam.rec) setCamMode(b.dataset.m); }));
$("#camClose").onclick = () => { pendingSound = null; paintSoundChips(); closeCamera(); };
$("#camSound").onclick = () => { pendingSound = null; paintSoundChips(); toast("Sound removed"); if (camOpen()) startStream(); };
$("#camFlip").onclick = () => { if (cam.rec || cam.busy) return; cam.facing = cam.facing === "user" ? "environment" : "user"; cam.torch = false; $("#camFlash").classList.remove("on"); startStream(); };
$("#camFlash").onclick = async () => {
  const tr = cam.stream && cam.stream.getVideoTracks()[0];
  const caps = tr && tr.getCapabilities ? tr.getCapabilities() : {};
  if (!caps.torch) return toast("Flash isn't available on this camera");
  cam.torch = !cam.torch;
  await tr.applyConstraints({ advanced: [{ torch: cam.torch }] }).catch(() => {});
  $("#camFlash").classList.toggle("on", cam.torch);
};
$("#camTimer").onclick = () => { cam.delay = cam.delay ? 0 : 3; $("#camTimer").classList.toggle("on", !!cam.delay); toast(cam.delay ? "3 second timer on" : "Timer off"); };
$("#camGallery").onclick = () => $("#camPick").click();

function feedInput(input, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
}
function finishCapture(file) {
  closeCamera();
  const isVid = /^video/.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
  if (isVid) { openPost(); feedInput($("#postFile"), file); }
  else { openPhoto(); feedInput($("#photoFile"), file); }
}
["camPick", "camShot"].forEach((id) => { $("#" + id).onchange = (e) => { const f = e.target.files[0]; if (f) finishCapture(f); }; });

$("#camShutter").onclick = async () => {
  if (cam.busy) return;
  if (!cam.stream) { $("#camShot").click(); return; }
  if (cam.rec) { stopRec(); return; }
  if (cam.delay) {
    cam.busy = true;
    const c = $("#camCount");
    for (let n = cam.delay; n > 0 && camOpen(); n--) { c.textContent = n; c.classList.remove("hidden"); await sleep(1000); }
    c.classList.add("hidden");
    cam.busy = false;
    if (!camOpen()) return;
  }
  cam.mode === "photo" ? snap() : startRec();
};
function snap() {
  const w = camVid.videoWidth, h = camVid.videoHeight;
  if (!w) return toast("Camera isn't ready yet");
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const x = cv.getContext("2d");
  if (cam.facing === "user") { x.translate(w, 0); x.scale(-1, 1); }
  x.drawImage(camVid, 0, 0, w, h);
  cv.toBlob((b) => { if (b) finishCapture(new File([b], "photo.jpg", { type: "image/jpeg" })); }, "image/jpeg", 0.9);
}
function startRec() {
  if (!window.MediaRecorder) return toast("Recording isn't supported here. Use the library button.");
  const types = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const type = types.find((t) => MediaRecorder.isTypeSupported(t));
  cam.chunks = [];
  try { cam.rec = new MediaRecorder(cam.stream, type ? { mimeType: type } : undefined); }
  catch (err) { cam.rec = null; return toast("Couldn't start recording on this device."); }
  cam.rec.ondataavailable = (e) => { if (e.data && e.data.size) cam.chunks.push(e.data); };
  cam.rec.onstop = () => {
    cancelAnimationFrame(cam.raf);
    const t = (cam.rec && cam.rec.mimeType) || type || "video/mp4";
    const blob = new Blob(cam.chunks, { type: t });
    cam.rec = null;
    if (pendingSound) SND.pause();
    $("#camShutter").classList.remove("rec");
    $("#camRec").classList.add("hidden");
    camRing.style.strokeDashoffset = CIRC;
    if (cam.discard) { cam.discard = false; return; }
    const ext = t.includes("mp4") ? "mp4" : "webm";
    finishCapture(new File([blob], "clip." + ext, { type: t.split(";")[0] }));
  };
  cam.rec.start(250);
  if (pendingSound) { setSnd(pendingSound.url); try { SND.currentTime = 0; } catch (err) {} SND.muted = false; SND.playbackRate = 1; SND.play().catch(() => {}); }
  cam.t0 = performance.now();
  $("#camShutter").classList.add("rec");
  $("#camRec").classList.remove("hidden");
  const max = CAM_MAX[cam.mode] || 15;
  const tick = () => {
    const el = (performance.now() - cam.t0) / 1000;
    camRing.style.strokeDashoffset = CIRC * (1 - Math.min(el / max, 1));
    $("#camRec").textContent = "0:" + String(Math.floor(el)).padStart(2, "0");
    if (el >= max) stopRec(); else cam.raf = requestAnimationFrame(tick);
  };
  tick();
}
function stopRec() { if (cam.rec && cam.rec.state !== "inactive") cam.rec.stop(); }
document.addEventListener("visibilitychange", () => { if (document.hidden && camOpen()) closeCamera(); });


// ---------- sound pages: tap the disc, use someone's sound ----------
function paintSoundChips() {
  const t = pendingSound ? "Original sound \u00b7 @" + pendingSound.user : "";
  $("#camSound").classList.toggle("hidden", !pendingSound);
  $("#camSound span").textContent = t;
  $("#postSound").classList.toggle("hidden", !pendingSound);
  $("#postSound span").textContent = pendingSound ? "Using sound: " + t : "";
}
$("#postSound button").onclick = () => { pendingSound = null; paintSoundChips(); };

const spEl = $("#soundPage");
let spRoot = null, spPosts = new Map(), spPlaying = false;
const profOf = (x) => (Array.isArray(x.profiles) ? x.profiles[0] : x.profiles) || {};
function spPlay(on) {
  spPlaying = !!(on && spRoot);
  if (spPlaying) { setSnd(spRoot.url); try { SND.currentTime = 0; } catch (err) {} SND.muted = false; SND.playbackRate = 1; SND.play().catch(() => {}); }
  else SND.pause();
  $("#spPlayBtn use").setAttribute("href", spPlaying ? "#i-pause" : "#i-play");
  $("#spPreview use").setAttribute("href", spPlaying ? "#i-pause" : "#i-play");
  $("#spPreview span").textContent = spPlaying ? "Pause" : "Play sound";
}
function paintSpSave() {
  const on = spRoot && social.saves.has(String(spRoot.id));
  $("#spSave").classList.toggle("on", !!on);
  $("#spSave span").textContent = on ? "Saved" : "Save";
}
function spTile(p, orig, wide) {
  const u = esc(p.media_url);
  return `<div class="sp-tile${wide ? " wide" : ""}" data-id="${esc(p.id)}"><div class="sp-in"><video class="sp-bg" src="${u}#t=0.1" muted playsinline preload="metadata"></video><video class="sp-fg" src="${u}#t=0.1" muted playsinline preload="metadata"></video>${orig ? '<span class="sp-badge">Original</span>' : ""}</div></div>`;
}
async function openSound(rootId) {
  if (!sb || !MIXO.user) return toast("Log in to open sounds");
  pauseAll();
  spRoot = null;
  spEl.classList.remove("hidden");
  spPlay(false);
  $("#spGrid").innerHTML = '<p class="sp-empty">Loading...</p>';
  try {
    const cols = "id,user_id,media_url,created_at,profiles!user_id(username,display_name,avatar_url)";
    const rr = await sb.from("posts").select(cols).eq("id", rootId).maybeSingle();
    if (rr.error || !rr.data) throw rr.error || new Error("This sound isn't available anymore.");
    let list = [];
    const ur = await sb.from("posts").select(cols + ",sound_id").eq("sound_id", rootId).order("created_at", { ascending: false }).limit(40);
    if (!ur.error) list = ur.data;
    const rp = profOf(rr.data);
    spRoot = { id: rr.data.id, url: rr.data.media_url, uid: rr.data.user_id, user: rp.username || "user", name: rp.display_name || rp.username || "User", avatar: rp.avatar_url };
    spPosts = new Map([[String(rr.data.id), { ...rr.data, isRoot: true }]]);
    list.forEach((x) => spPosts.set(String(x.id), x));
    const all = [rr.data, ...list];
    $("#spCount").textContent = all.length + (all.length === 1 ? " post" : " posts");
    $("#spUser span").textContent = "@" + spRoot.user;
    $("#spAv").innerHTML = spRoot.avatar ? `<img src="${esc(spRoot.avatar)}" alt="">` : esc(spRoot.user[0].toUpperCase());
    paintSpSave();
    $("#spGrid").innerHTML = all.map((p, i) => spTile(p, i === 0, all.length % 2 === 1 && i === all.length - 1)).join("");
  } catch (err) { $("#spGrid").innerHTML = `<p class="sp-empty">${esc(socialErr(err))}</p>`; }
}
function closeSound() {
  spPlay(false);
  closeVideoView();
  spEl.classList.add("hidden");
  if ($("#home").classList.contains("on")) resumeCurrent();
}
$("#spBack").onclick = closeSound;
$("#spPlayBtn").onclick = () => spPlay(!spPlaying);
$("#spPreview").onclick = () => spPlay(!spPlaying);
$("#spSave").onclick = () => { if (!spRoot) return; toggleSave(spRoot.id); paintSpSave(); };
$("#spUser").onclick = () => {
  if (!spRoot) return;
  const o = { id: spRoot.id, uid: spRoot.uid, user: spRoot.user, name: spRoot.name, avatar: spRoot.avatar, bio: "", country: "", profile: { following: 0, followers: 0, likes: 0 } };
  closeSound();
  openCreator(o);
};
$("#spUse").onclick = () => {
  if (!spRoot) return;
  pendingSound = { id: spRoot.id, url: spRoot.url, user: spRoot.user };
  spPlay(false);
  spEl.classList.add("hidden");
  openCamera();
  paintSoundChips();
};

// play one video from the sound page
const vv = $("#vidView"), vvVid = $("#vvVid");
function openVideoView(id) {
  const p = spPosts.get(String(id));
  if (!p) return;
  spPlay(false);
  const borrowed = !p.isRoot && p.sound_id && spRoot;
  vv.classList.remove("hidden");
  vvVid.src = p.media_url;
  vvVid.muted = !!borrowed;
  let last = 0;
  vvVid.ontimeupdate = () => { if (borrowed && vvVid.currentTime + 0.4 < last) { try { SND.currentTime = 0; } catch (err) {} } last = vvVid.currentTime; };
  vvVid.play().catch(() => { vvVid.muted = true; vvVid.play().catch(() => {}); });
  if (borrowed) { setSnd(spRoot.url); try { SND.currentTime = 0; } catch (err) {} SND.muted = false; SND.playbackRate = 1; SND.play().catch(() => {}); }
}
function closeVideoView() {
  if (vv.classList.contains("hidden")) return;
  vvVid.pause(); vvVid.removeAttribute("src"); vvVid.load();
  SND.pause();
  vv.classList.add("hidden");
}
$("#vvClose").onclick = (e) => { e.stopPropagation(); closeVideoView(); };
vv.onclick = () => { if (vvVid.paused) { vvVid.play().catch(() => {}); if (vvVid.muted && SND.src && SND.paused) SND.play().catch(() => {}); } else { vvVid.pause(); SND.pause(); } };
$("#spGrid").addEventListener("click", (e) => { const t = e.target.closest(".sp-tile"); if (t) openVideoView(t.dataset.id); });