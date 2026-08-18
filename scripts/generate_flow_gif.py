# Renders an animated GIF tracing one forecast run stage by stage, from input symbol to persisted signal.

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

Font = ImageFont.FreeTypeFont | ImageFont.ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "forecast-run-flow.gif"

W, H = 1280, 760
COLS, BOX_W, BOX_H = 4, 268, 104
GAP_X, GAP_Y = 40, 74
LEFT, TOP = 44, 150

BG = (13, 20, 22)
PANEL = (19, 30, 32)
DIM_FILL = (22, 34, 37)
DIM_EDGE = (36, 54, 58)
DIM_TEXT = (110, 133, 139)
HEAD_TEXT = (228, 236, 236)
MUTED = (125, 146, 152)
TS = (79, 195, 207)
PY = (224, 144, 78)
TS_FILL = (17, 51, 56)
PY_FILL = (56, 36, 20)


@dataclass(frozen=True)
class Stage:
    """One step of a real forecast run: where it executes, what it hands on, and the code that proves it."""

    title: str
    where: str
    lang: str
    payload: str
    cite: str


# Ordered from the entry script through to the persisted signal; each cite is a real file:line in this repo.
STAGES: list[Stage] = [
    Stage("Input", "run-real-pipeline.ts", "TS", "symbol + as_of date", "harness/scripts/run-real-pipeline.ts"),
    Stage(
        "Resolve capability", "capabilities/registry.ts", "TS", "market_data -> MCP stdio spawn", "single-agent.ts:93"
    ),
    Stage("Market data tool", "data_server/server.py", "PY", "fetch_ohlcv(symbol, start, end, as_of)", "server.py:100"),
    Stage("Pick plugin", "plugins/angelone.py", "PY", "authenticated vendor request", "registry.py resolve()"),
    Stage("Cache & normalize", "cache · normalizer", "PY", "raw OHLCV bars", "cache.py · normalizer.py"),
    Stage("Cut at as_of", "point_in_time.py", "PY", "leak-free bars (LeakageError if not)", "point_in_time.py"),
    Stage(
        "Search, metered", "search/capability.ts", "TS", "allowlisted results, per-run budget", "search/capability.ts"
    ),
    Stage("Agent turn", "pipeline/agent-turn.ts", "TS", "bars · flows · microstructure -> signal", "agent-turn.ts"),
    Stage("Write model script", "deepagents-adapter.ts", "TS", "model.py into run workspace", "single-agent.ts:137"),
    Stage("Validate tier", "sandbox/manager.ts", "TS", "Docker run, --network none", "manager.ts:110"),
    Stage("Score it", "evaluation/pipeline.py", "PY", "gate -> folds -> MASE · Brier · Sortino", "pipeline.py:16"),
    Stage("Persist", "storage/repository.ts", "TS", "direction · probability · confidence", "single-agent.ts:170"),
]

FONT_DIRS = ["/usr/share/fonts/dejavu-sans-fonts", "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu"]
MONO_DIRS = ["/usr/share/fonts/adwaita-mono-fonts", "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/liberation"]


def load_font(names: list[str], dirs: list[str], size: int) -> Font:
    """Takes candidate font filenames, directories to search, and a size; returns the first that loads."""
    for d in dirs:
        for n in names:
            p = Path(d) / n
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default(size)


F_TITLE = load_font(["DejaVuSans-Bold.ttf"], FONT_DIRS, 27)
F_SUB = load_font(["DejaVuSans.ttf"], FONT_DIRS, 15)
F_BOX = load_font(["DejaVuSans-Bold.ttf"], FONT_DIRS, 16)
F_WHERE = load_font(["AdwaitaMono-Regular.ttf", "DejaVuSansMono.ttf", "LiberationMono-Regular.ttf"], MONO_DIRS, 13)
F_STEP = load_font(["AdwaitaMono-Bold.ttf", "DejaVuSansMono-Bold.ttf", "LiberationMono-Bold.ttf"], MONO_DIRS, 14)
F_CAP = load_font(["DejaVuSans-Bold.ttf"], FONT_DIRS, 21)
F_CITE = load_font(["AdwaitaMono-Regular.ttf", "DejaVuSansMono.ttf", "LiberationMono-Regular.ttf"], MONO_DIRS, 13)


def box_at(i: int) -> tuple[int, int, int, int]:
    """Takes a stage index; returns its box rectangle, laid out left-to-right and wrapped into rows."""
    row, col = divmod(i, COLS)
    x = LEFT + col * (BOX_W + GAP_X)
    y = TOP + row * (BOX_H + GAP_Y)
    return x, y, x + BOX_W, y + BOX_H


def accent(stage: Stage) -> tuple[tuple[int, int, int], tuple[int, int, int]]:
    """Takes a stage; returns its (line colour, fill colour) according to which language runs it."""
    return (TS, TS_FILL) if stage.lang == "TS" else (PY, PY_FILL)


def arrow(d: ImageDraw.ImageDraw, pts: list[tuple[int, int]], colour: tuple[int, int, int], width: int) -> None:
    """Takes a polyline and a colour; draws it with a filled arrowhead on the final segment."""
    d.line(pts, fill=colour, width=width, joint="curve")
    (x0, y0), (x1, y1) = pts[-2], pts[-1]
    if x1 == x0:
        s = 1 if y1 > y0 else -1
        d.polygon([(x1, y1), (x1 - 7, y1 - 11 * s), (x1 + 7, y1 - 11 * s)], fill=colour)
    else:
        s = 1 if x1 > x0 else -1
        d.polygon([(x1, y1), (x1 - 11 * s, y1 - 7), (x1 - 11 * s, y1 + 7)], fill=colour)


def connector(i: int) -> list[tuple[int, int]]:
    """Takes the index of the stage being entered; returns the polyline carrying flow into it from the one before."""
    _, ay0, ax1, ay1 = box_at(i - 1)
    bx0, by0, _, by1 = box_at(i)
    if i % COLS:
        return [(ax1 + 4, (ay0 + ay1) // 2), (bx0 - 6, (by0 + by1) // 2)]
    lane = ay1 + GAP_Y // 2
    return [
        (ax1 + 4, (ay0 + ay1) // 2),
        (ax1 + 22, (ay0 + ay1) // 2),
        (ax1 + 22, lane),
        (bx0 + 30, lane),
        (bx0 + 30, by0 - 6),
    ]


def fit(text: str, font: Font, width: int) -> str:
    """Takes a string, its font, and an available width; returns it trimmed with an ellipsis if it would overflow."""
    if font.getlength(text) <= width:
        return text
    while text and font.getlength(text + "…") > width:
        text = text[:-1]
    return text + "…"


def draw_box(d: ImageDraw.ImageDraw, i: int, stage: Stage, active: bool, done: bool) -> None:
    """Takes a stage and whether it is current or already passed; draws its box at the matching emphasis."""
    x0, y0, x1, y1 = box_at(i)
    line, fill = accent(stage)
    if active:
        d.rounded_rectangle([x0 - 3, y0 - 3, x1 + 3, y1 + 3], 8, outline=line, width=3, fill=fill)
    else:
        d.rounded_rectangle([x0, y0, x1, y1], 6, outline=line if done else DIM_EDGE, width=1, fill=DIM_FILL)

    text = HEAD_TEXT if active else (MUTED if done else DIM_TEXT)
    tag = line if active or done else DIM_EDGE
    d.rounded_rectangle([x1 - 46, y0 + 14, x1 - 14, y0 + 34], 4, outline=tag, width=1)
    d.text((x1 - 40, y0 + 17), stage.lang, font=F_WHERE, fill=tag)
    d.text((x0 + 16, y0 + 17), f"{i + 1:02d}", font=F_STEP, fill=tag)
    d.text((x0 + 48, y0 + 32), fit(stage.title, F_BOX, BOX_W - 62), font=F_BOX, fill=text)
    d.text((x0 + 48, y0 + 60), fit(stage.where, F_WHERE, BOX_W - 62), font=F_WHERE, fill=line if active else DIM_TEXT)


def frame(active_index: int) -> Image.Image:
    """Takes the index of the stage to highlight; returns one fully rendered frame."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    stage = STAGES[active_index]
    line, _ = accent(stage)

    d.text((44, 40), "One forecast run, end to end", font=F_TITLE, fill=HEAD_TEXT)
    subtitle = "Teal runs in the TypeScript harness · amber runs in Python · every hop cited to real code"
    d.text((44, 78), subtitle, font=F_SUB, fill=MUTED)
    d.line([(44, 116), (W - 44, 116)], fill=DIM_EDGE, width=1)

    for i in range(1, len(STAGES)):
        passed = i <= active_index
        arrow(d, connector(i), accent(STAGES[i])[0] if passed else DIM_EDGE, 3 if i == active_index else 2)
    for i, s in enumerate(STAGES):
        draw_box(d, i, s, i == active_index, i < active_index)

    d.rectangle([0, H - 96, W, H], fill=PANEL)
    d.line([(0, H - 96), (W, H - 96)], fill=line, width=2)
    d.text((44, H - 76), f"STEP {active_index + 1:02d}/{len(STAGES):02d}", font=F_STEP, fill=line)
    d.text((160, H - 79), "carries", font=F_WHERE, fill=MUTED)
    d.text((236, H - 82), fit(stage.payload, F_CAP, W - 280), font=F_CAP, fill=HEAD_TEXT)
    d.text((236, H - 46), stage.cite, font=F_CITE, fill=MUTED)
    return img


def build(out: Path) -> None:
    """Takes an output path; writes the animated GIF of every stage in order."""
    frames = [frame(i).convert("P", palette=Image.Palette.ADAPTIVE, colors=64) for i in range(len(STAGES))]
    durations = [1500] * len(frames)
    durations[0] = 2200
    durations[-1] = 3000
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)


if __name__ == "__main__":
    build(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB, {len(STAGES)} frames)")
