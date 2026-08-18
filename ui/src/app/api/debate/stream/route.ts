import { NextRequest } from 'next/server';
import { samplePythonScripts } from '@/lib/debate/fixtures';
import type { DebateStreamEvent, ParticipantAgentId } from '@/lib/debate/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'SBIFUNDS.NS';
  const asOf = searchParams.get('asOf') || new Date().toISOString().slice(0, 10);
  const runId = `stream-${symbol}-${Date.now()}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: DebateStreamEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      try {
        // 1. Session Init
        send({ type: 'session-init', runId, symbol, asOf });
        await delay(400);

        // 2. Round 1: Independent Execution
        send({ type: 'round-start', roundIndex: 1, roundName: 'independent' });
        await delay(300);

        const agents: ParticipantAgentId[] = ['price', 'fii', 'dii', 'retail'];
        for (const agent of agents) {
          send({ type: 'agent-turn-start', agent, roundIndex: 1 });
          send({
            type: 'reasoning-token',
            agent,
            token: `Ingesting latest OHLCV market data and training quantitative ML features for ${symbol}...`,
          });
          await delay(250);

          // Find associated script
          const script = samplePythonScripts.find((s) => s.agent === agent && s.roundIndex === 1) || {
            fileName: `${agent}_features.py`,
            agent,
            roundIndex: 1,
            description: `${agent.toUpperCase()} quantitative feature calculation in Docker`,
            durationMs: 1250,
            exitCode: 0,
            code: `# Feature calculation for ${symbol}\nimport json, numpy as np, pandas as pd\nbars = json.load(open('/workspace/bars.json'))['bars']\nprint(f"${agent.toUpperCase()} features extracted successfully")`,
            stdout: `${agent.toUpperCase()} features extracted successfully\nExited with status 0`,
          };

          send({ type: 'sandbox-execution', agent, script });
          await delay(200);

          const probMap: Record<ParticipantAgentId, number> = { price: 0.58, fii: 0.62, dii: 0.55, retail: 0.74 };
          send({
            type: 'agent-signal',
            agent,
            roundIndex: 1,
            direction: 'down',
            probability: probMap[agent] ?? 0.6,
            confidence: 0.45,
            degraded: false,
            evidence: [
              { claim: `${agent.toUpperCase()} signal confirms downward momentum into support`, source: 'market_data' },
            ],
          });
          await delay(200);
        }
        send({ type: 'round-complete', roundIndex: 1 });
        await delay(400);

        // 3. Round 2: Peer Cross-Examinations
        send({ type: 'round-start', roundIndex: 2, roundName: 'critique' });
        await delay(300);

        for (const agent of agents) {
          send({ type: 'agent-turn-start', agent, roundIndex: 2 });
          send({
            type: 'reasoning-token',
            agent,
            token: `Auditing peer claims against domain data... Executing crosscheck.py in Docker...`,
          });
          await delay(200);

          const script = samplePythonScripts.find((s) => s.fileName === 'audit4_kalman.py')!;
          if (agent === 'price') {
            send({ type: 'sandbox-execution', agent, script });
          }

          send({
            type: 'peer-critiques',
            agent,
            critiques: [
              {
                targetAgent: agent === 'price' ? 'retail' : 'price',
                agreementLevel: 'agrees',
                critiquePoint: 'Confirmed volume distribution matches price breakdown.',
              },
            ],
            probabilityDelta: -0.04,
          });
          await delay(200);
        }
        send({ type: 'round-complete', roundIndex: 2 });
        await delay(400);

        // 4. Round 3: Devil's Advocate
        send({ type: 'round-start', roundIndex: 3, roundName: 'devils-advocate' });
        await delay(300);

        send({
          type: 'devils-advocate-selected',
          agent: 'fii',
          reason: 'Furthest stance from group consensus (|P - P_majority| = 0.12)',
          catastrophicRisks: [
            'Severe short-covering gap if 561.15 is reclaimed on volume',
            'Absence of institutional tape creates blind spot',
          ],
          invalidationTriggers: [
            'Close above ₹561.15 on heavy volume',
            'Reclaim of 5-day moving average ₹563.42',
          ],
        });

        const daScript = samplePythonScripts.find((s) => s.fileName === 'devils_advocate_r3.py')!;
        send({ type: 'sandbox-execution', agent: 'fii', script: daScript });
        await delay(300);

        send({ type: 'round-complete', roundIndex: 3 });
        await delay(400);

        // 5. Round 4: Deterministic Arithmetic Consensus
        send({ type: 'round-start', roundIndex: 4, roundName: 'consensus' });
        await delay(300);

        send({
          type: 'consensus-resolved',
          direction: 'down',
          probability: 0.6,
          confidence: 0.236,
          dispersion: 0.0354,
          deadlockStatus: 'RESOLVED',
          healthFactor: 0.5,
          scenarios: {
            majorityScenario: {
              primaryAdvocate: 'retail',
              direction: 'down',
              probability: 0.65,
              confidence: 0.5,
              evidenceClaims: ['Delivery distribution expanding on down days', 'Kalman velocity < 0'],
              catastrophicRisks: ['Short-covering squeeze if ₹561.15 reclaimed'],
              invalidationTriggers: ['Close above ₹561.15'],
            },
          },
        });
        send({ type: 'round-complete', roundIndex: 4 });
      } catch (err: any) {
        send({ type: 'error', message: err?.message || 'Stream failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
