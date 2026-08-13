# ruff: noqa
"""
Generate a world-class, premium, modern widescreen (16:9) .pptx pitch deck for Forecasting Agent.
Built with professional UI/UX standards:
- Cohesive design system & typography hierarchy
- Curated color tokens (Navy/Slate/Blue/Emerald/Amber/Violet)
- Clean card architecture with precise padding and alignment
- Metric callouts, step badges, and subtle dividers
- Balanced whitespace (never cramped, never empty)
"""

import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE


def build_presentation(output_path: str):
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # ==========================================
    # COLOR PALETTE TOKENS
    # ==========================================
    # Dark Theme
    C_DARK_BG = RGBColor(8, 14, 26)  # #080E1A - Deep Navy Surface
    C_DARK_CARD = RGBColor(15, 26, 46)  # #0F1A2E - Navy Card
    C_DARK_CARD_ALT = RGBColor(20, 35, 60)  # #14233C - Lighter Card
    C_DARK_BORDER = RGBColor(30, 48, 80)  # #1E3050 - Navy Border
    C_DARK_TEXT_TITLE = RGBColor(255, 255, 255)
    C_DARK_TEXT_BODY = RGBColor(203, 213, 225)  # #CBD5E1 - Slate 300
    C_DARK_TEXT_MUTED = RGBColor(148, 163, 184)  # #94A3B8 - Slate 400

    # Light Theme
    C_LIGHT_BG = RGBColor(248, 250, 252)  # #F8FAFC - Clean Off-white Canvas
    C_LIGHT_CARD = RGBColor(255, 255, 255)  # #FFFFFF - Crisp White Card
    C_LIGHT_CARD_ALT = RGBColor(241, 245, 249)  # #F1F5F9 - Slate 100
    C_LIGHT_BORDER = RGBColor(226, 232, 240)  # #E2E8F0 - Slate 200 Border
    C_LIGHT_TEXT_TITLE = RGBColor(15, 23, 42)  # #0F172A - Slate 900
    C_LIGHT_TEXT_BODY = RGBColor(51, 65, 85)  # #334155 - Slate 700
    C_LIGHT_TEXT_MUTED = RGBColor(100, 116, 139)  # #64748B - Slate 500

    # Accent Signatures
    C_BLUE = RGBColor(37, 99, 235)  # #2563EB - Royal Blue Primary
    C_CYAN = RGBColor(14, 165, 233)  # #0EA5E9 - Sky/Cyan
    C_EMERALD = RGBColor(16, 185, 129)  # #10B981 - Emerald Green
    C_AMBER = RGBColor(245, 158, 11)  # #F59E0B - Amber Ochre
    C_CORAL = RGBColor(239, 68, 68)  # #EF4444 - Coral Red
    C_VIOLET = RGBColor(139, 92, 246)  # #8B5CF6 - Indigo Violet

    FONT_FAMILY = "Segoe UI"
    FONT_FAMILY_HEAD = "Segoe UI Semibold"

    # ==========================================
    # HELPER FUNCTIONS
    # ==========================================
    def set_background(slide, dark=False):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
        bg.fill.solid()
        bg.fill.fore_color.rgb = C_DARK_BG if dark else C_LIGHT_BG
        bg.line.fill.background()

        # Subtle top accent gradient line
        top_line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(0.06))
        top_line.fill.solid()
        top_line.fill.fore_color.rgb = C_BLUE
        top_line.line.fill.background()
        return bg

    def add_slide_header(slide, title: str, category: str, subtitle: str = "", dark=False):
        # Category Pill
        cat_card = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.8), Inches(0.42), Inches(3.2), Inches(0.32)
        )
        cat_card.fill.solid()
        cat_card.fill.fore_color.rgb = C_DARK_CARD_ALT if dark else RGBColor(238, 242, 255)
        cat_card.line.color.rgb = C_DARK_BORDER if dark else RGBColor(199, 210, 254)
        cat_card.line.width = Pt(0.75)

        tf_c = cat_card.text_frame
        tf_c.vertical_anchor = MSO_ANCHOR.MIDDLE
        p_c = tf_c.paragraphs[0]
        p_c.alignment = PP_ALIGN.CENTER
        p_c.text = category.upper()
        p_c.font.name = FONT_FAMILY_HEAD
        p_c.font.size = Pt(9)
        p_c.font.bold = True
        p_c.font.color.rgb = C_CYAN if dark else C_BLUE

        # Main Title
        t_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.76), Inches(11.7), Inches(0.55))
        tf = t_box.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        p.text = title
        p.font.name = FONT_FAMILY_HEAD
        p.font.size = Pt(22)
        p.font.bold = True
        p.font.color.rgb = C_DARK_TEXT_TITLE if dark else C_LIGHT_TEXT_TITLE

        # Subtitle
        if subtitle:
            s_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.32), Inches(11.7), Inches(0.35))
            tf_s = s_box.text_frame
            tf_s.word_wrap = True
            tf_s.margin_left = tf_s.margin_right = tf_s.margin_top = tf_s.margin_bottom = 0
            p_s = tf_s.paragraphs[0]
            p_s.text = subtitle
            p_s.font.name = FONT_FAMILY
            p_s.font.size = Pt(11)
            p_s.font.color.rgb = C_DARK_TEXT_MUTED if dark else C_LIGHT_TEXT_MUTED

    def add_card_box(slide, left, top, width, height, bg_color=C_LIGHT_CARD, border_color=C_LIGHT_BORDER):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        card.fill.solid()
        card.fill.fore_color.rgb = bg_color
        if border_color:
            card.line.color.rgb = border_color
            card.line.width = Pt(1)
        else:
            card.line.fill.background()
        return card

    def add_footer(slide, slide_num: int, total_slides: int = 12, dark=False):
        # Divider line
        div = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(7.0), Inches(11.733), Inches(0.015))
        div.fill.solid()
        div.fill.fore_color.rgb = C_DARK_BORDER if dark else C_LIGHT_BORDER
        div.line.fill.background()

        # Left label
        tb_l = slide.shapes.add_textbox(Inches(0.8), Inches(7.06), Inches(6.0), Inches(0.3))
        tf_l = tb_l.text_frame
        p_l = tf_l.paragraphs[0]
        p_l.text = "Forecasting Agent • Autonomous Multi-Agent Architecture • MVP 1"
        p_l.font.name = FONT_FAMILY
        p_l.font.size = Pt(8.5)
        p_l.font.color.rgb = C_DARK_TEXT_MUTED if dark else C_LIGHT_TEXT_MUTED

        # Right label
        tb_r = slide.shapes.add_textbox(Inches(9.533), Inches(7.06), Inches(3.0), Inches(0.3))
        tf_r = tb_r.text_frame
        p_r = tf_r.paragraphs[0]
        p_r.alignment = PP_ALIGN.RIGHT
        p_r.text = f"Slide {slide_num} of {total_slides}"
        p_r.font.name = FONT_FAMILY
        p_r.font.size = Pt(8.5)
        p_r.font.color.rgb = C_DARK_TEXT_MUTED if dark else C_LIGHT_TEXT_MUTED

    # =========================================================================
    # SLIDE 1: Title Slide (Dark Theme Hero)
    # =========================================================================
    s1 = prs.slides.add_slide(blank_layout)
    set_background(s1, dark=True)

    # Hero Pill Badge
    pill1 = add_card_box(
        s1, Inches(0.8), Inches(1.1), Inches(3.8), Inches(0.36), bg_color=C_DARK_CARD_ALT, border_color=C_BLUE
    )
    tf1 = pill1.text_frame
    tf1.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf1.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    p.text = "AUTONOMOUS AGENT PLATFORM • FINANCIAL AI"
    p.font.name = FONT_FAMILY_HEAD
    p.font.size = Pt(9.5)
    p.font.bold = True
    p.font.color.rgb = C_CYAN

    # Master Title
    tb_title = s1.shapes.add_textbox(Inches(0.8), Inches(1.65), Inches(11.7), Inches(1.8))
    tf = tb_title.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    p1 = tf.paragraphs[0]
    p1.text = "Forecasting Agent"
    p1.font.name = FONT_FAMILY_HEAD
    p1.font.size = Pt(44)
    p1.font.bold = True
    p1.font.color.rgb = C_DARK_TEXT_TITLE

    p2 = tf.add_paragraph()
    p2.text = "Claude Code for Financial Markets & Enterprise Forecasting"
    p2.font.name = FONT_FAMILY
    p2.font.size = Pt(20)
    p2.font.color.rgb = C_CYAN
    p2.space_before = Pt(6)

    # Narrative Summary Box
    add_card_box(
        s1, Inches(0.8), Inches(3.45), Inches(11.733), Inches(1.35), bg_color=C_DARK_CARD, border_color=C_DARK_BORDER
    )
    tb_narr = s1.shapes.add_textbox(Inches(1.1), Inches(3.6), Inches(11.133), Inches(1.05))
    tf_n = tb_narr.text_frame
    tf_n.word_wrap = True
    p_n = tf_n.paragraphs[0]
    p_n.text = (
        "An autonomous multi-agent platform where specialized AI analysts write, execute, and stress-test custom "
        "Python models in secure Docker sandboxes — arriving at statistically calibrated market consensus through "
        "4 rounds of adversarial debate, governed by an immutable mathematical oracle."
    )
    p_n.font.name = FONT_FAMILY
    p_n.font.size = Pt(13)
    p_n.font.color.rgb = C_DARK_TEXT_BODY

    # 3 Stat Cards on Bottom
    highlights_s1 = [
        (
            "01",
            "Autonomous CodeAct",
            "Agents write & execute real Python scripts inside isolated Docker containers.",
            C_BLUE,
        ),
        (
            "02",
            "Adversarial Debate",
            "4-round protocol with hard Devil's Advocate eliminates LLM sycophancy.",
            C_EMERALD,
        ),
        ("03", "Immutable Oracle", "Ground-truth evaluation engine (MASE & Brier) with zero lookahead bias.", C_VIOLET),
    ]
    for i, (num, h_title, h_desc, col) in enumerate(highlights_s1):
        c_left = Inches(0.8 + i * 4.0)
        add_card_box(
            s1, c_left, Inches(5.05), Inches(3.733), Inches(1.65), bg_color=C_DARK_CARD, border_color=C_DARK_BORDER
        )

        # Color bar indicator
        c_bar = s1.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(5.05), Inches(0.1), Inches(1.65))
        c_bar.fill.solid()
        c_bar.fill.fore_color.rgb = col
        c_bar.line.fill.background()

        tb = s1.shapes.add_textbox(c_left + Inches(0.25), Inches(5.2), Inches(3.35), Inches(1.35))
        tf = tb.text_frame
        tf.word_wrap = True

        p_t = tf.paragraphs[0]
        p_t.text = f"{num}  {h_title}"
        p_t.font.name = FONT_FAMILY_HEAD
        p_t.font.size = Pt(13.5)
        p_t.font.bold = True
        p_t.font.color.rgb = C_DARK_TEXT_TITLE

        p_d = tf.add_paragraph()
        p_d.text = h_desc
        p_d.font.name = FONT_FAMILY
        p_d.font.size = Pt(11)
        p_d.font.color.rgb = C_DARK_TEXT_MUTED
        p_d.space_before = Pt(6)

    add_footer(s1, 1, 12, dark=True)

    # =========================================================================
    # SLIDE 2: The Core Problem
    # =========================================================================
    s2 = prs.slides.add_slide(blank_layout)
    set_background(s2, dark=False)
    add_slide_header(
        s2,
        "The Financial Intelligence Gap",
        "Market Problem",
        "Why existing generative AI chatbots and static statistical pipelines fail at real-world forecasting",
    )

    cards_data_s2 = [
        (
            "01",
            "Black-Box LLMs Hallucinate",
            "Chatbots Guess Direction Without Math",
            [
                "Generate predictions purely from text tokens without calculating equations",
                "Uncalibrated confidence (claim 90% certainty on coin-flip scenarios)",
                "Prone to lookahead bias and temporal data leakage during backtests",
                "Zero ability to self-debug syntax errors or mathematical anomalies",
            ],
            C_CORAL,
        ),
        (
            "02",
            "Traditional Quants are Brittle",
            "Static Pipelines Miss Regime Shifts",
            [
                "Rigid statistical scripts cannot parse unstructured news or regulatory filings",
                "Require weeks of manual feature engineering to add new market variables",
                "Collapse during sudden liquidity shocks, geopolitical events, and policy pivots",
                "Lack adversarial cross-examination to challenge stale model assumptions",
            ],
            C_AMBER,
        ),
        (
            "03",
            "The Enterprise Bottleneck",
            "High Costs with Zero Verifiable Track Record",
            [
                "Institutional teams spend 80% of analyst time on routine data scripting",
                "No immutable benchmark to prove whether alpha comes from skill or luck",
                "Expensive enterprise terminals provide raw feeds but zero automated synthesis",
                "High human overhead ($250k+/yr per quantitative research analyst)",
            ],
            C_VIOLET,
        ),
    ]

    for i, (num, tag, heading, points, col) in enumerate(cards_data_s2):
        c_left = Inches(0.8 + i * 4.0)
        add_card_box(s2, c_left, Inches(1.8), Inches(3.733), Inches(4.9))

        # Color bar top
        bar = s2.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(1.8), Inches(3.733), Inches(0.08))
        bar.fill.solid()
        bar.fill.fore_color.rgb = col
        bar.line.fill.background()

        tb = s2.shapes.add_textbox(c_left + Inches(0.25), Inches(2.05), Inches(3.233), Inches(4.5))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = f"PROBLEM {num}"
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(9.5)
        p1.font.bold = True
        p1.font.color.rgb = col

        p2 = tf.add_paragraph()
        p2.text = heading
        p2.font.name = FONT_FAMILY_HEAD
        p2.font.size = Pt(14)
        p2.font.bold = True
        p2.font.color.rgb = C_LIGHT_TEXT_TITLE
        p2.space_before = Pt(3)

        for pt in points:
            p_bullet = tf.add_paragraph()
            p_bullet.text = f"•  {pt}"
            p_bullet.font.name = FONT_FAMILY
            p_bullet.font.size = Pt(10.5)
            p_bullet.font.color.rgb = C_LIGHT_TEXT_BODY
            p_bullet.space_before = Pt(8)

    add_footer(s2, 2, 12, dark=False)

    # =========================================================================
    # SLIDE 3: The Solution: Autonomous Multi-Agent Coding
    # =========================================================================
    s3 = prs.slides.add_slide(blank_layout)
    set_background(s3, dark=False)
    add_slide_header(
        s3,
        "The Solution: Hybrid Coding Agents",
        "Core Architecture",
        "Combining generative LLM reasoning with autonomous Python code execution and multi-participant modeling",
    )

    # Left Hero Box: Core Concept
    add_card_box(s3, Inches(0.8), Inches(1.8), Inches(5.5), Inches(4.9))
    bar_l = s3.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.5), Inches(0.08))
    bar_l.fill.solid()
    bar_l.fill.fore_color.rgb = C_BLUE
    bar_l.line.fill.background()

    tb_sol = s3.shapes.add_textbox(Inches(1.1), Inches(2.05), Inches(4.9), Inches(4.5))
    tf_s3 = tb_sol.text_frame
    tf_s3.word_wrap = True

    p = tf_s3.paragraphs[0]
    p.text = "How Forecasting Agent Operates"
    p.font.name = FONT_FAMILY_HEAD
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_LIGHT_TEXT_TITLE

    pillars = [
        (
            "Autonomous Code Generation",
            "Agents write executable Python code to engineer multi-series features, train regressors, and test lead-lag relationships.",
        ),
        (
            "Two-Tier Docker Sandbox",
            "Code runs in micro-sandboxes. Error tracebacks feed back into the agent's scratchpad for self-debugging before submission.",
        ),
        (
            "Participant-Intent Modeling",
            "4 specialized agents simulate real Indian market participants (Price, FIIs, DIIs, and Retail) rather than single-agent guessing.",
        ),
        (
            "Immutable Mathematical Oracle",
            "An isolated evaluation package (M8) scores forecasts on ground-truth returns with zero lookahead bias.",
        ),
    ]
    for p_title, p_desc in pillars:
        p_t = tf_s3.add_paragraph()
        p_t.text = f"• {p_title}: "
        p_t.font.name = FONT_FAMILY_HEAD
        p_t.font.size = Pt(11)
        p_t.font.bold = True
        p_t.font.color.rgb = C_LIGHT_TEXT_TITLE
        p_t.space_before = Pt(8)

        p_t.text += p_desc
        p_t.font.name = FONT_FAMILY
        p_t.font.bold = False
        p_t.font.color.rgb = C_LIGHT_TEXT_BODY

    # Right: 4 Participant Sub-Agent Cards
    agents_s3 = [
        (
            "Price Anchor Agent",
            "Baseline Statistical Anchor",
            "ARIMA, Exponential Smoothing, and rolling volatility modeling.",
            C_BLUE,
        ),
        (
            "FII Flow Agent",
            "Foreign Institutional Intent",
            "USD/INR FX pressure, US 10Y yields, and cross-border net flow trends.",
            C_EMERALD,
        ),
        (
            "DII Flow Agent",
            "Domestic Institutional Intent",
            "Mutual fund SIP inflows, sector rotation, and domestic liquidity absorption.",
            C_VIOLET,
        ),
        (
            "Retail & Sentiment Agent",
            "Market Psychology & Noise",
            "Bhavcopy Delivery %, Put-Call Ratios, and FinBERT news headline decay.",
            C_AMBER,
        ),
    ]
    for i, (name, role, desc, col) in enumerate(agents_s3):
        c_top = Inches(1.8 + i * 1.25)
        add_card_box(s3, Inches(6.6), c_top, Inches(5.933), Inches(1.15))

        # Color bar indicator
        ind = s3.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.6), c_top, Inches(0.12), Inches(1.15))
        ind.fill.solid()
        ind.fill.fore_color.rgb = col
        ind.line.fill.background()

        tb = s3.shapes.add_textbox(Inches(6.9), c_top + Inches(0.12), Inches(5.4), Inches(0.9))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = f"{name} • {role}"
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(12.5)
        p1.font.bold = True
        p1.font.color.rgb = C_LIGHT_TEXT_TITLE

        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(10.5)
        p2.font.color.rgb = C_LIGHT_TEXT_BODY
        p2.space_before = Pt(3)

    add_footer(s3, 3, 12, dark=False)

    # =========================================================================
    # SLIDE 4: 4-Round Adversarial Debate Protocol
    # =========================================================================
    s4 = prs.slides.add_slide(blank_layout)
    set_background(s4, dark=False)
    add_slide_header(
        s4,
        "4-Round Adversarial Debate Protocol",
        "Consensus Engine",
        "Eliminating sycophancy and groupthink through structured multi-turn cross-examination",
    )

    rounds_s4 = [
        (
            "Round 1",
            "Independent Analysis",
            "Each sub-agent runs isolated code scripts on multi-series feeds and emits an initial AgentSignal with quantitative evidence triples.",
            C_BLUE,
        ),
        (
            "Round 2",
            "Cross-Examination",
            "Agents review peer evidence. They write adversarial counter-scripts in Docker to challenge conflicting assumptions and test fragility.",
            C_EMERALD,
        ),
        (
            "Round 3",
            "Devil's Advocate",
            "Supervisor assigns the lowest-calibrated agent to aggressively attack the leading consensus thesis with hard counter-factuals.",
            C_AMBER,
        ),
        (
            "Round 4",
            "Arithmetic Consensus",
            "Calculated in pure TypeScript code (NOT by LLM) using rolling 30-day Brier calibration weights. Emits calibrated scenario probabilities.",
            C_VIOLET,
        ),
    ]

    for i, (r_num, r_title, r_desc, col) in enumerate(rounds_s4):
        c_left = Inches(0.8 + i * 3.0)
        add_card_box(s4, c_left, Inches(1.8), Inches(2.75), Inches(4.3))

        # Round Header Box
        head_box = s4.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(1.8), Inches(2.75), Inches(0.65))
        head_box.fill.solid()
        head_box.fill.fore_color.rgb = col
        head_box.line.fill.background()

        tb_h = s4.shapes.add_textbox(c_left, Inches(1.82), Inches(2.75), Inches(0.55))
        p = tb_h.text_frame.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        p.text = r_num.upper()
        p.font.name = FONT_FAMILY_HEAD
        p.font.size = Pt(11.5)
        p.font.bold = True
        p.font.color.rgb = RGBColor(255, 255, 255)

        tb_b = s4.shapes.add_textbox(c_left + Inches(0.2), Inches(2.55), Inches(2.35), Inches(3.4))
        tf = tb_b.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = r_title
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(13)
        p1.font.bold = True
        p1.font.color.rgb = C_LIGHT_TEXT_TITLE

        p2 = tf.add_paragraph()
        p2.text = r_desc
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(10.5)
        p2.font.color.rgb = C_LIGHT_TEXT_BODY
        p2.space_before = Pt(8)

    # Bottom Guardrail Banner
    guard_banner = add_card_box(
        s4,
        Inches(0.8),
        Inches(6.25),
        Inches(11.733),
        Inches(0.55),
        bg_color=RGBColor(238, 242, 255),
        border_color=RGBColor(199, 210, 254),
    )
    tb_g = s4.shapes.add_textbox(Inches(1.0), Inches(6.28), Inches(11.333), Inches(0.48))
    tf_g = tb_g.text_frame
    p_g = tf_g.paragraphs[0]
    p_g.text = "HARD ARCHITECTURAL RULE: Consensus is computed deterministically in code via Brier weights [15%, 40%] — NEVER by LLM vote or narrative averaging."
    p_g.font.name = FONT_FAMILY_HEAD
    p_g.font.size = Pt(10)
    p_g.font.bold = True
    p_g.font.color.rgb = C_BLUE

    add_footer(s4, 4, 12, dark=False)

    # =========================================================================
    # SLIDE 5: Two-Tier Docker Sandbox & Execution Safety
    # =========================================================================
    s5 = prs.slides.add_slide(blank_layout)
    set_background(s5, dark=False)
    add_slide_header(
        s5,
        "Two-Tier Sandbox & Execution Safety",
        "Safety & Sandboxing",
        "Balancing rapid iterative modeling with clean-room zero-network mathematical validation",
    )

    # Left: Tier 1 Explore
    add_card_box(s5, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.9))
    bar1 = s5.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.6), Inches(0.08))
    bar1.fill.solid()
    bar1.fill.fore_color.rgb = C_BLUE
    bar1.line.fill.background()

    tb1 = s5.shapes.add_textbox(Inches(1.1), Inches(2.05), Inches(5.0), Inches(4.4))
    tf1 = tb1.text_frame
    tf1.word_wrap = True

    p = tf1.paragraphs[0]
    p.text = "Tier 1: Warm Explore Sandbox"
    p.font.name = FONT_FAMILY_HEAD
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_LIGHT_TEXT_TITLE

    p_sub1 = tf1.add_paragraph()
    p_sub1.text = "Fast, iterative modeling & self-debugging loop"
    p_sub1.font.name = FONT_FAMILY
    p_sub1.font.size = Pt(11)
    p_sub1.font.color.rgb = C_BLUE
    p_sub1.space_before = Pt(2)

    tier1_items = [
        ("Stateful Session", "Agent writes Python code, inspects outputs, and iterates over 1-3 self-debug loops."),
        (
            "PyPI Access Enabled",
            "Can import standard statistical & ML libraries (pandas, scipy, statsmodels, xgboost).",
        ),
        ("Resource Boundaries", "Hard cgroup limits: 512MB RAM, 1 CPU core, and 45s execution timeout."),
        ("Circular Ring Buffer", "50KB circular stdout/stderr buffer prevents terminal memory saturation."),
    ]
    for t, d in tier1_items:
        p_item = tf1.add_paragraph()
        p_item.text = f"• {t}: "
        p_item.font.name = FONT_FAMILY_HEAD
        p_item.font.size = Pt(10.5)
        p_item.font.bold = True
        p_item.font.color.rgb = C_LIGHT_TEXT_TITLE
        p_item.space_before = Pt(8)

        p_item.text += d
        p_item.font.name = FONT_FAMILY
        p_item.font.bold = False
        p_item.font.color.rgb = C_LIGHT_TEXT_BODY

    # Right: Tier 2 Validate
    add_card_box(s5, Inches(6.8), Inches(1.8), Inches(5.733), Inches(4.9))
    bar2 = s5.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.733), Inches(0.08))
    bar2.fill.solid()
    bar2.fill.fore_color.rgb = C_EMERALD
    bar2.line.fill.background()

    tb2 = s5.shapes.add_textbox(Inches(7.1), Inches(2.05), Inches(5.133), Inches(4.4))
    tf2 = tb2.text_frame
    tf2.word_wrap = True

    p = tf2.paragraphs[0]
    p.text = "Tier 2: Cold Validate Sandbox"
    p.font.name = FONT_FAMILY_HEAD
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_LIGHT_TEXT_TITLE

    p_sub2 = tf2.add_paragraph()
    p_sub2.text = "Clean-room verification before score acceptance"
    p_sub2.font.name = FONT_FAMILY
    p_sub2.font.size = Pt(11)
    p_sub2.font.color.rgb = C_EMERALD
    p_sub2.space_before = Pt(2)

    tier2_items = [
        ("Zero Network Access", "Strict `--network=none` flag mathematically prevents any live internet data leakage."),
        ("Pristine Base Image", "Fresh container spawn with zero residue or persistent state from previous runs."),
        ("Read-Only M8 Oracle", "Evaluation logic is mounted read-only; agent code cannot tamper with scoring."),
        ("Concurrency Limiter", "Worker pool enforced by `async-mutex` Semaphore(2), preventing server lockups."),
    ]
    for t, d in tier2_items:
        p_item = tf2.add_paragraph()
        p_item.text = f"• {t}: "
        p_item.font.name = FONT_FAMILY_HEAD
        p_item.font.size = Pt(10.5)
        p_item.font.bold = True
        p_item.font.color.rgb = C_LIGHT_TEXT_TITLE
        p_item.space_before = Pt(8)

        p_item.text += d
        p_item.font.name = FONT_FAMILY
        p_item.font.bold = False
        p_item.font.color.rgb = C_LIGHT_TEXT_BODY

    add_footer(s5, 5, 12, dark=False)

    # =========================================================================
    # SLIDE 6: 4-Layer Ground Truth Evaluation (M8)
    # =========================================================================
    s6 = prs.slides.add_slide(blank_layout)
    set_background(s6, dark=False)
    add_slide_header(
        s6,
        "4-Layer Mathematical Evaluation Engine",
        "Oracle Scoring",
        "Immutable M8 package: Pure mathematical evaluation pipeline isolated from agent manipulation",
    )

    layers_s6 = [
        (
            "Layer 4",
            "Purged Walk-Forward CV & Temporal Gate",
            "RUNS FIRST",
            "Enforces mandatory embargo gap between train/test folds and validates strict `as_of` temporal indexing. If any lookahead data leakage is detected, the run is immediately marked INVALID.",
            C_CORAL,
        ),
        (
            "Layer 1",
            "Objective MASE on Realized Returns",
            "ACCURACY",
            "Evaluates forecast against naive random-walk baseline. Mean Absolute Scaled Error must be < 1.0; models >= 1.0 are discarded as statistically indistinguishable from noise.",
            C_BLUE,
        ),
        (
            "Layer 2",
            "Brier Score & Probabilistic Calibration",
            "HONESTY",
            "Measures whether 80% confidence forecasts actually win 80% of the time across 10 probability bins. Penalizes overconfident hallucinations heavily.",
            C_EMERALD,
        ),
        (
            "Layer 3",
            "Cost-Adjusted Sortino Ratio",
            "PROFITABILITY",
            "Deducts realistic Indian equity and derivative transaction friction (STT: 0.1%, Stamp Duty: 0.015%, GST: 18%, Exchange fees: 0.00345%) to ensure real-world strategy viability.",
            C_VIOLET,
        ),
    ]

    for i, (l_num, l_title, l_tag, l_desc, col) in enumerate(layers_s6):
        c_top = Inches(1.8 + i * 1.25)
        add_card_box(s6, Inches(0.8), c_top, Inches(11.733), Inches(1.15))

        # Color bar left
        ind = s6.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), c_top, Inches(0.12), Inches(1.15))
        ind.fill.solid()
        ind.fill.fore_color.rgb = col
        ind.line.fill.background()

        # Tag pill
        tag_p = add_card_box(
            s6, Inches(1.1), c_top + Inches(0.15), Inches(1.2), Inches(0.3), bg_color=C_LIGHT_CARD_ALT, border_color=col
        )
        tf_tp = tag_p.text_frame
        tf_tp.vertical_anchor = MSO_ANCHOR.MIDDLE
        p_tp = tf_tp.paragraphs[0]
        p_tp.alignment = PP_ALIGN.CENTER
        p_tp.text = l_num
        p_tp.font.name = FONT_FAMILY_HEAD
        p_tp.font.size = Pt(9.5)
        p_tp.font.bold = True
        p_tp.font.color.rgb = col

        tb = s6.shapes.add_textbox(Inches(2.45), c_top + Inches(0.1), Inches(9.8), Inches(0.95))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = l_title
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(12.5)
        p1.font.bold = True
        p1.font.color.rgb = C_LIGHT_TEXT_TITLE

        p2 = tf.add_paragraph()
        p2.text = l_desc
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(10.5)
        p2.font.color.rgb = C_LIGHT_TEXT_BODY
        p2.space_before = Pt(3)

    add_footer(s6, 6, 12, dark=False)

    # =========================================================================
    # SLIDE 7: Offline DSPy MIPROv2 Prompt Compilation
    # =========================================================================
    s7 = prs.slides.add_slide(blank_layout)
    set_background(s7, dark=False)
    add_slide_header(
        s7,
        "Offline Prompt Compilation & Hydration",
        "Prompt Engineering",
        "Algorithmic prompt optimization with Bayesian search and sub-millisecond production runtime",
    )

    cols_s7 = [
        (
            "01",
            "Offline DSPy MIPROv2",
            "Bayesian Instruction Search",
            [
                "Replaces manual prompt tweaking with algorithmic Bayesian optimization",
                "Evaluates 20 candidate instructions across 50 trials on historical regimes",
                "Optimizes few-shot exemplar selection directly on Brier calibration metric",
                "One-time offline compilation cost: ~$0.48 on DeepSeek v4-flash",
            ],
            C_BLUE,
        ),
        (
            "02",
            "Exported JSON Schemas",
            "Immutable Template Artifacts",
            [
                "Compiled prompts saved as JSON artifacts in `prompts/compiled/`",
                "Jinja2 template syntax shared seamlessly between Python & Node.js",
                "Strict semantic versioning (`price_anchor_v1.2.json`) for audit trails",
                "Enables zero-downtime prompt rollback and live A/B benchmarking",
            ],
            C_VIOLET,
        ),
        (
            "03",
            "< 1ms Nunjucks Runtime",
            "Zero-Latency Hydration",
            [
                "TypeScript harness loads compiled JSON templates via Nunjucks in < 1ms",
                "Zero Python runtime dependency during live production inference",
                "Maintains 90%+ prefix cache hit rate on DeepSeek API endpoint",
                "Fail-safe fallback to raw `.j2` template if compiled artifact missing",
            ],
            C_EMERALD,
        ),
    ]

    for i, (num, title, subtitle, points, col) in enumerate(cols_s7):
        c_left = Inches(0.8 + i * 4.0)
        add_card_box(s7, c_left, Inches(1.8), Inches(3.733), Inches(4.9))

        bar = s7.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(1.8), Inches(3.733), Inches(0.08))
        bar.fill.solid()
        bar.fill.fore_color.rgb = col
        bar.line.fill.background()

        tb = s7.shapes.add_textbox(c_left + Inches(0.25), Inches(2.05), Inches(3.233), Inches(4.5))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = f"STAGE {num} • {subtitle.upper()}"
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(9.5)
        p1.font.bold = True
        p1.font.color.rgb = col

        p2 = tf.add_paragraph()
        p2.text = title
        p2.font.name = FONT_FAMILY_HEAD
        p2.font.size = Pt(14)
        p2.font.bold = True
        p2.font.color.rgb = C_LIGHT_TEXT_TITLE
        p2.space_before = Pt(3)

        for pt in points:
            p_bullet = tf.add_paragraph()
            p_bullet.text = f"•  {pt}"
            p_bullet.font.name = FONT_FAMILY
            p_bullet.font.size = Pt(10.5)
            p_bullet.font.color.rgb = C_LIGHT_TEXT_BODY
            p_bullet.space_before = Pt(8)

    add_footer(s7, 7, 12, dark=False)

    # =========================================================================
    # SLIDE 8: Market Data Ingestion & Sanitization Pipeline
    # =========================================================================
    s8 = prs.slides.add_slide(blank_layout)
    set_background(s8, dark=False)
    add_slide_header(
        s8,
        "Data Ingestion & Outlier Sanitization",
        "Data Infrastructure",
        "Deterministic multi-asset pipeline built specifically for Indian equities, derivatives, and macro feeds",
    )

    steps_s8 = [
        (
            "Step 1",
            "Multi-Asset Ingestion",
            "NSE/BSE equities, F&O option chains, Bhavcopy delivery percentages, and USD/INR macro feeds ingested via Python MCP Server plugins.",
            C_BLUE,
        ),
        (
            "Step 2",
            "Hampel Outlier Filter",
            "Scipy rolling median filter detects >3σ flash spikes, circuit-breaker price freezes, and data feed anomalies, tagging them in metadata.",
            C_EMERALD,
        ),
        (
            "Step 3",
            "Calendar Alignment",
            "Reconciles cross-asset trading calendars (e.g., US holiday market closures vs Indian trading sessions) with deterministic forward-fill.",
            C_AMBER,
        ),
        (
            "Step 4",
            "Point-in-Time Guard",
            "Mandatory `as_of` timestamp filter strictly prunes all observations occurring after the backtest cut-off, preventing lookahead leakage.",
            C_VIOLET,
        ),
    ]

    for i, (s_num, s_title, s_desc, col) in enumerate(steps_s8):
        c_top = Inches(1.8 + i * 1.25)
        add_card_box(s8, Inches(0.8), c_top, Inches(11.733), Inches(1.15))

        # Step Circle / Badge
        badge = s8.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.1), c_top + Inches(0.22), Inches(1.0), Inches(0.7)
        )
        badge.fill.solid()
        badge.fill.fore_color.rgb = col
        badge.line.fill.background()

        tb_b = s8.shapes.add_textbox(Inches(1.1), c_top + Inches(0.25), Inches(1.0), Inches(0.6))
        p_b = tb_b.text_frame.paragraphs[0]
        p_b.alignment = PP_ALIGN.CENTER
        p_b.text = s_num.upper()
        p_b.font.name = FONT_FAMILY_HEAD
        p_b.font.size = Pt(11)
        p_b.font.bold = True
        p_b.font.color.rgb = RGBColor(255, 255, 255)

        tb_t = s8.shapes.add_textbox(Inches(2.35), c_top + Inches(0.12), Inches(9.9), Inches(0.95))
        tf = tb_t.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = s_title
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(13)
        p1.font.bold = True
        p1.font.color.rgb = C_LIGHT_TEXT_TITLE

        p2 = tf.add_paragraph()
        p2.text = s_desc
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(10.5)
        p2.font.color.rgb = C_LIGHT_TEXT_BODY
        p2.space_before = Pt(3)

    add_footer(s8, 8, 12, dark=False)

    # =========================================================================
    # SLIDE 9: End-to-End System Execution Flow
    # =========================================================================
    s9 = prs.slides.add_slide(blank_layout)
    set_background(s9, dark=False)
    add_slide_header(
        s9,
        "End-to-End System Execution Flow",
        "System Lifecycle",
        "From query trigger to 1-page Executive Digest Card: Complete lifecycle of a forecast run",
    )

    flows_s9 = [
        (
            "01",
            "Trigger & Handshake",
            "CLI or Scheduled Cron initiates run. Parallel health probes verify DB, Redis, Docker, and MCP servers in < 200ms.",
            C_BLUE,
        ),
        (
            "02",
            "Data & Feature Prep",
            "Multi-series feeds ingested, Hampel filter sanitizes anomalies, and sub-agents generate Python feature pipelines.",
            C_EMERALD,
        ),
        (
            "03",
            "4-Round Debate Loop",
            "Agents execute models in explore sandbox, challenge peer claims, assign Devil's Advocate, and compute consensus.",
            C_AMBER,
        ),
        (
            "04",
            "M8 Oracle Validation",
            "Winning model scripts run in clean cold-tier container (`--network=none`). M8 computes MASE, Brier score, and Sortino.",
            C_VIOLET,
        ),
        (
            "05",
            "Executive Digest Card",
            "1-page decision card generated. 15-minute bar invalidation guardrail prevents false alarms on intraday liquidity wicks.",
            C_BLUE,
        ),
    ]

    for i, (num, title, desc, col) in enumerate(flows_s9):
        c_top = Inches(1.8 + i * 1.0)
        add_card_box(s9, Inches(0.8), c_top, Inches(11.733), Inches(0.88))

        # Color bar
        ind = s9.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), c_top, Inches(0.12), Inches(0.88))
        ind.fill.solid()
        ind.fill.fore_color.rgb = col
        ind.line.fill.background()

        # Step tag
        tag = add_card_box(
            s9, Inches(1.1), c_top + Inches(0.18), Inches(0.6), Inches(0.5), bg_color=C_LIGHT_CARD_ALT, border_color=col
        )
        tf_tag = tag.text_frame
        tf_tag.vertical_anchor = MSO_ANCHOR.MIDDLE
        p_tag = tf_tag.paragraphs[0]
        p_tag.alignment = PP_ALIGN.CENTER
        p_tag.text = num
        p_tag.font.name = FONT_FAMILY_HEAD
        p_tag.font.size = Pt(11)
        p_tag.font.bold = True
        p_tag.font.color.rgb = col

        tb = s9.shapes.add_textbox(Inches(1.9), c_top + Inches(0.12), Inches(10.4), Inches(0.65))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = f"{title}: "
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(11.5)
        p1.font.bold = True
        p1.font.color.rgb = C_LIGHT_TEXT_TITLE

        p1.text += desc
        p1.font.name = FONT_FAMILY
        p1.font.bold = False
        p1.font.color.rgb = C_LIGHT_TEXT_BODY

    add_footer(s9, 9, 12, dark=False)

    # =========================================================================
    # SLIDE 10: Unit Economics & Open-Source Stack
    # =========================================================================
    s10 = prs.slides.add_slide(blank_layout)
    set_background(s10, dark=False)
    add_slide_header(
        s10,
        "Unit Economics & Open-Source Foundation",
        "Economics & Infra",
        "Institutional-grade quantitative intelligence delivered at a marginal cost of under 2.5 cents per run",
    )

    # Left: Unit Economics Card
    add_card_box(s10, Inches(0.8), Inches(1.8), Inches(5.6), Inches(4.9))
    bar_e = s10.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.8), Inches(5.6), Inches(0.08))
    bar_e.fill.solid()
    bar_e.fill.fore_color.rgb = C_EMERALD
    bar_e.line.fill.background()

    tb_e = s10.shapes.add_textbox(Inches(1.1), Inches(2.05), Inches(5.0), Inches(4.4))
    tf_e = tb_e.text_frame
    tf_e.word_wrap = True

    p = tf_e.paragraphs[0]
    p.text = "Unit Cost Breakdown"
    p.font.name = FONT_FAMILY_HEAD
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_LIGHT_TEXT_TITLE

    # Big Number Callout
    p_cost = tf_e.add_paragraph()
    p_cost.text = "$0.024"
    p_cost.font.name = FONT_FAMILY_HEAD
    p_cost.font.size = Pt(36)
    p_cost.font.bold = True
    p_cost.font.color.rgb = C_EMERALD
    p_cost.space_before = Pt(4)

    p_cost_lbl = tf_e.add_paragraph()
    p_cost_lbl.text = "Total Marginal Cost per 4-Round Debate Run"
    p_cost_lbl.font.name = FONT_FAMILY
    p_cost_lbl.font.size = Pt(11)
    p_cost_lbl.font.color.rgb = C_LIGHT_TEXT_MUTED

    econ_items = [
        ("LLM Inference (DeepSeek)", "4 rounds x 4 agents = 16 turns (~65k prompt tokens, 8k output tokens) = $0.018"),
        ("Docker Sandbox Compute", "0.2 CPU-hours of execution time = $0.004"),
        ("News & Web Scraping", "Open-source DuckDuckGo & FinBERT = $0.000"),
        ("Storage & Tracing", "Postgres + Redis + Langfuse = $0.002"),
    ]
    for k, v in econ_items:
        p_item = tf_e.add_paragraph()
        p_item.text = f"• {k}: {v}"
        p_item.font.name = FONT_FAMILY
        p_item.font.size = Pt(10)
        p_item.font.color.rgb = C_LIGHT_TEXT_BODY
        p_item.space_before = Pt(6)

    # Right: Open Source Stack Card
    add_card_box(s10, Inches(6.8), Inches(1.8), Inches(5.733), Inches(4.9))
    bar_s = s10.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(6.8), Inches(1.8), Inches(5.733), Inches(0.08))
    bar_s.fill.solid()
    bar_s.fill.fore_color.rgb = C_BLUE
    bar_s.line.fill.background()

    tb_s = s10.shapes.add_textbox(Inches(7.1), Inches(2.05), Inches(5.133), Inches(4.4))
    tf_s = tb_s.text_frame
    tf_s.word_wrap = True

    p = tf_s.paragraphs[0]
    p.text = "100% Open-Source Foundation"
    p.font.name = FONT_FAMILY_HEAD
    p.font.size = Pt(16)
    p.font.bold = True
    p.font.color.rgb = C_LIGHT_TEXT_TITLE

    p_sub = tf_s.add_paragraph()
    p_sub.text = "Zero proprietary vendor lock-in; deployable on private enterprise VPCs"
    p_sub.font.name = FONT_FAMILY
    p_sub.font.size = Pt(11)
    p_sub.font.color.rgb = C_BLUE
    p_sub.space_before = Pt(2)

    stack_rows = [
        ("Orchestrator Layer", "@langchain/langgraph & TypeScript StateGraph"),
        ("Data Protocol", "Python Model Context Protocol (MCP) + yfinance"),
        ("Compute Sandboxes", "Docker Engine with cgroups memory isolation"),
        ("Evaluation Core", "scipy, statsmodels, pandas, scikit-learn"),
        ("Observability", "Langfuse Open-Source Tracing + UUIDv7 Hierarchy"),
        ("Database & Cache", "PostgreSQL with temporal as_of indexing + Redis"),
    ]
    for cat, tech in stack_rows:
        p_item = tf_s.add_paragraph()
        p_item.text = f"• {cat}: "
        p_item.font.name = FONT_FAMILY_HEAD
        p_item.font.size = Pt(10.5)
        p_item.font.bold = True
        p_item.font.color.rgb = C_LIGHT_TEXT_TITLE
        p_item.space_before = Pt(8)

        p_item.text += tech
        p_item.font.name = FONT_FAMILY
        p_item.font.bold = False
        p_item.font.color.rgb = C_LIGHT_TEXT_BODY

    add_footer(s10, 10, 12, dark=False)

    # =========================================================================
    # SLIDE 11: Multi-Industry Skill Expansion Roadmap
    # =========================================================================
    s11 = prs.slides.add_slide(blank_layout)
    set_background(s11, dark=False)
    add_slide_header(
        s11,
        "Beyond Equities: Multi-Industry Expansion",
        "Market Horizon",
        "The platform adapts: Financial forecasting is just the initial skill pack in an expanding enterprise ecosystem",
    )

    phases_s11 = [
        (
            "Phase 1",
            "Financial Markets",
            "INDIAN EQUITIES (MVP 1)",
            [
                "Nifty 50, Bank Nifty, and liquid F&O equities",
                "FII/DII liquidity and sentiment flow modeling",
                "Daily 1-page Executive Digest Card delivery",
            ],
            C_BLUE,
        ),
        (
            "Phase 2",
            "Supply Chain & Ops",
            "DEMAND & LEAD TIME",
            [
                "Multi-echelon Bill of Materials (BOM) forecasting",
                "Port congestion and supplier lead time variance",
                "Warehouse safety stock and reorder point optimization",
            ],
            C_EMERALD,
        ),
        (
            "Phase 3",
            "Energy & Commodities",
            "LOAD & SPREAD FORECASTS",
            [
                "Weather-adjusted renewable power grid load",
                "Crude oil, diesel, and natural gas crack spreads",
                "Carbon credit supply/demand equilibrium curves",
            ],
            C_AMBER,
        ),
        (
            "Phase 4",
            "Enterprise FP&A",
            "REVENUE & CASH RUNWAY",
            [
                "Autonomous ERP connector ingestion (SAP/NetSuite)",
                "ARR churn and expansion scenario modeling",
                "Rolling 13-week operating cash flow forecasting",
            ],
            C_VIOLET,
        ),
    ]

    for i, (p_num, p_name, p_tag, points, col) in enumerate(phases_s11):
        c_left = Inches(0.8 + i * 3.0)
        add_card_box(s11, c_left, Inches(1.8), Inches(2.75), Inches(4.9))

        bar = s11.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, Inches(1.8), Inches(2.75), Inches(0.08))
        bar.fill.solid()
        bar.fill.fore_color.rgb = col
        bar.line.fill.background()

        tb = s11.shapes.add_textbox(c_left + Inches(0.2), Inches(2.05), Inches(2.35), Inches(4.5))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = f"{p_num.upper()} • {p_tag}"
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(8.5)
        p1.font.bold = True
        p1.font.color.rgb = col

        p2 = tf.add_paragraph()
        p2.text = p_name
        p2.font.name = FONT_FAMILY_HEAD
        p2.font.size = Pt(13.5)
        p2.font.bold = True
        p2.font.color.rgb = C_LIGHT_TEXT_TITLE
        p2.space_before = Pt(3)

        for pt in points:
            p_bullet = tf.add_paragraph()
            p_bullet.text = f"•  {pt}"
            p_bullet.font.name = FONT_FAMILY
            p_bullet.font.size = Pt(10)
            p_bullet.font.color.rgb = C_LIGHT_TEXT_BODY
            p_bullet.space_before = Pt(8)

    add_footer(s11, 11, 12, dark=False)

    # =========================================================================
    # SLIDE 12: Summary & MVP 1 Milestones (Dark Theme Conclusion)
    # =========================================================================
    s12 = prs.slides.add_slide(blank_layout)
    set_background(s12, dark=True)
    add_slide_header(
        s12,
        "Why Forecasting Agent Wins",
        "Investment Summary",
        "Combining the rigor of quantitative finance with the flexibility of generative coding agents",
        dark=True,
    )

    takeaways_s12 = [
        (
            "01",
            "Code Beats Chat",
            "Agents write and execute real statistical Python code instead of guessing next-token probability distributions.",
            C_BLUE,
        ),
        (
            "02",
            "Adversarial Calibration",
            "4-round debate with dedicated Devil's Advocate role systematically eliminates herd bias and sycophancy.",
            C_EMERALD,
        ),
        (
            "03",
            "Immutable Ground Truth",
            "M8 Oracle prevents overfitting, lookahead bias, and cheating via purged walk-forward cross-validation gates.",
            C_AMBER,
        ),
        (
            "04",
            "100x Cost Efficiency",
            "At $0.024 per forecast run, institutional-grade multi-agent analysis is 100x cheaper than manual human labor.",
            C_VIOLET,
        ),
    ]

    for i, (num, title, desc, col) in enumerate(takeaways_s12):
        row = i // 2
        col_idx = i % 2
        c_left = Inches(0.8 + col_idx * 6.0)
        c_top = Inches(1.8 + row * 2.3)

        add_card_box(s12, c_left, c_top, Inches(5.733), Inches(2.05), bg_color=C_DARK_CARD, border_color=C_DARK_BORDER)

        ind = s12.shapes.add_shape(MSO_SHAPE.RECTANGLE, c_left, c_top, Inches(0.12), Inches(2.05))
        ind.fill.solid()
        ind.fill.fore_color.rgb = col
        ind.line.fill.background()

        tb = s12.shapes.add_textbox(c_left + Inches(0.3), c_top + Inches(0.2), Inches(5.15), Inches(1.65))
        tf = tb.text_frame
        tf.word_wrap = True

        p1 = tf.paragraphs[0]
        p1.text = f"{num}  {title}"
        p1.font.name = FONT_FAMILY_HEAD
        p1.font.size = Pt(15)
        p1.font.bold = True
        p1.font.color.rgb = C_DARK_TEXT_TITLE

        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.name = FONT_FAMILY
        p2.font.size = Pt(11.5)
        p2.font.color.rgb = C_DARK_TEXT_BODY
        p2.space_before = Pt(6)

    # Bottom Status Banner
    bot_card = add_card_box(
        s12, Inches(0.8), Inches(6.25), Inches(11.733), Inches(0.55), bg_color=C_DARK_CARD_ALT, border_color=C_BLUE
    )
    tb_bot = s12.shapes.add_textbox(Inches(1.0), Inches(6.28), Inches(11.333), Inches(0.48))
    tf_bot = tb_bot.text_frame
    p_b = tf_bot.paragraphs[0]
    p_b.text = "MILESTONE STATUS: MVP 1 (Indian Equities) • 10 User Stories Tracked on GitHub • Target Alpha Release: v0.1.0-alpha"
    p_b.font.name = FONT_FAMILY_HEAD
    p_b.font.size = Pt(10)
    p_b.font.bold = True
    p_b.font.color.rgb = C_CYAN

    add_footer(s12, 12, 12, dark=True)

    # Save presentation
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    prs.save(output_path)


if __name__ == "__main__":
    build_presentation("docs/Forecasting_Agent_Pitch_Deck.pptx")
