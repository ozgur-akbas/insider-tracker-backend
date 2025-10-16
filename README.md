# Insider Tracker Backend (Cloudflare Pages)

Backend API for the Insider Tracker application, deployed on Cloudflare Pages with Functions.

## Structure

```
/functions/
  /api/
    [[path]].js    # Main API handler (handles all /api/* routes)
  _middleware.js   # Global middleware
```

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/transactions` - Get insider transactions
- `GET /api/companies` - Get companies
- `GET /api/companies/top` - Get top-scored companies
- `GET /api/companies/{ticker}` - Get company details
- `GET /api/clusters` - Get cluster buys
- `GET /api/stats` - Get statistics
- `POST /api/collect` - Trigger data collection

## Deployment

This is automatically deployed via Cloudflare Pages when you push to GitHub.

## D1 Database Binding

Make sure to bind the D1 database in Cloudflare Pages settings:
- Variable name: `DB`
- D1 database: `insider-tracker-db`

## Environment

- Platform: Cloudflare Pages
- Runtime: Pages Functions
- Database: Cloudflare D1 (SQLite)

