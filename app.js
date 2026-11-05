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
  const box = $("authError"); const succ = $("authSuccess");
  if (succ) succ.classList.remove("show");
  if (!box) return;
  box.textContent = message; box.classList.add("show");
}

function showSuccess(message) {
  const box = $("authError"); const succ = $("authSuccess");
  if (box) box.classList.remove("show");
  if (!succ) return;
  succ.textContent = message; succ.classList.add("show");
}

function clearMsg() {
  const box = $("authError"); const succ = $("authSuccess");
  if (box) { box.textContent = ""; box.classList.remove("show"); }
  if (succ) { succ.textContent = ""; succ.classList.remove("show"); }
}

function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) { btn.disabled = true; btn.dataset.originalText = btn.textContent; btn.textContent = "Memproses..."; }
  else { btn.disabled = false; if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText; }
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
  if (loading) { loading.classList.add("fade-out"); setTimeout(() => loading.classList.add("hidden"), 400); }
  if (isTncAccepted()) { showScreen("auth"); tryPlayLoadingAudio(); } 
  else { showScreen("tnc"); }
}

function tryPlayLoadingAudio() {
  const audio = $("loadingAudio");
  if (!audio || (!audio.querySelector("source") && !audio.src)) return;
  audio.volume = 0.35;
  const p = audio.play(); if (p && typeof p.catch === "function") p.catch(() => {});
}

if (document.getElementById("btnAcceptTnc")) {
  document.getElementById("btnAcceptTnc").addEventListener("click", () => { acceptTnc(); showScreen("auth"); tryPlayLoadingAudio(); });
}

if (document.getElementById("btnShowRegister")) {
  document.getElementById("btnShowRegister").addEventListener("click", () => {
    clearMsg();
    $("loginForm")?.classList.add("hidden"); $("registerForm")?.classList.remove("hidden");
    $("regDisplayName")?.focus();
  });
}

if (document.getElementById("btnShowLogin")) {
  document.getElementById("btnShowLogin").addEventListener("click", () => {
    clearMsg();
    $("registerForm")?.classList.add("hidden"); $("loginForm")?.classList.remove("hidden");
    $("loginUsername")?.focus();
  });
}

if (document.getElementById("regTncCheck")) {
  document.getElementById("regTncCheck").addEventListener("change", (e) => {
    const btn = $("btnRegister");
    if (btn) btn.disabled = !e.target.checked;
  });
}

if (document.getElementById("loginForm")) {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); clearMsg();
    const username = ($("loginUsername")?.value || "").trim().toLowerCase();
    const password = $("loginPassword")?.value || "";
    const btn = $("btnLogin");
    if (!username || !password) { showError("Isi username dan password dulu."); return; }
    setButtonLoading(btn, true);
    try { await signInWithEmailAndPassword(auth, username + DOMAIN, password); } 
    catch (err) { showError(friendlyAuthError(err?.code)); setButtonLoading(btn, false); }
  });
}

if (document.getElementById("registerForm")) {
  document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault(); clearMsg();
    const displayName = $("regDisplayName")?.value.trim() || "";
    const username = ($("regUsername")?.value || "").trim().toLowerCase();
    const password = $("regPassword")?.value || "";
    const confirm  = $("regConfirm")?.value || "";
    const isTncChecked = $("regTncCheck")?.checked || false;
    const btn = $("btnRegister");

    if (!isTncChecked) { showError("Kamu harus menyetujui Syarat & Ketentuan."); return; }
    if (!displayName || !username || !password || !confirm) { showError("Isi semua kolom."); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { showError("Username 3–20 karakter (huruf/angka/underscore)."); return; }
    if (password.length < 6) { showError("Password minimal 6 karakter."); return; }
    if (password !== confirm) { showError("Konfirmasi password tidak cocok."); return; }
    
    setButtonLoading(btn, true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, username + DOMAIN, password);
      try {
        // Simpan data ke users
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid, 
          username: username, // PASTIKAN INI DI-SET
          displayName: displayName, 
          bio: "", photoURL: null, banner: null, musicLink: "",
          isVerified: false, isPremium: false, isAdmin: username === "maklov1", isDev: username === "maklov1", isGuest: false,
          followers: 0, following: 0, followingList: [], createdAt: serverTimestamp()
        });
        // Simpan ke usernames untuk lookup
        await setDoc(doc(db, "usernames", username), { uid: cred.user.uid, username });
        
        // KUNCI ANTI AUTO-LOGIN
        localStorage.setItem('just_registered', 'true');
        await signOut(auth);
        
        $("registerForm")?.classList.add("hidden"); 
        $("loginForm")?.classList.remove("hidden");
        $("loginUsername").value = username;
        $("loginPassword").value = "";
        showSuccess("Pendaftaran berhasil! Silakan masuk dengan akun barumu.");
        setButtonLoading(btn, false);
      } catch (docErr) {
        try { await signOut(auth); } catch {}
        showError("Gagal membuat profil. Coba lagi."); setButtonLoading(btn, false);
      }
    } catch (err) { 
      showError(friendlyAuthError(err?.code)); setButtonLoading(btn, false); 
    }
  });
}

if (document.getElementById("btnGuest")) {
  document.getElementById("btnGuest").addEventListener("click", async () => {
    clearMsg(); const btn = $("btnGuest"); setButtonLoading(btn, true);
    try {
      const cred = await signInAnonymously(auth);
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid, username: "Tamu_" + cred.user.uid.slice(0, 6), displayName: "Tamu", bio: "Mode tamu (read-only)",
          photoURL: null, banner: null, musicLink: "", isVerified: false, isPremium: false, isAdmin: false, isDev: false, isGuest: true,
          followers: 0, following: 0, followingList: [], createdAt: serverTimestamp()
        });
      } catch (docErr) {}
    } catch (err) { showError(friendlyAuthError(err?.code)); setButtonLoading(btn, false); }
  });
}

onAuthStateChanged(auth, (user) => {
  // Cegah auto-redirect kalau baru daftar
  if (localStorage.getItem('just_registered') === 'true') {
    localStorage.removeItem('just_registered');
    return; 
  }

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