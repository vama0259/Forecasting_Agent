"""Run DSPy MIPROv2 Prompt Compilation across multi-regime Indian market exemplars (ADR-028)."""

import os
from pathlib import Path

from dotenv import load_dotenv

from forecasting_agent.prompt_compiler import PromptCompiler


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    load_dotenv(repo_root / ".env")

    api_key = os.getenv("LLM_API_KEY")
    compiler = PromptCompiler(
        model_name="deepseek/deepseek-chat",
        api_key=api_key,
        api_base="https://api.deepseek.com/v1",
    )
    compiler.configure_lm()

    print("=== DSPY MIPROv2 PROMPT COMPILATION ===")
    print("1. Compiling Price Anchor Agent Prompt...")
    price_prog = compiler.compile_price_agent(max_bootstrapped_demos=2, max_labeled_demos=2)
    price_out = repo_root / "harness" / "prompts" / "compiled" / "price_demos.j2"
    compiler.export_compiled_exemplars(price_prog, price_out)
    print(f"   -> Exported to {price_out}")

    print("2. Compiling FII Intent Agent Prompt...")
    fii_prog = compiler.compile_fii_agent(max_bootstrapped_demos=2, max_labeled_demos=2)
    fii_out = repo_root / "harness" / "prompts" / "compiled" / "fii_demos.j2"
    compiler.export_compiled_exemplars(fii_prog, fii_out)
    print(f"   -> Exported to {fii_out}")
    print("=== PROMPT COMPILATION COMPLETED SUCCESSFULLY ===")


if __name__ == "__main__":
    main()
