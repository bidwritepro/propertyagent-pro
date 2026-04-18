# PropertyAgent Pro — Deployment Guide

## What's in this package

```
propertyagent-pro/
├── server.js          ← Express server (app + admin dashboard)
├── database.js        ← SQLite database layer
├── package.json       ← Dependencies
├── railway.json       ← Railway deployment config
├── Procfile           ← Process definition
├── .gitignore         ← Keeps node_modules & data out of git
└── public/
    └── index.html     ← The PropertyAgent Pro app
```

## Admin Login (Test Credentials)

- **Username:** `david`
- **Password:** `PropAgent2026!`

You can change the password from the admin dashboard after logging in,
or set environment variables before deployment (see below).

## Option 1: Deploy to Railway (Recommended)

### Step-by-step

1. Go to https://railway.app and sign in
2. Click **"New Project"** → **"Deploy from GitHub Repo"**
3. If your code is not on GitHub yet:
   - Create a new GitHub repository (e.g., `propertyagent-pro`)
   - Push this folder to it:
     ```bash
     cd propertyagent-pro
     git init
     git add .
     git commit -m "Initial commit — PropertyAgent Pro"
     git remote add origin https://github.com/YOUR_USERNAME/propertyagent-pro.git
     git push -u origin main
     ```
   - Then connect that repo in Railway
4. Railway will auto-detect Node.js and deploy
5. In Railway → **Settings** → **Networking**, click **"Generate Domain"** to get a public URL
6. To use your custom domain (www.propertyagentpro.com):
   - In Railway → **Settings** → **Networking** → **Custom Domain**
   - Add `www.propertyagentpro.com`
   - Railway gives you a CNAME record
   - Go to your domain registrar and add that CNAME record pointing to Railway

### Environment Variables (set in Railway dashboard)

| Variable         | Description                        | Default              |
|------------------|------------------------------------|----------------------|
| `ADMIN_USER`     | Admin login username               | `david`              |
| `ADMIN_PASS`     | Admin login password               | `PropAgent2026!`     |
| `SESSION_SECRET`  | Session encryption key             | (auto-generated)     |
| `PORT`           | Server port (Railway sets this)    | `3000`               |

**Important:** Set `SESSION_SECRET` to a random string in production:
```
SESSION_SECRET=your-random-string-here-at-least-32-chars
```

## Option 2: Run Locally for Testing

```bash
cd propertyagent-pro
npm install
node server.js
```

Then open:
- App: http://localhost:3000
- Admin: http://localhost:3000/admin

## Admin Dashboard Features

- **Stats overview:** Total users, revenue, offers printed, conversion rate
- **Signups & Revenue chart:** Bar + line chart, adjustable time range
- **Top ZIP codes:** Doughnut chart of most-searched areas
- **User list:** Searchable table with all registered users
- **Payment log:** Every payment with property details and offer price
- **Recent activity:** Live feed of signups and payments
- **Export:** Download users or payments as .xlsx or .csv
- **Change password:** Update admin password from the dashboard

## Custom Domain Setup (www.propertyagentpro.com)

1. In Railway, add `www.propertyagentpro.com` as a custom domain
2. Railway provides a CNAME value (e.g., `xxx.up.railway.app`)
3. At your domain registrar, add:
   - **Type:** CNAME
   - **Name:** www
   - **Value:** (the Railway CNAME)
4. For the root domain (`propertyagentpro.com`), add a redirect to `www`
5. SSL is automatic through Railway

## Data Storage

User data is stored in a SQLite database file at `data/propertyagent.db`.
On Railway, this persists as long as the deployment volume is attached.
For long-term production, consider upgrading to Railway's PostgreSQL add-on.

## Future: Stripe Integration

The payment modal currently simulates payment. To accept real payments:
1. Create a Stripe account at https://stripe.com
2. Add your Stripe secret key as an environment variable
3. Replace the `/api/payment` endpoint with Stripe Checkout
4. The admin dashboard will still track all payments automatically
