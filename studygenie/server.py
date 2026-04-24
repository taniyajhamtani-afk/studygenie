"""
StudyGenie — Python Flask Backend
SQLite + File Upload + Gemini AI Integration
"""

import os
import sqlite3
import base64
import json
import mimetypes
import hashlib
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, g
from flask_cors import CORS
from werkzeug.utils import secure_filename
import urllib.request
import urllib.error
import os
import time
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# ===== CONFIG =====
app = Flask(__name__, static_folder='static')
CORS(app, origins="*")

BASE_DIR    = Path(__file__).parent
DB_PATH     = BASE_DIR / "database.db"
UPLOAD_DIR  = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

GEMINI_URL     = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"

ALLOWED_EXT = {
    'image': ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    'pdf':   ['.pdf'],
    'text':  ['.txt', '.md', '.csv'],
    'video': ['.mp4', '.mov', '.avi', '.mkv'],
    'doc':   ['.doc', '.docx']
}
MAX_FILE_SIZE = 50 * 1024 * 1024   # 50 MB

# ===== DATABASE =====
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    UNIQUE NOT NULL,
    password    TEXT,
    google_id   TEXT,
    role        TEXT    DEFAULT 'student',
    created_at  TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL,
    filename      TEXT    NOT NULL,
    original_name TEXT    NOT NULL,
    file_type     TEXT    NOT NULL,
    file_category TEXT    NOT NULL,
    file_size     INTEGER,
    file_path     TEXT    NOT NULL,
    uploaded_at   TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER,
    topic           TEXT    DEFAULT 'General',
    questions_asked INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    started_at      TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    role       TEXT,
    content    TEXT,
    file_ids   TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);
"""

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(str(DB_PATH))
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    db = g.pop('db', None)
    if db: db.close()

def init_db():
    with sqlite3.connect(str(DB_PATH)) as conn:
        conn.executescript(SCHEMA)
        # Default admin
        conn.execute("""
            INSERT OR IGNORE INTO users (name, email, password, role)
            VALUES ('Admin', 'admin@srt.com', ?, 'admin')
        """, (base64.b64encode(b'admin123').decode(),))
        conn.commit()
with app.app_context():
    init_db()

def query(sql, params=()):
    return get_db().execute(sql, params).fetchall()

def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()

def run(sql, params=()):
    db = get_db()
    cur = db.execute(sql, params)
    db.commit()
    return cur.lastrowid

# ===== FILE HELPERS =====
def get_category(filename):
    ext = Path(filename).suffix.lower()
    for cat, exts in ALLOWED_EXT.items():
        if ext in exts: return cat
    return 'other'

def is_allowed(filename):
    ext = Path(filename).suffix.lower()
    all_exts = [e for exts in ALLOWED_EXT.values() for e in exts]
    return ext in all_exts

def file_to_base64(filepath):
    with open(filepath, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

def get_mime(filepath):
    mime, _ = mimetypes.guess_type(str(filepath))
    return mime or 'application/octet-stream'

# ===== GEMINI API =====
def call_gemini(messages, system_prompt, files=None):
    """Call Gemini API with optional file attachments"""

    contents = []
    for msg in messages:
        role = 'model' if msg['role'] == 'assistant' else 'user'
        parts = [{'text': msg['content']}]
        contents.append({'role': role, 'parts': parts})

    # If files provided, add to LAST user message
    if files and contents:
        last = contents[-1]
        if last['role'] == 'user':
            for f in files:
                filepath = UPLOAD_DIR / f['filename']
                if not filepath.exists():
                    continue

                category = f['file_category']
                mime = get_mime(filepath)

                if category == 'image':
                    # Images: send as inline_data
                    b64 = file_to_base64(filepath)
                    last['parts'].append({
                        'inline_data': {
                            'mime_type': mime,
                            'data': b64
                        }
                    })

                elif category == 'pdf':
                    # PDF: send as inline_data
                    b64 = file_to_base64(filepath)
                    last['parts'].append({
                        'inline_data': {
                            'mime_type': 'application/pdf',
                            'data': b64
                        }
                    })

                elif category == 'text':
                    # Text: read and send as text
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as tf:
                            content = tf.read()[:8000]  # limit
                        last['parts'].append({
                            'text': f"\n\n[File: {f['original_name']}]\n{content}"
                        })
                    except:
                        pass

                elif category == 'video':
                    # Videos: mention only (Gemini free tier doesn't support video)
                    last['parts'].append({
                        'text': f"\n[Video file uploaded: {f['original_name']} — {f['file_size']} bytes. Video content ka analysis karo based on filename.]"
                    })

                else:
                    last['parts'].append({
                        'text': f"\n[File uploaded: {f['original_name']}]"
                    })

    payload = {
        'contents': contents,
        'systemInstruction': {'parts': [{'text': system_prompt}]},
        'generationConfig': {'maxOutputTokens': 1500}
    }

    payload_bytes = json.dumps(payload).encode('utf-8')

    req = urllib.request.Request(
        GEMINI_URL,
        data=payload_bytes,
        headers={
            'Content-Type': 'application/json',
            'X-goog-api-key': GEMINI_API_KEY
        },
        method='POST'
    )

    # 🔥 retry logic
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode('utf-8'))

                try:
                    return data['candidates'][0]['content']['parts'][0]['text']
                except:
                    return "⚠️ AI response nahi mila, dubara try karo"

        except Exception as e:
            print(f"Retry {i+1} failed:", e)
            time.sleep(2)

    return "⚠️ AI busy hai, 10 sec baad try karo"

# ===== AUTH ROUTES =====
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    name  = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '').strip()

    if not name or not email or not password:
        return jsonify({'error': 'Sab fields bharo!'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password kam se kam 6 characters!'}), 400

    existing = query_one('SELECT id FROM users WHERE email = ?', (email,))
    if existing:
        return jsonify({'error': 'Email already registered hai!'}), 400

    uid = run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
              (name, email, base64.b64encode(password.encode()).decode()))

    user = query_one('SELECT * FROM users WHERE id = ?', (uid,))
    return jsonify({
        'id': user['id'], 'name': user['name'],
        'email': user['email'], 'role': user['role']
    })

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '').strip()

    user = query_one('SELECT * FROM users WHERE email = ?', (email,))
    if not user:
        return jsonify({'error': 'Email nahi mila!'}), 401

    stored = base64.b64decode(user['password'].encode()).decode()
    if stored != password:
        return jsonify({'error': 'Password galat hai!'}), 401

    return jsonify({
        'id': user['id'], 'name': user['name'],
        'email': user['email'], 'role': user['role']
    })

# ===== FILE ROUTES =====
@app.route('/api/upload', methods=['POST'])
def upload_file():
    user_id = request.form.get('user_id')
    if not user_id:
        return jsonify({'error': 'user_id required'}), 400

    if 'file' not in request.files:
        return jsonify({'error': 'File nahi mili!'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400
    if not is_allowed(file.filename):
        return jsonify({'error': 'File type allowed nahi hai!'}), 400

    # Check size
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_SIZE:
        return jsonify({'error': 'File 50MB se badi hai!'}), 400

    # Save file
    original = secure_filename(file.filename)
    ext  = Path(original).suffix.lower()
    name = hashlib.md5(f"{user_id}_{original}_{datetime.now()}".encode()).hexdigest() + ext
    path = UPLOAD_DIR / name
    file.save(str(path))

    category = get_category(original)
    fid = run("""
        INSERT INTO files (user_id, filename, original_name, file_type, file_category, file_size, file_path)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (user_id, name, original, ext, category, size, str(path)))

    return jsonify({
        'id': fid, 'filename': name, 'original_name': original,
        'file_type': ext, 'file_category': category,
        'file_size': size, 'url': f'/api/files/{name}'
    })

@app.route('/api/files/<filename>')
def serve_file(filename):
    return send_from_directory(str(UPLOAD_DIR), filename)

@app.route('/api/user/<int:user_id>/files')
def get_user_files(user_id):
    files = query("""
        SELECT id, filename, original_name, file_type, file_category, file_size, uploaded_at
        FROM files WHERE user_id = ? ORDER BY uploaded_at DESC
    """, (user_id,))
    return jsonify([dict(f) for f in files])

@app.route('/api/files/<int:file_id>', methods=['DELETE'])
def delete_file(file_id):
    f = query_one('SELECT * FROM files WHERE id = ?', (file_id,))
    if f:
        try: Path(f['file_path']).unlink(missing_ok=True)
        except: pass
        run('DELETE FROM files WHERE id = ?', (file_id,))
    return jsonify({'success': True})

# ===== CHAT ROUTE =====
@app.route('/api/chat', methods=['POST'])
def chat():
    data       = request.json
    messages   = data.get('messages', [])
    file_ids   = data.get('file_ids', [])     # list of file IDs to attach
    language   = data.get('language', 'hinglish')
    mode       = data.get('mode', 'chat')
    session_id = data.get('session_id')
    user_id    = data.get('user_id')

    # Fetch file info from DB
    files = []
    for fid in file_ids:
        f = query_one('SELECT * FROM files WHERE id = ?', (fid,))
        if f: files.append(dict(f))

    # Build system prompt
    lang_map = {
        'hinglish': "Respond in Hinglish (Hindi + English mix). Natural Indian teacher tone.",
        'hindi':    "Respond entirely in Hindi. Simple teacher language.",
        'english':  "Respond in English only. Friendly teacher tone."
    }
    mode_map = {
        'revision': "EXAM MODE: Rapid-fire questions, short bullet summaries, be fast!",
        'notes':    "NOTES MODE: Summarize, extract key points, generate questions.",
        'chat':     "CHAT MODE: Teach deeply, ask questions after explaining, be interactive."
    }

    file_instruction = ""
    if files:
        types = [f['file_category'] for f in files]
        file_instruction = f"\nFILES ATTACHED: {', '.join(types)}. Carefully analyze the provided file content and answer questions about it."

    system = f"""You are StudyGenie — an advanced friendly Indian AI teacher.
LANGUAGE: {lang_map.get(language, lang_map['hinglish'])}
MODE: {mode_map.get(mode, mode_map['chat'])}
{file_instruction}

TEACHING RULES:
1. Simple explanation first with real Indian examples
2. Break complex topics into small parts
3. After explaining ALWAYS ask 1-3 questions
4. Wrong answer: "Almost! Thoda aur socho..." then re-explain
5. Right answer: praise briefly, increase difficulty

FORMATTING:
- **bold** for key terms, bullet points for lists
- 🎯 important, ✅ correct, 💡 tips, ❓ questions
- MCQ format:
[MCQ]
Question?
A) Option1
B) Option2
C) Option3
D) Option4
[ANSWER: X]
[/MCQ]

If files are attached, analyze them carefully and answer specifically about their content.
Always end with a question to keep student engaged!"""

    reply = call_gemini(messages, system, files if files else None)

    # Save to DB
    if session_id:
        last_user = next((m for m in reversed(messages) if m['role'] == 'user'), None)
        if last_user:
            run('INSERT INTO messages (session_id, role, content, file_ids) VALUES (?,?,?,?)',
                (session_id, 'user', last_user['content'], json.dumps(file_ids)))
        run('INSERT INTO messages (session_id, role, content) VALUES (?,?,?)',
            (session_id, 'assistant', reply[:3000]))

    return jsonify({'reply': reply})

# ===== SESSION ROUTES =====
@app.route('/api/sessions', methods=['POST'])
def create_session():
    data = request.json
    sid = run('INSERT INTO sessions (user_id, topic) VALUES (?, ?)',
              (data.get('user_id'), data.get('topic', 'General')))
    return jsonify({'session_id': sid})

@app.route('/api/sessions/<int:sid>', methods=['PUT'])
def update_session(sid):
    data = request.json
    run('UPDATE sessions SET questions_asked=?, correct_answers=?, topic=? WHERE id=?',
        (data.get('questions_asked', 0), data.get('correct_answers', 0),
         data.get('topic', 'General'), sid))
    return jsonify({'success': True})

# ===== ADMIN ROUTES =====
@app.route('/api/admin/stats')
def admin_stats():
    return jsonify({
        'users':    query_one('SELECT COUNT(*) as c FROM users')['c'],
        'files':    query_one('SELECT COUNT(*) as c FROM files')['c'],
        'sessions': query_one('SELECT COUNT(*) as c FROM sessions')['c'],
        'messages': query_one('SELECT COUNT(*) as c FROM messages')['c'],
    })

@app.route('/api/admin/users')
def admin_users():
    users = query('SELECT id, name, email, role, created_at FROM users ORDER BY id DESC')
    return jsonify([dict(u) for u in users])

@app.route('/api/admin/users/<int:uid>', methods=['DELETE'])
def admin_delete_user(uid):
    run('DELETE FROM users WHERE id = ?', (uid,))
    return jsonify({'success': True})

@app.route('/api/admin/users/<int:uid>/role', methods=['PUT'])
def admin_toggle_role(uid):
    user = query_one('SELECT role FROM users WHERE id = ?', (uid,))
    new_role = 'student' if user['role'] == 'admin' else 'admin'
    run('UPDATE users SET role = ? WHERE id = ?', (new_role, uid))
    return jsonify({'role': new_role})

@app.route('/api/admin/files')
def admin_files():
    files = query("""
        SELECT f.*, u.name as user_name
        FROM files f LEFT JOIN users u ON f.user_id = u.id
        ORDER BY f.uploaded_at DESC
    """)
    return jsonify([dict(f) for f in files])

@app.route('/api/admin/sessions')
def admin_sessions():
    sessions = query("""
        SELECT s.*, u.name as user_name
        FROM sessions s LEFT JOIN users u ON s.user_id = u.id
        ORDER BY s.started_at DESC LIMIT 50
    """)
    return jsonify([dict(s) for s in sessions])

# ===== SERVE FRONTEND =====
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    try:
        return send_from_directory('static', path)
    except:
        return send_from_directory('static', 'index.html')

# ===== RUN =====
if __name__ == '__main__':
    init_db()
    print("\n" + "="*50)
    
    print("="*50)
   
    print(f"📁 Files save hongi: {UPLOAD_DIR}")
    print(f"🗄️  Database: {DB_PATH}")
    import os

    PORT = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=PORT)
   

# ===== CHAT HISTORY ROUTES =====
@app.route('/api/user/<int:user_id>/history')
def get_user_history(user_id):
    """All sessions with message count for this user"""
    sessions = query("""
        SELECT s.id, s.topic, s.questions_asked, s.correct_answers, s.started_at,
               COUNT(m.id) as message_count
        FROM sessions s
        LEFT JOIN messages m ON m.session_id = s.id
        WHERE s.user_id = ?
        GROUP BY s.id
        ORDER BY s.started_at DESC
        LIMIT 50
    """, (user_id,))
    return jsonify([dict(s) for s in sessions])

@app.route('/api/sessions/<int:sid>/messages')
def get_session_messages(sid):
    """All messages for a session"""
    msgs = query("""
        SELECT id, role, content, file_ids, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at ASC
    """, (sid,))
    return jsonify([dict(m) for m in msgs])

@app.route('/api/sessions/<int:sid>', methods=['DELETE'])
def delete_session(sid):
    run('DELETE FROM messages WHERE session_id = ?', (sid,))
    run('DELETE FROM sessions WHERE id = ?', (sid,))
    return jsonify({'success': True})
