/**
 * Stats API Endpoint
 */

export async function getStats(db, corsHeaders) {
  // Total companies
  const totalCompanies = await db.prepare(`
    SELECT COUNT(*) as count FROM companies
  `).first();

  // Today's filings
  const todayFilings = await db.prepare(`
    SELECT COUNT(*) as count 
    FROM transactions 
    WHERE filing_date = date('now')
  `).first();

  // Cluster buys in last 7 days
  const clusterBuys7d = await db.prepare(`
    SELECT COUNT(DISTINCT company_id) as count
    FROM cluster_buys
    WHERE cluster_date >= date('now', '-7 days')
  `).first();

  // CEO buys today
  const ceoBuysToday = await db.prepare(`
    SELECT COUNT(*) as count
    FROM transactions
    WHERE is_purchase = 1
    AND transaction_date = date('now')
    AND (insider_role LIKE '%CEO%' OR insider_role LIKE '%CFO%')
  `).first();

  // Total transactions
  const totalTransactions = await db.prepare(`
    SELECT COUNT(*) as count FROM transactions
  `).first();

  // Recent activity (last 24 hours)
  const recentActivity = await db.prepare(`
    SELECT COUNT(*) as count
    FROM transactions
    WHERE created_at >= datetime('now', '-1 day')
  `).first();

  return new Response(JSON.stringify({
    total_companies: totalCompanies.count,
    today_filings: todayFilings.count,
    cluster_buys_7d: clusterBuys7d.count,
    ceo_buys_today: ceoBuysToday.count,
    total_transactions: totalTransactions.count,
    recent_activity_24h: recentActivity.count,
    last_updated: new Date().toISOString()
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

