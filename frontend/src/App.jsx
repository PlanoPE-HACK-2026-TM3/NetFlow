import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'

const api = axios.create({
  baseURL: 'http://127.0.0.1:8000',
})

function App() {
  const [location, setLocation] = useState('San Jose, CA')
  const [properties, setProperties] = useState([])
  const [selectedAnalysis, setSelectedAnalysis] = useState({})
  const [portfolio, setPortfolio] = useState([])
  const [mortgageRate, setMortgageRate] = useState(null)
  const [news, setNews] = useState([])
  const [chatInput, setChatInput] = useState('What is my current portfolio outlook?')
  const [chatHistory, setChatHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [chatLoading, setChatLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showPortfolioModal, setShowPortfolioModal] = useState(false)
  const chatBottomRef = useRef(null)

  const chartData = useMemo(() => {
    return Object.values(selectedAnalysis).map((item) => ({
      property: item.property_id.slice(-6),
      risk: item.risk_score,
      investment: item.investment_score,
    }))
  }, [selectedAnalysis])

  const portfolioTotalValue = useMemo(
    () => portfolio.reduce((sum, item) => sum + item.price, 0),
    [portfolio],
  )

  const showError = (msg) => {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }

  const loadPortfolio = async () => {
    try {
      const { data } = await api.get('/portfolio')
      setPortfolio(data)
    } catch {
      // silent on initial load
    }
  }

  const loadContext = async () => {
    try {
      const [rateRes, newsRes] = await Promise.all([
        api.get('/rates/mortgage'),
        api.get('/news/housing?limit=4'),
      ])
      setMortgageRate(rateRes.data)
      setNews(newsRes.data.headlines)
    } catch {
      // silent on initial load
    }
  }

  useEffect(() => {
    loadPortfolio()
    loadContext()
  }, [])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  const handleSearch = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post('/properties/search', { location, limit: 50, allow_demo: false })
      setProperties(data)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setProperties([])
      showError(detail || 'No listings found for that location. Try a supported ZIP or city.')
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async (property) => {
    setAnalyzingId(property.property_id)
    try {
      const { data } = await api.post('/analysis/property', { property })
      setSelectedAnalysis((prev) => ({ ...prev, [property.property_id]: data }))
    } catch {
      showError('Analysis failed. The model may be loading — try again shortly.')
    } finally {
      setAnalyzingId(null)
    }
  }

  const handleAddPortfolio = async (property) => {
    try {
      await api.post('/portfolio', {
        property_id: property.property_id,
        address: property.address,
        city: property.city,
        state: property.state,
        price: property.price,
        notes: property.description || '',
      })
      await loadPortfolio()
    } catch {
      showError('Could not add to portfolio.')
    }
  }

  const handleRemovePortfolio = async (id) => {
    try {
      await api.delete(`/portfolio/${id}`)
      await loadPortfolio()
    } catch {
      showError('Could not remove portfolio item.')
    }
  }

  const handleChat = async (event) => {
    event.preventDefault()
    if (!chatInput.trim()) return
    const question = chatInput
    setChatLoading(true)
    try {
      const { data } = await api.post('/chat', { message: question })
      setChatHistory((prev) => [...prev, { question, answer: data.answer }])
      setChatInput('')
    } catch {
      showError('Chat request failed. Try again.')
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <AnimatePresence>
        {error && (
          <motion.div
            className="error-banner"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <header className="topbar">
        <div>
          <p className="kicker">NETFLOW APP MVP</p>
          <h1>AI Real Estate Intelligence</h1>
          <p className="subtitle">Search opportunities, score risk, and track predictive insights.</p>
        </div>
        <button className="button-secondary" onClick={() => setShowPortfolioModal(true)}>
          Portfolio ({portfolio.length})
        </button>
      </header>

      <section className="metrics-row">
        <article className="metric-card">
          <h3>30Y Mortgage</h3>
          <p>{mortgageRate ? `${mortgageRate.value}%` : '--'}</p>
          <span>{mortgageRate?.date || 'loading...'}</span>
        </article>
        <article className="metric-card">
          <h3>Market Headlines</h3>
          <p>{news.length}</p>
          <span>live context signals</span>
        </article>
        <article className="metric-card">
          <h3>Portfolio Value</h3>
          <p>{portfolioTotalValue > 0 ? `$${(portfolioTotalValue / 1e6).toFixed(2)}M` : '$0'}</p>
          <span>{portfolio.length} tracked {portfolio.length === 1 ? 'property' : 'properties'}</span>
        </article>
      </section>

      <section className="search-panel">
        <form onSubmit={handleSearch}>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City, State or ZIP"
          />
          <button className="button-primary" type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search Properties'}
          </button>
        </form>
      </section>

      <section className="content-grid">
        <div className="properties-panel">
          <h2>Property Results</h2>
          {properties.length === 0 && !loading && (
            <p className="muted empty-hint">Search a location above to discover properties.</p>
          )}
          {properties.map((property) => {
            const analysis = selectedAnalysis[property.property_id]
            const isAnalyzing = analyzingId === property.property_id
            return (
              <motion.article
                key={property.property_id}
                className="property-card"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="property-head">
                  <h3>{property.address}</h3>
                  <p className="property-price">${Number(property.price).toLocaleString()}</p>
                </div>
                <p className="muted">{property.city}, {property.state}{property.zip ? ` ${property.zip}` : ''}</p>
                <div className="property-source-row">
                  <span className={`source-pill ${property.source === 'demo' ? 'demo' : 'real'}`}>
                    {property.source === 'demo' ? 'Demo listing' : 'Real listing'}
                  </span>
                  {property.listing_url && (
                    <a className="listing-link" href={property.listing_url} target="_blank" rel="noreferrer">
                      Open listing
                    </a>
                  )}
                </div>
                {(property.beds != null || property.sqft) && (
                  <p className="property-meta">
                    {property.beds != null && `${property.beds} bd`}
                    {property.baths != null && ` · ${property.baths} ba`}
                    {property.sqft ? ` · ${Number(property.sqft).toLocaleString()} sqft` : ''}
                  </p>
                )}
                <div className="card-actions">
                  <button onClick={() => handleAnalyze(property)} disabled={isAnalyzing}>
                    {isAnalyzing ? 'Analyzing...' : analysis ? 'Re-Analyze' : 'Analyze'}
                  </button>
                  <button onClick={() => handleAddPortfolio(property)}>+ Portfolio</button>
                </div>
                {analysis && (
                  <div className="analysis-box">
                    <div className="score-row">
                      <span className="score-badge invest">Invest {analysis.investment_score}/100</span>
                      <span className="score-badge risk">Risk {analysis.risk_score}/100</span>
                      <span className={`rec-badge rec-${analysis.recommendation}`}>
                        {analysis.recommendation.toUpperCase()}
                      </span>
                    </div>
                    <p className="analysis-metric">
                      1Y Outlook: <strong>{analysis.projected_12m_change_percent > 0 ? '+' : ''}{analysis.projected_12m_change_percent}%</strong>
                      {' '}· Confidence: {Math.round(analysis.confidence * 100)}%
                    </p>
                    <p className="analysis-rationale">{analysis.rationale}</p>
                  </div>
                )}
              </motion.article>
            )
          })}
        </div>

        <div className="side-panel">
          {/* ── Compact news strip ─────────────────────── */}
          {news.length > 0 && (
            <section className="news-strip">
              {news.slice(0, 3).map((item) => (
                <a className="news-chip" key={item.url} href={item.url} target="_blank" rel="noreferrer">
                  <span className="news-dot" />
                  <span>{item.title}</span>
                </a>
              ))}
            </section>
          )}

          {/* ── Chat panel ─────────────────────────────── */}
          <section className="chat-panel">
            <div className="chat-header">
              <div className="chat-header-left">
                <span className="chat-avatar">N</span>
                <div>
                  <p className="chat-name">NETFLOW Assistant</p>
                  <p className="chat-status">
                    <span className="status-dot" />
                    AI · context-aware
                  </p>
                </div>
              </div>
              {chartData.length > 0 && (
                <div className="chat-mini-chart">
                  <ResponsiveContainer width={90} height={36}>
                    <BarChart data={chartData} margin={{ top: 0, bottom: 0, left: 0, right: 0 }}>
                      <Bar dataKey="investment" fill="#f59e0b" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="risk" fill="#475569" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="chat-body">
              {chatHistory.length === 0 ? (
                <div className="chat-empty">
                  <div className="chat-empty-icon">💬</div>
                  <p>Ask NETFLOW anything about your portfolio, market trends, or investment risk.</p>
                  <div className="chat-suggestions">
                    {[
                      'What are the best investment markets right now?',
                      'Search for homes with positive cashflow near me',
                      'Give me NNN lease commercial properties above 6% cap rate',
                    ].map((s) => (
                      <button
                        key={s}
                        className="chat-suggestion"
                        onClick={() => setChatInput(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatHistory.map((entry, i) => (
                  <div key={i} className="chat-turn">
                    <div className="chat-bubble user">
                      <p>{entry.question}</p>
                    </div>
                    <div className="chat-bubble-wrap">
                      <span className="bubble-avatar">N</span>
                      <div className="chat-bubble ai">
                        <p>{entry.answer}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="chat-bubble-wrap">
                  <span className="bubble-avatar">N</span>
                  <div className="chat-bubble ai typing">
                    <span /><span /><span />
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            <form onSubmit={handleChat} className="chat-footer">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChat(e) }
                }}
                rows={1}
                placeholder="Type or ask questions…"
                disabled={chatLoading}
                className="chat-input"
              />
              <div className="chat-actions">
                <button
                  type="button"
                  className="mic-btn"
                  title="Voice input (coming soon)"
                  onClick={() => {}}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                    <line x1="9" y1="22" x2="15" y2="22" />
                  </svg>
                </button>
                <button className="send-btn" type="submit" disabled={chatLoading}>
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                  </svg>
                </button>
              </div>
            </form>
          </section>
        </div>
      </section>

      <AnimatePresence>
        {showPortfolioModal && (
          <motion.div
            className="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => e.target === e.currentTarget && setShowPortfolioModal(false)}
          >
            <motion.div
              className="modal"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
            >
              <div className="modal-head">
                <h2>Portfolio</h2>
                <button onClick={() => setShowPortfolioModal(false)}>✕ Close</button>
              </div>
              <div className="portfolio-summary">
                <span>{portfolio.length} {portfolio.length === 1 ? 'property' : 'properties'} tracked</span>
                <span className="portfolio-total">Total: ${portfolioTotalValue.toLocaleString()}</span>
              </div>
              {portfolio.length === 0 && (
                <p className="muted" style={{ padding: '1.2rem 0' }}>
                  No properties tracked yet. Add from search results.
                </p>
              )}
              {portfolio.map((item) => (
                <div key={item.id} className="portfolio-row">
                  <div>
                    <strong>{item.address}</strong>
                    <p className="muted" style={{ margin: '0.1rem 0' }}>{item.city}, {item.state}</p>
                    <p className="portfolio-price">${Number(item.price).toLocaleString()}</p>
                  </div>
                  <button className="remove-btn" onClick={() => handleRemovePortfolio(item.id)}>Remove</button>
                </div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
