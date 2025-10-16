/**
 * Clusters API Endpoints
 */

export async function getClusters(request, db, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '7');
  const minInsiders = parseInt(url.searchParams.get('min_insiders') || '2');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  const query = `
    SELECT 
      cb.*,
      c.ticker,
      c.name as company_name
    FROM cluster_buys cb
    JOIN companies c ON cb.company_id = c.id
    WHERE cb.cluster_date >= date('now', '-' || ? || ' days')
    AND cb.num_insiders >= ?
    ORDER BY cb.score DESC, cb.total_value DESC
    LIMIT ?
  `;

  const { results } = await db.prepare(query).bind(days, minInsiders, limit).all();

  return new Response(JSON.stringify({
    data: results,
    count: results.length
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export async function getLiveClusters(db, corsHeaders) {
  // Detect live cluster buys (2+ insiders buying within 7 days)
  const query = `
    SELECT 
      c.id as company_id,
      c.ticker,
      c.name as company_name,
      COUNT(DISTINCT t.insider_id) as num_insiders,
      COUNT(*) as num_transactions,
      SUM(t.transaction_value) as total_value,
      SUM(t.shares) as total_shares,
      cs.score,
      cs.signal
    FROM transactions t
    JOIN companies c ON t.company_id = c.id
    LEFT JOIN company_scores cs ON c.id = cs.company_id
    WHERE t.is_purchase = 1
    AND t.transaction_date >= date('now', '-7 days')
    GROUP BY c.id, c.ticker, c.name, cs.score, cs.signal
    HAVING COUNT(DISTINCT t.insider_id) >= 2
    ORDER BY cs.score DESC, total_value DESC
    LIMIT 50
  `;

  const { results } = await db.prepare(query).all();

  return new Response(JSON.stringify({
    data: results,
    count: results.length
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

