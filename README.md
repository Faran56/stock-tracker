# Stock Tracker

Modern stock tracking app for water treatment products. Built with React.

## Features
- Track stock in / out per product column (211G, Bwm 303, Bwm 777 + add more)
- Upload customer names from CSV or Excel — auto-populates dropdown
- Filter by status, product, or search by name
- Inline status update (Pending → Delivered etc.)
- Export to Excel
- Auto-saves to browser localStorage

## Setup

```bash
npm install
npm start        # dev server at localhost:3000
```

## Deploy to GitHub Pages

1. Create a GitHub repo named `stock-tracker`
2. Edit `package.json` → change `homepage`:
   ```json
   "homepage": "https://YOUR-USERNAME.github.io/stock-tracker"
   ```
3. Push your code:
   ```bash
   git init
   git remote add origin https://github.com/YOUR-USERNAME/stock-tracker.git
   git add .
   git commit -m "initial"
   git push -u origin main
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```

Live at: `https://YOUR-USERNAME.github.io/stock-tracker`

## Customer List Format

Upload a `.csv` or `.xlsx` with customer names in any single column. Example:
```
Matar Al Kutbi
Omar Al Rahba
Sultan Al Habtoor
```
