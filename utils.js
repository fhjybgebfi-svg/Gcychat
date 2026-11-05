// ============================================================
// utils.js — Fungsi bantuan, Emoji, Format, & Upload
// ============================================================

const APPLE_EMOJI_BASE = "https://emojicdn.elk.sh/";
// Regex deteksi emoji (Pictographic, flag, ZWJ, skin tone)
const EMOJI_REGEX = /((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator})|[\u{1F3FB}-\u{1F3FF}])*)/gu;

export function parseEmojis(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(EMOJI_REGEX, (emoji) => {
    const enc = encodeURIComponent(emoji); const alt = escapeHtml(emoji);
    return `<img class="apple-emoji" src="${APPLE_EMOJI_BASE}${enc}?style=apple" alt="${alt}" draggable="false" loading="lazy" />`;
  });
}

export function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function formatText(text) {
  if (typeof text !== "string" || !text) return "";
  let s = escapeHtml(text);
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, p1) => { codes.push(p1); return `\u0000C${codes.length - 1}\u0000`; });
  s = s.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>").replace(/_([^_\n]+)_/g, "<em>$1</em>").replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  s = s.replace(/\u0000C(\d+)\u0000/g, (_m, i) => `<code>${codes[+i]}</code>`);
  s = parseEmojis(s);
  s = s.replace(/\n/g, "<br>");
  return s;
}

export function compressImage(file, maxW = 1080, maxH = 1080, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) return reject(new Error("File bukan gambar."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal baca file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal decode gambar."));
      img.onload = () => {
        try {
          let { width, height } = img;
          const ratio = Math.min(maxW / width, maxH / height, 1);
          width = Math.max(1, Math.round(width * ratio)); height = Math.max(1, Math.round(height * ratio));
          const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) { reject(err); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function cropToRatio(file, ratioW = 16, ratioH = 6, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject(new Error("File bukan gambar."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal baca file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal decode gambar."));
      img.onload = () => {
        try {
          const targetRatio = ratioW / ratioH; let sw = img.width; let sh = img.height;
          if (sw / sh > targetRatio) sw = sh * targetRatio; else sh = sw / targetRatio;
          const sx = (img.width - sw) / 2; const sy = (img.height - sh) / 2;
          const maxW = 1280; const outW = Math.min(maxW, Math.round(sw)); const outH = Math.round(outW / targetRatio);
          const canvas = document.createElement("canvas"); canvas.width = outW; canvas.height = outH;
          const ctx = canvas.getContext("2d"); ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) { reject(err); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal baca blob."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function toDate(input) {
  if (!input) return new Date(0);
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  if (typeof input === "object" && typeof input.toDate === "function") { try { return input.toDate(); } catch { return new Date(0); } }
  if (typeof input === "object" && typeof input.seconds === "number") return new Date(input.seconds * 1000);
  const d = new Date(input); return isNaN(d.getTime()) ? new Date(0) : d;
}

export function formatTime(input) { const d = toDate(input); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

export function formatRelativeTime(input) {
  const d = toDate(input); const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 0 || diff < 30) return "baru";
  if (diff < 60) return diff + "d"; if (diff < 3600) return Math.floor(diff / 60) + "m";
  if (diff < 86400) return Math.floor(diff / 3600) + "j"; if (diff < 604800) return Math.floor(diff / 86400) + "h";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

export function formatSmartTime(input) {
  const d = toDate(input); const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return formatTime(d);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

export function debounce(fn, wait = 300) { let t; return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); }; }
export function generateGroupId() { const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let id = "HZ-"; for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)]; return id; }
export function truncate(str, n = 60) { if (typeof str !== "string") return ""; return str.length > n ? str.slice(0, n - 1) + "…" : str; }

export function getInitials(name) {
  if (!name) return "?"; const clean = String(name).trim(); if (!clean) return "?";
  const parts = clean.split(/\s+/); if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ["#00ffc8", "#00b894", "#00d4a8", "#14b8a6", "#22d3ee", "#0891b2", "#10b981", "#06b6d4"];
export function getAvatarColor(seed) {
  if (!seed) return AVATAR_COLORS[0]; let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function toast(message, type = "info", duration = 2800) {
  let container = document.getElementById("toastContainer");
  if (!container) { container = document.createElement("div"); container.id = "toastContainer"; container.className = "toast-container"; document.body.appendChild(container); }
  const el = document.createElement("div"); el.className = "toast toast-" + type; el.innerHTML = parseEmojis(escapeHtml(message));
  container.appendChild(el); requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => { try { el.remove(); } catch {} }, 300); }, duration);
}

export const REACTION_EMOJIS = ["❤️", "👍", "😂"];
export function formatDuration(seconds) { const s = Math.max(0, Math.floor(Number(seconds) || 0)); const m = Math.floor(s / 60); const r = s % 60; return `${m}:${String(r).padStart(2, "0")}`; }

// ============================================================
// FITUR PENDUKUNG: CLOUDINARY, NOTIFIKASI, & SETTINGS (LOCALSTORAGE)
// ============================================================

const CLOUDINARY_CLOUD_NAME = "hyot6nmh"; 
const CLOUDINARY_UPLOAD_PRESET = "gpyth_unsigned"; 

export async function uploadToCloudinary(file) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) { const err = await response.json(); throw new Error(err.error?.message || 'Gagal upload'); }
  const data = await response.json();
  return data.secure_url; 
}

let __audioCtx = null;
export function playNotificationSound(type = 'chat') {
  try {
    // Cek settingan custom dari user
    const customUrl = getSetting(`notifSound_${type}`);
    if (customUrl) {
      const audio = new Audio(customUrl);
      audio.play().catch(()=>{});
      return;
    }
    
    // Default: Web Audio API (Ting iPhone style)
    if (!__audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; __audioCtx = new AC(); }
    const ctx = __audioCtx; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine"; 
    if (type === 'call') {
      o.frequency.setValueAtTime(600, ctx.currentTime);
      o.frequency.setValueAtTime(800, ctx.currentTime + 0.2);
      o.frequency.setValueAtTime(600, ctx.currentTime + 0.4);
    } else {
      o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    }
    g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.35);
    
    // Getar (Vibrate)
    if (getSetting('vibration') !== 'false' && navigator.vibrate) {
      navigator.vibrate(type === 'call' ? [200, 100, 200] : [50]);
    }
  } catch {}
}

export function getSetting(key) { try { return localStorage.getItem('gpyth_' + key); } catch { return null; } }
export function setSetting(key, value) { try { localStorage.setItem('gpyth_' + key, value); } catch {} }
