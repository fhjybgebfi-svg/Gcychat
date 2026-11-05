// ============================================================
// main.js — PART 4A (Core, Feed, Story, Reels, Settings)
// ============================================================

import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { parseEmojis, formatText, escapeHtml, compressImage, cropToRatio, formatTime, formatRelativeTime, formatSmartTime, formatDuration, debounce, generateGroupId, toast, getInitials, getAvatarColor, REACTION_EMOJIS, truncate, uploadToCloudinary, getSetting, setSetting } from "./utils.js";

const $ = (id) => document.getElementById(id);
const safeGet = (id) => document.getElementById(id);
const safeOn = (id, evt, fn) => { const el = safeGet(id); if (el) el.addEventListener(evt, fn); };
const openModal = (id) => safeGet(id)?.classList.add('open');
const closeModal = (id) => safeGet(id)?.classList.remove('open');

// Global State
let currentUser = null, currentUserData = null;
let feedFilter = 'all', profileTab = 'posts';
let currentChatId = null, currentChatType = null, currentChatData = null;
let unsubFeed = null, unsubProfileFeed = null, unsubChatList = null, unsubMessages = null, unsubChatMeta = null, unsubTyping = null;
let replyTo = null;
let cropperInstance = null;
let mediaRecorder = null, audioChunks = [];
let peer = null, currentCall = null, localStream = null;

// ════════════════ 1. INITIALIZATION & AUTH ════════════════
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user;
  await loadUserData();
  applySettings();
  
  initHeader();
  initNavigation();
  initFeed();
  initStories();
  initReels();
  initChatList();
  initChatRoom();
  initProfile();
  initSettingsModal();
  initCall();
  
  listenIncomingCalls();
  startPresenceHeartbeat();
});

async function loadUserData() {
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists()) {
      currentUserData = { uid: currentUser.uid, ...snap.data() };
      
      // SELF-HEALING: Paksa maklov1 jadi Dev & Admin
      if (currentUserData.username === 'maklov1') {
        if (!currentUserData.isAdmin || !currentUserData.isDev) {
          await updateDoc(doc(db, 'users', currentUser.uid), { isAdmin: true, isDev: true });
          currentUserData.isAdmin = true;
          currentUserData.isDev = true;
        }
      }
    } else {
      currentUserData = {
        uid: currentUser.uid,
        username: currentUser.isAnonymous ? 'Tamu_' + currentUser.uid.slice(0,6) : 'user',
        displayName: currentUser.isAnonymous ? 'Tamu' : 'User',
        isGuest: currentUser.isAnonymous, isAdmin: false, isDev: false, isVerified: false, isPremium: false,
        followers: 0, following: 0, followingList: [], createdAt: serverTimestamp()
      };
      await setDoc(doc(db, 'users', currentUser.uid), currentUserData);
    }
  } catch (e) { console.error(e); toast('Gagal memuat profil', 'error'); }
}

async function getUserData(uid) {
  if (uid === currentUser.uid) return currentUserData;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? { uid, ...snap.data() } : null;
  } catch { return null; }
}

function initHeader() {
  const isAdmin = currentUserData?.username === 'maklov1' || currentUserData?.isAdmin === true;
  safeGet('headerAdminBtn')?.classList.toggle('hidden', !isAdmin);
  
  safeOn('headerAdminBtn', 'click', () => { switchTab('profile'); setTimeout(() => safeGet('adminSection')?.scrollIntoView({ behavior: 'smooth' }), 200); });
  safeOn('headerAvatarBtn', 'click', () => switchTab('profile'));
  
  const fallback = safeGet('headerAvatarFallback'), img = safeGet('headerAvatarImg');
  if (currentUserData?.photoURL) { img.src = currentUserData.photoURL; img.classList.remove('hidden'); fallback.classList.add('hidden'); }
  else { fallback.textContent = getInitials(currentUserData?.displayName || 'U'); fallback.style.background = getAvatarColor(currentUser.uid); fallback.style.color = '#08120f'; fallback.classList.remove('hidden'); img.classList.add('hidden'); }
}

function startPresenceHeartbeat() {
  const update = async () => { 
    if (getSetting('lastSeen') === 'false') return;
    try { await updateDoc(doc(db, 'users', currentUser.uid), { lastSeen: serverTimestamp() }); } catch (_) {} 
  };
  update(); setInterval(update, 20000);
}

function isOnline(user) {
  if (!user?.lastSeen) return false;
  if (getSetting('lastSeen') === 'false') return false;
  return (Date.now() - (user.lastSeen.toDate?.() || new Date(user.lastSeen)).getTime() < 60000);
}

// ════════════════ 2. NAVIGATION & SETTINGS ════════════════
function initNavigation() {
  ['feed', 'reels', 'chat', 'profile'].forEach(t => {
    safeOn(`tabBtn${t.charAt(0).toUpperCase() + t.slice(1)}`, 'click', () => switchTab(t));
  });
}

function switchTab(name) {
  ['feed', 'reels', 'chat', 'profile'].forEach((t) => {
    safeGet('tab' + t.charAt(0).toUpperCase() + t.slice(1))?.classList.toggle('active', t === name);
    safeGet('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1))?.classList.toggle('active', t === name);
  });
  safeGet('profileFAB').classList.toggle('hidden', name !== 'profile');
  if (name === 'chat') refreshChatList();
  if (name === 'profile') refreshProfileUI();
}

function applySettings() {
  const font = getSetting('fontSize') || '14.5px';
  document.documentElement.style.setProperty('--font-md', font);
  
  const theme = getSetting('theme') || 'dark';
  if (theme === 'light') document.body.classList.add('light-mode');
  else document.body.classList.remove('light-mode');
}

function initSettingsModal() {
  safeOn('menuSettings', 'click', () => openModal('settingsModal'));
  safeOn('btnSettingsClose', 'click', () => closeModal('settingsModal'));

  const setEnter = safeGet('settingEnterSend');
  if (setEnter) { setEnter.checked = getSetting('enterSend') !== 'false'; setEnter.onchange = (e) => setSetting('enterSend', e.target.checked); }
  
  const setFont = safeGet('settingFont');
  if (setFont) { setFont.value = getSetting('fontSize') || '14.5px'; setFont.onchange = (e) => { setSetting('fontSize', e.target.value); applySettings(); }; }

  const setTheme = safeGet('settingTheme');
  if (setTheme) { setTheme.value = getSetting('theme') || 'dark'; setTheme.onchange = (e) => { setSetting('theme', e.target.value); applySettings(); }; }

  const setVibrate = safeGet('settingVibrate');
  if (setVibrate) { setVibrate.checked = getSetting('vibration') !== 'false'; setVibrate.onchange = (e) => setSetting('vibration', e.target.checked); }

  const setLastSeen = safeGet('settingLastSeen');
  if (setLastSeen) { setLastSeen.checked = getSetting('lastSeen') !== 'false'; setLastSeen.onchange = (e) => setSetting('lastSeen', e.target.checked); }

  const handleAudioUpload = (inputId, storageKey) => {
    safeOn(inputId, 'change', async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      if (file.size > 500000) return toast('File MP3 terlalu besar (Maks 500KB).', 'error');
      const reader = new FileReader();
      reader.onload = () => { setSetting(storageKey, reader.result); toast('Nada berhasil diubah.', 'success'); };
      reader.readAsDataURL(file);
    });
  };
  handleAudioUpload('settingSoundChat', 'notifSound_chat');
  handleAudioUpload('settingSoundCall', 'notifSound_call');

  safeOn('btnCheckUpdate', 'click', () => toast('Gpyth Chat v2.0.0 — Aplikasi sudah versi terbaru!', 'success'));
}

// ════════════════ 3. FEED (THREADS) ════════════════
function initFeed() {
  safeOn('composerImageBtn', 'click', () => safeGet('composerImageInput')?.click());
  
  let pendingPostFile = null, pendingPostData = null, pendingPostType = null;
  safeOn('composerImageInput', 'change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      pendingPostFile = file;
      pendingPostType = file.type.startsWith('video') ? 'video' : 'image';
      if (pendingPostType === 'image') { pendingPostData = await compressImage(file); safeGet('composerImagePreviewImg').src = pendingPostData; }
      else { safeGet('composerImagePreviewImg').src = URL.createObjectURL(file); }
      safeGet('composerImagePreview').style.display = 'block';
    } catch (err) { toast('Gagal memproses file.', 'error'); }
    e.target.value = '';
  });

  safeOn('composerRemoveImage', 'click', () => { pendingPostFile = null; pendingPostData = null; safeGet('composerImagePreview').style.display = 'none'; });

  safeOn('composerPostBtn', 'click', async () => {
    const text = safeGet('composerText').value.trim();
    if (!text && !pendingPostFile) return toast('Tulis sesuatu atau pilih media.', 'info');
    if (currentUserData?.isGuest) return toast('Mode tamu read-only.', 'error');
    
    const btn = safeGet('composerPostBtn'); btn.disabled = true; btn.textContent = 'Posting...';
    try {
      let mediaUrl = null;
      if (pendingPostFile) {
        btn.textContent = 'Upload...';
        if (pendingPostType === 'image') mediaUrl = pendingPostData;
        else mediaUrl = await uploadToCloudinary(pendingPostFile);
      }
      await addDoc(collection(db, 'posts'), {
        authorId: currentUser.uid, authorName: currentUserData.displayName || currentUserData.username, 
        authorPhoto: currentUserData.photoURL || null, authorVerified: currentUserData.isVerified || false,
        text, mediaUrl, mediaType: pendingPostType, likedBy: [], commentsCount: 0, repostsCount: 0, createdAt: serverTimestamp()
      });
      safeGet('composerText').value = ''; safeGet('composerImagePreview').style.display = 'none';
      pendingPostFile = null; pendingPostData = null;
      toast('Postingan dibuat!', 'success');
    } catch (err) { toast('Gagal posting.', 'error'); } 
    finally { btn.disabled = false; btn.textContent = 'Posting'; }
  });

  safeOn('feedFilterAll', 'click', () => { feedFilter = 'all'; safeGet('feedFilterAll').style.opacity = '1'; safeGet('feedFilterFollowing').style.opacity = '0.5'; loadFeed(); });
  safeOn('feedFilterFollowing', 'click', () => { feedFilter = 'following'; safeGet('feedFilterFollowing').style.opacity = '1'; safeGet('feedFilterAll').style.opacity = '0.5'; loadFeed(); });
  
  safeOn('btnGoLive', 'click', () => { openModal('liveModal'); safeOn('btnLiveClose', 'click', () => closeModal('liveModal')); });

  loadFeed();
}

function loadFeed() {
  if (unsubFeed) unsubFeed();
  let q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
  
  if (feedFilter === 'following') {
    const following = currentUserData.followingList || [];
    if (following.length === 0) {
      safeGet('feedList').innerHTML = `<div class="empty-state"><p>Kamu belum mengikuti siapapun.</p></div>`;
      return;
    }
    q = query(collection(db, 'posts'), where('authorId', 'in', following.slice(0, 10)), orderBy('createdAt', 'desc'), limit(50));
  }

  unsubFeed = onSnapshot(q, (snap) => {
    const container = safeGet('feedList');
    if (snap.empty) { container.innerHTML = `<div class="empty-state"><p>Belum ada postingan.</p></div>`; return; }
    
    let html = '';
    snap.forEach((docSnap) => {
      const p = docSnap.data(); 
      if (p.isRepost) return; // JANGAN TAMPILKAN REPOST DI BERANDA UTAMA

      const dId = docSnap.id;
      const liked = (p.likedBy || []).includes(currentUser.uid);
      html += `<div class="post-card">
        <div class="post-header">
          <div class="post-avatar" onclick="window.openUserProfileModal('${p.authorId}')" style="cursor:pointer;">${p.authorPhoto ? `<img src="${p.authorPhoto}"/>` : `<div class="avatar-fallback" style="background:${getAvatarColor(p.authorId)};color:#08120f;">${getInitials(p.authorName)}</div>`}</div>
          <div class="post-meta">
            <div class="post-author" onclick="window.openUserProfileModal('${p.authorId}')" style="cursor:pointer;">${escapeHtml(p.authorName)} ${p.authorVerified ? '<span class="badge badge-verified">✓</span>' : ''}</div>
            <div class="post-time">${formatRelativeTime(p.createdAt)}</div>
          </div>
        </div>
        ${p.text ? `<div class="post-content">${formatText(p.text)}</div>` : ''}
        ${p.mediaUrl ? (p.mediaType === 'video' ? `<div class="post-image"><video src="${p.mediaUrl}" controls playsinline></video></div>` : `<div class="post-image" onclick="window.openImageViewer('${p.mediaUrl}')"><img src="${p.mediaUrl}"/></div>`) : ''}
        <div class="post-actions">
          <button class="post-action-btn ${liked ? 'liked' : ''}" onclick="window.toggleLike('${dId}')"><i class="ph${liked ? '-fill' : ''} ph-heart"></i> ${(p.likedBy || []).length}</button>
          <button class="post-action-btn" onclick="window.openComments('${dId}')"><i class="ph ph-chat-circle"></i> ${p.commentsCount || 0}</button>
          <button class="post-action-btn" onclick="window.repostPost('${dId}')"><i class="ph ph-arrows-clockwise"></i> ${p.repostsCount || 0}</button>
        </div>
      </div>`;
    });
    container.innerHTML = html;
  });
}

window.toggleLike = async (id) => {
  if (currentUserData?.isGuest) return toast('Mode tamu read-only.', 'error');
  const ref = doc(db, 'posts', id); const snap = await getDoc(ref);
  const liked = (snap.data().likedBy || []).includes(currentUser.uid);
  await updateDoc(ref, { likedBy: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid) });
};

window.repostPost = async (id) => {
  if (currentUserData?.isGuest) return toast('Mode tamu read-only.', 'error');
  const snap = await getDoc(doc(db, 'posts', id)); const p = snap.data();
  if (!p.mediaUrl) return toast('Hanya media yang bisa di-repost.', 'info');
  await addDoc(collection(db, 'posts'), {
    authorId: currentUser.uid, authorName: currentUserData.displayName || 'User', authorPhoto: currentUserData.photoURL || null,
    text: p.text, mediaUrl: p.mediaUrl, mediaType: p.mediaType, likedBy: [], commentsCount: 0, repostsCount: 0, isRepost: true, createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, 'posts', id), { repostsCount: increment(1) });
  toast('Berhasil di-repost! Cek di profil.', 'success');
};

let commentUnsub = null;
window.openComments = (id) => {
  openModal('commentsModal');
  const list = safeGet('commentsList'); list.innerHTML = '<div class="text-center"><span class="spinner"></span></div>';
  if (commentUnsub) commentUnsub();
  commentUnsub = onSnapshot(query(collection(db, 'posts', id, 'comments'), orderBy('createdAt', 'asc')), (snap) => {
    if (snap.empty) { list.innerHTML = '<p class="text-muted text-center">Belum ada komentar.</p>'; return; }
    let html = ''; snap.forEach(c => {
      const d = c.data();
      html += `<div style="display:flex; gap:10px; margin-bottom:12px;">
        <div class="post-avatar" style="width:32px;height:32px;">${d.authorPhoto ? `<img src="${d.authorPhoto}"/>` : `<div class="avatar-fallback" style="font-size:12px;background:${getAvatarColor(d.authorId)};color:#08120f;">${getInitials(d.authorName)}</div>`}</div>
        <div><div style="font-weight:700;font-size:13px;">${escapeHtml(d.authorName)}</div><div style="font-size:13.5px;">${formatText(d.text)}</div></div>
      </div>`;
    });
    list.innerHTML = html; list.scrollTop = list.scrollHeight;
  });

  safeOn('btnCommentsClose', 'click', () => { closeModal('commentsModal'); if(commentUnsub) commentUnsub(); });
  safeOn('btnSendComment', 'click', async () => {
    const text = safeGet('commentInput').value.trim(); if (!text) return;
    await addDoc(collection(db, 'posts', id, 'comments'), { authorId: currentUser.uid, authorName: currentUserData.displayName || 'User', authorPhoto: currentUserData.photoURL || null, text, createdAt: serverTimestamp() });
    await updateDoc(doc(db, 'posts', id), { commentsCount: increment(1) });
    safeGet('commentInput').value = '';
  });
};

// ════════════════ 4. STORIES ════════════════
function initStories() {
  safeOn('btnAddStory', 'click', async () => {
    if (currentUserData?.isGuest) return toast('Mode tamu read-only.', 'error');
    if (!currentUserData.isPremium) {
      const today = new Date(); today.setHours(0,0,0,0);
      const snap = await getDocs(query(collection(db, 'stories'), where('uid', '==', currentUser.uid), where('createdAt', '>=', today)));
      if (!snap.empty) return toast('User biasa hanya bisa 1 Story per hari. Upgrade Premium untuk unlimited!', 'info');
    }
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      toast('Mengunggah story...', 'info');
      try {
        const b64 = await compressImage(file, 720, 1280, 0.7);
        await addDoc(collection(db, 'stories'), { uid: currentUser.uid, mediaUrl: b64, createdAt: serverTimestamp() });
        toast('Story diunggah!', 'success');
      } catch (err) { toast('Gagal upload story.', 'error'); }
    };
    input.click();
  });

  onSnapshot(query(collection(db, 'stories'), where('uid', '==', currentUser.uid), orderBy('createdAt', 'desc')), (snap) => {
    const container = safeGet('storiesList'); let html = '';
    snap.forEach(d => { const s = d.data(); html += `<div class="story-item" onclick="window.openImageViewer('${s.mediaUrl}')"><div class="story-circle"><img src="${s.mediaUrl}"></div><span>Story</span></div>`; });
    container.innerHTML = html;
  });
}

// ════════════════ 5. REELS ════════════════
function initReels() {
  onSnapshot(query(collection(db, 'posts'), where('mediaType', '==', 'video'), orderBy('createdAt', 'desc'), limit(20)), (snap) => {
    const container = safeGet('reelsContainer');
    if (snap.empty) { container.innerHTML = `<div class="empty-state" style="height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;"><i class="ph-fill ph-duck" style="font-size:60px;color:var(--neon);margin-bottom:10px;"></i><h3 style="color:var(--text-0);">Belum Rilis</h3><p style="color:var(--text-2);">Video pendek akan segera hadir.</p></div>`; return; }
    let html = '';
    snap.forEach(d => { const p = d.data(); html += `<div class="reel-item"><video src="${p.mediaUrl}" loop playsinline muted></video><div class="reel-overlay"><div style="font-weight:700;margin-bottom:5px;">@${escapeHtml(p.authorName)}</div><div style="font-size:13px;">${formatText(p.text)}</div></div></div>`; });
    container.innerHTML = html;
    const observer = new IntersectionObserver((entries) => { entries.forEach(entry => { const vid = entry.target.querySelector('video'); if (entry.isIntersecting) { vid.muted = false; vid.play().catch(()=>{}); } else vid.pause(); }); }, { threshold: 0.6 });
    container.querySelectorAll('.reel-item').forEach(el => observer.observe(el));
  });
}

// ════════════════ 6. CHAT LIST & HZCS ════════════════
async function getOrCreateDM(otherUid) {
  const id = `dm_${[currentUser.uid, otherUid].sort().join('_')}`;
  const ref = doc(db, 'chats', id); const snap = await getDoc(ref);
  if (snap.exists()) return id;
  const otherData = await getUserData(otherUid); const otherName = otherData?.displayName || otherData?.username || 'User';
  await setDoc(ref, { type: 'dm', members: [currentUser.uid, otherUid], memberNames: { [currentUser.uid]: currentUserData.username, [otherUid]: otherName }, lastMessage: '', lastSenderId: '', lastMessageAt: serverTimestamp(), pinnedMessage: null, readAt: {}, streakCount: 0, createdAt: serverTimestamp() });
  return id;
}

function initChatList() {
  if (unsubChatList) unsubChatList();
  unsubChatList = onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', currentUser.uid)), async (snap) => {
    const container = safeGet('chatListContainer'); if (!container) return;
    const chatRows = []; snap.forEach((d) => chatRows.push({ id: d.id, ...d.data() }));
    chatRows.sort((a, b) => (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0));

    let html = `
      <div class="chat-item" data-chat-type="hzcs" style="border-left: 3px solid var(--neon);">
        <div class="chat-avatar-wrap"><div class="chat-avatar" style="background:var(--neon-soft); display:flex; align-items:center; justify-content:center;"><i class="ph-fill ph-headset" style="color:var(--neon);font-size:24px;"></i></div></div>
        <div class="chat-info">
          <div class="chat-name">HZCS Support <span class="badge badge-verified" style="background:var(--neon);color:#000;">Official</span></div>
          <div class="chat-preview text-neon">Butuh bantuan? Chat di sini.</div>
        </div>
      </div>`;
    let totalUnread = 0;

    for (const chat of chatRows) {
      let displayName, avatarHtml, otherUser = null, online = false, otherUid = null;
      if (chat.type === 'group') {
        displayName = chat.groupName || 'Grup'; avatarHtml = `<div class="avatar-fallback" style="background:${getAvatarColor(chat.id)};color:#08120f;">${getInitials(displayName)}</div>`;
      } else {
        otherUid = (chat.members || []).find((u) => u !== currentUser.uid);
        otherUser = await getUserData(otherUid); displayName = otherUser?.displayName || otherUser?.username || 'User'; online = isOnline(otherUser);
        avatarHtml = otherUser?.photoURL ? `<img src="${otherUser.photoURL}" alt="" />` : `<div class="avatar-fallback" style="background:${getAvatarColor(otherUid)};color:#08120f;">${getInitials(displayName)}</div>`;
      }
      const unread = chat.lastSenderId && chat.lastSenderId !== currentUser.uid && (chat.lastMessageAt?.toMillis?.() || 0) > (chat.readAt?.[currentUser.uid]?.toMillis?.() || 0);
      if (unread) totalUnread++;
      
      html += `<div class="chat-item ${currentChatId === chat.id ? 'active' : ''}" data-chat-id="${chat.id}" data-chat-type="${chat.type}" data-other-uid="${otherUid || ''}">
        <div class="chat-avatar-wrap"><div class="chat-avatar">${avatarHtml}</div><span class="online-dot ${online ? 'online' : ''}"></span></div>
        <div class="chat-info"><div class="chat-name">${escapeHtml(displayName)} ${otherUser?.isVerified ? '<span class="badge badge-verified">✓</span>' : ''}</div><div class="chat-preview">${escapeHtml(truncate(chat.lastMessage || '', 40)) || '<span class="text-dim">Belum ada pesan</span>'}</div></div>
        <div class="chat-meta"><div class="chat-time">${chat.lastMessageAt ? formatSmartTime(chat.lastMessageAt) : ''}</div>${unread ? `<div class="unread-badge">•</div>` : ''}</div>
      </div>`;
    }

    container.innerHTML = html; updateChatBadge(totalUnread);
    
    container.querySelectorAll('.chat-item').forEach((el) => {
      el.onclick = async () => {
        if (el.dataset.chatType === 'hzcs') {
          toast('Menghubungkan ke HZCS...', 'info');
          const snap = await getDoc(doc(db, 'usernames', 'maklov1'));
          if(snap.exists()) { const chatId = await getOrCreateDM(snap.data().uid); openChat(chatId, 'dm', snap.data().uid); }
          else { toast('Admin HZCS belum terdaftar di database.', 'error'); }
        } else { openChat(el.dataset.chatId, el.dataset.chatType, el.dataset.otherUid || null); }
      };
    });
  });

  safeOn('btnCreateGroupCard', 'click', () => openModal('createGroupModal'));
  
  // Tombol + buat nambah kontak
  safeOn('btnNewChat', 'click', () => {
    const term = prompt('Masukkan Username yang ingin dichat (contoh: maklov1):');
    if(term && term.trim()) {
      const search = safeGet('chatSearchInput');
      search.value = term.trim().toLowerCase();
      search.dispatchEvent(new Event('input'));
    }
  });

  const search = safeGet('chatSearchInput');
  if (search) search.addEventListener('input', debounce(async () => {
    const term = search.value.trim().toLowerCase(); if (term.length < 2) return initChatList();
    try {
      const uSnap = await getDoc(doc(db, 'usernames', term));
      if (uSnap.exists() && uSnap.data().uid !== currentUser.uid) {
        const targetUid = uSnap.data().uid; const targetData = await getUserData(targetUid);
        const name = targetData?.displayName || targetData?.username || term;
        safeGet('chatListContainer').innerHTML = `<div class="chat-item" data-start-dm="${targetUid}"><div class="chat-avatar-wrap"><div class="chat-avatar"><img src="${targetData?.photoURL || ''}"/></div></div><div class="chat-info"><div class="chat-name">${escapeHtml(name)}</div><div class="chat-preview text-neon">Tap untuk mulai chat</div></div></div>`;
        safeGet('chatListContainer').querySelector('[data-start-dm]').onclick = async () => { const chatId = await getOrCreateDM(targetUid); openChat(chatId, 'dm', targetUid); };
      }
    } catch (_) {}
  }, 350));
}

function updateChatBadge(count) {
  const badge = safeGet('chatTabBadge'); if (!badge) return;
  if (count > 0) { badge.textContent = count > 9 ? '9+' : String(count); badge.classList.remove('hidden'); }
  else { badge.classList.add('hidden'); }
}
function refreshChatList() { const search = safeGet('chatSearchInput'); if (search && search.value.trim()) { search.value = ''; initChatList(); } }

// ════════════════ 7. CHAT ROOM ════════════════
function initChatRoom() {
  safeOn('chatRoomBack', 'click', () => { safeGet('chatRoom')?.classList.remove('open'); if (unsubMessages) unsubMessages(); if (unsubChatMeta) unsubChatMeta(); if (unsubTyping) unsubTyping(); currentChatId = null; });
  safeOn('chatRoomOptionsBtn', 'click', () => openModal('chatOptionsModal'));
  safeOn('chatRoomCallBtn', 'click', () => startCall(false));
  safeOn('chatRoomVideoBtn', 'click', () => startCall(true));

  const input = safeGet('chatInput');
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto'; input.style.height = Math.min(130, input.scrollHeight) + 'px';
      handleTypingBroadcast();
      const hasText = input.value.trim().length > 0;
      safeGet('chatSendBtn')?.classList.toggle('hidden', !hasText);
      safeGet('chatVoiceBtn')?.classList.toggle('hidden', hasText);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && getSetting('enterSend') !== 'false') { e.preventDefault(); sendTextMessage(); } });
  }

  safeOn('chatSendBtn', 'click', sendTextMessage);
  safeOn('replyCancelBtn', 'click', () => { replyTo = null; safeGet('replyPreviewBar')?.classList.add('hidden'); });
  safeOn('pinnedBannerClose', 'click', () => { if (currentChatId) updateDoc(doc(db, 'chats', currentChatId), { pinnedMessage: null }); });
  safeOn('chatAttachBtn', 'click', () => safeGet('chatAttachInput')?.click());
  
  safeOn('chatAttachInput', 'change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    toast('Mengunggah media...', 'info');
    try { const url = await uploadToCloudinary(file); await sendMessagePayload(buildMessagePayload(file.type.startsWith('video') ? 'video' : 'image', { image: url })); } catch (err) { toast('Gagal upload media.', 'error'); }
    e.target.value = '';
  });

  safeOn('chatVoiceBtn', 'click', startRecording);
  safeOn('recorderCancelBtn', 'click', () => stopRecording(false));
  safeOn('recorderSendBtn', 'click', () => stopRecording(true));

  safeOn('chatOptionProfile', 'click', () => { closeModal('chatOptionsModal'); if (currentChatType === 'dm') window.openUserProfileModal(currentChatId.split('_').find(u=>u!==currentUser.uid)); });
  safeOn('chatOptionGroupSettings', 'click', () => { closeModal('chatOptionsModal'); openGroupSettings(); });
  safeOn('chatOptionClear', 'click', () => {
    closeModal('chatOptionsModal');
    showConfirm('Bersihkan Chat', 'Hapus semua pesan?', async () => {
      if (!currentChatId) return;
      const msgs = await getDocs(collection(db, 'chats', currentChatId, 'messages'));
      const batch = writeBatch(db); msgs.forEach(m => batch.delete(m.ref));
      batch.update(doc(db, 'chats', currentChatId), { lastMessage: '', lastSenderId: '', pinnedMessage: null });
      await batch.commit(); toast('Chat dibersihkan.', 'success');
    });
  });
  safeOn('btnChatOptionsClose', 'click', () => closeModal('chatOptionsModal'));
}

async function openChat(chatId, chatType, otherUid) {
  try {
    const chatRef = doc(db, 'chats', chatId); const chatSnap = await getDoc(chatRef);
    if (!chatSnap.exists()) { toast('Chat tidak ditemukan.', 'error'); return; }
    currentChatId = chatId; currentChatType = chatType; currentChatData = { id: chatId, ...chatSnap.data() };
    let otherData = null; if (chatType === 'dm' && otherUid) otherData = await getUserData(otherUid);

    if (chatType === 'group') {
      safeGet('chatRoomName').textContent = currentChatData.groupName || 'Grup';
      safeGet('chatRoomStatus').textContent = `${(currentChatData.members || []).length} anggota`;
      safeGet('chatRoomCallBtn').style.display = 'none'; safeGet('chatRoomVideoBtn').style.display = 'none';
      safeGet('chatOptionGroupSettings')?.classList.remove('hidden');
    } else {
      const name = otherData?.displayName || otherData?.username || 'User';
      safeGet('chatRoomName').innerHTML = `${escapeHtml(name)} ${otherData?.isVerified ? '<span class="badge badge-verified">✓</span>' : ''}`;
      safeGet('chatRoomStatus').textContent = isOnline(otherData) ? 'Online' : 'Offline';
      safeGet('chatRoomCallBtn').style.display = ''; safeGet('chatRoomVideoBtn').style.display = '';
      safeGet('chatOptionGroupSettings')?.classList.add('hidden');
      safeGet('chatRoomAvatar').innerHTML = otherData?.photoURL ? `<img src="${otherData.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />` : `<div class="avatar-fallback" style="width:100%;height:100%;background:${getAvatarColor(otherUid)};color:#08120f;">${getInitials(name)}</div>`;
    }

    safeGet('chatRoom').classList.add('open');
    
    if (unsubChatMeta) unsubChatMeta();
    unsubChatMeta = onSnapshot(chatRef, (snap) => {
      if (!snap.exists()) return; currentChatData = { id: snap.id, ...snap.data() };
      const pm = currentChatData.pinnedMessage;
      if (pm) { safeGet('pinnedBannerText').innerHTML = `<b>${escapeHtml(pm.senderName)}:</b> ${escapeHtml(truncate(pm.text, 50))}`; safeGet('pinnedBanner').classList.remove('hidden'); }
      else safeGet('pinnedBanner').classList.add('hidden');
    });

    if (unsubMessages) unsubMessages();
    unsubMessages = onSnapshot(query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'), limit(200)), async (snap) => {
      const msgs = []; snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
      renderMessages(msgs);
      const batch = writeBatch(db);
      msgs.forEach(m => { if (m.senderId !== currentUser.uid && !(m.readBy || []).includes(currentUser.uid)) batch.update(doc(db, 'chats', chatId, 'messages', m.id), { readBy: arrayUnion(currentUser.uid) }); });
      await batch.commit();
      updateDoc(chatRef, { [`readAt.${currentUser.uid}`]: serverTimestamp() }).catch(()=>{});
    });

    if (unsubTyping) unsubTyping();
    if (chatType === 'dm' && otherUid) {
      unsubTyping = onSnapshot(doc(db, 'users', otherUid), (snap) => {
        if (!snap.exists()) return; const d = snap.data(); const statusEl = safeGet('chatRoomStatus');
        if (d.typingIn === chatId) { statusEl.textContent = 'sedang mengetik...'; statusEl.style.color = 'var(--neon)'; }
        else { statusEl.textContent = isOnline(d) ? 'Online' : 'Offline'; statusEl.style.color = isOnline(d) ? 'var(--success)' : 'var(--text-3)'; }
      });
    }
  } catch (err) { toast('Gagal buka chat.', 'error'); }
}

function renderMessages(msgs) {
  const container = safeGet('chatMessagesArea'); if (!container) return;
  let html = '', lastDay = '';
  const now = new Date();
  
  for (const m of msgs) {
    if (m.expiresAt && m.expiresAt.toDate() < now) continue;
    const d = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
    const dayStr = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    if (dayStr !== lastDay) { html += `<div class="date-sep">${dayStr}</div>`; lastDay = dayStr; }

    const isOwn = m.senderId === currentUser.uid;
    const senderName = currentChatType === 'group' && !isOwn ? `<div class="bubble-sender">${escapeHtml(m.senderName || 'User')}</div>` : '';
    
    const unlockAt = m.unlockTime?.toDate ? m.unlockTime.toDate() : null;
    if (unlockAt && unlockAt > now && !isOwn) {
      html += `<div class="bubble-row incoming"><div class="chat-bubble" style="opacity:0.8;"><div style="color:var(--text-2);">🔒 Pesan terkunci</div></div></div>`; continue;
    }

    let replyHtml = m.replyTo ? `<div class="bubble-reply"><span class="bubble-reply-name">${escapeHtml(m.replyTo.senderName)}</span><span class="bubble-reply-text">${escapeHtml(truncate(m.replyTo.text, 30))}</span></div>` : '';
    let body = '';
    if (m.type === 'text') body = `<div class="bubble-text">${formatText(m.text)}</div>`;
    else if (m.type === 'image' || m.type === 'video') body = `<div class="bubble-image" onclick="window.openImageViewer('${m.image}')"><img src="${m.image}" style="max-width:100%;border-radius:8px;" /></div>`;
    else if (m.type === 'voice') body = `<div class="bubble-voice" data-audio="${m.audio}"><button class="voice-play-btn">▶</button><div class="voice-waveform"></div><span class="voice-duration">${formatDuration(m.audioDuration)}</span></div>`;

    const othersRead = isOwn && (m.readBy || []).some((u) => u !== currentUser.uid);
    const checkHtml = isOwn ? `<span class="bubble-check ${othersRead ? 'read' : 'sent'}">${othersRead ? '✓✓' : '✓'}</span>` : '';
    
    let reactionsHtml = ''; 
    if (m.reactions && Object.keys(m.reactions).length) {
      reactionsHtml = `<div class="bubble-reactions">` + Object.entries(m.reactions).map(([e, l]) => l.length ? `<span class="bubble-reaction-chip ${l.includes(currentUser.uid) ? 'self' : ''}" onclick="window.toggleReaction('${m.id}', '${e}')">${parseEmojis(e)} ${l.length}</span>` : '').join('') + `</div>`;
    }

    html += `<div class="bubble-row ${isOwn ? 'outgoing' : 'incoming'}" data-msg-id="${m.id}" data-own="${isOwn}">
      <span class="swipe-indicator">↩</span>
      <div class="chat-bubble" oncontextmenu="window.showLongPressMenu(event, '${m.id}', ${isOwn})">
        ${senderName}${replyHtml}${body}
        <div class="bubble-meta"><span>${formatTime(m.createdAt)}</span>${checkHtml}</div>
        ${reactionsHtml}
      </div>
    </div>`;
  }
  container.innerHTML = html; container.scrollTop = container.scrollHeight;

  container.querySelectorAll('.bubble-voice').forEach(el => {
    el.onclick = () => { const audio = new Audio(el.dataset.audio); audio.play(); el.querySelector('.voice-play-btn').innerHTML = '⏸'; audio.onended = () => el.querySelector('.voice-play-btn').innerHTML = '▶'; };
  });

  container.querySelectorAll('.bubble-row').forEach(row => {
    let startX = 0, moved = false;
    row.ontouchstart = (e) => { startX = e.touches[0].clientX; moved = false; };
    row.ontouchmove = (e) => { const dx = e.touches[0].clientX - startX; if (Math.abs(dx) > 10) moved = true; if (Math.abs(dx) < 100) row.style.transform = `translateX(${dx}px)`; };
    row.ontouchend = (e) => {
      const dx = e.changedTouches[0].clientX - startX; row.style.transform = '';
      if (moved) { if (dx > 60) window.setReply(row.dataset.msgId); if (dx < -60 && row.dataset.own === 'true') window.deleteMessage(row.dataset.msgId); }
    };
  });
}

window.showLongPressMenu = (e, msgId, isOwn) => {
  e.preventDefault();
  const existing = document.querySelector('.emoji-picker-float'); if (existing) existing.remove();
  const menu = document.createElement('div'); menu.className = 'emoji-picker-float';
  menu.style.cssText = `position:fixed; top:${e.clientY - 50}px; left:${e.clientX - 80}px; z-index:9999; background:var(--surface); padding:8px; border-radius:20px; display:flex; gap:8px; box-shadow:0 4px 12px rgba(0,0,0,0.5);`;
  REACTION_EMOJIS.forEach(emoji => {
    const btn = document.createElement('button'); btn.innerHTML = `<img class="apple-emoji" src="https://emojicdn.elk.sh/${encodeURIComponent(emoji)}?style=apple" style="width:24px;">`;
    btn.onclick = () => { window.toggleReaction(msgId, emoji); menu.remove(); }; menu.appendChild(btn);
  });
  if (isOwn) {
    const del = document.createElement('button'); del.innerHTML = '🗑'; del.style.fontSize = '20px';
    del.onclick = () => { window.deleteMessage(msgId); menu.remove(); }; menu.appendChild(del);
  }
  document.body.appendChild(menu);
  setTimeout(() => document.body.addEventListener('click', () => menu.remove(), { once: true }), 100);
};

window.toggleReaction = async (msgId, emoji) => {
  const ref = doc(db, 'chats', currentChatId, 'messages', msgId); const snap = await getDoc(ref);
  const reactions = { ...(snap.data().reactions || {}) }; const list = reactions[emoji] || [];
  const newList = list.includes(currentUser.uid) ? list.filter(u => u !== currentUser.uid) : [...list, currentUser.uid];
  if (newList.length) reactions[emoji] = newList; else delete reactions[emoji];
  await updateDoc(ref, { reactions });
};

window.setReply = async (msgId) => {
  const snap = await getDoc(doc(db, 'chats', currentChatId, 'messages', msgId)); if (!snap.exists()) return;
  const m = snap.data(); replyTo = { id: msgId, senderName: m.senderName, text: m.type === 'text' ? m.text : '📷 Media' };
  safeGet('replyBarName').textContent = replyTo.senderName; safeGet('replyBarText').textContent = truncate(replyTo.text, 40);
  safeGet('replyPreviewBar').classList.remove('hidden'); safeGet('chatInput').focus();
};

window.deleteMessage = (msgId) => { showConfirm('Hapus', 'Hapus pesan ini untuk semua orang?', async () => { await deleteDoc(doc(db, 'chats', currentChatId, 'messages', msgId)); }); };

function buildMessagePayload(type, fields) {
  const payload = { senderId: currentUser.uid, senderName: currentUserData.displayName || currentUserData.username, type, text: fields.text || '', image: fields.image || null, audio: fields.audio || null, audioDuration: fields.audioDuration || 0, replyTo: replyTo ? { ...replyTo } : null, reactions: {}, readBy: [currentUser.uid], unlockTime: null, createdAt: serverTimestamp() };
  return payload;
}

async function sendMessagePayload(payload) {
  if (!currentChatId) return;
  try {
    await addDoc(collection(db, 'chats', currentChatId, 'messages'), payload);
    await updateDoc(doc(db, 'chats', currentChatId), { lastMessage: payload.type === 'text' ? payload.text : (payload.type === 'image' ? '📷 Foto' : '🎤 Voice'), lastSenderId: currentUser.uid, lastMessageAt: serverTimestamp() });
    replyTo = null; safeGet('replyPreviewBar').classList.add('hidden');
  } catch (err) { toast('Gagal kirim pesan.', 'error'); }
}

function sendTextMessage() { const input = safeGet('chatInput'); const text = input.value.trim(); if (!text || !currentChatId) return; input.value = ''; input.style.height = 'auto'; safeGet('chatSendBtn').classList.add('hidden'); safeGet('chatVoiceBtn').classList.remove('hidden'); sendMessagePayload(buildMessagePayload('text', { text })); }
function handleTypingBroadcast() { updateDoc(doc(db, 'users', currentUser.uid), { typingIn: currentChatId || null }).catch(()=>{}); }

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream); audioChunks = []; mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.start(); let start = Date.now();
    safeGet('chatInputArea').style.display = 'none'; safeGet('recorderBar').classList.remove('hidden');
    let timer = setInterval(() => { safeGet('recorderTimer').textContent = formatDuration((Date.now() - start) / 1000); }, 250);
    mediaRecorder.onstop = () => { clearInterval(timer); if (mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(t => t.stop()); };
  } catch (err) { toast('Akses mikrofon ditolak.', 'error'); }
}

async function stopRecording(send) {
  if (!mediaRecorder) return; 
  mediaRecorder.stop();
  mediaRecorder.onstop = () => {
    if (send && audioChunks.length) {
      const reader = new FileReader(); reader.onload = () => sendMessagePayload(buildMessagePayload('voice', { audio: reader.result, audioDuration: parseInt(safeGet('recorderTimer').textContent.split(':')[1] || 0) }));
      reader.readAsDataURL(new Blob(audioChunks, { type: 'audio/webm' }));
    }
    mediaRecorder = null; audioChunks = []; safeGet('recorderBar').classList.add('hidden'); safeGet('chatInputArea').style.display = 'flex';
  };
}

// ════════════════ 8. GROUPS ════════════════
safeOn('btnCreateGroupClose', 'click', () => closeModal('createGroupModal'));
safeOn('btnCreateGroupConfirm', 'click', async () => {
  const name = safeGet('createGroupName').value.trim(); if (!name) return;
  const groupId = generateGroupId(); const chatId = `group_${groupId}`;
  await setDoc(doc(db, 'groups', groupId), { groupId, name, members: [currentUser.uid], admin: currentUser.uid, createdAt: serverTimestamp() });
  await setDoc(doc(db, 'chats', chatId), { type: 'group', groupName: name, groupId, members: [currentUser.uid], admin: currentUser.uid, lastMessage: '', lastMessageAt: serverTimestamp(), readAt: {}, boostLevel: 0 });
  closeModal('createGroupModal'); safeGet('createGroupName').value = ''; toast('Grup dibuat!', 'success'); openChat(chatId, 'group');
});

function openGroupSettings() {
  if (currentChatType !== 'group') return;
  safeGet('gsName').value = currentChatData.groupName || ''; safeGet('gsBio').value = currentChatData.bio || '';
  safeGet('gsBoostLevel').textContent = currentChatData.boostLevel || 0; openModal('groupSettingsModal');
}

safeOn('btnGroupSettingsClose', 'click', () => closeModal('groupSettingsModal'));
safeOn('btnSaveGroupSettings', 'click', async () => {
  if (!currentChatData?.groupId) return;
  await updateDoc(doc(db, 'groups', currentChatData.groupId), { name: safeGet('gsName').value, bio: safeGet('gsBio').value, link: safeGet('gsLink').value, username: safeGet('gsUsername').value });
  await updateDoc(doc(db, 'chats', currentChatId), { groupName: safeGet('gsName').value });
  closeModal('groupSettingsModal'); toast('Grup disimpan.', 'success');
});
// ════════════════ 9. PROFIL & ADMIN ════════════════
function initProfile() {
  // Ganti Foto & Banner
  safeOn('profileAvatarBtn', 'click', () => safeGet('profileAvatarInput')?.click());
  safeOn('profileBannerEditBtn', 'click', () => safeGet('profileBannerInput')?.click());

  safeOn('profileAvatarInput', 'change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const b64 = await compressImage(file, 500, 500, 0.8);
      safeGet('cropperImage').src = b64; openModal('cropperModal');
      setTimeout(() => {
        if (typeof Cropper !== 'undefined') {
          if (cropperInstance) cropperInstance.destroy();
          cropperInstance = new Cropper(safeGet('cropperImage'), { aspectRatio: 1, viewMode: 1, autoCropArea: 0.9, background: false });
        }
      }, 100);
    } catch (err) { toast('Gagal memproses gambar.', 'error'); }
    e.target.value = '';
  });

  safeOn('btnCropperSave', 'click', async () => {
    if (!cropperInstance) return;
    const canvas = cropperInstance.getCroppedCanvas({ width: 400, height: 400 });
    const b64 = canvas.toDataURL('image/jpeg', 0.8);
    await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: b64 });
    currentUserData.photoURL = b64; closeModal('cropperModal'); initHeader(); refreshProfileUI(); toast('Foto profil diperbarui.', 'success');
  });
  safeOn('btnCropperClose', 'click', () => closeModal('cropperModal'));
  safeOn('btnCropperCancel', 'click', () => closeModal('cropperModal'));

  safeOn('profileBannerInput', 'change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const b64 = await cropToRatio(file, 16, 6, 0.72);
      await updateDoc(doc(db, 'users', currentUser.uid), { banner: b64 });
      currentUserData.banner = b64; refreshProfileUI(); toast('Banner diperbarui.', 'success');
    } catch (err) { toast('Gagal memproses banner.', 'error'); }
    e.target.value = '';
  });

  // Edit Profil (Teks)
  safeOn('profileEditBtn', 'click', () => { safeGet('editDisplayName').value = currentUserData.displayName || ''; safeGet('editBio').value = currentUserData.bio || ''; safeGet('editMusicLink').value = currentUserData.musicLink || ''; openModal('editProfileModal'); });
  safeOn('btnEditProfileClose', 'click', () => closeModal('editProfileModal'));
  safeOn('btnSaveProfile', 'click', async () => {
    await updateDoc(doc(db, 'users', currentUser.uid), { displayName: safeGet('editDisplayName').value, bio: safeGet('editBio').value, musicLink: safeGet('editMusicLink').value });
    closeModal('editProfileModal'); toast('Profil disimpan.', 'success'); location.reload();
  });

  // Tab Profil (Postingan, Repost, Disukai)
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.profile-tab').forEach(t => { t.style.color = 'var(--text-3)'; t.style.borderBottom = '2px solid transparent'; });
      tab.style.color = 'var(--neon)'; tab.style.borderBottom = '2px solid var(--neon)';
      profileTab = tab.dataset.ptab;
      loadProfilePosts();
    };
  });

  // Tombol FAB (Tambah Postingan)
  safeOn('profileFAB', 'click', () => { toast('Fitur posting dari profil belum tersedia. Gunakan tab Beranda.', 'info'); });

  safeOn('menuShop', 'click', () => openModal('premiumModal'));
  safeOn('btnPremiumClose', 'click', () => closeModal('premiumModal'));
  safeOn('menuLogout', 'click', () => showConfirm('Keluar', 'Yakin ingin keluar?', async () => { await signOut(auth); window.location.href = 'index.html'; }));

  // Admin Actions
  safeOn('btnAdminInject', 'click', () => adminAction('inject'));
  safeOn('btnAdminVerify', 'click', () => adminAction('verify'));
  safeOn('btnAdminPremium', 'click', () => adminAction('premium'));
  safeOn('btnAdminToggle', 'click', () => adminAction('admin'));
  safeOn('btnAdminDev', 'click', () => adminAction('dev'));
  safeOn('btnAdminCreator', 'click', () => adminAction('creator'));
  
  // FITUR GHOST MODE (Penyamaran)
  safeOn('btnAdminGhost', 'click', () => {
    const currentGhost = getSetting('ghostMode') === 'true';
    setSetting('ghostMode', !currentGhost);
    toast(!currentGhost ? 'Mode Penyamaran AKTIF. Badge & Panel Admin disembunyikan.' : 'Mode Penyamaran MATI.', 'success');
    refreshProfileUI();
  });
  
  refreshProfileUI();
}

function loadProfilePosts() {
  const container = safeGet('profilePostsList'); container.innerHTML = '<div class="text-center" style="padding:20px;"><span class="spinner"></span></div>';
  if (unsubProfileFeed) unsubProfileFeed();
  
  let q;
  if (profileTab === 'posts') q = query(collection(db, 'posts'), where('authorId', '==', currentUser.uid), orderBy('createdAt', 'desc'));
  else if (profileTab === 'reposts') q = query(collection(db, 'posts'), where('authorId', '==', currentUser.uid), where('isRepost', '==', true), orderBy('createdAt', 'desc'));
  else if (profileTab === 'likes') q = query(collection(db, 'posts'), where('likedBy', 'array-contains', currentUser.uid), orderBy('createdAt', 'desc'));

  unsubProfileFeed = onSnapshot(q, (snap) => {
    if (snap.empty) { container.innerHTML = `<div class="empty-state"><p>Belum ada postingan di sini.</p></div>`; return; }
    let html = '';
    snap.forEach(d => {
      const p = d.data(); const dId = d.id; const liked = (p.likedBy || []).includes(currentUser.uid);
      // Di tab "posts" biasa, sembunyikan repost. Di tab "reposts", cuma tampilkan repost.
      if (profileTab === 'posts' && p.isRepost) return;

      html += `<div class="post-card">
        <div class="post-header"><div class="post-avatar">${p.authorPhoto ? `<img src="${p.authorPhoto}"/>` : `<div class="avatar-fallback" style="background:${getAvatarColor(p.authorId)};color:#08120f;">${getInitials(p.authorName)}</div>`}</div><div class="post-meta"><div class="post-author">${escapeHtml(p.authorName)} ${p.isRepost ? '<span class="text-muted" style="font-size:11px;">repost</span>' : ''}</div><div class="post-time">${formatRelativeTime(p.createdAt)}</div></div></div>
        ${p.text ? `<div class="post-content">${formatText(p.text)}</div>` : ''}
        ${p.mediaUrl ? (p.mediaType === 'video' ? `<div class="post-image"><video src="${p.mediaUrl}" controls playsinline></video></div>` : `<div class="post-image" onclick="window.openImageViewer('${p.mediaUrl}')"><img src="${p.mediaUrl}"/></div>`) : ''}
        <div class="post-actions"><button class="post-action-btn ${liked ? 'liked' : ''}" onclick="window.toggleLike('${dId}')"><i class="ph${liked ? '-fill' : ''} ph-heart"></i> ${(p.likedBy || []).length}</button><button class="post-action-btn" onclick="window.openComments('${dId}')"><i class="ph ph-chat-circle"></i> ${p.commentsCount || 0}</button></div>
      </div>`;
    });
    container.innerHTML = html;
  });
}

async function adminAction(type) {
  const username = safeGet('adminTargetUsername').value.toLowerCase().trim(); if (!username) return toast('Masukkan username target.', 'error');
  try {
    const snap = await getDoc(doc(db, 'usernames', username)); if (!snap.exists()) return toast('User tidak ditemukan.', 'error');
    const ref = doc(db, 'users', snap.data().uid);
    if (type === 'inject') await updateDoc(ref, { followers: increment(100) });
    else if (type === 'verify') await updateDoc(ref, { isVerified: true });
    else if (type === 'premium') await updateDoc(ref, { isPremium: true });
    else if (type === 'admin') await updateDoc(ref, { isAdmin: true });
    else if (type === 'dev') await updateDoc(ref, { isVerified: true, isDev: true });
    else if (type === 'creator') await updateDoc(ref, { isVerified: true, badge: 'creator' });
    toast('Aksi admin berhasil.', 'success');
    safeGet('adminTargetUsername').value = '';
  } catch (e) { toast('Gagal.', 'error'); }
}

function refreshProfileUI() {
  const isDev = currentUserData?.isDev === true || currentUserData?.username === 'maklov1';
  const isGhost = getSetting('ghostMode') === 'true';
  
  // Bikin Badge Developer Emas
  let devBadge = '';
  if (isDev && !isGhost) {
    devBadge = `<span class="badge badge-dev" style="background:linear-gradient(135deg,#FFD700,#FFA500);color:#000;font-weight:800;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:5px;">👑 Developer</span>`;
  }

  safeGet('profileName').innerHTML = `${escapeHtml(currentUserData.displayName || 'User')} ${devBadge} ${currentUserData.isVerified && !isDev ? '<span class="badge badge-verified">✓</span>' : ''} ${currentUserData.isPremium ? '<span class="badge badge-premium">★</span>' : ''}`;
  safeGet('profileUsername').textContent = '@' + (currentUserData.username || 'user');
  safeGet('profileBio').innerHTML = currentUserData.bio ? parseEmojis(escapeHtml(currentUserData.bio)) : 'Belum ada bio.';
  safeGet('profileFollowersCount').textContent = currentUserData.followers || 0;
  safeGet('profileFollowingCount').textContent = currentUserData.following || 0;
  
  // Sembunyiin panel admin kalau mode penyamaran aktif
  safeGet('adminSection').classList.toggle('hidden', (!isDev) || isGhost);
  
  const fallback = safeGet('profileAvatarFallback'), img = safeGet('profileAvatarImg'), banner = safeGet('profileBannerImg');
  if (currentUserData.photoURL) { img.src = currentUserData.photoURL; img.classList.remove('hidden'); fallback.classList.add('hidden'); }
  else { fallback.textContent = getInitials(currentUserData.displayName || 'U'); fallback.style.background = getAvatarColor(currentUser.uid); fallback.style.color = '#08120f'; fallback.classList.remove('hidden'); img.classList.add('hidden'); }
  
  if (currentUserData.banner) { banner.src = currentUserData.banner; banner.classList.remove('hidden'); } else banner.classList.add('hidden');
  
  const audio = safeGet('profileMusicAudio'), musicWrap = safeGet('profileMusicWrap');
  if (currentUserData.musicLink) { musicWrap.classList.remove('hidden'); if(audio.src !== currentUserData.musicLink) audio.src = currentUserData.musicLink; }
  else musicWrap.classList.add('hidden');

  loadProfilePosts();
}

window.openUserProfileModal = async (uid) => {
  if (!uid || uid === currentUser.uid) return switchTab('profile');
  const data = await getUserData(uid); if (!data) return toast('User tidak ditemukan.', 'error');
  
  const isDev = data.isDev === true || data.username === 'maklov1';
  let devBadge = isDev ? `<span class="badge badge-dev" style="background:linear-gradient(135deg,#FFD700,#FFA500);color:#000;font-weight:800;padding:2px 8px;border-radius:12px;font-size:10px;margin-left:5px;">👑 Developer</span>` : '';

  safeGet('userProfileName').innerHTML = `${escapeHtml(data.displayName || 'User')} ${devBadge} ${data.isVerified && !isDev ? '<span class="badge badge-verified">✓</span>' : ''}`;
  safeGet('userProfileUsername').textContent = '@' + (data.username || 'user');
  safeGet('userProfileBio').textContent = data.bio || 'Belum ada bio.';
  safeGet('userProfileFollowersCount').textContent = data.followers || 0;
  safeGet('userProfileFollowingCount').textContent = data.following || 0;
  
  if (data.photoURL) { safeGet('userProfileAvatarImg').src = data.photoURL; safeGet('userProfileAvatarImg').classList.remove('hidden'); safeGet('userProfileAvatarFallback').classList.add('hidden'); }
  else { safeGet('userProfileAvatarFallback').textContent = getInitials(data.displayName || 'U'); safeGet('userProfileAvatarFallback').classList.remove('hidden'); safeGet('userProfileAvatarImg').classList.add('hidden'); }
  
  safeGet('btnUserProfileMessage').onclick = async () => { closeModal('userProfileModal'); const chatId = await getOrCreateDM(uid); openChat(chatId, 'dm', uid); };
  safeOn('btnUserProfileClose', 'click', () => closeModal('userProfileModal'));
  openModal('userProfileModal');
};

// ════════════════ 10. PEERJS CALL ════════════════
function initCall() { 
  safeOn('callEndBtn', 'click', endCall); 
  safeOn('callAcceptBtn', 'click', acceptCall); 
  safeOn('callMuteBtn', 'click', toggleMute); 
}

async function startCall(isVideo) {
  if (currentChatType !== 'dm') return toast('Call hanya di DM.', 'info');
  const otherUid = currentChatId.split('_').find(u => u !== currentUser.uid);
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
    if (isVideo) { safeGet('localVideo').srcObject = localStream; safeGet('localVideo').style.display = 'block'; }
    peer = new Peer();
    peer.on('open', async (id) => {
      const callRef = await addDoc(collection(db, 'calls'), { fromUid: currentUser.uid, toUid: otherUid, fromPeerId: id, status: 'ringing', isVideo, createdAt: serverTimestamp() });
      currentCall = { id: callRef.id, direction: 'outgoing', isVideo };
      safeGet('callScreen').classList.add('open'); safeGet('callStatus').textContent = 'Memanggil...';
      safeGet('callName').textContent = (await getUserData(otherUid))?.displayName || 'User';
      
      onSnapshot(doc(db, 'calls', callRef.id), (snap) => {
        const d = snap.data();
        if (d.status === 'accepted') { const call = peer.call(d.toPeerId, localStream); call.on('stream', (remoteStream) => { safeGet('remoteVideo').srcObject = remoteStream; }); }
        else if (d.status === 'ended') cleanupCall();
      });
    });
  } catch (err) { toast('Gagal memanggil.', 'error'); cleanupCall(); }
}

function listenIncomingCalls() {
  onSnapshot(query(collection(db, 'calls'), where('toUid', '==', currentUser.uid), where('status', '==', 'ringing')), (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added' && !currentCall) {
        const d = change.doc.data();
        currentCall = { id: change.doc.id, fromPeerId: d.fromPeerId, direction: 'incoming', isVideo: d.isVideo };
        safeGet('callScreen').classList.add('open'); safeGet('callStatus').textContent = 'Panggilan Masuk...'; safeGet('callAcceptBtn').classList.remove('hidden');
      }
    });
  });
}

async function acceptCall() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: currentCall.isVideo });
  peer = new Peer();
  peer.on('open', async (id) => {
    await updateDoc(doc(db, 'calls', currentCall.id), { status: 'accepted', toPeerId: id });
    safeGet('callAcceptBtn').classList.add('hidden');
    peer.on('call', (call) => { call.answer(localStream); call.on('stream', (remoteStream) => { safeGet('remoteVideo').srcObject = remoteStream; }); });
  });
}

function endCall() { if (currentCall) updateDoc(doc(db, 'calls', currentCall.id), { status: 'ended' }); cleanupCall(); }
function cleanupCall() { safeGet('callScreen').classList.remove('open'); if (localStream) localStream.getTracks().forEach(t => t.stop()); if (peer) peer.destroy(); currentCall = null; }
function toggleMute() { if (localStream) { const enabled = localStream.getAudioTracks()[0].enabled; localStream.getAudioTracks()[0].enabled = !enabled; safeGet('callMuteBtn').classList.toggle('active', enabled); } }

// ════════════════ 11. GLOBAL MODALS & UTILS ════════════════
function showConfirm(title, text, cb) { 
  safeGet('confirmTitle').textContent = title; safeGet('confirmText').textContent = text; 
  safeGet('btnConfirmYes').onclick = () => { cb(); closeModal('confirmModal'); }; 
  safeGet('btnConfirmNo').onclick = () => closeModal('confirmModal'); 
  openModal('confirmModal'); 
}

window.openImageViewer = (src) => { safeGet('imageViewerImg').src = src; openModal('imageViewerModal'); safeOn('btnImageViewerClose', 'click', () => closeModal('imageViewerModal')); };

console.log('%c[Gpyth Chat] main.js FULLY LOADED — SEMUA FITUR AKTIF!', 'color:#00ffc8; font-weight:800; font-size:16px;');