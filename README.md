# 🚀 SmartRevise AI — Full Stack Website

A full-stack AI-powered learning platform built with:

* 🎨 Frontend (HTML, CSS, JavaScript)
* ⚙️ Backend (Flask API)
* 🗄️ SQLite Database
* 🤖 Gemini AI Integration

---
✨ Features
🤖 AI Teacher — kisi bhi topic ko step-by-step samjho
🎤 Voice Mode — bol kar pucho, AI jawab dega
📝 Smart Notes — notes analyze karo instantly
❓ MCQ Practice — exam preparation easy
📁 File Upload — PDF, Images, Text analyze
📊 Progress Tracking — apni growth dekho
👑 Admin Panel — users aur data manage karo

## 📁 Project Structure

```
project/
├── server.py
├── requirements.txt
├── database.db        (auto-created)
├── uploads/           (user files)
└── static/
    ├── index.html
    ├── css/
    ├── js/
    └── pages/
```

---

## ⚙️ Run Locally (3 Steps)

### 1️⃣ Install dependencies

```
pip install -r requirements.txt
```

### 2️⃣ Set API Key

Create a `.env` file (only for local use):

```
GEMINI_API_KEY=your_api_key
```

### 3️⃣ Run server

```
python server.py
```

Open in browser:

```
http://localhost:5000
```

---


### ⚙️ Settings:

**Build Command**

```
pip install -r requirements.txt
```

**Start Command**

```
gunicorn server:app
```

---

## 📦 Requirements

```
Flask
flask-cors
gunicorn
```

---


## 📁 File Upload Features

* 📄 PDF — AI content read karega
* 🖼️ Images — AI analyze karega
* 📝 Text — full read
* 🎥 Video — filename-based context


## 👨‍💻 Author

taniya
