# ruff: noqa
"""
Generate a professional, modern, widescreen (16:9) .pptx pitch deck for Forecasting Agent.
Uses clean card layouts, subtle colors, clear visual hierarchy, and readable typography.
"""

import os

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt


def create_deck(output_path: str):
    prs = Presentation()
    # 16:9 Widescreen dimensions
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Color Palette Tokens
    C_BG_DARK = RGBColor(10, 25, 47)  # #0A192F - Navy Slate
    C_BG_LIGHT = RGBColor(248, 250, 252)  # #F8FAFC - Off-white
    C_CARD_BG = RGBColor(255, 255, 255)  # #FFFFFF - Card white
    C_CARD_BORDER = RGBColor(226, 232, 240)  # #E2E8F0 - Slate border
    C_CARD_DARK = RGBColor(23, 42, 69)  # #172A45 - Card navy
    C_TEXT_PRIMARY = RGBColor(15, 23, 42)  # #0F172A - Slate 900
    C_TEXT_SECONDARY = RGBColor(71, 85, 105)  # #475569 - Slate 600
    C_TEXT_LIGHT = RGBColor(241, 245, 249)  # #F1F5F9 - Slate 100
    C_TEXT_MUTED = RGBColor(148, 163, 184)  # #94A3B8 - Slate 400
    C_ACCENT_BLUE = RGBColor(0, 150, 255)  # #0096FF - Cyan Blue
    C_ACCENT_GREEN = RGBColor(16, 185, 129)  # #10B981 - Emerald Green
    C_ACCENT_AMBER = RGBColor(245, 158, 11)  # #F59E0B - Amber
    C_ACCENT_PURPLE = RGBColor(139, 92, 246)  # #8B5CF6 - Violet

    FONT_HEADING = "Calibri"

    def add_bg(slide, dark=False):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        bg.fill.solid()
        bg.fill.fore_color.rgb = C_BG_DARK if dark else C_BG_LIGHT
        bg.line.fill.background()
        return bg

    def add_header(slide, title: str, category: str = "", dark=False):
        if category:
            cat_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.45), Inches(11.7), Inches(0.35))
            tf_cat = cat_box.text_frame
            tf_cat.word_wrap = True
            tf_cat.margin_left = tf_cat.margin_right = tf_cat.margin_top = tf_cat.margin_bottom = 0
            p_cat = tf_cat.paragraphs[0]
            p_cat.text = category.upper()
            p_cat.font.name = FONT_HEADING
            p_cat.font.size = Pt(11)
            p_cat.font.bold = True
            p_cat.font.color.rgb = C_ACCENT_BLUE if dark else RGBColor(2, 132, 199)

        t_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.75), Inches(11.7), Inches(0.8))
        tf = t_box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        p.text = title
        p.font.name = FONT_HEADING
        p.font.size = Pt(26)
        p.font.bold = True
        p.font.color.rgb = C_TEXT_LIGHT if dark else C_TEXT_PRIMARY

    def add_card(slide, left, top, width, height, bg_color=C_CARD_BG, border_color=C_CARD_BORDER):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        card.fill.solid()
        card.fill.fore_color.rgb = bg_color
        if border_color:
            card.line.color.rgb = border_color
            card.line.width = Pt(1)
        else:
            card.line.fill.background()
        return card

    # ==========================================
    # SLIDE 1: Title Slide (Dark Theme)
    # ==========================================
    s1 = prs.slides.add_slide(blank_layout)
    add_bg(s1, dark=True)

    # Accent pill tag
    add_card(s1, Inches(0.8), Inches(1.3), Inches(3.2), Inches(0.4), bg_color=C_CARD_DARK, border_color=C_ACCENT_BLUE)
    tb_tag = s1.shapes.add_textbox(Inches(0.9), Inches(1.35), Inches(3.0), Inches(0.3))
    p = tb_tag.text_frame.paragraphs[0]
    p.text = "AUTONOMOUS CODING AGENT PLATFORM"
    p.font.size = Pt(9.5)
    p.font.bold = True
    p.font.color.rgb = C_ACCENT_BLUE

    # Main Title
    tb_title = s1.shapes.add_textbox(Inches(0.8), Inches(1.9), Inches(11.5), Inches(1.8))
    tf = tb_title.text_frame
    tf.word_wrap = True
    p1 = tf.paragraphs[0]
    p1.text = "Forecasting Agent"
    p1.font.size = Pt(44)
    p1.font.bold = True
    p1.font.color.rgb = RGBColor(255, 255, 255)

    p2 = tf.add_paragraph()
    p2.text = "Claude Code for Financial Markets & Enterprise Forecasting"
    p2.font.size = Pt(22)
    p2.font.color.rgb = C_ACCENT_BLUE
    p2.space_before = Pt(8)

    # Subtitle / description
    tb_sub = s1.shapes.add_textbox(Inches(0.8), Inches(3.8), Inches(10.0), Inches(1.0))
    tf_sub = tb_sub.text_frame
    tf_sub.word_wrap = True
    p_sub = tf_sub.paragraphs[0]
    p_sub.text = (
        "An autonomous multi-agent platform where specialized AI analysts write, execute, "
        "and stress-test custom Python models in secure Docker sandboxes — arriving at calibrated "
        "market consensus through 4 rounds of adversarial debate."
    )
    p_sub.font.size = Pt(14)
    p_sub.font.color.rgb = C_TEXT_MUTED

    # 3 Stat / Highlight Cards at bottom
    highlights = [
        ("4-Round Adversarial Debate", "Eliminates LLM hallucination & herd bias"),
        ("Two-Tier Docker Sandbox", "Exploration with strict zero-network validation"),
        ("Immutable Oracle (M8)", "Mathematical ground-truth evaluation (MASE & Brier)"),
    ]
    for i, (title, desc) in enumerate(highlights):
        c_left = Inches(0.8 + i * 4.0)
        add_card(
            s1, c_left, Inches(5.2), Inches(3.7), Inches(1.4), bg_color=C_CARD_DARK, border_color=RGBColor(30, 58, 95)
        )
        tb = s1.shapes.add_textbox(c_left + Inches(0.2), Inches(5.35), Inches(3.3), Inches(1.1))
        tf = tb.text_frame
        tf.word_wrap = True
        p_t = tf.paragraphs[0]
        p_t.text = title
        p_t.font.size = Pt(13)
        p_t.font.bold = True
        p_t.font.color.rgb = RGBColor(255, 255, 255)
        p_d = tf.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(11)
        p_d.font.color.rgb = C_TEXT_MUTED
        p_d.space_before = Pt(4)

    # ==========================================
    # SLIDE 2: The Core Problem
    # ==========================================
    s2 = prs.slides.add_slide(blank_layout)
    add_bg(s2, dark=False)
    add_header(s2, "The Financial Intelligence Gap", "Market Opportunity")

    cards_data_2 = [
        (
            "1. Black-Box LLMs Hallucinate",
            "Chatbots Guess Direction Without Math",
            "• Large language models predict market moves from text alone without executing code.\n• Uncalibrated probabilistic confidence (90% confident on coin flips).\n• Cannot verify lookahead bias or data leakage in memory.",
            RGBColor(239, 68, 68),
        ),
        (
            "2. Traditional Quants are Brittle",
            "Static Pipelines Miss Regime Shifts",
            "• Rigid statistical scripts cannot synthesize unstructured news, corporate filings, or FII/DII flow changes.\n• Require weeks of manual data engineering to add new features.\n• Fail during sudden market liquidity shocks and policy shifts.",
            RGBColor(245, 158, 11),
        ),
        (
            "3. The Enterprise Dilemma",
            "Need Speed Without Giving Up Rigor",
            "• Portfolio managers, risk officers, and FP&A teams spend 80% of their time writing repetitive analysis scripts.\n• No reproducible audit trail of why a forecast was made.\n• Lack of an immutable benchmark to prove forecasting skill.",
            RGBColor(99, 102, 241),
        ),
    ]

    for i, (tag, heading, body, color) in enumerate(cards_data_2):
        c_left = Inches(0.8 + i * 4.0)
        add_card(s2, c_left, Inches(1.8), Inches(3.7), Inches(4.8))

        # Color bar top
        bar = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(1.8), Inches(3.7), Inches(0.08))
        bar.fill.solid()
        bar.fill.fore_color.rgb = color
        bar.line.fill.background()

        tb = s2.shapes.add_textbox(c_left + Inches(0.25), Inches(2.05), Inches(3.2), Inches(4.3))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = tag.upper()
        p1.font.size = Pt(10)
        p1.font.bold = True
        p1.font.color.rgb = color

        p2 = tf.add_paragraph()
        p2.text = heading
        p2.font.size = Pt(15)
        p2.font.bold = True
        p2.font.color.rgb = C_TEXT_PRIMARY
        p2.space_before = Pt(4)

        p3 = tf.add_paragraph()
        p3.text = body
        p3.font.size = Pt(11.5)
        p3.font.color.rgb = C_TEXT_SECONDARY
        p3.space_before = Pt(10)

    # ==========================================
    # SLIDE 3: The Solution: Autonomous Multi-Agent Coding
    # ==========================================
    s3 = prs.slides.add_slide(blank_layout)
    add_bg(s3, dark=False)
    add_header(s3, "The Solution: Hybrid Coding Agents", "Platform Architecture")

    # Left: Big concept box
    add_card(s3, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.8), bg_color=C_CARD_BG)
    tb_left = s3.shapes.add_textbox(Inches(1.1), Inches(2.1), Inches(5.0), Inches(4.2))
    tf_l = tb_left.text_frame
    tf_l.word_wrap = True

    p = tf_l.paragraphs[0]
    p.text = "How Forecasting Agent Works"
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = C_TEXT_PRIMARY

    items_sol = [
        (
            "Autonomous Code Generation",
            "Agents don't just speak English — they write real Python code to clean data, engineer multi-series features, and train models.",
        ),
        (
            "Isolated Docker Execution",
            "Code runs in secure micro-sandboxes. If a model fails or hallucinates, the error trace feeds back to self-debug.",
        ),
        (
            "Multi-Participant Simulation",
            "4 specialized agents model Indian market forces: Price Action, FII Flows, DII Institutions, and Retail Sentiment.",
        ),
        (
            "Immutable Mathematical Oracle",
            "An isolated M8 evaluation engine scores models on ground-truth returns with zero vendor cheating.",
        ),
    ]

    for title, desc in items_sol:
        p_t = tf_l.add_paragraph()
        p_t.text = "• " + title + ": "
        p_t.font.bold = True
        p_t.font.size = Pt(11.5)
        p_t.font.color.rgb = C_TEXT_PRIMARY
        p_t.space_before = Pt(8)

        # Add desc inline or after
        p_t.text += desc
        p_t.font.bold = False

    # Right: 4 Participant Agents breakdown
    agents = [
        (
            "Price Anchor Agent",
            "Baseline Statistical Anchor",
            "ARIMA, Exponential Smoothing, and rolling volatility modeling.",
            C_ACCENT_BLUE,
        ),
        (
            "FII Flow Agent",
            "Foreign Institutional Intent",
            "USD/INR FX pressure, US 10Y yields, and cross-border net flow trends.",
            C_ACCENT_GREEN,
        ),
        (
            "DII Flow Agent",
            "Domestic Institutional Intent",
            "Mutual fund SIP inflows, sector rotation, and domestic liquidity absorption.",
            C_ACCENT_PURPLE,
        ),
        (
            "Retail & Sentiment Agent",
            "Market Psychology & Noise",
            "Bhavcopy Delivery %, Put-Call Ratios, and FinBERT news headline decay.",
            C_ACCENT_AMBER,
        ),
    ]

    for i, (name, role, desc, col) in enumerate(agents):
        c_top = Inches(1.8 + i * 1.25)
        add_card(s3, Inches(6.8), c_top, Inches(5.7), Inches(1.1), bg_color=C_CARD_BG)

        # Icon / accent square
        sq = s3.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.8), c_top, Inches(0.12), Inches(1.1))
        sq.fill.solid()
        sq.fill.fore_color.rgb = col
        sq.line.fill.background()

        tb = s3.shapes.add_textbox(Inches(7.1), c_top + Inches(0.12), Inches(5.2), Inches(0.85))
        tf = tb.text_frame
        tf.word_wrap = True
        p1 = tf.paragraphs[0]
        p1.text = name + f" — {role}"
        p1.font.size = Pt(12)
        p1.font.bold = True
        p1.font.color.rgb = C_TEXT_PRIMARY

        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.size = Pt(10.5)
        p2.font.color.rgb = C_TEXT_SECONDARY
        p2.space_before = Pt(2)

    # ==========================================
    # SLIDE 4: 4-Round Adversarial Debate Protocol
    # ==========================================
    s4 = prs.slides.add_slide(blank_layout)
    add_bg(s4, dark=False)
    add_header(s4, "4-Round Adversarial Debate Protocol", "Consensus Engine")

    rounds = [
        (
            "Round 1",
            "Independent Analysis",
            "Each of the 4 sub-agents runs isolated code scripts on multi-series feeds and produces an initial AgentSignal with quantitative evidence.",
            C_ACCENT_BLUE,
        ),
        (
            "Round 2",
            "Cross-Examination",
            "Agents inspect peer evidence triples. They write counter-scripts in Docker to challenge conflicting assumptions and test fragility.",
            C_ACCENT_GREEN,
        ),
        (
            "Round 3",
            "Devil's Advocate",
            "Supervisor assigns the lowest-calibrated agent to aggressively attack the leading consensus thesis with hard counter-factuals.",
            C_ACCENT_AMBER,
        ),
        (
            "Round 4",
            "Arithmetic Consensus",
            "Calculated in pure TypeScript code (NOT by LLM) using rolling 30-day Brier calibration weights. Emits calibrated scenario probabilities.",
            C_ACCENT_PURPLE,
        ),
    ]

    for i, (r_num, r_title, r_desc, col) in enumerate(rounds):
        c_left = Inches(0.8 + i * 3.0)
        add_card(s4, c_left, Inches(1.8), Inches(2.75), Inches(4.8))

        # Round Header
        head_box = s4.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(1.8), Inches(2.75), Inches(0.7))
        head_box.fill.solid()
        head_box.fill.fore_color.rgb = col
        head_box.line.fill.background()

        tb_h = s4.shapes.add_textbox(c_left, Inches(1.85), Inches(2.75), Inches(0.6))
        p = tb_h.text_frame.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = r_num.upper()
        p.font.size = Pt(12)
        p.font.bold = True
        p.font.color.rgb = RGBColor(255, 255, 255)

        tb_b = s4.shapes.add_textbox(c_left + Inches(0.2), Inches(2.65), Inches(2.35), Inches(3.8))
        tf = tb_b.text_frame
        tf.word_wrap = True
        p1 = tf.paragraphs[0]
        p1.text = r_title
        p1.font.size = Pt(14)
        p1.font.bold = True
        p1.font.color.rgb = C_TEXT_PRIMARY

        p2 = tf.add_paragraph()
        p2.text = r_desc
        p2.font.size = Pt(11)
        p2.font.color.rgb = C_TEXT_SECONDARY
        p2.space_before = Pt(8)

    # ==========================================
    # SLIDE 5: Two-Tier Docker Sandbox & Execution Safety
    # ==========================================
    s5 = prs.slides.add_slide(blank_layout)
    add_bg(s5, dark=False)
    add_header(s5, "Two-Tier Sandbox & Execution Safety", "Safety & Compute Layer")

    # Left: Tier 1 Explore
    add_card(s5, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.8))
    bar1 = s5.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.6), Inches(0.08))
    bar1.fill.solid()
    bar1.fill.fore_color.rgb = C_ACCENT_BLUE
    bar1.line.fill.background()

    tb1 = s5.shapes.add_textbox(Inches(1.1), Inches(2.05), Inches(5.0), Inches(4.3))
    tf1 = tb1.text_frame
    tf1.word_wrap = True
    p = tf1.paragraphs[0]
    p.text = "Tier 1: Warm Explore Sandbox"
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = C_TEXT_PRIMARY

    p_sub = tf1.add_paragraph()
    p_sub.text = "Fast, iterative modeling & self-debugging"
    p_sub.font.size = Pt(12)
    p_sub.font.color.rgb = C_ACCENT_BLUE
    p_sub.space_before = Pt(2)

    tier1_pts = [
        ("Stateful Session", "Agent writes Python code, inspects outputs, and iterates over 1-3 debug loops."),
        (
            "PyPI Access Allowed",
            "Can import standard statistical & ML libraries (pandas, scipy, statsmodels, xgboost).",
        ),
        ("Resource Bounds", "Limited to 512MB RAM, 1 CPU cgroup, and 45s hard execution timeout."),
        ("Ring Buffer Logging", "50KB circular stdout/stderr buffer prevents terminal flooding."),
    ]
    for t, d in tier1_pts:
        p_item = tf1.add_paragraph()
        p_item.text = f"• {t}: {d}"
        p_item.font.size = Pt(11)
        p_item.font.color.rgb = C_TEXT_SECONDARY
        p_item.space_before = Pt(6)

    # Right: Tier 2 Validate
    add_card(s5, Inches(6.8), Inches(1.8), Inches(5.7), Inches(4.8))
    bar2 = s5.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.7), Inches(0.08))
    bar2.fill.solid()
    bar2.fill.fore_color.rgb = C_ACCENT_GREEN
    bar2.line.fill.background()

    tb2 = s5.shapes.add_textbox(Inches(7.1), Inches(2.05), Inches(5.1), Inches(4.3))
    tf2 = tb2.text_frame
    tf2.word_wrap = True
    p = tf2.paragraphs[0]
    p.text = "Tier 2: Cold Validate Sandbox"
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = C_TEXT_PRIMARY

    p_sub = tf2.add_paragraph()
    p_sub.text = "Clean-room verification before score acceptance"
    p_sub.font.size = Pt(12)
    p_sub.font.color.rgb = C_ACCENT_GREEN
    p_sub.space_before = Pt(2)

    tier2_pts = [
        ("Zero Network Access", "Strict `--network=none` prevents any live internet data leakage."),
        ("Fresh Container Spawn", "Spawns from a pristine base image with zero residue from exploration runs."),
        ("Read-Only M8 Oracle", "Evaluation logic is mounted read-only; agent code cannot tamper with scoring."),
        ("Semaphore(2) Limiter", "Worker pool allows max 2 concurrent containers, guaranteeing host stability."),
    ]
    for t, d in tier2_pts:
        p_item = tf2.add_paragraph()
        p_item.text = f"• {t}: {d}"
        p_item.font.size = Pt(11)
        p_item.font.color.rgb = C_TEXT_SECONDARY
        p_item.space_before = Pt(6)

    # ==========================================
    # SLIDE 6: 4-Layer Ground Truth Evaluation (M8)
    # ==========================================
    s6 = prs.slides.add_slide(blank_layout)
    add_bg(s6, dark=False)
    add_header(s6, "4-Layer Mathematical Evaluation Engine", "Oracle Scoring")

    m8_layers = [
        (
            "Layer 4: Validity Gate (Runs First)",
            "Purged Walk-Forward CV & Temporal Guard",
            "Enforces mandatory embargo gap between folds and validates strict `as_of` temporal indexing. If lookahead leakage is detected, the run is immediately rejected.",
            C_ACCENT_AMBER,
        ),
        (
            "Layer 1: Objective MASE on Returns",
            "Mean Absolute Scaled Error (< 1.0 = Skill)",
            "Evaluates forecast against naive random-walk baseline. Any model with MASE >= 1.0 is discarded as statistically useless.",
            C_ACCENT_BLUE,
        ),
        (
            "Layer 2: Brier Score & Calibration",
            "Probabilistic Honesty & Confidence Bins",
            "Measures whether 80% confidence forecasts actually win 80% of the time. Heavy penalty for overconfident hallucinations.",
            C_ACCENT_GREEN,
        ),
        (
            "Layer 3: Cost-Adjusted Sortino",
            "Net of Indian STT, GST, & Exchange Fees",
            "Deducts Indian equity & derivative transaction costs (STT: 0.1%, Stamp Duty: 0.015%, GST: 18%) to verify real-world profitability.",
            C_ACCENT_PURPLE,
        ),
    ]

    for i, (title, subtitle, desc, col) in enumerate(m8_layers):
        c_top = Inches(1.8 + i * 1.25)
        add_card(s6, Inches(0.8), c_top, Inches(11.7), Inches(1.15))

        # Left color badge
        badge = s6.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), c_top, Inches(0.15), Inches(1.15))
        badge.fill.solid()
        badge.fill.fore_color.rgb = col
        badge.line.fill.background()

        tb = s6.shapes.add_textbox(Inches(1.2), c_top + Inches(0.12), Inches(11.0), Inches(0.9))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = title + f" — {subtitle}"
        p1.font.size = Pt(13)
        p1.font.bold = True
        p1.font.color.rgb = C_TEXT_PRIMARY

        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.size = Pt(11)
        p2.font.color.rgb = C_TEXT_SECONDARY
        p2.space_before = Pt(3)

    # ==========================================
    # SLIDE 7: Offline DSPy MIPROv2 Prompt Compilation
    # ==========================================
    s7 = prs.slides.add_slide(blank_layout)
    add_bg(s7, dark=False)
    add_header(s7, "Offline Prompt Compilation (DSPy MIPROv2)", "Prompt Engineering & Runtime")

    # 3 Column Cards
    col_data_7 = [
        (
            "1. Offline Bayesian Optimization",
            "DSPy MIPROv2 in Python",
            "• Replaces manual trial-and-error prompt writing with algorithmic optimization.\n• Evaluates 20 candidate prompt variants across 50 trials on historical Indian market regimes.\n• Optimizes few-shot exemplar selection directly on Brier score.\n• One-time compile cost: ~$0.48.",
            C_ACCENT_BLUE,
        ),
        (
            "2. Exported JSON Schema",
            "Shared Template Artifacts",
            "• Compiled system instructions and exemplars are saved as immutable JSON schemas in `prompts/compiled/`.\n• Jinja2 syntax compatible with both Python & Node.js.\n• Strict versioning (`price_anchor_v1.2.json`) enables audit trails and live A/B benchmarking.",
            C_ACCENT_PURPLE,
        ),
        (
            "3. < 1ms Zero-Latency Runtime",
            "Nunjucks Hydration in TypeScript",
            "• TypeScript harness loads pre-compiled JSON schemas directly via Nunjucks.\n• Zero Python runtime dependency during live production inference.\n• Maximum throughput with 90%+ prefix cache hit rates on DeepSeek API.",
            C_ACCENT_GREEN,
        ),
    ]

    for i, (tag, head, body, col) in enumerate(col_data_7):
        c_left = Inches(0.8 + i * 4.0)
        add_card(s7, c_left, Inches(1.8), Inches(3.7), Inches(4.8))

        bar = s7.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(1.8), Inches(3.7), Inches(0.08))
        bar.fill.solid()
        bar.fill.fore_color.rgb = col
        bar.line.fill.background()

        tb = s7.shapes.add_textbox(c_left + Inches(0.25), Inches(2.05), Inches(3.2), Inches(4.3))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = tag.upper()
        p1.font.size = Pt(10)
        p1.font.bold = True
        p1.font.color.rgb = col

        p2 = tf.add_paragraph()
        p2.text = head
        p2.font.size = Pt(15)
        p2.font.bold = True
        p2.font.color.rgb = C_TEXT_PRIMARY
        p2.space_before = Pt(4)

        p3 = tf.add_paragraph()
        p3.text = body
        p3.font.size = Pt(11.5)
        p3.font.color.rgb = C_TEXT_SECONDARY
        p3.space_before = Pt(10)

    # ==========================================
    # SLIDE 8: Market Data Ingestion & Sanitization Pipeline
    # ==========================================
    s8 = prs.slides.add_slide(blank_layout)
    add_bg(s8, dark=False)
    add_header(s8, "Data Ingestion & Outlier Sanitization", "Data Infrastructure")

    steps_data_8 = [
        (
            "Step 1: Multi-Asset Ingestion",
            "NSE/BSE equities, F&O option chains, USDINR macro feeds, and Bhavcopy delivery data ingested via Python MCP Server.",
        ),
        (
            "Step 2: Hampel Outlier Filter",
            "Scipy rolling median filter detects >3σ flash spikes, circuit-breaker limit hits, and data feed glitches, flagging them cleanly.",
        ),
        (
            "Step 3: Calendar Normalization",
            "Aligns cross-asset trading calendars (e.g. US trading holidays vs Indian trading hours) with forward-fill and gap reconciliation.",
        ),
        (
            "Step 4: Strict Point-in-Time Guard",
            "Mandatory `as_of` timestamp check strictly drops any data point after the backtest horizon, mathematically preventing lookahead leakage.",
        ),
    ]

    for i, (title, desc) in enumerate(steps_data_8):
        c_top = Inches(1.8 + i * 1.25)
        add_card(s8, Inches(0.8), c_top, Inches(11.7), Inches(1.15))

        # Step number pill
        pill = s8.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.1), c_top + Inches(0.2), Inches(0.7), Inches(0.7)
        )
        pill.fill.solid()
        pill.fill.fore_color.rgb = C_ACCENT_BLUE
        pill.line.fill.background()

        tb_p = s8.shapes.add_textbox(Inches(1.1), c_top + Inches(0.22), Inches(0.7), Inches(0.6))
        p = tb_p.text_frame.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = f"{i + 1}"
        p.font.size = Pt(18)
        p.font.bold = True
        p.font.color.rgb = RGBColor(255, 255, 255)

        tb_txt = s8.shapes.add_textbox(Inches(2.1), c_top + Inches(0.12), Inches(10.1), Inches(0.9))
        tf = tb_txt.text_frame
        tf.word_wrap = True
        p1 = tf.paragraphs[0]
        p1.text = title
        p1.font.size = Pt(13)
        p1.font.bold = True
        p1.font.color.rgb = C_TEXT_PRIMARY

        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.size = Pt(11)
        p2.font.color.rgb = C_TEXT_SECONDARY
        p2.space_before = Pt(3)

    # ==========================================
    # SLIDE 9: End-to-End System Workflow
    # ==========================================
    s9 = prs.slides.add_slide(blank_layout)
    add_bg(s9, dark=False)
    add_header(s9, "End-to-End System Execution Flow", "System Lifecycle")

    flow_boxes = [
        (
            "1. User / Cron Trigger",
            "CLI or Scheduled Cron requests forecast for symbol (e.g. RELIANCE.NS)",
            C_ACCENT_BLUE,
        ),
        (
            "2. Startup Handshake",
            "< 200ms fail-fast verification of DB, Redis, Docker, and MCP servers",
            C_ACCENT_GREEN,
        ),
        (
            "3. Multi-Agent R1-R4",
            "4 sub-agents write code, execute in sandbox, and debate over 4 rounds",
            C_ACCENT_AMBER,
        ),
        (
            "4. M8 Oracle Gate",
            "Read-only evaluation computes MASE, Brier score, and fee-adjusted Sortino",
            C_ACCENT_PURPLE,
        ),
        (
            "5. Executive Digest Card",
            "1-page decision card generated with 15-minute bar invalidation guardrail",
            C_ACCENT_BLUE,
        ),
    ]

    for i, (title, desc, col) in enumerate(flow_boxes):
        c_top = Inches(1.8 + i * 1.0)
        add_card(s9, Inches(0.8), c_top, Inches(11.7), Inches(0.88))

        bar = s9.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), c_top, Inches(0.12), Inches(0.88))
        bar.fill.solid()
        bar.fill.fore_color.rgb = col
        bar.line.fill.background()

        tb = s9.shapes.add_textbox(Inches(1.1), c_top + Inches(0.1), Inches(11.2), Inches(0.7))
        tf = tb.text_frame
        tf.word_wrap = True
        p1 = tf.paragraphs[0]
        p1.text = title + " — "
        p1.font.bold = True
        p1.font.size = Pt(12.5)
        p1.font.color.rgb = C_TEXT_PRIMARY
        p1.text += desc
        p1.font.bold = False

    # ==========================================
    # SLIDE 10: Unit Economics & Open-Source Stack
    # ==========================================
    s10 = prs.slides.add_slide(blank_layout)
    add_bg(s10, dark=False)
    add_header(s10, "Unit Economics & Open-Source Stack", "Infrastructure & Costs")

    # Left: Unit Economics
    add_card(s10, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.8))
    tb_u = s10.shapes.add_textbox(Inches(1.1), Inches(2.05), Inches(5.0), Inches(4.3))
    tf_u = tb_u.text_frame
    tf_u.word_wrap = True

    p = tf_u.paragraphs[0]
    p.text = "Forecast Run Unit Economics"
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = C_TEXT_PRIMARY

    p_cost = tf_u.add_paragraph()
    p_cost.text = "$0.024 per Full 4-Round Forecast"
    p_cost.font.size = Pt(14)
    p_cost.font.bold = True
    p_cost.font.color.rgb = C_ACCENT_GREEN
    p_cost.space_before = Pt(4)

    econ_breakdown = [
        (
            "DeepSeek v4-flash Inference",
            "4 rounds × 4 agents = 16 turns (~65k input tokens, 8k output tokens) = $0.018",
        ),
        ("Docker Sandbox Compute", "0.2 CPU-hours of execution time = $0.004"),
        ("News & Search (DuckDuckGo)", "$0.000 (Open-source scraping / zero API fee)"),
        ("Total Marginal Cost", "Less than 2.5 cents per comprehensive multi-agent analysis"),
    ]
    for t, d in econ_breakdown:
        p_item = tf_u.add_paragraph()
        p_item.text = f"• {t}: {d}"
        p_item.font.size = Pt(11)
        p_item.font.color.rgb = C_TEXT_SECONDARY
        p_item.space_before = Pt(6)

    # Right: Open Source Stack
    add_card(s10, Inches(6.8), Inches(1.8), Inches(5.7), Inches(4.8))
    tb_s = s10.shapes.add_textbox(Inches(7.1), Inches(2.05), Inches(5.1), Inches(4.3))
    tf_s = tb_s.text_frame
    tf_s.word_wrap = True

    p = tf_s.paragraphs[0]
    p.text = "100% Open-Source Foundation"
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = C_TEXT_PRIMARY

    stack_items = [
        ("Orchestrator", "@langchain/langgraph & TypeScript (StateGraph)"),
        ("Data Server", "FastAPI + Python Model Context Protocol (MCP)"),
        ("Sandbox", "Docker Engine with cgroup memory limits"),
        ("Evaluation", "scipy, statsmodels, pandas, and scikit-learn"),
        ("Observability", "Langfuse open-source tracing with UUIDv7 hierarchy"),
        ("Storage", "PostgreSQL with temporal `as_of` indexing + Redis"),
    ]
    for l, tech in stack_items:
        p_item = tf_s.add_paragraph()
        p_item.text = f"• {l}: {tech}"
        p_item.font.size = Pt(11)
        p_item.font.color.rgb = C_TEXT_SECONDARY
        p_item.space_before = Pt(6)

    # ==========================================
    # SLIDE 11: Multi-Industry Skill Expansion Roadmap
    # ==========================================
    s11 = prs.slides.add_slide(blank_layout)
    add_bg(s11, dark=False)
    add_header(s11, "Beyond Equities: Multi-Industry Expansion", "Market Horizon")

    phases = [
        (
            "Phase 1: Financial Markets",
            "Indian Equities & Derivatives (MVP 1)",
            "• Nifty 50, Bank Nifty, and F&O derivatives.\n• FII/DII liquidity flow modeling.\n• Daily executive digest delivery.",
            C_ACCENT_BLUE,
        ),
        (
            "Phase 2: Supply Chain & Ops",
            "Demand & Lead Time Forecasting",
            "• Bill of materials (BOM) multi-echelon forecasting.\n• Port congestion and supplier lead time variance.\n• Warehouse safety stock optimization.",
            C_ACCENT_GREEN,
        ),
        (
            "Phase 3: Energy & Commodities",
            "Grid Load & Commodity Price Shocks",
            "• Weather-adjusted renewable power generation.\n• Crude oil & natural gas crack spread forecasting.\n• Carbon credit supply/demand equilibrium.",
            C_ACCENT_AMBER,
        ),
        (
            "Phase 4: Enterprise FP&A",
            "Revenue, Churn & Working Capital",
            "• Autonomous ERP connector integration (SAP/NetSuite).\n• ARR churn and runway scenario modeling.\n• Rolling 13-week cash flow forecasting.",
            C_ACCENT_PURPLE,
        ),
    ]

    for i, (p_name, p_sub, p_body, col) in enumerate(phases):
        c_left = Inches(0.8 + i * 3.0)
        add_card(s11, c_left, Inches(1.8), Inches(2.75), Inches(4.8))

        bar = s11.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(1.8), Inches(2.75), Inches(0.08))
        bar.fill.solid()
        bar.fill.fore_color.rgb = col
        bar.line.fill.background()

        tb = s11.shapes.add_textbox(c_left + Inches(0.2), Inches(2.05), Inches(2.35), Inches(4.3))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = p_name
        p1.font.size = Pt(13.5)
        p1.font.bold = True
        p1.font.color.rgb = C_TEXT_PRIMARY

        p2 = tf.add_paragraph()
        p2.text = p_sub
        p2.font.size = Pt(11)
        p2.font.bold = True
        p2.font.color.rgb = col
        p2.space_before = Pt(3)

        p3 = tf.add_paragraph()
        p3.text = p_body
        p3.font.size = Pt(10.5)
        p3.font.color.rgb = C_TEXT_SECONDARY
        p3.space_before = Pt(8)

    # ==========================================
    # SLIDE 12: Summary & MVP 1 Milestones (Dark Theme)
    # ==========================================
    s12 = prs.slides.add_slide(blank_layout)
    add_bg(s12, dark=True)

    add_header(s12, "Why Forecasting Agent Wins", "Investment Summary", dark=True)

    # 4 Key Takeaways in 2x2 grid
    takeaways = [
        (
            "1. Code Beats Chat",
            "Agents write and execute real statistical Python code instead of guessing token probabilities.",
            C_ACCENT_BLUE,
        ),
        (
            "2. Adversarial Calibration",
            "4-round debate with hard Devil's Advocate role eliminates groupthink and sycophancy.",
            C_ACCENT_GREEN,
        ),
        (
            "3. Immutable Ground Truth",
            "M8 Oracle prevents overfitting, lookahead bias, and cheating via purged walk-forward gates.",
            C_ACCENT_AMBER,
        ),
        (
            "4. Extreme Cost Efficiency",
            "At $0.024 per forecast run, enterprise-grade multi-agent intelligence is 100x cheaper than manual analyst labor.",
            C_ACCENT_PURPLE,
        ),
    ]

    for i, (title, desc, col) in enumerate(takeaways):
        row = i // 2
        col_idx = i % 2
        c_left = Inches(0.8 + col_idx * 6.0)
        c_top = Inches(1.8 + row * 2.5)

        add_card(s12, c_left, c_top, Inches(5.7), Inches(2.2), bg_color=C_CARD_DARK, border_color=RGBColor(30, 58, 95))

        # Color indicator line
        ind = s12.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, c_top, Inches(0.12), Inches(2.2))
        ind.fill.solid()
        ind.fill.fore_color.rgb = col
        ind.line.fill.background()

        tb = s12.shapes.add_textbox(c_left + Inches(0.3), c_top + Inches(0.2), Inches(5.1), Inches(1.8))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = title
        p1.font.size = Pt(16)
        p1.font.bold = True
        p1.font.color.rgb = RGBColor(255, 255, 255)

        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.size = Pt(12)
        p2.font.color.rgb = C_TEXT_MUTED
        p2.space_before = Pt(8)

    # Save presentation
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    prs.save(output_path)


if __name__ == "__main__":
    create_deck("docs/Forecasting_Agent_Pitch_Deck.pptx")
