// Sandbox output component rendering code execution stdout in Terminal or stderr in StackTrace
"use client";

import React from "react";
import { Terminal, AnimatedSpan } from "@/components/ui/terminal";
import {
  StackTrace,
  StackTraceHeader,
  StackTraceError,
  StackTraceErrorMessage,
  StackTraceContent,
  StackTraceFrames,
} from "@/components/ai-elements/stack-trace";
import { Tool, ToolHeader, ToolContent, ToolOutput } from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";

// Props accepted by the SandboxOutput component
export interface SandboxOutputProps {
  tool: string;
  status: "success" | "error";
  output: unknown;
  stdout?: string;
  stderr?: string;
  className?: string;
}

// Renders sandboxed tool execution results branching strictly between Terminal stdout and StackTrace stderr
export function SandboxOutput({
  tool,
  status,
  output,
  stdout,
  stderr,
  className,
}: SandboxOutputProps) {
  if (status === "error") {
    const errorTrace = stderr || (typeof output === "string" ? output : "Error executing tool");
    return (
      <div data-testid="stack-trace" className={cn("w-full my-2", className)}>
        <StackTrace trace={errorTrace} defaultOpen={true}>
          <StackTraceHeader>
            <StackTraceError>
              <StackTraceErrorMessage>{`Tool error: ${tool}`}</StackTraceErrorMessage>
            </StackTraceError>
          </StackTraceHeader>
          <StackTraceContent>
            <StackTraceFrames />
          </StackTraceContent>
        </StackTrace>
      </div>
    );
  }

  // Success branch
  const terminalContent = stdout || (output ? JSON.stringify(output, null, 2) : "Process completed with exit code 0");

  return (
    <div className={cn("w-full my-2", className)}>
      <Tool defaultOpen={true} className="border-border bg-card/60">
        <ToolHeader
          title={`Tool Execution: ${tool}`}
          type="dynamic-tool"
          state="output-available"
          toolName={tool}
        />
        <ToolContent className="p-3">
          <div className="space-y-3">
            <Terminal sequence={false} className="max-w-none w-full bg-background border-border/80 text-xs">
              <AnimatedSpan className="text-muted-foreground whitespace-pre-wrap font-mono">
                {terminalContent}
              </AnimatedSpan>
            </Terminal>
            {Boolean(output && !stdout) && <ToolOutput output={output as any} errorText={undefined} />}
          </div>
        </ToolContent>
      </Tool>
    </div>
  );
}
