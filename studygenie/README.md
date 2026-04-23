# 🚀 SmartRevise AI — Full Stack Website

A full-stack AI-powered learning platform built with:

* 🎨 Frontend (HTML, CSS, JavaScript)
* ⚙️ Backend (Flask API)
* 🗄️ SQLite Database
* 🤖 Gemini AI Integration

---

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

## 🔐 Environment Variables (IMPORTANT)

Render dashboard me add karo:

```
GEMINI_API_KEY=your_api_key
```

⚠️ `.env` file GitHub par upload **na karein**

---

## 📦 Requirements

```
Flask
flask-cors
gunicorn
```

---

## 👑 Admin Login

* Email: [admin@srt.com](mailto:admin@srt.com)
* Password: admin123

---

## 📁 File Upload Features

* 📄 PDF — AI content read karega
* 🖼️ Images — AI analyze karega
* 📝 Text — full read
* 🎥 Video — filename-based context

---

## ⚠️ Important Notes

* ❌ `.env` GitHub par upload na karein
* ❌ `database.db` upload na karein
* ❌ `uploads/` upload na karein
* ✅ Environment variables hosting par set karein

---

## 🌍 Live Website

```
https://your-app.onrender.com
```

---

## 👨‍💻 Author

taniya
