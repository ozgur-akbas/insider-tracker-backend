/**
 * Companies API Endpoints
 */

export async function getCompanies(request, db, corsHeaders) {
  const url = new URL(request.url);
  const search = url.searchParams.get('q');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  let query = `
    SELECT c.*, cs.score, cs.signal
    FROM companies c
    LEFT JOIN company_scores cs ON c.id = cs.company_id
    WHERE 1=1
  `;
  
  const params = [];

  if (search) {
    query += ` AND (c.ticker LIKE ? OR c.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY cs.score DESC LIMIT ?`;
  params.push(limit);

  const { results } = await db.prepare(query).bind(...params).all();

  return new Response(JSON.stringify({
    data: results,
    count: results.length
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export async function getTopScored(request, db, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const minScore = parseInt(url.searchParams.get('min_score') || '60');

  const query = `
    SELECT 
      c.*,
      cs.score,
      cs.signal,
      cs.num_buyers_30d,
      cs.num_sellers_30d,
      cs.total_buy_value_30d,
      cs.total_sell_value_30d,
      cs.num_transactions_30d
    FROM companies c
    JOIN company_scores cs ON c.id = cs.company_id
    WHERE cs.score >= ?
    ORDER BY cs.score DESC
    LIMIT ?
  `;

  const { results } = await db.prepare(query).bind(minScore, limit).all();

  return new Response(JSON.stringify({
    data: results,
    count: results.length
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export async function getCompanyDetail(ticker, db, corsHeaders) {
  // Get company info with score
  const companyQuery = `
    SELECT 
      c.*,
      cs.score,
      cs.signal,
      cs.num_buyers_30d,
      cs.num_sellers_30d,
      cs.total_buy_value_30d,
      cs.total_sell_value_30d,
      cs.num_transactions_30d
    FROM companies c
    LEFT JOIN company_scores cs ON c.id = cs.company_id
    WHERE c.ticker = ?
  `;

  const company = await db.prepare(companyQuery).bind(ticker.toUpperCase()).first();

  if (!company) {
    return new Response(JSON.stringify({ error: 'Company not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Get recent transactions
  const transactionsQuery = `
    SELECT 
      t.*,
      i.name as insider_name
    FROM transactions t
    JOIN insiders i ON t.insider_id = i.id
    WHERE t.company_id = ?
    AND t.transaction_date >= date('now', '-90 days')
    ORDER BY t.transaction_date DESC
    LIMIT 50
  `;

  const { results: transactions } = await db.prepare(transactionsQuery).bind(company.id).all();

  // Get top insiders
  const insidersQuery = `
    SELECT 
      i.name,
      COUNT(*) as num_transactions,
      SUM(t.transaction_value) as total_value
    FROM transactions t
    JOIN insiders i ON t.insider_id = i.id
    WHERE t.company_id = ?
    AND t.transaction_date >= date('now', '-90 days')
    GROUP BY i.id, i.name
    ORDER BY total_value DESC
    LIMIT 10
  `;

  const { results: topInsiders } = await db.prepare(insidersQuery).bind(company.id).all();

  return new Response(JSON.stringify({
    company,
    transactions,
    topInsiders
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

