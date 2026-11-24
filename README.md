# ⚙️ SpendSense — Backend API

The REST API powering SpendSense. Handles multimodal receipt vision OCR, expense management, and budget analytics.

> **Live API:** [spendsense-backend.onrender.com](https://your-api.onrender.com)  
> **Frontend App:** [spendsense-frontend.vercel.app](https://your-app.vercel.app)

---

## 🎯 What it Does

- **Receipt Vision OCR:** Parses raw receipt images via Google Gemini Vision into merchant names, dates, amounts, and itemized lists.
- **Expense Operations:** Full CRUD for expenses stored in Supabase PostgreSQL.
- **Budget Intelligence:** Computes monthly pacing, category concentrations, runway buffers, and spending metrics.
- **Secure Authentication:** Validates Supabase JWTs with database-level Row Level Security (RLS) enforcement.

---

## 🛠️ Tech Stack

- **Runtime:** Node.js, Express, TypeScript
- **AI Model:** Google Gemini Multimodal Vision API
- **Database:** Supabase (PostgreSQL with RLS)
- **Token Verification:** `jose` (JWT / JWKS)

---

## 📡 Key Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status |
| `POST` | `/api/receipts/scan` | Receipt OCR analysis (accepts base64 image) |
| `GET` | `/api/expenses` | Get user expenses with search, filter, and sort |
| `POST` | `/api/expenses` | Save an expense with itemized lines |
| `GET` | `/api/expenses/stats` | Monthly budget pacing and metrics |
| `PUT` | `/api/expenses/:id` | Update an existing expense |
| `DELETE` | `/api/expenses/:id` | Delete an expense |

---

## 💻 Running Locally

### 1. Install dependencies:
```bash
npm install
```

### 2. Set environment variables:
Create a `.env` file in this folder (see `.env.example`):
```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5500,http://localhost:3000
SUPABASE_URL=your_supabase_project_url
SUPABASE_SECRET_KEY=your_supabase_service_role_key
SUPABASE_JWT_SECRET=your_supabase_jwt_secret
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Build & start:
```bash
npm run dev
# or for production:
npm run build && npm start
```
Server runs at `http://localhost:3000`. Database table schema can be found in `database/schema.sql`.
