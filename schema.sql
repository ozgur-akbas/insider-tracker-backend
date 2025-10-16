-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  cik TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_companies_ticker ON companies(ticker);
CREATE INDEX idx_companies_cik ON companies(cik);

-- Insiders table
CREATE TABLE IF NOT EXISTS insiders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  cik TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_insiders_cik ON insiders(cik);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  insider_id INTEGER NOT NULL,
  transaction_date TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  shares REAL NOT NULL,
  price_per_share REAL NOT NULL,
  transaction_value REAL NOT NULL,
  is_purchase INTEGER NOT NULL,
  insider_role TEXT,
  ownership_after REAL,
  filing_date TEXT NOT NULL,
  form4_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (insider_id) REFERENCES insiders(id)
);

CREATE INDEX idx_transactions_company ON transactions(company_id);
CREATE INDEX idx_transactions_insider ON transactions(insider_id);
CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_type ON transactions(is_purchase);

-- Company scores table
CREATE TABLE IF NOT EXISTS company_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER UNIQUE NOT NULL,
  score INTEGER NOT NULL DEFAULT 50,
  signal TEXT NOT NULL DEFAULT 'NEUTRAL',
  num_buyers_30d INTEGER DEFAULT 0,
  num_sellers_30d INTEGER DEFAULT 0,
  total_buy_value_30d REAL DEFAULT 0,
  total_sell_value_30d REAL DEFAULT 0,
  num_transactions_30d INTEGER DEFAULT 0,
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX idx_scores_company ON company_scores(company_id);
CREATE INDEX idx_scores_score ON company_scores(score DESC);

-- Cluster buys table
CREATE TABLE IF NOT EXISTS cluster_buys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  cluster_date TEXT NOT NULL,
  num_insiders INTEGER NOT NULL,
  num_transactions INTEGER NOT NULL,
  total_value REAL NOT NULL,
  total_shares REAL NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX idx_clusters_company ON cluster_buys(company_id);
CREATE INDEX idx_clusters_date ON cluster_buys(cluster_date DESC);
CREATE INDEX idx_clusters_score ON cluster_buys(score DESC);

