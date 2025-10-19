// Cloudflare Pages Functions API Handler
// This handles all /api/* routes

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS for CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Route handling
    if (path === '' || path === 'health') {
      return handleHealth(corsHeaders);
    } else if (path === 'transactions') {
      return await handleTransactions(request, env.DB, corsHeaders);
    } else if (path.startsWith('transactions/recent')) {
      return await handleRecentTransactions(request, env.DB, corsHeaders);
    } else if (path === 'companies') {
      return await handleCompanies(request, env.DB, corsHeaders);
    } else if (path === 'companies/top') {
      return await handleTopCompanies(request, env.DB, corsHeaders);
    } else if (path.startsWith('companies/top-scored')) {
      return await handleTopScoredCompanies(request, env.DB, corsHeaders);
    } else if (path.startsWith('companies/')) {
      const ticker = path.split('/')[1];
      return await handleCompanyDetail(ticker, env.DB, corsHeaders);
    } else if (path === 'clusters') {
      return await handleClusters(request, env.DB, corsHeaders);
    } else if (path === 'stats') {
      return await handleStats(env.DB, corsHeaders);
    } else if (path === 'collect') {
      return await handleCollect(env.DB, corsHeaders);
    } else if (path === 'debug-collect') {
      return await handleDebugCollect(env.DB, corsHeaders);
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse({ error: error.message }, 500, corsHeaders);
  }
}

// Helper function for JSON responses
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

// Health check
function handleHealth(corsHeaders) {
  return jsonResponse({
    status: 'ok',
    message: 'Insider Tracker API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }, 200, corsHeaders);
}

// Get transactions
async function handleTransactions(request, db, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const ticker = url.searchParams.get('ticker');
  const isPurchase = url.searchParams.get('is_purchase');

  let query = `
    SELECT t.*, c.ticker, c.name as company_name, i.name as insider_name
    FROM transactions t
    JOIN companies c ON t.company_id = c.id
    JOIN insiders i ON t.insider_id = i.id
    WHERE 1=1
  `;
  
  const params = [];
  
  if (ticker) {
    query += ` AND c.ticker = ?`;
    params.push(ticker);
  }
  
  if (isPurchase !== null && isPurchase !== undefined) {
    query += ` AND t.is_purchase = ?`;
    params.push(isPurchase === 'true' ? 1 : 0);
  }
  
  query += ` ORDER BY t.transaction_date DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await db.prepare(query).bind(...params).all();
  
  return jsonResponse({
    transactions: result.results || [],
    count: result.results?.length || 0,
    limit,
    offset,
  }, 200, corsHeaders);
}

// Get recent transactions
async function handleRecentTransactions(request, db, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '7');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  
  const query = `
    SELECT t.*, c.ticker, c.name as company_name, i.name as insider_name,
           CASE WHEN t.is_purchase = 1 THEN 'Purchase' ELSE 'Sale' END as transaction_type
    FROM transactions t
    JOIN companies c ON t.company_id = c.id
    JOIN insiders i ON t.insider_id = i.id
    WHERE t.transaction_date >= date('now', '-' || ? || ' days')
    ORDER BY t.transaction_date DESC
    LIMIT ?
  `;
  
  const result = await db.prepare(query).bind(days, limit).all();
  
  return jsonResponse({
    transactions: result.results || [],
    count: result.results?.length || 0,
    days,
  }, 200, corsHeaders);
}

// Get companies
async function handleCompanies(request, db, corsHeaders) {
  const url = new URL(request.url);
  const search = url.searchParams.get('search');
  
  let query = 'SELECT * FROM companies';
  const params = [];
  
  if (search) {
    query += ` WHERE ticker LIKE ? OR name LIKE ?`;
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ` LIMIT 100`;
  
  const result = await db.prepare(query).bind(...params).all();
  
  return jsonResponse({
    companies: result.results || [],
  }, 200, corsHeaders);
}

// Get top companies by score (legacy endpoint)
async function handleTopCompanies(request, db, corsHeaders) {
  // Redirect to the improved scoring endpoint
  return handleTopScoredCompanies(request, db, corsHeaders);
}

// Get top scored companies with improved algorithm
async function handleTopScoredCompanies(request, db, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const days = parseInt(url.searchParams.get('days') || '30');
  
  // Enhanced scoring query
  const query = `
    SELECT 
      c.ticker,
      c.name,
      c.cik,
      COUNT(t.id) as transaction_count,
      SUM(CASE WHEN t.is_purchase = 1 THEN 1 ELSE 0 END) as purchase_count,
      SUM(CASE WHEN t.is_purchase = 0 THEN 1 ELSE 0 END) as sale_count,
      SUM(CASE WHEN t.is_purchase = 1 THEN t.transaction_value ELSE 0 END) as buy_value,
      SUM(CASE WHEN t.is_purchase = 0 THEN t.transaction_value ELSE 0 END) as sell_value,
      (SUM(CASE WHEN t.is_purchase = 1 THEN t.transaction_value ELSE 0 END) - 
       SUM(CASE WHEN t.is_purchase = 0 THEN t.transaction_value ELSE 0 END)) as net_value,
      MAX(t.transaction_date) as last_transaction_date,
      AVG(CASE 
        WHEN t.insider_role LIKE '%CEO%' OR t.insider_role LIKE '%Chief Executive%' THEN 1.5
        WHEN t.insider_role LIKE '%CFO%' OR t.insider_role LIKE '%Chief Financial%' THEN 1.4
        WHEN t.insider_role LIKE '%President%' THEN 1.3
        WHEN t.insider_role LIKE '%COO%' OR t.insider_role LIKE '%Chief Operating%' THEN 1.3
        WHEN t.insider_role LIKE '%Director%' THEN 1.2
        WHEN t.insider_role LIKE '%SVP%' OR t.insider_role LIKE '%Senior Vice President%' THEN 1.15
        WHEN t.insider_role LIKE '%EVP%' OR t.insider_role LIKE '%Executive Vice President%' THEN 1.2
        WHEN t.insider_role LIKE '%VP%' OR t.insider_role LIKE '%Vice President%' THEN 1.1
        WHEN t.insider_role LIKE '%10%' OR t.insider_role LIKE '%Owner%' THEN 1.3
        ELSE 1.0
      END) as avg_seniority_weight,
      AVG(CASE 
        WHEN julianday('now') - julianday(t.transaction_date) <= 7 THEN 1.0
        WHEN julianday('now') - julianday(t.transaction_date) <= 30 THEN 0.8
        WHEN julianday('now') - julianday(t.transaction_date) <= 90 THEN 0.5
        ELSE 0.2
      END) as avg_recency_factor,
      (SUM(CASE WHEN t.is_purchase = 1 THEN t.shares ELSE -t.shares END) / 
       NULLIF(AVG(t.ownership_after), 0)) * 100 as ownership_change_pct,
      -- Improved scoring formula
      -- Component 1: Net Value (40 points max, normalized to millions)
      MIN(40, (SUM(CASE WHEN t.is_purchase = 1 THEN t.transaction_value ELSE -t.transaction_value END) / 1000000) * 4) +
      -- Component 2: Ownership Change (30 points max)
      MIN(30, MAX(-30, ((SUM(CASE WHEN t.is_purchase = 1 THEN t.shares ELSE -t.shares END) / 
       NULLIF(AVG(t.ownership_after), 0)) * 100) * 3)) +
      -- Component 3: Seniority (20 points max)
      (AVG(CASE 
        WHEN t.insider_role LIKE '%CEO%' OR t.insider_role LIKE '%Chief Executive%' THEN 1.5
        WHEN t.insider_role LIKE '%CFO%' OR t.insider_role LIKE '%Chief Financial%' THEN 1.4
        WHEN t.insider_role LIKE '%President%' THEN 1.3
        WHEN t.insider_role LIKE '%Director%' THEN 1.2
        WHEN t.insider_role LIKE '%VP%' THEN 1.1
        ELSE 1.0
      END) - 1.0) * 40 +
      -- Component 4: Recency (10 points max)
      AVG(CASE 
        WHEN julianday('now') - julianday(t.transaction_date) <= 7 THEN 1.0
        WHEN julianday('now') - julianday(t.transaction_date) <= 30 THEN 0.8
        WHEN julianday('now') - julianday(t.transaction_date) <= 90 THEN 0.5
        ELSE 0.2
      END) * 10 +
      -- Base adjustment to normalize to 0-100 scale
      50
      as score
    FROM companies c
    JOIN transactions t ON c.id = t.company_id
    WHERE t.transaction_date >= date('now', '-' || ? || ' days')
    GROUP BY c.id, c.ticker, c.name, c.cik
    HAVING transaction_count > 0
    ORDER BY score DESC, net_value DESC
    LIMIT ?
  `;
  
  const result = await db.prepare(query).bind(days, limit).all();
  
  // Round scores and format values
  const companies = (result.results || []).map(company => ({
    ...company,
    score: Math.max(0, Math.min(100, Math.round(company.score))),
    buy_value: Math.round(company.buy_value || 0),
    sell_value: Math.round(company.sell_value || 0),
    net_value: Math.round(company.net_value || 0),
    ownership_change_pct: Math.round((company.ownership_change_pct || 0) * 100) / 100,
    avg_seniority_weight: Math.round((company.avg_seniority_weight || 1.0) * 100) / 100,
    avg_recency_factor: Math.round((company.avg_recency_factor || 0) * 100) / 100
  }));
  
  return jsonResponse({
    companies,
    count: companies.length,
    scoring_info: {
      formula: 'Net Value (40%) + Ownership Change (30%) + Seniority (20%) + Recency (10%)',
      components: {
        net_value: 'Buy value - Sell value, normalized to millions',
        ownership_change: 'Percentage change in insider holdings',
        seniority: 'Weighted by insider role (CEO=1.5x, CFO=1.4x, etc.)',
        recency: 'Recent trades weighted higher (7d=1.0x, 30d=0.8x, 90d=0.5x)'
      }
    }
  }, 200, corsHeaders);
}

// Get company detail
async function handleCompanyDetail(ticker, db, corsHeaders) {
  const companyQuery = `
    SELECT c.*, cs.*
    FROM companies c
    LEFT JOIN company_scores cs ON c.id = cs.company_id
    WHERE c.ticker = ?
  `;
  
  const company = await db.prepare(companyQuery).bind(ticker).first();
  
  if (!company) {
    return jsonResponse({ error: 'Company not found' }, 404, corsHeaders);
  }
  
  const transactionsQuery = `
    SELECT t.*, i.name as insider_name
    FROM transactions t
    JOIN insiders i ON t.insider_id = i.id
    WHERE t.company_id = ?
    ORDER BY t.transaction_date DESC
    LIMIT 50
  `;
  
  const transactions = await db.prepare(transactionsQuery).bind(company.id).all();
  
  return jsonResponse({
    company,
    transactions: transactions.results || [],
  }, 200, corsHeaders);
}

// Get cluster buys
async function handleClusters(request, db, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const minScore = parseInt(url.searchParams.get('min_score') || '60');
  
  const query = `
    SELECT cb.*, c.ticker, c.name as company_name
    FROM cluster_buys cb
    JOIN companies c ON cb.company_id = c.id
    WHERE cb.score >= ?
    ORDER BY cb.score DESC, cb.cluster_date DESC
    LIMIT ?
  `;
  
  const result = await db.prepare(query).bind(minScore, limit).all();
  
  return jsonResponse({
    clusters: result.results || [],
  }, 200, corsHeaders);
}

// Get statistics
async function handleStats(db, corsHeaders) {
  const stats = {};
  
  // Total transactions
  const totalTx = await db.prepare('SELECT COUNT(*) as count FROM transactions').first();
  stats.total_transactions = totalTx?.count || 0;
  
  // Total companies
  const totalCo = await db.prepare('SELECT COUNT(*) as count FROM companies').first();
  stats.total_companies = totalCo?.count || 0;
  
  // Purchases vs sales (last 30 days)
  const purchases = await db.prepare(`
    SELECT COUNT(*) as count FROM transactions 
    WHERE is_purchase = 1 AND transaction_date >= date('now', '-30 days')
  `).first();
  stats.purchases_30d = purchases?.count || 0;
  
  const sales = await db.prepare(`
    SELECT COUNT(*) as count FROM transactions 
    WHERE is_purchase = 0 AND transaction_date >= date('now', '-30 days')
  `).first();
  stats.sales_30d = sales?.count || 0;
  
  // Cluster buys
  const clusters = await db.prepare('SELECT COUNT(*) as count FROM cluster_buys').first();
  stats.total_clusters = clusters?.count || 0;
  
  return jsonResponse(stats, 200, corsHeaders);
}

// Trigger data collection
async function handleCollect(db, corsHeaders) {
  try {
    const { collectInsiderData } = await import('../collectors/sec-collector.js');
    const result = await collectInsiderData(db);
    
    return jsonResponse({
      message: result.success ? 'Data collection completed' : 'Data collection failed',
      ...result
    }, result.success ? 200 : 500, corsHeaders);
  } catch (error) {
    console.error('Collection error:', error);
    return jsonResponse({
      error: 'Collection failed: ' + error.message,
      timestamp: new Date().toISOString()
    }, 500, corsHeaders);
  }
}

async function handleDebugCollect(db, corsHeaders) {
  try {
    const { collectInsiderDataDebug } = await import('../collectors/sec-collector-debug-detailed.js');
    const result = await collectInsiderDataDebug(db);
    
    // Return debug log as HTML for easy reading
    const htmlLog = `
<!DOCTYPE html>
<html>
<head>
  <title>Debug Log</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1a1a1a; color: #00ff00; }
    pre { white-space: pre-wrap; line-height: 1.5; }
    .error { color: #ff4444; }
    .success { color: #44ff44; }
  </style>
</head>
<body>
  <h1>SEC Collector Debug Log</h1>
  <pre>${result.debugLog ? result.debugLog.join('\n') : 'No debug log available'}</pre>
  <hr>
  <h2>Result:</h2>
  <pre>${JSON.stringify(result, null, 2)}</pre>
</body>
</html>
    `;
    
    return new Response(htmlLog, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error('Debug collection error:', error);
    return jsonResponse({
      error: 'Debug collection failed: ' + error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    }, 500, corsHeaders);
  }
}
