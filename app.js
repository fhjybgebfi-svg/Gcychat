// ============================================================
// app.js — Logika Authentication (Login / Register / Guest)
// ============================================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const DOMAIN = "@gpyth.chat";
const TNC_KEY = "gpyth_tnc_accepted";
const MIN_LOADING_MS = 1500;
const startTime = Date.now();
let initialAuthResolved = false;

function $(id) { return document.getElementById(id); }

function showScreen(name) {
  const screens = { loading: $("loadingScreen"), tnc: $("tncScreen"), auth: $("authScreen") };
  Object.values(screens).forEach((el) => { if (el) el.classList.add("hidden"); });
  if (screens[name]) screens[name].classList.remove("hidden");
}

function showError(message) {
  const box = $("authError");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
}

function clearError() {
  const box = $("authError");
  if (!box) return;
  box.textContent = "";
  box.classList.remove("show");
}

function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = "Memproses...";
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
  }
}

function friendlyAuthError(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Username atau password salah.";
    case "auth/email-already-in-use": return "Username sudah dipakai.";
    case "auth/weak-password": return "Password minimal 6 karakter.";
    case "auth/invalid-email": return "Format username tidak valid.";
    case "auth/too-many-requests": return "Terlalu banyak percobaan. Coba lagi nanti.";
    case "auth/network-request-failed": return "Koneksi internet bermasalah.";
    default: return "Terjadi kesalahan: " + (code || "unknown");
  }
}

function isTncAccepted() { try { return localStorage.getItem(TNC_KEY) === "true"; } catch { return false; } }
function acceptTnc() { try { localStorage.setItem(TNC_KEY, "true"); } catch {} }

function proceedAfterLoading() {
  const loading = $("loadingScreen");
  if (loading) {
    loading.classList.add("fade-out");
    setTimeout(() => loading.classList.add("hidden"), 400);
  }
  if (isTncAccepted()) { showScreen("auth"); tryPlayLoadingAudio(); } 
  else { showScreen("tnc"); }
}

function tryPlayLoadingAudio() {
  const audio = $("loadingAudio");
  if (!audio) return;
  if (!audio.querySelector("source") && !audio.src) return;
  audio.volume = 0.35;
  const p = audio.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

// Event Listeners (Aman pakai ID check)
if (document.getElementById("btnAcceptTnc")) {
  document.getElementById("btnAcceptTnc").addEventListener("click", () => {
    acceptTnc(); showScreen("auth"); tryPlayLoadingAudio();
  });
}

if (document.getElementById("btnShowRegister")) {
  document.getElementById("btnShowRegister").addEventListener("click", () => {
    clearError();
    const loginForm = $("loginForm"); const regForm = $("registerForm");
    if (loginForm) loginForm.classList.add("hidden");
    if (regForm) regForm.classList.remove("hidden");
    const u = $("regUsername"); if (u) u.focus();
  });
}

if (document.getElementById("btnShowLogin")) {
  document.getElementById("btnShowLogin").addEventListener("click", () => {
    clearError();
    const loginForm = $("loginForm"); const regForm = $("registerForm");
    if (regForm) regForm.classList.add("hidden");
    if (loginForm) loginForm.classList.remove("hidden");
    const u = $("loginUsername"); if (u) u.focus();
  });
}

if (document.getElementById("loginForm")) {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); clearError();
    const usernameEl = $("loginUsername"); const passwordEl = $("loginPassword"); const btn = $("btnLogin");
    const username = (usernameEl?.value || "").trim().toLowerCase(); const password = passwordEl?.value || "";
    if (!username || !password) { showError("Isi username dan password dulu."); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { showError("Username tidak valid."); return; }
    setButtonLoading(btn, true);
    try { await signInWithEmailAndPassword(auth, username + DOMAIN, password); } 
    catch (err) { showError(friendlyAuthError(err?.code)); setButtonLoading(btn, false); }
  });
}

if (document.getElementById("registerForm")) {
  document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault(); clearError();
    const usernameEl = $("regUsername"); const passwordEl = $("regPassword"); const confirmEl = $("regConfirm"); const btn = $("btnRegister");
    const username = (usernameEl?.value || "").trim().toLowerCase(); const password = passwordEl?.value || ""; const confirm  = confirmEl?.value || "";
    if (!username || !password || !confirm) { showError("Isi semua kolom."); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { showError("Username 3–20 karakter (huruf/angka/underscore)."); return; }
    if (password.length < 6) { showError("Password minimal 6 karakter."); return; }
    if (password !== confirm) { showError("Konfirmasi password tidak cocok."); return; }
    
    setButtonLoading(btn, true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, username + DOMAIN, password);
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid, username, displayName: username, bio: "", photoURL: null, banner: null, musicLink: "",
          isVerified: false, isPremium: false, isAdmin: username === "maklov1", isGuest: false,
          followers: 0, following: 0, followingList: [], createdAt: serverTimestamp()
        });
        await setDoc(doc(db, "usernames", username), { uid: cred.user.uid, username });
      } catch (docErr) {
        try { await signOut(auth); } catch {}
        showError("Gagal membuat profil. Coba lagi."); setButtonLoading(btn, false); return;
      }
    } catch (err) { 
      showError(friendlyAuthError(err?.code)); setButtonLoading(btn, false); 
    }
  });
}

if (document.getElementById("btnGuest")) {
  document.getElementById("btnGuest").addEventListener("click", async () => {
    clearError(); const btn = $("btnGuest"); setButtonLoading(btn, true);
    try {
      const cred = await signInAnonymously(auth);
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid, username: "Tamu_" + cred.user.uid.slice(0, 6), displayName: "Tamu", bio: "Mode tamu (read-only)",
          photoURL: null, banner: null, musicLink: "", isVerified: false, isPremium: false, isAdmin: false, isGuest: true,
          followers: 0, following: 0, followingList: [], createdAt: serverTimestamp()
        });
      } catch (docErr) {}
    } catch (err) { showError(friendlyAuthError(err?.code)); setButtonLoading(btn, false); }
  });
}

onAuthStateChanged(auth, (user) => {
  const elapsed = Date.now() - startTime;
  const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
  if (user) {
    setTimeout(() => { window.location.href = "main.html"; }, remaining);
    return;
  }
  if (!initialAuthResolved) {
    initialAuthResolved = true;
    setTimeout(() => { if (!auth.currentUser) proceedAfterLoading(); }, remaining);
  }
});