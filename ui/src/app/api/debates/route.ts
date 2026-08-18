import { NextResponse } from 'next/server';
import { getDbPool } from '@/lib/db';
import { mockDebateSummary, samplePythonScripts } from '@/lib/debate/fixtures';
import type { FullDebateSummary, PersistedDebateRoundRecord, ParticipantAgentId } from '@/lib/debate/types';

export const dynamic = 'force-dynamic';

interface DbRow {
  forecast_id: string;
  round_number: number;
  agent_name: string;
  direction: string;
  probability: string | number;
  confidence: string | number;
  degraded: boolean;
  dissent: string | null;
  evidence: unknown;
  metadata: unknown;
  created_at: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolFilter = searchParams.get('symbol');
  const limit = parseInt(searchParams.get('limit') || '10', 10);

  try {
    const pool = getDbPool();
    const query = `
      SELECT forecast_id, round_number, agent_name, direction, probability, confidence, degraded, dissent, evidence, metadata, created_at
      FROM debate_rounds
      ORDER BY created_at DESC
      LIMIT 200;
    `;
    const result = await pool.query<DbRow>(query);

    if (result.rows.length === 0) {
      return NextResponse.json({ debates: [mockDebateSummary] });
    }

    // Group rows by forecast_id
    const debatesMap = new Map<string, FullDebateSummary>();

    for (const row of result.rows) {
      const forecastId = row.forecast_id;
      const metadata = (typeof row.metadata === 'object' && row.metadata !== null ? row.metadata : {}) as Record<string, unknown>;
      const symbol = (metadata.symbol as string) || symbolFilter || 'SBIFUNDS.NS';

      if (symbolFilter && symbol.toUpperCase() !== symbolFilter.toUpperCase()) {
        continue;
      }

      if (!debatesMap.has(forecastId)) {
        debatesMap.set(forecastId, {
          forecastId,
          symbol,
          asOf: (metadata.asOf as string) || row.created_at.slice(0, 10),
          consensusDirection: 'down',
          consensusProbability: 0.5,
          consensusConfidence: 0.5,
          dispersion: 0.0,
          deadlockStatus: 'RESOLVED',
          healthFactor: 1.0,
          createdAt: row.created_at,
          scripts: samplePythonScripts,
          rounds: {
            round1: {} as Record<ParticipantAgentId, PersistedDebateRoundRecord>,
            round2: {} as Record<ParticipantAgentId, PersistedDebateRoundRecord>,
            round3: {} as Record<ParticipantAgentId, PersistedDebateRoundRecord>,
            round4: {} as PersistedDebateRoundRecord,
          },
        });
      }

      const summary = debatesMap.get(forecastId)!;
      const record: PersistedDebateRoundRecord = {
        forecastId,
        roundNumber: row.round_number as 1 | 2 | 3 | 4,
        agentName: row.agent_name as any,
        direction: row.direction.toLowerCase() as 'up' | 'down',
        probability: parseFloat(String(row.probability)),
        confidence: parseFloat(String(row.confidence)),
        degraded: Boolean(row.degraded),
        dissent: row.dissent ?? undefined,
        evidence: Array.isArray(row.evidence) ? (row.evidence as any) : [],
        metadata: {
          symbol,
          asOf: (metadata.asOf as string) || row.created_at.slice(0, 10),
          ...metadata,
        },
        createdAt: row.created_at,
      };

      if (row.round_number === 1 && row.agent_name !== 'consensus') {
        summary.rounds.round1[row.agent_name as ParticipantAgentId] = record;
      } else if (row.round_number === 2 && row.agent_name !== 'consensus') {
        summary.rounds.round2[row.agent_name as ParticipantAgentId] = record;
      } else if (row.round_number === 3 && row.agent_name !== 'consensus') {
        summary.rounds.round3[row.agent_name as ParticipantAgentId] = record;
      } else if (row.round_number === 4 || row.agent_name === 'consensus') {
        summary.rounds.round4 = record;
        summary.consensusDirection = record.direction;
        summary.consensusProbability = record.probability;
        summary.consensusConfidence = record.confidence;
        summary.dispersion = Number(metadata.dispersion ?? 0);
        summary.healthFactor = Number(metadata.healthFactor ?? 1);
        summary.deadlockStatus = (metadata.deadlockStatus as 'RESOLVED' | 'DEADLOCK') ?? 'RESOLVED';
      }
    }

    const debatesList = Array.from(debatesMap.values()).slice(0, limit);
    if (debatesList.length === 0) {
      return NextResponse.json({ debates: [mockDebateSummary] });
    }

    return NextResponse.json({ debates: debatesList });
  } catch (error) {
    console.error('Error fetching debate rounds from database:', error);
    return NextResponse.json({ debates: [mockDebateSummary], note: 'Loaded fallback fixtures' });
  }
}
