import type { FullDebateSummary, PythonScriptArtifact } from './types';

export const samplePythonScripts: PythonScriptArtifact[] = [
  {
    fileName: 'retail_features.py',
    agent: 'retail',
    roundIndex: 1,
    description: 'CatBoostClassifier & Bhavcopy volume delivery distribution modeling',
    durationMs: 42633,
    exitCode: 0,
    code: `import json
import numpy as np
import pandas as pd
from catboost import CatBoostClassifier

# Dynamic JSON data ingestion
raw_bars = json.load(open("/workspace/bars.json"))["bars"]
raw_micro = json.load(open("/workspace/microstructure.json"))
df = pd.DataFrame(raw_bars)

# Feature engineering
df["vol_ratio_5d"] = df["volume"] / df["volume"].rolling(5).mean()
df["body_pos"] = (df["close"] - df["low"]) / (df["high"] - df["low"])
df["next_up"] = (df["close"].shift(-1) > df["close"]).astype(int)

# Train CatBoostClassifier
clf = CatBoostClassifier(iterations=50, depth=4, learning_rate=0.1, verbose=0)
X = df[["vol_ratio_5d", "body_pos"]].dropna()
y = df["next_up"].iloc[X.index]
clf.fit(X.iloc[:-1], y.iloc[:-1])

p_up = clf.predict_proba(X.iloc[[-1]])[0][1]
print(f"CatBoost P(up) on latest bar: {p_up:.3f}")
print(f"Delivery volume distribution on 8/18: 1.62M shares (down from 2.67M)")`,
    stdout: `CatBoost P(up) on latest bar: 0.352\nDelivery volume distribution on 8/18: 1.62M shares (down from 2.67M)\nExited with status 0`,
  },
  {
    fileName: 'audit4_kalman.py',
    agent: 'price',
    roundIndex: 2,
    description: 'KalmanFilter recursive Bayesian trend velocity denoising',
    durationMs: 2450,
    exitCode: 0,
    code: `import json
import numpy as np
import pandas as pd
from scipy.signal import savgol_filter

bars = json.load(open("/workspace/bars.json"))["bars"]
closes = np.array([b["close"] for b in bars])

# Denoised trend extraction
smooth_trend = savgol_filter(closes, window_length=5, polyorder=2)
velocity = np.diff(smooth_trend)

print(f"Latest Denoised Price: ₹{smooth_trend[-1]:.2f}")
print(f"Latent Trend Velocity (dx/dt): {velocity[-1]:.4f}")
print(f"MA5 Distance: {(closes[-1] / np.mean(closes[-5:]) - 1) * 100:.2f}%")`,
    stdout: `Latest Denoised Price: ₹554.20\nLatent Trend Velocity (dx/dt): -0.0182 (Negative Trend)\nMA5 Distance: -1.52%\nExited with status 0`,
  },
  {
    fileName: 'devils_advocate_r3.py',
    agent: 'fii',
    roundIndex: 3,
    description: "Devil's Advocate short-covering gap & extreme oversold risk audit",
    durationMs: 2555,
    exitCode: 0,
    code: `import json
import numpy as np
import pandas as pd
from arch import arch_model

bars = json.load(open("/workspace/bars.json"))["bars"]
df = pd.DataFrame(bars)
df["ret"] = df["close"].pct_change()

# Fit GARCH(1,1) for conditional volatility bounds
am = arch_model(df["ret"].dropna() * 100, vol="Garch", p=1, q=1)
res = am.fit(disp="off")
vol_forecast = res.forecast(horizon=1).variance.iloc[-1, 0] ** 0.5

print(f"GARCH 1-Day Volatility Estimate: {vol_forecast:.2f}%")
print("RSI(14) Wilder: 11.1 (Severe Oversold Tail)")
print("Short-Covering Gap Invalidation Line: ₹561.15")`,
    stdout: `GARCH 1-Day Volatility Estimate: 1.84%\nRSI(14) Wilder: 11.1 (Severe Oversold Tail)\nShort-Covering Gap Invalidation Line: ₹561.15\nExited with status 0`,
  },
  {
    fileName: 'model.py',
    agent: 'price',
    roundIndex: 1,
    description: 'Purged Walk-Forward M8 Backtest Model Script',
    durationMs: 180,
    exitCode: 0,
    code: `import json

# Output eval_request for M8 purged evaluation
eval_data = {
    "returns": [-0.0033, -0.0235, -0.011, -0.0043],
    "forecasts": [-0.005, -0.015, -0.008, -0.006],
    "calls": [0.35, 0.28, 0.40, 0.38],
    "timestamps": ["2026-08-14T00:00:00+05:30", "2026-08-17T00:00:00+05:30", "2026-08-18T00:00:00+05:30"],
    "as_of": "2026-08-18T00:00:00+05:30",
    "segment": "EQUITY_DELIVERY",
    "position_notional": 10000.0,
    "trade_side": ["hold", "hold", "hold"],
    "capital": 100000.0
}
with open("/tmp/eval_request.json", "w") as f:
    json.dump(eval_data, f)`,
    stdout: `Wrote /tmp/eval_request.json\nExited with status 0`,
  },
];

export const mockDebateSummary: FullDebateSummary = {
  forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  symbol: 'SBIFUNDS.NS',
  asOf: '2026-08-18',
  consensusDirection: 'down',
  consensusProbability: 0.6,
  consensusConfidence: 0.236,
  dispersion: 0.0354,
  deadlockStatus: 'RESOLVED',
  healthFactor: 0.5,
  createdAt: '2026-08-18T23:12:10.570Z',
  scripts: samplePythonScripts,
  rounds: {
    round1: {
      price: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 1,
        agentName: 'price',
        direction: 'down',
        probability: 0.58,
        confidence: 0.4,
        degraded: false,
        evidence: [
          { claim: 'Breakdown below 5-day moving average (563.42)', source: 'market_data', value: 563.42 },
          { claim: 'Denoised Kalman trend velocity dx/dt < 0', source: 'market_data', value: -0.0182 },
        ],
        metadata: { symbol: 'SBIFUNDS.NS', asOf: '2026-08-18' },
        createdAt: '2026-08-18T23:05:00.000Z',
      },
      fii: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 1,
        agentName: 'fii',
        direction: 'down',
        probability: 0.62,
        confidence: 0.4,
        degraded: false,
        evidence: [
          { claim: 'Empty derivative flow records indicating zero institutional buy floor', source: 'flows', explicitAbsence: true },
        ],
        metadata: { symbol: 'SBIFUNDS.NS', asOf: '2026-08-18' },
        createdAt: '2026-08-18T23:05:00.000Z',
      },
      dii: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 1,
        agentName: 'dii',
        direction: 'down',
        probability: 0.55,
        confidence: 0.35,
        degraded: false,
        evidence: [
          { claim: 'Domestic mutual fund liquidity absorption failure on fresh lows', source: 'flows', value: 0 },
        ],
        metadata: { symbol: 'SBIFUNDS.NS', asOf: '2026-08-18' },
        createdAt: '2026-08-18T23:05:00.000Z',
      },
      retail: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 1,
        agentName: 'retail',
        direction: 'down',
        probability: 0.74,
        confidence: 0.45,
        degraded: false,
        evidence: [
          { claim: 'Delivery volume distribution ratio expanding on down candles', source: 'microstructure', value: 1.59 },
        ],
        metadata: { symbol: 'SBIFUNDS.NS', asOf: '2026-08-18' },
        createdAt: '2026-08-18T23:05:00.000Z',
      },
    },
    round2: {
      price: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 2,
        agentName: 'price',
        direction: 'down',
        probability: 0.6,
        confidence: 0.45,
        degraded: false,
        metadata: {
          symbol: 'SBIFUNDS.NS',
          asOf: '2026-08-18',
          probabilityDelta: 0.02,
          critiques: [
            { targetAgent: 'retail', agreementLevel: 'agrees', critiquePoint: 'Confirms volume expansion into support lows.' },
          ],
        },
        evidence: [{ claim: 'Kalman filter confirms sustained negative price momentum', source: 'market_data' }],
        createdAt: '2026-08-18T23:08:00.000Z',
      },
      fii: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 2,
        agentName: 'fii',
        direction: 'down',
        probability: 0.6,
        confidence: 0.4,
        degraded: true,
        metadata: { symbol: 'SBIFUNDS.NS', asOf: '2026-08-18', probabilityDelta: -0.02 },
        evidence: [{ claim: 'Macro absence of institutional hedging tape', source: 'flows', explicitAbsence: true }],
        createdAt: '2026-08-18T23:08:00.000Z',
      },
      dii: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 2,
        agentName: 'dii',
        direction: 'down',
        probability: 0.58,
        confidence: 0.4,
        degraded: true,
        metadata: { symbol: 'SBIFUNDS.NS', asOf: '2026-08-18', probabilityDelta: 0.03 },
        evidence: [{ claim: 'No domestic bid support detected', source: 'flows' }],
        createdAt: '2026-08-18T23:08:00.000Z',
      },
      retail: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 2,
        agentName: 'retail',
        direction: 'down',
        probability: 0.65,
        confidence: 0.5,
        degraded: true,
        metadata: {
          symbol: 'SBIFUNDS.NS',
          asOf: '2026-08-18',
          probabilityDelta: -0.09,
          critiques: [
            { targetAgent: 'price', agreementLevel: 'disagrees_partially', critiquePoint: 'Oversold hammer wick introduces bounce tail risk.' },
          ],
        },
        evidence: [{ claim: 'Wilder RSI14=11.1 warrants probability calibration from 0.74 to 0.65', source: 'microstructure' }],
        createdAt: '2026-08-18T23:08:00.000Z',
      },
    },
    round3: {
      price: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 3,
        agentName: 'price',
        direction: 'down',
        probability: 0.6,
        confidence: 0.45,
        degraded: false,
        metadata: {
          symbol: 'SBIFUNDS.NS',
          asOf: '2026-08-18',
          invalidationTriggers: ['Close above ₹561.15', 'Reclaim of 5d MA ₹563.42 on heavy volume'],
          catastrophicRisks: ['Gap-up open on unexpected sector AUM inflow announcement'],
        },
        evidence: [{ claim: 'Intraday highs held below prior day ceiling', source: 'market_data' }],
        createdAt: '2026-08-18T23:11:00.000Z',
      },
      fii: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 3,
        agentName: 'fii',
        direction: 'down',
        probability: 0.58,
        confidence: 0.4,
        degraded: true,
        metadata: {
          symbol: 'SBIFUNDS.NS',
          asOf: '2026-08-18',
          isDevilsAdvocate: true,
          invalidationTriggers: ['Any positive buy-side institutional print on 8/18 tape'],
          catastrophicRisks: ['Late block/bulk deal print causing sudden 2-3% jump'],
        },
        evidence: [{ claim: "Devil's advocate audit confirms missing institutional floor but notes short-squeeze tail", source: 'flows' }],
        createdAt: '2026-08-18T23:11:00.000Z',
      },
      dii: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 3,
        agentName: 'dii',
        direction: 'down',
        probability: 0.58,
        confidence: 0.4,
        degraded: true,
        metadata: { symbol: 'SBIFUNDS.NS', asOf: '2026-08-18' },
        evidence: [{ claim: 'Absence of domestic accumulation confirmed', source: 'flows' }],
        createdAt: '2026-08-18T23:11:00.000Z',
      },
      retail: {
        forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        roundNumber: 3,
        agentName: 'retail',
        direction: 'down',
        probability: 0.65,
        confidence: 0.5,
        degraded: true,
        metadata: {
          symbol: 'SBIFUNDS.NS',
          asOf: '2026-08-18',
          invalidationTriggers: ['Strong gap-up open (>1.5%) holding above 559.05'],
          catastrophicRisks: ['Severe short-covering after 8 consecutive distribution days'],
        },
        evidence: [{ claim: 'Distribution intact; hammer defense targeted at 551-553', source: 'microstructure' }],
        createdAt: '2026-08-18T23:11:00.000Z',
      },
    },
    round4: {
      forecastId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      roundNumber: 4,
      agentName: 'consensus',
      direction: 'down',
      probability: 0.6,
      confidence: 0.236,
      degraded: false,
      evidence: [],
      metadata: {
        symbol: 'SBIFUNDS.NS',
        asOf: '2026-08-18',
        dispersion: 0.0354,
        healthFactor: 0.5,
        deadlockStatus: 'RESOLVED',
      },
      createdAt: '2026-08-18T23:12:10.570Z',
    },
  },
};
