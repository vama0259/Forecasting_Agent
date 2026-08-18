// Domain types for the 4-round multi-agent debate event stream and database models

export type ParticipantAgentId = 'price' | 'fii' | 'dii' | 'retail';
export type DebateAgentId = ParticipantAgentId | 'consensus';

export type DebateRoundName = 'independent' | 'critique' | 'devils-advocate' | 'consensus';
export type DebateRoundIndex = 1 | 2 | 3 | 4;

export interface EvidenceItem {
  claim: string;
  source: string;
  value?: unknown;
  url?: string;
  explicitAbsence?: boolean;
}

export interface PeerCritiqueItem {
  targetAgent: ParticipantAgentId;
  agreementLevel: 'agrees' | 'disagrees_partially' | 'disagrees_strongly';
  critiquePoint: string;
}

export interface PythonScriptArtifact {
  fileName: string;
  agent: ParticipantAgentId;
  roundIndex: DebateRoundIndex;
  code: string;
  stdout?: string;
  stderr?: string;
  exitCode: number;
  durationMs: number;
  description: string;
}

export interface ScenarioDetail {
  primaryAdvocate: ParticipantAgentId;
  direction: 'up' | 'down';
  probability: number;
  confidence: number;
  evidenceClaims: string[];
  catastrophicRisks: string[];
  invalidationTriggers: string[];
}

export type DebateStreamEvent =
  | { type: 'session-init'; runId: string; symbol: string; asOf: string }
  | { type: 'round-start'; roundIndex: DebateRoundIndex; roundName: DebateRoundName }
  | { type: 'agent-turn-start'; agent: ParticipantAgentId; roundIndex: DebateRoundIndex }
  | { type: 'reasoning-token'; agent: ParticipantAgentId; token: string }
  | {
      type: 'sandbox-execution';
      agent: ParticipantAgentId;
      script: PythonScriptArtifact;
    }
  | {
      type: 'agent-signal';
      agent: ParticipantAgentId;
      roundIndex: DebateRoundIndex;
      direction: 'up' | 'down';
      probability: number;
      confidence: number;
      degraded: boolean;
      evidence: EvidenceItem[];
      dissent?: string;
    }
  | {
      type: 'peer-critiques';
      agent: ParticipantAgentId;
      critiques: PeerCritiqueItem[];
      probabilityDelta: number;
    }
  | {
      type: 'devils-advocate-selected';
      agent: ParticipantAgentId;
      reason: string;
      catastrophicRisks: string[];
      invalidationTriggers: string[];
    }
  | {
      type: 'consensus-resolved';
      direction: 'up' | 'down';
      probability: number;
      confidence: number;
      dispersion: number;
      deadlockStatus: 'RESOLVED' | 'DEADLOCK';
      healthFactor: number;
      scenarios?: {
        majorityScenario: ScenarioDetail;
        contrarianScenario?: ScenarioDetail;
      };
    }
  | { type: 'round-complete'; roundIndex: DebateRoundIndex }
  | { type: 'error'; message: string; detail?: string };

export interface PersistedDebateRoundRecord {
  id?: string;
  forecastId: string;
  roundNumber: DebateRoundIndex;
  agentName: DebateAgentId;
  direction: 'up' | 'down';
  probability: number;
  confidence: number;
  degraded: boolean;
  dissent?: string;
  evidence: EvidenceItem[];
  metadata: {
    symbol: string;
    asOf: string;
    critiques?: PeerCritiqueItem[];
    probabilityDelta?: number;
    catastrophicRisks?: string[];
    invalidationTriggers?: string[];
    isDevilsAdvocate?: boolean;
    dispersion?: number;
    healthFactor?: number;
    deadlockStatus?: string;
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface FullDebateSummary {
  forecastId: string;
  symbol: string;
  asOf: string;
  consensusDirection: 'up' | 'down';
  consensusProbability: number;
  consensusConfidence: number;
  dispersion: number;
  deadlockStatus: 'RESOLVED' | 'DEADLOCK';
  healthFactor: number;
  createdAt: string;
  rounds: {
    round1: Record<ParticipantAgentId, PersistedDebateRoundRecord>;
    round2: Record<ParticipantAgentId, PersistedDebateRoundRecord>;
    round3: Record<ParticipantAgentId, PersistedDebateRoundRecord>;
    round4: PersistedDebateRoundRecord;
  };
  scripts?: PythonScriptArtifact[];
}
