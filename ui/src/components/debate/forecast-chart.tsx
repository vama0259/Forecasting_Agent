// Time-series forecast chart rendering actual vs forecasted trajectory with confidence intervals
"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import { TrendingUpIcon } from "lucide-react";

// Input data shape for the forecast trajectory and confidence boundaries
export interface ForecastChartData {
  horizon: string;
  actual: number[];
  forecast: number[];
  confidenceBand: [number, number][];
}

// Props accepted by the ForecastChart component
export interface ForecastChartProps {
  data: ForecastChartData;
  className?: string;
}

// Renders the adjudicated time-series forecast with solid actuals, dashed projections, and accessible fallbacks
export function ForecastChart({ data, className }: ForecastChartProps) {
  const { horizon, actual, forecast, confidenceBand } = data;

  const chartData = useMemo(() => {
    const points: Array<{
      step: string;
      actual?: number;
      forecast?: number;
      bandLow?: number;
      bandHigh?: number;
      bandRange?: [number, number];
    }> = [];

    // Actual historical points
    actual.forEach((val, idx) => {
      points.push({
        step: `T-${actual.length - idx - 1}`,
        actual: val,
        forecast: idx === actual.length - 1 ? val : undefined,
      });
    });

    // Forecast projected points
    forecast.forEach((val, idx) => {
      const band = confidenceBand[idx] ?? [val, val];
      if (idx === 0) {
        // Bridge point
        const lastIdx = points.length - 1;
        if (points[lastIdx]) {
          points[lastIdx].bandLow = band[0];
          points[lastIdx].bandHigh = band[1];
          points[lastIdx].bandRange = [band[0], band[1]];
        }
      } else {
        points.push({
          step: `T+${idx}`,
          forecast: val,
          bandLow: band[0],
          bandHigh: band[1],
          bandRange: [band[0], band[1]],
        });
      }
    });

    return points;
  }, [actual, forecast, confidenceBand]);

  const lastForecast = forecast[forecast.length - 1] ?? 0;
  const lastBand = confidenceBand[confidenceBand.length - 1] ?? [lastForecast, lastForecast];
  const minBand = lastBand[0];
  const maxBand = lastBand[1];

  const accessibleSummary = `${horizon} projection: ${lastForecast}, confidence range ${minBand} to ${maxBand}`;

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUpIcon className="size-4 text-primary" />
          <h3 className="font-heading text-sm font-semibold tracking-wide text-foreground">
            Consensus Projection ({horizon})
          </h3>
        </div>

        {/* Direct visible series indicators (accessibility requirement: direct labeling, not hue alone) */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5 text-foreground">
            <span className="inline-block w-4 h-0.5 bg-foreground" />
            <span>Actual (Historical)</span>
          </div>
          <div className="flex items-center gap-1.5 text-primary">
            <span className="inline-block w-4 h-0.5 border-t-2 border-dashed border-primary" />
            <span>Forecast (Projected)</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block size-3 rounded-xs bg-primary/20 border border-primary/40" />
            <span>90% Interval Band</span>
          </div>
        </div>
      </div>

      {/* Screen-reader accessible fallback summary */}
      <p className="sr-only" role="note">
        {accessibleSummary}
      </p>

      {/* Chart visualization */}
      <div className="w-full h-64 min-h-[250px] pt-2">
        <ResponsiveContainer width="100%" height="100%" minHeight={240}>
          <ComposedChart data={chartData} margin={{ top: 10, right: 15, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E2433" vertical={false} />
            <XAxis
              dataKey="step"
              stroke="#8B93A7"
              fontSize={11}
              fontFamily="var(--font-plex-mono)"
              tickLine={false}
              axisLine={{ stroke: "#1E2433" }}
            />
            <YAxis
              stroke="#8B93A7"
              fontSize={11}
              fontFamily="var(--font-plex-mono)"
              domain={["auto", "auto"]}
              tickLine={false}
              axisLine={{ stroke: "#1E2433" }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0B0F1A",
                borderColor: "#1E2433",
                borderRadius: "8px",
                fontSize: "12px",
                fontFamily: "var(--font-plex-mono)",
                color: "#F1F3F5",
              }}
            />
            {/* Confidence Band Area */}
            <Area
              type="monotone"
              dataKey="bandRange"
              stroke="none"
              fill="var(--signal-bull)"
              fillOpacity={0.15}
              isAnimationActive={false}
            />
            {/* Historical Solid Line */}
            <Line
              type="monotone"
              dataKey="actual"
              stroke="#F1F3F5"
              strokeWidth={2}
              dot={{ r: 3, fill: "#F1F3F5" }}
              isAnimationActive={false}
            />
            {/* Forecast Dashed Line (Distinguished by strokeDasharray) */}
            <Line
              type="monotone"
              dataKey="forecast"
              stroke="var(--signal-bull)"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3, fill: "var(--signal-bull)" }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between text-xs font-mono text-muted-foreground pt-1 border-t border-border/40">
        <span>Horizon: {horizon}</span>
        <span>Target: <strong className="text-foreground">{lastForecast}</strong></span>
        <span>Range: <strong className="text-foreground">{minBand} — {maxBand}</strong></span>
      </div>
    </div>
  );
}
