// Realistic 4-round multi-agent debate sequence fixture for UI replay and testing

import type { DebateEvent } from './types';

// Complete mock debate fixture covering independent analysis, debate, devil's advocate, and consensus
export const fullDebateFixture: DebateEvent[] = [
  // ==========================================
  // Round 1: Independent Analysis
  // ==========================================
  { type: 'round-start', round: 'independent', roundIndex: 1 },

  // Technical Agent Turn
  { type: 'agent-turn-start', agent: 'technical', round: 'independent' },
  { type: 'reasoning-token', agent: 'technical', token: 'Evaluating multi-timeframe momentum and daily moving average structure for NIFTY 50. ' },
  { type: 'reasoning-token', agent: 'technical', token: 'Price has reclaimed the 20-day EMA with a positive MACD histogram divergence on the 4H chart. ' },
  {
    type: 'tool-call',
    agent: 'technical',
    tool: 'run_backtest',
    input: { symbol: 'NIFTY50', strategy: 'ema_crossover', lookback_days: 90 },
  },
  {
    type: 'tool-result',
    agent: 'technical',
    tool: 'run_backtest',
    status: 'success',
    output: { sharpe: 1.42, win_rate: 0.64, max_drawdown_pct: -3.8 },
    stdout: '[Backtest Engine] Completed 90-day simulation. Sharpe: 1.42 | Win Rate: 64% | Max DD: -3.8%',
  },
  {
    type: 'evidence',
    agent: 'technical',
    source: 'NSE Technical Data Feed',
    snippet: 'NIFTY closed at 24,850 with 14-day RSI rising from 44 to 58.2, confirming short-term accumulation.',
  },

  // Sentiment Agent Turn
  { type: 'agent-turn-start', agent: 'sentiment', round: 'independent' },
  { type: 'reasoning-token', agent: 'sentiment', token: 'Analyzing social and institutional news sentiment over the last 48 hours. ' },
  { type: 'reasoning-token', agent: 'sentiment', token: 'Foreign Institutional Investor (FII) net index options positioning flipped net-long (+22k contracts). ' },
  {
    type: 'tool-call',
    agent: 'sentiment',
    tool: 'search_news_sentiment',
    input: { query: 'India equities earnings and institutional flows', limit: 5 },
  },
  {
    type: 'tool-result',
    agent: 'sentiment',
    tool: 'search_news_sentiment',
    status: 'success',
    output: { score: 0.72, articles_analyzed: 45 },
    stdout: '[News Sentiment API] 45 articles parsed. Bullish ratio: 72% | Volatility index (India VIX) easing to 12.8',
  },
  {
    type: 'evidence',
    agent: 'sentiment',
    source: 'Reuters Markets India',
    url: 'https://reuters.com/markets/india-equities',
    snippet: 'Q3 corporate earnings in banking and auto sectors outpaced consensus estimates by 4.2%.',
  },

  // Macro Agent Turn
  { type: 'agent-turn-start', agent: 'macro', round: 'independent' },
  { type: 'reasoning-token', agent: 'macro', token: 'Reviewing macroeconomic liquidity, yield curves, and RBI policy stance. ' },
  { type: 'reasoning-token', agent: 'macro', token: 'Domestic CPI inflation printed at 4.1%, giving the MPC room to maintain accommodative stance. ' },
  {
    type: 'evidence',
    agent: 'macro',
    source: 'RBI Monthly Bulletin',
    url: 'https://rbi.org.in/bulletin',
    snippet: 'Systemic liquidity surplus stood at ₹1.4 lakh crore with 10-year G-Sec yield stabilizing near 6.82%.',
  },

  // ==========================================
  // Round 2: Interactive Debate
  // ==========================================
  { type: 'round-start', round: 'debate', roundIndex: 2 },

  { type: 'agent-turn-start', agent: 'technical', round: 'debate' },
  { type: 'reasoning-token', agent: 'technical', token: 'I agree with Sentiment regarding positive FII flows, but overhead resistance at 25,100 presents substantial supply. ' },
  { type: 'reasoning-token', agent: 'technical', token: 'Without heavy volume expansion on breakout, momentum may stall before the 25,200 level. ' },

  { type: 'agent-turn-start', agent: 'sentiment', round: 'debate' },
  { type: 'reasoning-token', agent: 'sentiment', token: 'Technical resistance is acknowledged, but call open-interest unwind at 25,000 indicates dealers will be forced to delta-hedge higher. ' },

  { type: 'agent-turn-start', agent: 'macro', round: 'debate' },
  { type: 'reasoning-token', agent: 'macro', token: 'Crude oil prices softened 3.5% this week, providing a strong structural tailwind for Indian trade balance and corporate margins. ' },

  // ==========================================
  // Round 3: Devil's Advocate
  // ==========================================
  { type: 'round-start', round: 'devils-advocate', roundIndex: 3 },
  {
    type: 'devils-advocate-assigned',
    agent: 'macro',
    targetClaim: 'Unconditional bullish breakout above 25,000 fueled by FII flows and rate stability',
  },
  { type: 'agent-turn-start', agent: 'macro', round: 'devils-advocate' },
  { type: 'reasoning-token', agent: 'macro', token: 'Stress-testing the bullish thesis: US Treasury yields have ticked up 15 bps overnight. ' },
  { type: 'reasoning-token', agent: 'macro', token: 'If DXY breaks above 104.5, emerging market capital outflows could abruptly reverse recent institutional inflows despite solid domestic fundamentals. ' },
  {
    type: 'evidence',
    agent: 'macro',
    source: 'Federal Reserve Monetary Data',
    snippet: 'US 10Y yields rose to 4.38% following stronger-than-expected US retail sales figures.',
  },

  // ==========================================
  // Round 4: Consensus & Forecast
  // ==========================================
  { type: 'round-start', round: 'consensus', roundIndex: 4 },
  {
    type: 'consensus',
    scenarios: [
      {
        label: 'bull',
        probability: 0.68,
        summary: 'Targeted upward expansion towards 25,250 driven by domestic liquidity and strong corporate earnings.',
      },
      {
        label: 'bear',
        probability: 0.32,
        summary: 'Pullback toward 24,600 support triggered by global FX volatility and US yield escalation.',
      },
    ],
  },
  {
    type: 'forecast',
    horizon: '5d',
    actual: [24650, 24720, 24690, 24810, 24850],
    forecast: [24890, 24950, 25040, 25120, 25210],
    confidenceBand: [
      [24750, 25030],
      [24780, 25120],
      [24820, 25260],
      [24870, 25370],
      [24910, 25510],
    ],
  },
];
