/* ===================================
   StudyGenie — app.js  (Fixed + Enhanced)
=================================== */

const API = 'https://studygenie-tio9.onrender.com';

// ===== AUTH =====
const currentUser = JSON.parse(localStorage.getItem('srt_user') || '{}');
if (!currentUser.id) window.location.href = 'login.html';

function logout() {
  localStorage.removeItem('srt_user');
  window.location.href = 'login.html';
}

// ===== STATE =====
const STATE = {
  mode: 'chat',
  language: 'hinglish',
  topicsCovered: new Set(),
  questionsAsked: 0,
  correctAnswers: 0,
  weakAreas: {},
  conversationHistory: [],
  currentTopic: null,
  isWaiting: false,
  voiceEnabled: false,  // starts OFF — fixed
  isSpeaking: false,
  isListening: false,
  pendingFiles: [],
  sessionId: null
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('userName').textContent = currentUser.name || currentUser.email || 'User';

  // Create session on backend
  try {
    const res = await fetch(`${API}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: currentUser.id, topic: 'General' })
    });
    const data = await res.json();
    STATE.sessionId = data.session_id;
  } catch (e) { console.warn('Session create failed:', e); }

  showWelcome();
  loadSidebarFiles();
  loadChatHistory();
  document.getElementById('userInput').focus();
  initVoices();
});

// ===== VOICE TTS =====
const synth = window.speechSynthesis;
let voices = [];

function initVoices() {
  // Load voices — handle async loading in some browsers
  const load = () => { voices = synth.getVoices(); };
  load();
  synth.onvoiceschanged = load;
}

function speakText(text, forcePlay = false) {
  if (!forcePlay && !STATE.voiceEnabled) return;
  synth.cancel();
  const clean = text
    .replace(/\[MCQ\][\s\S]*?\[\/MCQ\]/g, 'Ek question hai screen par.')
    .replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1')
    .replace(/[#•\-*_`[\]]/g, '')
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/\s+/g, ' ').trim();
  if (!clean) return;
  if (!voices.length) voices = synth.getVoices();
  const v = voices.find(v => v.lang === 'hi-IN')
    || voices.find(v => v.lang === 'en-IN')
    || voices.find(v => v.lang.startsWith('en'))
    || voices[0];
  const utt = new SpeechSynthesisUtterance(clean);
  if (v) utt.voice = v;
  utt.rate = 0.9; utt.pitch = 1.05; utt.volume = 1;
  utt.onstart = () => { STATE.isSpeaking = true; updateStopBtn(true); };
  utt.onend = () => { STATE.isSpeaking = false; updateStopBtn(false); };
  utt.onerror = () => { STATE.isSpeaking = false; updateStopBtn(false); };
  synth.speak(utt);
}

function stopSpeaking() {
  synth.cancel();
  STATE.isSpeaking = false;
  updateStopBtn(false);
}
window.stopSpeaking = stopSpeaking;

function updateStopBtn(speaking) {
  const btn = document.getElementById('stopSpeakBtn');
  if (btn) btn.style.display = speaking ? 'inline-flex' : 'none';
}

// Toggle auto-voice ON/OFF
window.toggleVoice = function () {
  STATE.voiceEnabled = !STATE.voiceEnabled;
  const btn = document.getElementById('voiceOnOffBtn');
  if (btn) {
    btn.textContent = STATE.voiceEnabled ? '🔊 Voice' : '🔇 Voice';
    btn.classList.toggle('active', STATE.voiceEnabled);
  }
  if (!STATE.voiceEnabled) stopSpeaking();
};

// ===== VOICE STT =====
let recognition = null;
window.toggleMic = function () {
  if (!recognition) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Speech recognition ke liye Chrome browser use karo!'); return; }
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = STATE.language === 'english' ? 'en-IN' : 'hi-IN';
    recognition.onstart = () => { STATE.isListening = true; updateMicBtn(true); };
    recognition.onresult = e => {
      document.getElementById('userInput').value =
        Array.from(e.results).map(r => r[0].transcript).join('');
    };
    recognition.onend = () => {
      STATE.isListening = false;
      updateMicBtn(false);
      const v = document.getElementById('userInput').value.trim();
      if (v) sendMessage();
    };
    recognition.onerror = () => { STATE.isListening = false; updateMicBtn(false); recognition = null; };
  }
  if (STATE.isListening) {
    recognition.stop();
  } else {
    recognition.lang = STATE.language === 'english' ? 'en-IN' : 'hi-IN';
    recognition.start();
  }
};

function updateMicBtn(listening) {
  const btn = document.getElementById('micBtn');
  if (btn) {
    btn.innerHTML = listening ? '🔴 Sun raha...' : '🎤 Bolo';
    btn.classList.toggle('listening', listening);
  }
}

// ===== FILE HELPERS =====
function getFileIcon(cat) {
  const m = { image: '🖼️', pdf: '📄', video: '🎥', text: '📝', doc: '📎' };
  return m[cat] || '📎';
}
function formatSize(b) {
  if (!b) return '?';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// ===== FILE UPLOAD — FILES PANEL =====
window.handleDrop = function (e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('drag-over');
  uploadFiles(e.dataTransfer.files);
};
window.handleFiles = function (files) { uploadFiles(files); };

async function uploadFiles(files) {
  for (const file of Array.from(files)) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', currentUser.id);
    const tempCard = createTempCard(file.name);
    document.getElementById('uploadedFiles').appendChild(tempCard);
    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) {
        tempCard.innerHTML = `<span style="color:var(--rose)">❌ ${data.error}</span>`;
        setTimeout(() => tempCard.remove(), 3000);
      } else {
        renderFileCard(data, tempCard);
        loadSidebarFiles();
      }
    } catch (e) {
      tempCard.innerHTML = `<span style="color:var(--rose)">❌ Upload failed — server chalu hai?</span>`;
    }
  }
}

function createTempCard(name) {
  const el = document.createElement('div');
  el.className = 'file-card';
  el.innerHTML = `<span class="file-card-icon">⏳</span><div class="file-card-info"><div class="file-card-name">${escapeHtml(name)}</div><div class="file-card-size">Uploading...</div></div>`;
  return el;
}

function renderFileCard(f, existing = null) {
  const card = existing || document.createElement('div');
  card.className = 'file-card';
  card.innerHTML = `
    <span class="file-card-icon">${getFileIcon(f.file_category)}</span>
    <div class="file-card-info">
      <div class="file-card-name">${escapeHtml(f.original_name)}</div>
      <div class="file-card-size">${formatSize(f.file_size)}</div>
    </div>
    <button class="file-card-ask" onclick='attachAndAsk(${JSON.stringify(f)})'>💬 Chat</button>
    <button class="file-card-del" onclick="deleteFile(${f.id}, this)">✕</button>`;
  if (!existing) document.getElementById('uploadedFiles').appendChild(card);
}

// ===== ATTACH FILE TO MESSAGE =====
window.attachAndAsk = function (file) {
  if (!STATE.pendingFiles.find(f => f.id === file.id)) {
    STATE.pendingFiles.push(file);
  }
  setMode('chat');
  updateAttachPreview();
  document.getElementById('userInput').focus();
};

// ===== QUICK ATTACH FROM CHAT INPUT =====
window.quickAttach = async function (files) {
  for (const file of Array.from(files)) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', currentUser.id);
    const tempId = `temp_${Date.now()}_${Math.random()}`;
    addTempPreviewChip(file.name, tempId);
    try {
      const res = await fetch(`${API}/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      removeTempChip(tempId);
      if (!data.error) {
        STATE.pendingFiles.push(data);
        updateAttachPreview();
        loadSidebarFiles();
      }
    } catch (e) { removeTempChip(tempId); }
  }
  // Reset file input so same file can be re-selected
  document.getElementById('quickFileInput').value = '';
};

function addTempPreviewChip(name, tempId) {
  const preview = document.getElementById('attachPreview');
  preview.classList.remove('hidden');
  const chip = document.createElement('div');
  chip.className = 'attach-chip';
  chip.id = tempId;
  chip.innerHTML = `⏳ ${escapeHtml(name)}`;
  preview.appendChild(chip);
}
function removeTempChip(id) { document.getElementById(id)?.remove(); }

function updateAttachPreview() {
  const preview = document.getElementById('attachPreview');
  preview.innerHTML = '';
  if (STATE.pendingFiles.length === 0) { preview.classList.add('hidden'); return; }
  preview.classList.remove('hidden');
  STATE.pendingFiles.forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    chip.innerHTML = `${getFileIcon(f.file_category)} ${escapeHtml(f.original_name)} <button class="attach-chip-remove" onclick="removePending(${f.id})">✕</button>`;
    preview.appendChild(chip);
  });
}
window.removePending = function (id) {
  STATE.pendingFiles = STATE.pendingFiles.filter(f => f.id !== id);
  updateAttachPreview();
};

async function deleteFile(id, btn) {
  btn.closest('.file-card').style.opacity = '0.4';
  try {
    await fetch(`${API}/files/${id}`, { method: 'DELETE' });
    btn.closest('.file-card').remove();
  } catch(e) { btn.closest('.file-card').style.opacity = '1'; }
  STATE.pendingFiles = STATE.pendingFiles.filter(f => f.id !== id);
  updateAttachPreview();
  loadSidebarFiles();
}

// ===== LOAD SIDEBAR FILES =====
async function loadSidebarFiles() {
  try {
    const res = await fetch(`${API}/user/${currentUser.id}/files`);
    const files = await res.json();
    const container = document.getElementById('sidebarFiles');
    if (!Array.isArray(files) || !files.length) {
      container.innerHTML = '<span class="muted-text">No files yet</span>';
      return;
    }
    container.innerHTML = files.slice(0, 6).map(f => `
      <div class="file-item-side" onclick='attachAndAsk(${JSON.stringify(f).replace(/'/g, "&#39;")})'>
        ${getFileIcon(f.file_category)}
        <span>${escapeHtml(f.original_name.slice(0, 20))}${f.original_name.length > 20 ? '…' : ''}</span>
      </div>`).join('');
  } catch (e) {
    document.getElementById('sidebarFiles').innerHTML = '<span class="muted-text">Files load nahi hue</span>';
  }
}

// ===== SYSTEM PROMPT =====
function getSystemPrompt() {
  const lang = {
    hinglish: "Respond in Hinglish (Hindi + English mix). Natural Indian teacher tone.",
    hindi: "Respond entirely in Hindi. Simple teacher language.",
    english: "Respond in English only. Friendly teacher tone."
  }[STATE.language];
  const mode = STATE.mode === 'revision'
    ? "EXAM MODE: Rapid-fire questions, short bullet summaries!"
    : STATE.mode === 'notes' ? "NOTES MODE: Summarize, extract key points, generate questions."
    : "CHAT MODE: Teach deeply, ask questions after explaining.";
  return `You are StudyGenie — advanced friendly Indian AI teacher.
LANGUAGE: ${lang}
MODE: ${mode}
TEACHING: Simple explanation → Indian examples → Questions → Adapt difficulty
PERSONALITY: Use "Bilkul sahi!", "Shabash!", "Almost correct..."
FORMATTING: **bold** key terms, bullets, [MCQ]...[/MCQ] for MCQs
Always end with a question!`;
}

// ===== DOM SHORTCUTS =====
const $ = id => document.getElementById(id);
const chatMessages = $('chatMessages');
const userInput = $('userInput');

// ===== WELCOME =====
function showWelcome() {
  const w = {
    hinglish: `👋 **Namaste ${currentUser.name || ''}!**

Main hun tumhara StudyGenie Teacher! 💪

**Kaise use kare:**
📎 Attach button se file lagao ya Files tab use karo
💬 Koi bhi topic type karo aur Enter dabao
🎤 Mic button se bolke poochho (Chrome mein kaam karta hai)

**Aaj kya padhna hai?** 🎯`,
    hindi: `👋 **नमस्ते ${currentUser.name || ''}! मैं हूँ StudyGenie!**\n\n**आज कौन सा topic?** 🎯`,
    english: `👋 **Hello ${currentUser.name || ''}! I'm StudyGenie!**\n\nAttach files using 📎 or the Files tab, then ask your question!\n\n**What shall we learn today?** 🎯`
  };
  addTeacherMessage(w[STATE.language] || w.hinglish, []);
}

// ===== ADD MESSAGES =====
function addTeacherMessage(content, fileRefs = []) {
  const msg = document.createElement('div');
  msg.className = 'msg teacher';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = renderContent(content);
  const speakBtn = document.createElement('button');
  speakBtn.className = 'msg-speak-btn';
  speakBtn.textContent = '🔊 Suno';
  speakBtn.onclick = () => speakText(content, true);
  bubble.appendChild(speakBtn);
  msg.innerHTML = `<div class="msg-avatar">👨‍🏫</div>`;
  msg.appendChild(bubble);
  chatMessages.appendChild(msg);
  scrollBottom();
  if (STATE.voiceEnabled) speakText(content);
}

function addUserMessage(content, files = []) {
  const msg = document.createElement('div');
  msg.className = 'msg user';
  const filePreviews = files.map(f => {
    if (f.file_category === 'image') {
      return `<div class="file-msg-preview">
        <img src="${API}/files/${f.filename}" alt="${escapeHtml(f.original_name)}"
          style="max-width:200px;max-height:150px;border-radius:8px;margin-top:8px;display:block"/>
      </div>`;
    }
    return `<div class="file-msg-bubble">
      ${getFileIcon(f.file_category)} <strong>${escapeHtml(f.original_name)}</strong>
      <span style="color:var(--text3);font-size:0.73rem">(${formatSize(f.file_size)})</span>
    </div>`;
  }).join('');
  msg.innerHTML = `
    <div class="msg-avatar">🙋</div>
    <div class="msg-bubble">
      ${filePreviews}
      ${content ? `<p style="margin-top:${files.length ? '8px':'0'}">${escapeHtml(content)}</p>` : ''}
    </div>`;
  chatMessages.appendChild(msg);
  scrollBottom();
}

function renderContent(text) {
  text = parseMCQ(text);
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
  text = text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>');
  text = text.replace(/^[•\-] (.*)/gm, '<li>$1</li>');
  text = text.replace(/((<li>.*<\/li>\s*)+)/g, '<ul>$1</ul>');
  return `<p>${text}</p>`;
}

function parseMCQ(text) {
  return text.replace(/\[MCQ\]([\s\S]*?)\[\/MCQ\]/g, (_, inner) => {
    const lines = inner.trim().split('\n').map(l => l.trim()).filter(Boolean);
    const ansLine = lines.find(l => l.startsWith('[ANSWER:'));
    const answer = ansLine?.replace('[ANSWER:', '').replace(']', '').trim();
    const fLines = lines.filter(l => !l.startsWith('[ANSWER:'));
    const opts = fLines.slice(1).filter(l => /^[A-D]\)/.test(l));
    return `<div class="question-card">
      <div class="q-label">❓ MCQ Question</div>
      <strong>${fLines[0] || ''}</strong>
      <div class="mcq-options">${opts.map(o =>
        `<button class="mcq-opt" data-letter="${o[0]}" data-answer="${answer || ''}" onclick="checkMCQ(this)">${escapeHtml(o)}</button>`
      ).join('')}</div>
    </div>`;
  });
}

function escapeHtml(t) {
  return (t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function scrollBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

// ===== MCQ =====
window.checkMCQ = function (btn) {
  const parent = btn.closest('.mcq-options');
  if (parent.dataset.answered) return;
  parent.dataset.answered = 'true';
  const answer = btn.dataset.answer;
  const isCorrect = btn.dataset.letter === answer;
  parent.querySelectorAll('.mcq-opt').forEach(b => {
    b.disabled = true;
    if (b.dataset.letter === answer) b.classList.add('correct');
  });
  if (!isCorrect) { btn.classList.add('wrong'); trackWeak(STATE.currentTopic); }
  STATE.questionsAsked++;
  if (isCorrect) STATE.correctAnswers++;
  updateStats();
  const txt = isCorrect ? 'Bilkul sahi! Excellent! 🎉' : `Almost! Sahi answer tha: ${answer}`;
  const fb = document.createElement('div');
  fb.innerHTML = isCorrect
    ? `<div class="feedback-correct">✅ ${txt}</div>`
    : `<div class="feedback-improve">💡 ${txt}</div>`;
  parent.after(fb);
  if (STATE.voiceEnabled) speakText(txt.replace(/🎉/, ''));
  setTimeout(() => sendContextMsg(
    isCorrect ? "Student ne sahi answer diya! Agle level ka question do." : "Wrong answer. Re-explain karo aur easy question do."
  ), 1400);
};

function sendContextMsg(hint) {
  callAPI([...STATE.conversationHistory, { role: 'user', content: hint }], [], false);
}

// ===== MAIN API CALL =====
async function callAPI(messages, files = [], addToHistory = true) {
  if (STATE.isWaiting) return;
  STATE.isWaiting = true;
  showTyping(true);
  stopSpeaking();
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) sendBtn.disabled = true;

  try {
    const res = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        file_ids: files.map(f => f.id),
        language: STATE.language,
        mode: STATE.mode,
        session_id: STATE.sessionId,
        user_id: currentUser.id
      })
    });
    const data = await res.json();
    const reply = data.reply || 'Kuch error hua, dobara try karo.';
    if (addToHistory) STATE.conversationHistory.push({ role: 'assistant', content: reply });
    showTyping(false);
    addTeacherMessage(reply);
    extractTopic(reply);

    if (STATE.sessionId) {
      fetch(`${API}/sessions/${STATE.sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions_asked: STATE.questionsAsked,
          correct_answers: STATE.correctAnswers,
          topic: STATE.currentTopic || 'General'
        })
      }).catch(() => {});
    }
  } catch (err) {
    showTyping(false);
    addTeacherMessage('⚠️ Backend se connect nahi ho paya!\n\n`python server.py` chala rahe ho? Check karo.');
    console.error('API Error:', err);
  }

  STATE.isWaiting = false;
  if (sendBtn) sendBtn.disabled = false;
}

// ===== SEND MESSAGE =====
async function sendMessage() {
  const text = userInput.value.trim();
  const files = [...STATE.pendingFiles];
  if (!text && files.length === 0) return;
  if (STATE.isWaiting) return;

  stopSpeaking();
  userInput.value = '';

  addUserMessage(text, files);

  const userContent = files.length > 0
    ? `[${files.map(f => f.original_name).join(', ')}] ${text}`.trim()
    : text;

  STATE.conversationHistory.push({ role: 'user', content: userContent });
  STATE.currentTopic = extractTopicFromText(text) || STATE.currentTopic;

  STATE.pendingFiles = [];
  updateAttachPreview();
  // Reset quick file input
  const qfi = document.getElementById('quickFileInput');
  if (qfi) qfi.value = '';

  await callAPI(STATE.conversationHistory, files);
}

function handleKey(e) { if (e.key === 'Enter' && !e.shiftKey) sendMessage(); }

// ===== QUICK ACTIONS =====
window.quickTopic = function (topic) {
  STATE.currentTopic = topic;
  STATE.topicsCovered.add(topic);
  updateStats();
  userInput.value = `${topic} samjhao mujhe`;
  sendMessage();
};

window.quickAction = function (action) {
  const map = {
    revision: 'Quick bullet-point revision summary do',
    mcq: 'Ek MCQ question banao MCQ format mein',
    explain: 'Aur simple language mein samjhao with Indian example',
    example: 'Real-life Indian example do is concept ka'
  };
  if (!STATE.currentTopic && action !== 'explain') {
    addTeacherMessage('Pehle koi topic batao ya poochho! 😊'); return;
  }
  const msg = map[action];
  STATE.conversationHistory.push({ role: 'user', content: msg });
  addUserMessage(msg);
  callAPI(STATE.conversationHistory, []);
};

// ===== NOTES =====
window.analyzeNotes = async function () {
  const notes = $('notesInput').value.trim();
  if (!notes) { alert('Notes paste karo pehle!'); return; }
  setMode('chat');
  const prompt = `Yeh mere notes hain:\n${notes}\n\nInhe analyze karo:\n1. Summary\n2. Key points\n3. Exam topics\n4. 3 practice questions`;
  addUserMessage('📝 Notes Analysis Request');
  STATE.conversationHistory.push({ role: 'user', content: prompt });
  await callAPI(STATE.conversationHistory, []);
};

// ===== MODE =====
window.setMode = function (mode) {
  STATE.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');
  $('notesPanel').classList.toggle('hidden', mode !== 'notes');
  $('filesPanel').classList.toggle('hidden', mode !== 'files');
  const banner = document.querySelector('.exam-banner');
  if (mode === 'revision') {
    if (!banner) {
      const b = document.createElement('div');
      b.className = 'exam-banner';
      b.textContent = '⚡ EXAM MODE — Rapid Fire Questions On!';
      chatMessages.before(b);
    }
    STATE.conversationHistory.push({ role: 'user', content: 'Exam mode! Rapid fire questions do.' });
    callAPI(STATE.conversationHistory, []);
  } else {
    banner?.remove();
  }
};

window.setLanguage = function (lang) {
  STATE.language = lang;
  STATE.conversationHistory = [];
  chatMessages.innerHTML = '';
  showWelcome();
  // Reset STT recognition for new language
  recognition = null;
};

// ===== STATS =====
function updateStats() {
  $('statQ').textContent = STATE.questionsAsked;
  $('statC').textContent = STATE.correctAnswers;
  $('statT').textContent = STATE.topicsCovered.size;
  const pct = STATE.questionsAsked > 0 ? Math.round(STATE.correctAnswers / STATE.questionsAsked * 100) : 0;
  $('accPct').textContent = `${pct}%`;
  $('accFill').style.width = `${pct}%`;
}

function trackWeak(topic) {
  if (!topic) return;
  STATE.weakAreas[topic] = (STATE.weakAreas[topic] || 0) + 1;
  const el = $('weakAreas');
  const sorted = Object.entries(STATE.weakAreas).sort((a, b) => b[1] - a[1]).slice(0, 5);
  el.innerHTML = sorted.map(([t, c]) => `<span class="weak-tag">⚠️ ${escapeHtml(t)} (${c}x)</span>`).join('');
}

function extractTopicFromText(t) {
  return t?.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b/g)?.[0] || null;
}
function extractTopic(reply) {
  const m = reply.match(/\*\*([\w\s]+)\*\*/);
  if (m && m[1].length < 40) {
    STATE.currentTopic = m[1];
    STATE.topicsCovered.add(m[1]);
    updateStats();
  }
}

function showTyping(show) {
  $('typingIndicator').classList.toggle('hidden', !show);
  if (show) scrollBottom();
}

// ===== CHAT HISTORY =====
let selectedHistorySession = null;

async function loadChatHistory() {
  const container = document.getElementById('chatHistoryList');
  container.innerHTML = '<span class="muted-text">Loading...</span>';
  try {
    const res = await fetch(`${API}/user/${currentUser.id}/history`);
    const sessions = await res.json();
    if (!Array.isArray(sessions) || !sessions.length) {
      container.innerHTML = '<span class="muted-text">Koi history nahi abhi tak!</span>';
      return;
    }
    container.innerHTML = sessions.map(s => {
      const date = new Date(s.started_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      const topic = s.topic && s.topic !== 'General' ? s.topic : '💬 Chat Session';
      const msgs = s.message_count || 0;
      const accuracy = s.questions_asked > 0
        ? Math.round(s.correct_answers / s.questions_asked * 100) + '%' : '-';
      return `
        <div class="history-item">
          <div class="history-item-topic" onclick="openHistoryModal(${s.id}, '${escapeAttr(topic)}')" title="${escapeAttr(topic)}">
            📖 ${escapeHtml(topic)}
          </div>
          <div class="history-item-meta">
            <span>${date}</span>
            <span>${msgs} msg</span>
            <span>✅ ${accuracy}</span>
          </div>
          <div class="history-item-actions">
            <button class="history-del-btn" onclick="deleteSession(${s.id}, this)">🗑️ Delete</button>
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    container.innerHTML = '<span class="muted-text" style="color:var(--rose)">⚠️ Load nahi hua</span>';
  }
}

async function openHistoryModal(sessionId, topic) {
  selectedHistorySession = { id: sessionId, topic };
  document.getElementById('historyModal').classList.remove('hidden');
  document.getElementById('historyModalTitle').textContent = `📖 ${topic}`;
  document.getElementById('historyModalMessages').innerHTML =
    '<div style="text-align:center;padding:40px;color:var(--text3)">⏳ Loading messages...</div>';
  try {
    const histRes = await fetch(`${API}/user/${currentUser.id}/history`);
    const sessions = await histRes.json();
    const sess = sessions.find(s => s.id === sessionId);
    if (sess) {
      const accuracy = sess.questions_asked > 0
        ? Math.round(sess.correct_answers / sess.questions_asked * 100) + '%' : '-';
      const date = new Date(sess.started_at).toLocaleString('en-IN');
      document.getElementById('historyModalMeta').innerHTML = `
        <span>📅 ${date}</span>
        <span>❓ ${sess.questions_asked} questions</span>
        <span>✅ ${sess.correct_answers} correct</span>
        <span>🎯 ${accuracy} accuracy</span>`;
    }
    const msgRes = await fetch(`${API}/sessions/${sessionId}/messages`);
    const messages = await msgRes.json();
    const container = document.getElementById('historyModalMessages');
    if (!Array.isArray(messages) || !messages.length) {
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">Koi messages nahi is session mein</div>';
      return;
    }
    container.innerHTML = messages.map(m => {
      const isUser = m.role === 'user';
      const time = new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const content = renderHistoryContent(m.content || '');
      return `
        <div class="h-msg ${isUser ? 'user' : 'teacher'}">
          <div class="h-avatar">${isUser ? '🙋' : '👨‍🏫'}</div>
          <div>
            <div class="h-bubble">${content}</div>
            <div class="h-time">${time}</div>
          </div>
        </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  } catch(e) {
    document.getElementById('historyModalMessages').innerHTML =
      '<div style="color:var(--rose);padding:20px">⚠️ Messages load nahi hue</div>';
  }
}

function renderHistoryContent(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\[MCQ\][\s\S]*?\[\/MCQ\]/g, '<em style="color:var(--green)">[MCQ Question]</em>')
    .replace(/\n/g, '<br/>');
}

function closeHistoryModal() {
  document.getElementById('historyModal').classList.add('hidden');
  selectedHistorySession = null;
}

function resumeSession() {
  if (!selectedHistorySession) return;
  closeHistoryModal();
  const topic = selectedHistorySession.topic;
  STATE.currentTopic = topic;
  const msg = `Mujhe "${topic}" topic continue karna hai — jahan chhoda tha wahan se shuru karo`;
  document.getElementById('userInput').value = msg;
  sendMessage();
}

async function deleteSession(sessionId, btn) {
  if (!confirm('Is chat history ko delete karna chahte ho?')) return;
  const item = btn.closest('.history-item');
  item.style.opacity = '0.4';
  try {
    await fetch(`${API}/sessions/${sessionId}`, { method: 'DELETE' });
    item.remove();
    const container = document.getElementById('chatHistoryList');
    if (!container.querySelector('.history-item')) {
      container.innerHTML = '<span class="muted-text">Koi history nahi!</span>';
    }
  } catch(e) { item.style.opacity = '1'; }
}

function escapeAttr(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Close modal on backdrop click
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('historyModal')?.addEventListener('click', function(e) {
    if (e.target === this) closeHistoryModal();
  });
});
