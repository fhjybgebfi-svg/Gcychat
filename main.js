import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { parseEmojis, formatText, escapeHtml, compressImage, cropToRatio, formatTime, formatRelativeTime, formatSmartTime, formatDuration, debounce, generateGroupId, toast, getInitials, getAvatarColor, REACTION_EMOJIS, truncate, uploadToCloudinary, getSetting, setSetting } from "./utils.js";

let currentUser = null, currentUserData = null;
let currentChatId = null, currentChatType = null, currentChatData = null, currentShopItem = null;
let unsubFeed = null, unsubChatList = null, unsubMessages = null, unsubChatMeta = null, unsubTyping = null;
let replyTo = null, cropperInstance = null, mediaRecorder = null, audioChunks = [], peer = null, currentCall = null, localStream = null;

// EXPOSE GLOBAL FUNCTIONS (ANTI MATI TOMBOL)
window.openModal = (id) => document.getElementById(id)?.classList.add('open');
window.closeModal = (id) => document.getElementById(id)?.classList.remove('open');
window.switchTab = (name) => {
  ['feed', 'reels', 'chat', 'profile', 'userProfile'].forEach((t) => {
    const p = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    const b = document.getElementById('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
    if (p) p.classList.toggle('active', t === name);
    if (b) b.classList.toggle('active', t === name);
  });
  document.getElementById('profileFAB').classList.toggle('hidden', name !== 'profile');
  if (name === 'chat') initChatList(); if (name === 'profile') refreshProfileUI();
  document.getElementById('appContent').style.overflow = (name === 'userProfile') ? 'hidden' : 'auto';
};
window.cancelReply = () => { replyTo = null; document.getElementById('replyPreviewBar').classList.add('hidden'); };
window.closeChatRoom = () => { 
  document.getElementById('chatRoom').classList.remove('open'); 
  if (unsubMessages) unsubMessages(); if (unsubChatMeta) unsubChatMeta(); if (unsubTyping) unsubTyping(); 
  if (currentChatId) updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null }).catch(()=>{});
  currentChatId = null; 
};
window.switchShopTab = (tabName, btn) => {
  document.querySelectorAll('.shop-tab').forEach(t => { t.classList.remove('active'); t.style.color = 'var(--text-3)'; t.style.borderBottom = '2px solid transparent'; });
  btn.classList.add('active'); btn.style.color = 'var(--neon)'; btn.style.borderBottom = '2px solid var(--neon)';
  document.querySelectorAll('.shop-content').forEach(c => c.style.display = 'none');
  const content = document.getElementById('shopTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (content) content.style.display = 'block';
};
window.openCheckout = (productName, price) => {
  currentShopItem = { name: productName, price: price };
  document.getElementById('coProductName').textContent = productName;
  document.getElementById('coProductPrice').textContent = 'Rp ' + Number(price).toLocaleString('id-ID');
  document.getElementById('coTargetUser').value = currentUserData.username;
  window.openModal('checkoutModal');
};
window.logoutAction = () => { showConfirm('Keluar', 'Yakin ingin keluar?', async () => { await signOut(auth); window.location.href = 'index.html'; }); };
window.testMediaPermission = async () => { toast('Meminta izin...', 'info'); try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); toast('Izin diberikan!', 'success'); s.getTracks().forEach(t => t.stop()); } catch (e) { alert("IZIN DITOLAK. Buka Pengaturan Browser -> Izinkan Kamera/Mic -> Refresh."); } };
window.newContactAction = () => { const term = prompt('Masukkan Username:'); if(term && term.trim()) { const search = document.getElementById('chatSearchInput'); search.value = term.trim().toLowerCase(); search.dispatchEvent(new Event('input')); } };
window.saveProfileAction = async () => { await updateDoc(doc(db, 'users', currentUser.uid), { displayName: document.getElementById('editDisplayName').value, bio: document.getElementById('editBio').value, musicLink: document.getElementById('editMusicLink').value }); window.closeModal('editProfileModal'); location.reload(); };
window.saveCroppedAvatar = async () => { if (!cropperInstance) return; const c = cropperInstance.getCroppedCanvas({ width: 400, height: 400 }); const b64 = c.toDataURL('image/jpeg', 0.8); await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: b64 }); location.reload(); };
window.createGroupAction = async () => { const name = document.getElementById('createGroupName').value.trim(); if (!name) return; const gId = generateGroupId(); const cId = 'group_' + gId; await setDoc(doc(db, 'groups', gId), { groupId: gId, name, members: [currentUser.uid], admin: currentUser.uid, createdAt: serverTimestamp() }); await setDoc(doc(db, 'chats', cId), { type: 'group', groupName: name, groupId: gId, members: [currentUser.uid], admin: currentUser.uid, lastMessage: '', lastMessageAt: serverTimestamp(), readAt: {} }); window.closeModal('createGroupModal'); openChat(cId, 'group'); };
window.toggleGhostMode = () => { const g = getSetting('ghostMode') === 'true'; setSetting('ghostMode', !g); toast(!g ? 'Ghost AKTIF' : 'Ghost MATI', 'success'); refreshProfileUI(); };
window.seeProfileFromChat = () => { window.closeModal('chatOptionsModal'); if (currentChatType === 'dm') { const o = currentChatId.split('_').find(u => u !== currentUser.uid); if (o) openUserProfilePage(o); } };
window.renameContactAction = () => { window.closeModal('chatOptionsModal'); if (currentChatType !== 'dm') return toast('Hanya untuk chat pribadi.', 'info'); const n = prompt('Masukkan nama baru:', document.getElementById('chatRoomName').textContent.trim()); if (n && n.trim()) { updateDoc(doc(db, 'chats', currentChatId), { ['customNames.' + currentUser.uid]: n.trim() }); document.getElementById('chatRoomName').textContent = n.trim(); toast('Nama diubah.', 'success'); } };
window.reportScamAction = async () => { showConfirm('Report Scam', 'Laporkan user ini sebagai scammer?', async () => { const aSnap = await getDoc(doc(db, 'usernames', 'maklov1')); if(aSnap.exists()) { const cId = await getOrCreateDM(aSnap.data().uid); await sendMessagePayload({ senderId: currentUser.uid, senderName: currentUserData.displayName || 'User', type: 'text', text: '🚩 LAPORAN SCAM\nTerlapor: @' + document.getElementById('upUsername').textContent.replace('@',''), reactions: {}, readBy: [currentUser.uid], createdAt: serverTimestamp() }, cId); toast('Laporan terkirim.', 'success'); } }); };
window.startCall = (isVideo) => startCall(isVideo);
window.acceptCall = () => acceptCall();
window.endCall = () => endCall();
window.toggleMute = () => toggleMute();
window.startRecording = () => startRecording();
window.stopRecording = (send) => stopRecording(send);
window.sendTextMessage = () => sendTextMessage();
window.adminAction = (type) => adminAction(type);
window.submitCheckout = () => submitCheckout();

// INIT
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  currentUser = user; await loadUserData();
  applySettings(); initFeed(); initStories(); initReels(); initChatList(); initChatRoom(); initProfile(); initCall();
  listenIncomingCalls(); startPresenceHeartbeat(); initPTR();
});

async function loadUserData() {
  try {
    const s = await getDoc(doc(db, 'users', currentUser.uid));
    if (s.exists()) {
      currentUserData = { uid: currentUser.uid, ...s.data() };
      if (currentUserData.isBanned) { const b = currentUserData.banUntil?.toDate ? currentUserData.banUntil.toDate() : null; if (!b || b > new Date()) { alert('AKUN DIBANNED.'); await signOut(auth); window.location.href = 'index.html'; return; } }
      if (currentUserData.username === 'maklov1' && (!currentUserData.isAdmin || !currentUserData.isDev)) { await updateDoc(doc(db, 'users', currentUser.uid), { isAdmin: true, isDev: true }); currentUserData.isAdmin = true; currentUserData.isDev = true; }
    } else {
      currentUserData = { uid: currentUser.uid, username: currentUser.isAnonymous ? 'Tamu_'+currentUser.uid.slice(0,6) : 'user', displayName: 'User', isGuest: currentUser.isAnonymous, isAdmin: false, isDev: false, isVerified: false, isPremium: false, isBanned: false, isScam: false, followers: 0, following: 0, followingList: [], createdAt: serverTimestamp() };
      await setDoc(doc(db, 'users', currentUser.uid), currentUserData);
    }
  } catch (e) { toast('Gagal memuat profil.', 'error'); }
}
async function getUserData(uid) { if (uid === currentUser.uid) return currentUserData; try { const s = await getDoc(doc(db, 'users', uid)); return s.exists() ? { uid, ...s.data() } : null; } catch { return null; } }
function startPresenceHeartbeat() { const u = async () => { if (getSetting('lastSeen') === 'false') return; try { await updateDoc(doc(db, 'users', currentUser.uid), { lastSeen: serverTimestamp() }); } catch(_){} }; u(); setInterval(u, 20000); }
const isOnline = (u) => (u?.lastSeen && getSetting('lastSeen') !== 'false') ? (Date.now() - (u.lastSeen.toDate?.() || new Date(u.lastSeen)).getTime() < 60000) : false;
function applySettings() { document.documentElement.style.setProperty('--font-md', getSetting('fontSize') || '14.5px'); if (getSetting('theme') === 'light') document.body.classList.add('light-mode'); else document.body.classList.remove('light-mode'); }

function initPTR() {
  let startY = 0, pulling = false; const c = document.getElementById('appContent'); const p = document.getElementById('pullToRefresh');
  c.addEventListener('touchstart', e => { if (c.scrollTop === 0) { startY = e.touches[0].clientY; pulling = false; } }, {passive: true});
  c.addEventListener('touchmove', e => { if (c.scrollTop === 0 && startY > 0) { const dy = e.touches[0].clientY - startY; if (dy > 80) { pulling = true; p.classList.add('active'); } } }, {passive: true});
  c.addEventListener('touchend', () => { if (pulling) setTimeout(() => location.reload(), 800); startY = 0; });
}

// PROFIL
function initProfile() {
  document.getElementById('profileAvatarInput').onchange = async (e) => { const f = e.target.files[0]; if(!f) return; const b = await compressImage(f, 500, 500, 0.8); document.getElementById('cropperImage').src = b; window.openModal('cropperModal'); setTimeout(() => { if(cropperInstance) cropperInstance.destroy(); cropperInstance = new Cropper(document.getElementById('cropperImage'), { aspectRatio: 1, viewMode: 1 }); }, 100); };
  document.getElementById('profileBannerInput').onchange = async (e) => { const f = e.target.files[0]; if(!f) return; const b = await cropToRatio(f, 16, 6, 0.72); await updateDoc(doc(db, 'users', currentUser.uid), { banner: b }); location.reload(); };
  document.getElementById('profileEditBtn').onclick = () => { document.getElementById('editDisplayName').value = currentUserData.displayName || ''; document.getElementById('editBio').value = currentUserData.bio || ''; document.getElementById('editMusicLink').value = currentUserData.musicLink || ''; window.openModal('editProfileModal'); };
  document.querySelectorAll('.profile-tab').forEach(t => t.onclick = () => { document.querySelectorAll('.profile-tab').forEach(x => { x.style.color = 'var(--text-3)'; x.style.borderBottom = 'none'; }); t.style.color = 'var(--neon)'; t.style.borderBottom = '2px solid var(--neon)'; loadProfilePosts(t.dataset.ptab); });
  refreshProfileUI();
}

function refreshProfileUI() {
  const isDev = currentUserData?.isDev || currentUserData?.username === 'maklov1'; const isPrem = currentUserData?.isPremium; const isCre = currentUserData?.badge === 'creator'; const isGhost = getSetting('ghostMode') === 'true';
  const c = document.getElementById('profileCardContainer'); if (c) { c.className = 'profile-card-basic'; if (isDev && !isGhost) c.classList.add('profile-card-dev'); else if (isPrem && !isGhost) c.classList.add('profile-card-premium'); else if (isCre && !isGhost) c.classList.add('profile-card-creator'); }
  let b = ''; if (isDev && !isGhost) b = `<span class="badge" style="background:gold;color:#000;">Dev</span>`; else if (isPrem && !isGhost) b = `<span class="badge" style="background:pink;color:#000;">Premium</span>`; if (currentUserData?.isScam) b += `<span class="badge-scam">SCAM</span>`;
  document.getElementById('profileName').innerHTML = `${escapeHtml(currentUserData.displayName || 'User')} ${b}`;
  document.getElementById('profileUsername').textContent = '@' + (currentUserData.username || 'user');
  document.getElementById('profileBio').innerHTML = currentUserData.bio ? parseEmojis(escapeHtml(currentUserData.bio)) : 'Belum ada bio.';
  document.getElementById('profileFollowersCount').textContent = currentUserData.followers || 0; document.getElementById('profileFollowingCount').textContent = currentUserData.following || 0;
  document.getElementById('adminSection').classList.toggle('hidden', (!isDev) || isGhost);
  const f = document.getElementById('profileAvatarFallback'), i = document.getElementById('profileAvatarImg'), bn = document.getElementById('profileBannerImg');
  if (currentUserData.photoURL) { i.src = currentUserData.photoURL; i.classList.remove('hidden'); f.classList.add('hidden'); } else { f.textContent = getInitials(currentUserData.displayName); f.style.background = getAvatarColor(currentUser.uid); f.classList.remove('hidden'); i.classList.add('hidden'); }
  if (currentUserData.banner) { bn.src = currentUserData.banner; bn.classList.remove('hidden'); } else bn.classList.add('hidden');
  loadProfilePosts('posts');
}

function loadProfilePosts(tab) {
  const c = document.getElementById('profilePostsList'); c.innerHTML = '<div class="text-center"><span class="spinner"></span></div>';
  let q; if (tab === 'posts') q = query(collection(db, 'posts'), where('authorId', '==', currentUser.uid), orderBy('createdAt', 'desc')); else if (tab === 'reposts') q = query(collection(db, 'posts'), where('authorId', '==', currentUser.uid), where('isRepost', '==', true), orderBy('createdAt', 'desc')); else q = query(collection(db, 'posts'), where('likedBy', 'array-contains', currentUser.uid), orderBy('createdAt', 'desc'));
  onSnapshot(q, (snap) => { if (snap.empty) { c.innerHTML = '<p class="text-muted text-center">Kosong.</p>'; return; } let h = ''; snap.forEach(d => { const p = d.data(); if (tab === 'posts' && p.isRepost) return; h += `<div class="post-card"><div class="post-header"><div class="post-avatar">${p.authorPhoto ? `<img src="${p.authorPhoto}"/>` : `<div class="avatar-fallback" style="background:${getAvatarColor(p.authorId)};color:#08120f;">${getInitials(p.authorName)}</div>`}</div><div class="post-meta"><div class="post-author">${escapeHtml(p.authorName)}</div><div class="post-time">${formatRelativeTime(p.createdAt)}</div></div></div>${p.text ? `<div class="post-content">${formatText(p.text)}</div>` : ''}${p.mediaUrl ? `<div class="post-image"><img src="${p.mediaUrl}"/></div>` : ''}</div>`; }); c.innerHTML = h; });
}

// ADMIN
async function adminAction(type) {
  const u = document.getElementById('adminTargetUsername').value.toLowerCase().trim(); if (!u) return toast('Isi username!', 'error');
  const s = await getDoc(doc(db, 'usernames', u)); if (!s.exists()) return toast('User gak ada.', 'error'); const r = doc(db, 'users', s.data().uid);
  if (type === 'inject') await updateDoc(r, { followers: increment(100) }); else if (type === 'verify') await updateDoc(r, { isVerified: true }); else if (type === 'premium') await updateDoc(r, { isPremium: true }); else if (type === 'admin') await updateDoc(r, { isAdmin: true }); else if (type === 'dev') await updateDoc(r, { isDev: true }); else if (type === 'creator') await updateDoc(r, { badge: 'creator' }); else if (type === 'ban') { const d = parseInt(document.getElementById('adminBanDuration').value) || 0; await updateDoc(r, { isBanned: true, banUntil: d > 0 ? new Date(Date.now() + d * 86400000) : null }); } else if (type === 'unban') await updateDoc(r, { isBanned: false }); else if (type === 'scam') { const us = await getDoc(r); await updateDoc(r, { isScam: !us.data().isScam }); }
  toast('Aksi admin sukses.', 'success'); document.getElementById('adminTargetUsername').value = '';
}

// FEED & REELS
function initFeed() {
  document.getElementById('composerImageInput').onchange = async (e) => { const f = e.target.files[0]; if(!f) return; const b = await compressImage(f); document.getElementById('composerImagePreviewImg').src = b; document.getElementById('composerImagePreview').style.display = 'block'; window.pendingPostFile = f; };
  document.getElementById('composerRemoveImage').onclick = () => { document.getElementById('composerImagePreview').style.display = 'none'; window.pendingPostFile = null; };
  document.getElementById('composerPostBtn').onclick = async () => {
    const t = document.getElementById('composerText').value.trim(); if(!t && !window.pendingPostFile) return toast('Isi teks/media', 'info');
    let u = null; if(window.pendingPostFile) u = await uploadToCloudinary(window.pendingPostFile);
    await addDoc(collection(db, 'posts'), { authorId: currentUser.uid, authorName: currentUserData.displayName, authorPhoto: currentUserData.photoURL, authorVerified: currentUserData.isVerified, text: t, mediaUrl: u, mediaType: u ? 'image' : null, likedBy: [], commentsCount: 0, repostsCount: 0, createdAt: serverTimestamp() });
    document.getElementById('composerText').value = ''; document.getElementById('composerImagePreview').style.display = 'none'; window.pendingPostFile = null; toast('Posted!', 'success');
  };
  onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50)), (snap) => { const c = document.getElementById('feedList'); let h = ''; snap.forEach(d => { const p = d.data(); if(p.isRepost) return; h += `<div class="post-card"><div class="post-header"><div class="post-avatar">${p.authorPhoto ? `<img src="${p.authorPhoto}"/>` : `<div class="avatar-fallback" style="background:${getAvatarColor(p.authorId)};color:#08120f;">${getInitials(p.authorName)}</div>`}</div><div class="post-meta"><div class="post-author">${escapeHtml(p.authorName)}</div><div class="post-time">${formatRelativeTime(p.createdAt)}</div></div></div>${p.text ? `<div class="post-content">${formatText(p.text)}</div>` : ''}${p.mediaUrl ? `<div class="post-image"><img src="${p.mediaUrl}"/></div>` : ''}</div>`; }); c.innerHTML = h; });
}

function initStories() { document.getElementById('btnAddStory').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = async e => { const f = e.target.files[0]; if(!f) return; const b = await compressImage(f, 720, 1280, 0.7); await addDoc(collection(db, 'stories'), { uid: currentUser.uid, mediaUrl: b, createdAt: serverTimestamp() }); toast('Story up!', 'success'); }; i.click(); }; }

function initReels() { onSnapshot(query(collection(db, 'posts'), where('mediaType', '==', 'image'), orderBy('createdAt', 'desc'), limit(5)), (snap) => { const c = document.getElementById('reelsContainer'); if(snap.empty) { c.innerHTML = '<div class="text-center" style="padding:50px;">Reels coming soon...</div>'; return; } let h = ''; snap.forEach(d => { const p = d.data(); h += `<div class="reel-item"><img src="${p.mediaUrl}"/></div>`; }); c.innerHTML = h; }); }

// CHAT
async function getOrCreateDM(otherUid) { const id = `dm_${[currentUser.uid, otherUid].sort().join('_')}`; const s = await getDoc(doc(db, 'chats', id)); if (s.exists()) return id; await setDoc(doc(db, 'chats', id), { type: 'dm', members: [currentUser.uid, otherUid], lastMessage: '', lastMessageAt: serverTimestamp(), readAt: {} }); return id; }

function initChatList() {
  onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', currentUser.uid)), async (snap) => {
    const c = document.getElementById('chatListContainer'); let h = '';
    for (const d of snap.docs) {
      const ch = d.data(); let name = 'User', av = '?', oUid = null;
      if (ch.type === 'dm') { oUid = ch.members.find(u => u !== currentUser.uid); const u = await getUserData(oUid); name = ch.customNames?.[currentUser.uid] || u?.displayName || 'User'; av = u?.photoURL ? `<img src="${u.photoURL}"/>` : getInitials(name); } else { name = ch.groupName; av = getInitials(name); }
      h += `<div class="chat-item" onclick="openChat('${d.id}', '${ch.type}', '${oUid || ''}')"><div class="chat-avatar">${av}</div><div class="chat-info"><div class="chat-name">${escapeHtml(name)}</div><div class="chat-preview">${escapeHtml(ch.lastMessage || '')}</div></div></div>`;
    }
    c.innerHTML = h;
  });
  document.getElementById('chatSearchInput').addEventListener('input', debounce(async e => { const t = e.target.value.toLowerCase().trim(); if(t.length < 2) return; const s = await getDoc(doc(db, 'usernames', t)); if(s.exists()) { const cId = await getOrCreateDM(s.data().uid); openChat(cId, 'dm', s.data().uid); } }, 500));
}

window.openChat = async (cId, cType, oUid) => {
  currentChatId = cId; currentChatType = cType;
  document.getElementById('chatRoom').classList.add('open');
  if (cType === 'dm') { const u = await getUserData(oUid); document.getElementById('chatRoomName').textContent = u?.displayName || 'User'; }
  onSnapshot(query(collection(db, 'chats', cId, 'messages'), orderBy('createdAt', 'asc'), limit(100)), (snap) => {
    const c = document.getElementById('chatMessagesArea'); let h = '';
    snap.forEach(d => { const m = d.data(); const own = m.senderId === currentUser.uid; h += `<div class="bubble-row ${own ? 'outgoing' : 'incoming'}"><div class="chat-bubble">${formatText(m.text || '')}</div></div>`; });
    c.innerHTML = h; c.scrollTop = c.scrollHeight;
  });
};

window.sendTextMessage = async () => { const i = document.getElementById('chatInput'); const t = i.value.trim(); if(!t || !currentChatId) return; i.value = ''; await addDoc(collection(db, 'chats', currentChatId, 'messages'), { senderId: currentUser.uid, text: t, createdAt: serverTimestamp() }); await updateDoc(doc(db, 'chats', currentChatId), { lastMessage: t, lastMessageAt: serverTimestamp() }); };

function initChatRoom() { document.getElementById('chatAttachInput').onchange = async e => { const f = e.target.files[0]; if(!f) return; const u = await uploadToCloudinary(f); await addDoc(collection(db, 'chats', currentChatId, 'messages'), { senderId: currentUser.uid, image: u, type: 'image', createdAt: serverTimestamp() }); }; }

// CALL
async function startCall(isVideo) { if (currentChatType !== 'dm') return toast('Hanya DM.', 'info'); const oUid = currentChatId.split('_').find(u => u !== currentUser.uid); try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo }); if(isVideo) document.getElementById('localVideo').srcObject = localStream; peer = new Peer(); peer.on('open', async id => { const r = await addDoc(collection(db, 'calls'), { fromUid: currentUser.uid, toUid: oUid, fromPeerId: id, status: 'ringing', isVideo, createdAt: serverTimestamp() }); onSnapshot(doc(db, 'calls', r.id), s => { const d = s.data(); if(d.status === 'accepted') { const c = peer.call(d.toPeerId, localStream); c.on('stream', rs => document.getElementById('remoteVideo').srcObject = rs); } }); }); } catch(e) { toast('Gagal panggil.', 'error'); } }
function listenIncomingCalls() { onSnapshot(query(collection(db, 'calls'), where('toUid', '==', currentUser.uid), where('status', '==', 'ringing')), snap => { snap.docChanges().forEach(ch => { if (ch.type === 'added') { const d = ch.doc.data(); currentCall = { id: ch.doc.id, fromPeerId: d.fromPeerId, isVideo: d.isVideo }; document.getElementById('callScreen').classList.add('open'); document.getElementById('callStatus').textContent = 'Panggilan Masuk...'; document.getElementById('callAcceptBtn').classList.remove('hidden'); } }); }); }
async function acceptCall() { peer = new Peer(); peer.on('open', async id => { await updateDoc(doc(db, 'calls', currentCall.id), { status: 'accepted', toPeerId: id }); peer.on('call', call => { call.answer(localStream); call.on('stream', rs => document.getElementById('remoteVideo').srcObject = rs); }); }); }
function endCall() { if (currentCall) updateDoc(doc(db, 'calls', currentCall.id), { status: 'ended' }); document.getElementById('callScreen').classList.remove('open'); if (localStream) localStream.getTracks().forEach(t => t.stop()); if (peer) peer.destroy(); currentCall = null; }
function toggleMute() { if (localStream) { const e = localStream.getAudioTracks()[0].enabled; localStream.getAudioTracks()[0].enabled = !e; } }
async function startRecording() { try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); mediaRecorder = new MediaRecorder(s); audioChunks = []; mediaRecorder.ondataavailable = e => audioChunks.push(e.data); mediaRecorder.start(); document.getElementById('recorderBar').classList.remove('hidden'); } catch(e) { toast('Mic ditolak.', 'error'); } }
async function stopRecording(send) { if(!mediaRecorder) return; mediaRecorder.stop(); mediaRecorder.onstop = async () => { if(send) { const r = new FileReader(); r.onload = async () => { await addDoc(collection(db, 'chats', currentChatId, 'messages'), { senderId: currentUser.uid, audio: r.result, type: 'voice', createdAt: serverTimestamp() }); }; r.readAsDataURL(new Blob(audioChunks, { type: 'audio/webm' })); } mediaRecorder = null; document.getElementById('recorderBar').classList.add('hidden'); }; }
async function submitCheckout() { const u = document.getElementById('coTargetUser').value; const f = document.getElementById('coProofFile').files[0]; if(!u || !f) return toast('Lengkapi data!', 'error'); const url = await uploadToCloudinary(f); const aSnap = await getDoc(doc(db, 'usernames', 'maklov1')); if(aSnap.exists()) { const c = await getOrCreateDM(aSnap.data().uid); await addDoc(collection(db, 'chats', c, 'messages'), { senderId: currentUser.uid, text: `PESANAN: ${currentShopItem.name}\nTarget: ${u}\nBukti: ${url}`, type: 'image', image: url, createdAt: serverTimestamp() }); toast('Pesanan terkirim.', 'success'); window.closeModal('checkoutModal'); } }
async function submitCheckout() { 
  const u = document.getElementById('coTargetUser').value; 
  const f = document.getElementById('coProofFile').files[0]; 
  if(!u || !f) return toast('Lengkapi data!', 'error'); 
  
  const url = await uploadToCloudinary(f); 
  const aSnap = await getDoc(doc(db, 'usernames', 'maklov1')); 
  if(aSnap.exists()) { 
    const c = await getOrCreateDM(aSnap.data().uid); 
    await addDoc(collection(db, 'chats', c, 'messages'), { 
      senderId: currentUser.uid, 
      text: `PESANAN: ${currentShopItem.name}\nTarget: ${u}\nBukti: ${url}`, 
      type: 'image', 
      image: url, 
      createdAt: serverTimestamp() 
    }); 
    await updateDoc(doc(db, 'chats', c), { lastMessage: 'Pesanan Baru', lastMessageAt: serverTimestamp() });
    toast('Pesanan terkirim.', 'success'); 
    window.closeModal('checkoutModal'); 
  } 
}

// ════════════════ FITUR PROFIL ORANG LAIN (FULL PAGE) ════════════════
window.openUserProfilePage = async (uid) => {
  if (!uid || uid === currentUser.uid) return window.switchTab('profile');
  const data = await getUserData(uid); if (!data) return toast('User tidak ditemukan.', 'error');
  
  document.getElementById('upName').innerHTML = `${escapeHtml(data.displayName || 'User')} ${data.isScam ? '<span class="badge-scam"><i class="ph-fill ph-warning"></i> SCAM</span>' : ''} ${data.isVerified ? '<span class="badge badge-verified">✓</span>' : ''}`;
  document.getElementById('upUsername').textContent = '@' + (data.username || 'user');
  document.getElementById('upBio').textContent = data.bio || 'Belum ada bio.';
  document.getElementById('upFollowersCount').textContent = data.followers || 0; 
  document.getElementById('upFollowingCount').textContent = data.following || 0;
  
  if (data.photoURL) { 
    document.getElementById('upAvatarImg').src = data.photoURL; 
    document.getElementById('upAvatarImg').classList.remove('hidden'); 
    document.getElementById('upAvatarFallback').classList.add('hidden'); 
  } else { 
    document.getElementById('upAvatarFallback').textContent = getInitials(data.displayName); 
    document.getElementById('upAvatarFallback').classList.remove('hidden'); 
    document.getElementById('upAvatarImg').classList.add('hidden'); 
  }
  
  if (data.banner) { 
    document.getElementById('upBanner').src = data.banner; 
    document.getElementById('upBanner').classList.remove('hidden'); 
  } else {
    document.getElementById('upBanner').classList.add('hidden'); 
  }
  
  document.getElementById('btnUpMessage').onclick = async () => { 
    const chatId = await getOrCreateDM(uid); 
    window.switchTab('chat'); 
    window.openChat(chatId, 'dm', uid); 
  };
  
  window.switchTab('userProfile');
};

window.reportScamAction = async () => {
  const uname = document.getElementById('upUsername').textContent.replace('@','');
  window.showConfirm('Report Scam', `Laporkan @${uname} sebagai scammer?`, async () => {
    const aSnap = await getDoc(doc(db, 'usernames', 'maklov1'));
    if(aSnap.exists()) { 
      const cId = await getOrCreateDM(aSnap.data().uid); 
      await addDoc(collection(db, 'chats', cId, 'messages'), { 
        senderId: currentUser.uid, 
        text: `🚩 LAPORAN SCAM\nPelapor: @${currentUserData.username}\nTerlapor: @${uname}`, 
        type: 'text', 
        createdAt: serverTimestamp() 
      }); 
      await updateDoc(doc(db, 'chats', cId), { lastMessage: 'Laporan Scam', lastMessageAt: serverTimestamp() });
      toast('Laporan terkirim ke Admin.', 'success'); 
    } 
  });
};

// ════════════════ UTILS & MODALS ════════════════
window.showConfirm = (title, text, cb) => { 
  document.getElementById('confirmTitle').textContent = title; 
  document.getElementById('confirmText').textContent = text; 
  document.getElementById('btnConfirmYes').onclick = () => { cb(); window.closeModal('confirmModal'); }; 
  window.openModal('confirmModal'); 
};

window.openImageViewer = (src) => { 
  document.getElementById('imageViewerImg').src = src; 
  window.openModal('imageViewerModal'); 
};

function cleanupCall() { 
  document.getElementById('callScreen').classList.remove('open'); 
  document.getElementById('callAcceptBtn').classList.add('hidden'); 
  document.getElementById('localVideo').style.display = 'none'; 
  if (localStream) localStream.getTracks().forEach(t => t.stop()); 
  if (peer) peer.destroy(); 
  currentCall = null; 
}

console.log('%c[Gpyth Chat] main.js FULLY LOADED — SEMUA FITUR AKTIF!', 'color:#00ffc8; font-weight:800; font-size:16px;');
