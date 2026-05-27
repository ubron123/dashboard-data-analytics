import base64
import json
import os
from flask import Flask, jsonify, render_template, request
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

app = Flask(__name__)

df = pd.read_csv("openings.csv")
df = df.reset_index(drop=True)

THEME = {
    "bg": "#0b0d12",
    "bg2": "#14171f",
    "accent": "#d4af6a",
    "accent_soft": "#e8c98a",
    "purple": "#3a8c7a",
    "white_win": "#4ade80",
    "black_win": "#f87171",
    "draw": "#fbbf24",
    "text": "#f2ece1",
    "muted": "#8a8676",
}

META = {
    "games_min": int(df["Num Games"].min()),
    "games_max": int(df["Num Games"].max()),
    "white_min": float(df["White_win%"].min()),
    "white_max": float(df["White_win%"].max()),
    "rating_min": int(df["Avg Player"].min()),
    "rating_max": int(df["Avg Player"].max()),
    "eco_codes": sorted(df["ECO"].dropna().astype(str).unique().tolist()),
}

# ── Skill-level buckets (maps label → (min, max) avg-player rating) ──────────
SKILL_LEVELS = {
    "all":          (0,    9999),
    "beginner":     (0,    1000),
    "intermediate": (1000, 1600),
    "advanced":     (1600, 2200),
    "master":       (2200, 9999),
}

# ── Opening-bias thresholds ───────────────────────────────────────────────────
BIAS_DRAW_PCT   = 40   # draw% above this → "drawish"
BIAS_MARGIN_PCT = 8    # |white% - black%| above this → "favored"


def _classify_bias(row) -> str:
    """Return one of: white_favored | black_favored | balanced | drawish."""
    w, b, d = row["White_win%"], row["Black_win%"], row["Draw %"]
    if d >= BIAS_DRAW_PCT:
        return "drawish"
    diff = w - b
    if diff > BIAS_MARGIN_PCT:
        return "white_favored"
    if diff < -BIAS_MARGIN_PCT:
        return "black_favored"
    return "balanced"


def _num(val, default, cast):
    """Parse a numeric filter value, falling back to default on null/empty/invalid input."""
    if val is None or val == "":
        return cast(default)
    try:
        return cast(val)
    except (TypeError, ValueError):
        return cast(default)


def _safe_str(v, fallback="—"):
    """Stringify a cell value, replacing NaN/None with a printable fallback (not 'nan')."""
    if v is None:
        return fallback
    if isinstance(v, float) and pd.isna(v):
        return fallback
    s = str(v)
    return fallback if s.lower() == "nan" else s


def apply_filters(data: pd.DataFrame, params: dict) -> pd.DataFrame:
    out = data.copy()

    # ── 1. Opening Search ─────────────────────────────────────────────────────
    search = (params.get("search") or "").strip().lower()
    if search:
        out = out[out["Opening"].str.lower().str.contains(search, na=False)]

    # ── 2. ECO Opening Family ─────────────────────────────────────────────────
    eco = params.get("eco") or ""
    if eco and eco != "all":
        out = out[out["ECO"].astype(str) == eco]

    # ── 3. Minimum Games Played ───────────────────────────────────────────────
    min_games = _num(params.get("min_games"), META["games_min"], int)
    out = out[out["Num Games"] >= min_games]

    # ── 4. Skill Level (replaces raw rating dual-slider) ─────────────────────
    skill = (params.get("skill_level") or "all").lower()
    if skill in SKILL_LEVELS and skill != "all":
        r_min, r_max = SKILL_LEVELS[skill]
        out = out[(out["Avg Player"] >= r_min) & (out["Avg Player"] < r_max)]
    else:
        # Backward-compat: honour raw rating_min/rating_max if sent by older clients
        r_min = _num(params.get("rating_min"), META["rating_min"], float)
        r_max = _num(params.get("rating_max"), META["rating_max"], float)
        if r_min > r_max:
            r_min, r_max = r_max, r_min
        out = out[(out["Avg Player"] >= r_min) & (out["Avg Player"] <= r_max)]

    # ── 5. Opening Bias (replaces white-win% dual-slider) ────────────────────
    bias = (params.get("opening_bias") or "all").lower()
    if bias and bias != "all":
        out = out[out.apply(_classify_bias, axis=1) == bias]
    else:
        # Backward-compat: honour raw white_min/white_max if sent
        w_min = _num(params.get("white_min"), META["white_min"], float)
        w_max = _num(params.get("white_max"), META["white_max"], float)
        if w_min > w_max:
            w_min, w_max = w_max, w_min
        out = out[(out["White_win%"] >= w_min) & (out["White_win%"] <= w_max)]

    return out


def compute_kpis(data: pd.DataFrame) -> dict:
    if data.empty:
        return {
            "total_openings": 0,
            "total_games": 0,
            "avg_white_win": 0,
            "avg_black_win": 0,
            "avg_draw": 0,
            "top_opening": "—",
            "top_opening_games": 0,
        }
    top = data.loc[data["Num Games"].idxmax()]
    return {
        "total_openings": len(data),
        "total_games": int(data["Num Games"].sum()),
        "avg_white_win": round(data["White_win%"].mean(), 2),
        "avg_black_win": round(data["Black_win%"].mean(), 2),
        "avg_draw": round(data["Draw %"].mean(), 2),
        "top_opening": _safe_str(top["Opening"]),
        "top_opening_games": int(top["Num Games"]),
    }


def scene_layout(title: str = "") -> dict:
    return dict(
        template="plotly_dark",
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(11,13,18,0.35)",
        font=dict(family="Inter, system-ui, sans-serif", color=THEME["muted"], size=11),
        title=dict(
            text=title,
            font=dict(
                family="Fraunces, Georgia, serif",
                size=15,
                color=THEME["text"],
            ),
            x=0,
        ),
        margin=dict(l=48, r=28, t=52, b=44),
        xaxis=dict(
            gridcolor="rgba(212,175,106,0.08)",
            zerolinecolor="rgba(212,175,106,0.15)",
            linecolor="rgba(212,175,106,0.2)",
            tickfont=dict(color=THEME["muted"]),
        ),
        yaxis=dict(
            gridcolor="rgba(212,175,106,0.08)",
            zerolinecolor="rgba(212,175,106,0.15)",
            linecolor="rgba(212,175,106,0.2)",
            tickfont=dict(color=THEME["muted"]),
        ),
        hoverlabel=dict(
            bgcolor="rgba(20,23,31,0.97)",
            bordercolor=THEME["accent"],
            font=dict(family="Fraunces, Georgia, serif", color=THEME["text"], size=13),
        ),
        transition=dict(duration=700, easing="cubic-in-out"),
    )


PLOTLY_CONFIG = {
    "responsive": True,
    "displayModeBar": True,
    "displaylogo": False,
    # 2D charts inherit scrollZoom: False to let the page scroll naturally.
    # The frontend (static/dashboard.js) re-applies a separate THREE_D_CFG
    # for the 3D scatter so wheel-zoom stays usable there.
    "scrollZoom": False,
    "modeBarButtonsToRemove": ["lasso2d", "select2d"],
}


def layout_3d(title: str = "") -> dict:
    lo = scene_layout(title)
    lo.pop("transition", None)
    lo.pop("xaxis", None)
    lo.pop("yaxis", None)
    lo.update(
        height=600,
        autosize=True,
        scene=dict(
            bgcolor="rgba(11,13,18,0.35)",
            dragmode="orbit",
            xaxis=dict(
                title="Avg Player Rating",
                gridcolor="rgba(212,175,106,0.18)",
                backgroundcolor="rgba(11,13,18,0.4)",
                color=THEME["muted"],
                showbackground=True,
            ),
            yaxis=dict(
                title="White Win %",
                gridcolor="rgba(58,140,122,0.22)",
                backgroundcolor="rgba(11,13,18,0.4)",
                color=THEME["muted"],
                showbackground=True,
            ),
            zaxis=dict(
                title="Draw %",
                gridcolor="rgba(251,191,36,0.15)",
                backgroundcolor="rgba(11,13,18,0.4)",
                color=THEME["muted"],
                showbackground=True,
            ),
            camera=dict(eye=dict(x=1.8, y=1.8, z=1.4)),
        ),
        margin=dict(l=0, r=0, t=56, b=0),
    )
    return lo


# Plotly.py 6+ serializes numpy/pandas arrays as binary {bdata, dtype[, shape]}
# blobs. Plotly.js < 2.35 silently ignores them, leaving charts (notably the 3D
# scatter, where every coordinate vector is binary) rendering blank. Decode
# back to plain lists so the pinned client (2.27) can read them.
_BDATA_DTYPES = {
    "f4": np.float32, "f8": np.float64,
    "i1": np.int8, "i2": np.int16, "i4": np.int32, "i8": np.int64,
    "u1": np.uint8, "u2": np.uint16, "u4": np.uint32, "u8": np.uint64,
}


def _decode_plotly_binary(node):
    if isinstance(node, dict):
        if "bdata" in node and "dtype" in node:
            dtype = _BDATA_DTYPES.get(node["dtype"])
            if dtype is not None:
                buf = base64.b64decode(node["bdata"])
                arr = np.frombuffer(buf, dtype=dtype)
                shape = node.get("shape")
                if shape:
                    if isinstance(shape, str):
                        shape = tuple(int(x) for x in shape.split(","))
                    arr = arr.reshape(shape)
                return arr.tolist()
        return {k: _decode_plotly_binary(v) for k, v in node.items()}
    if isinstance(node, list):
        return [_decode_plotly_binary(x) for x in node]
    return node


def fig_json(fig) -> dict:
    """Convert a Plotly Figure to a JSON-serializable dict with plain-array data."""
    if isinstance(fig, dict):
        return _decode_plotly_binary(fig)
    if hasattr(fig, "to_json"):
        return _decode_plotly_binary(json.loads(fig.to_json()))
    raise TypeError(f"Expected Plotly Figure or dict, got {type(fig).__name__}")


def chart_3d_scatter(data: pd.DataFrame) -> go.Figure:
    if data.empty:
        fig = go.Figure()
        fig.update_layout(**layout_3d(""))
        fig.add_annotation(
            text="No data for current filters",
            showarrow=False,
            font=dict(color=THEME["muted"], size=14),
            xref="paper",
            yref="paper",
            x=0.5,
            y=0.5,
        )
        return fig

    sample = data.nlargest(300, "Num Games") if len(data) > 300 else data.copy()
    max_g = sample["Num Games"].max() or 1
    sizes = np.clip(sample["Num Games"] / max_g * 18 + 5, 5, 22)

    fig = go.Figure(
        data=[
            go.Scatter3d(
                x=sample["Avg Player"],
                y=sample["White_win%"],
                z=sample["Draw %"],
                mode="markers",
                text=sample["Opening"],
                customdata=sample.index.astype(int).tolist(),
                marker=dict(
                    size=sizes,
                    color=sample["White_win%"],
                    colorscale=[
                        [0, THEME["black_win"]],
                        [0.5, THEME["accent"]],
                        [1, THEME["white_win"]],
                    ],
                    opacity=0.95,
                    line=dict(width=0.8, color="rgba(242,236,225,0.35)"),
                    colorbar=dict(
                        title=dict(text="White win %", font=dict(color=THEME["muted"])),
                        thickness=12,
                        tickfont=dict(color=THEME["muted"], size=10),
                        outlinewidth=0,
                    ),
                ),
                hovertemplate=(
                    "<b>%{text}</b><br>"
                    "Rating: %{x:.0f}<br>"
                    "White win: %{y:.1f}%<br>"
                    "Draw: %{z:.1f}%<br>"
                    "<extra></extra>"
                ),
            )
        ]
    )
    fig.update_layout(**layout_3d(""))
    return fig


def chart_popular(data: pd.DataFrame) -> go.Figure:
    top = data.nlargest(10, "Num Games") if not data.empty else data
    if top.empty:
        fig = go.Figure()
        fig.update_layout(**scene_layout(""))
        return fig

    fig = px.bar(
        top,
        x="Num Games",
        y="Opening",
        orientation="h",
        color="Num Games",
        color_continuous_scale=[THEME["purple"], THEME["accent"]],
    )
    fig.update_layout(**scene_layout())
    fig.update_yaxes(autorange="reversed", tickfont=dict(color=THEME["text"], size=11))
    fig.update_traces(
        customdata=np.column_stack(
            [top.index, top["White_win%"], top["Black_win%"], top["Draw %"]]
        ),
        hovertemplate=(
            "<b>%{y}</b><br>Games: %{x:,}<br>"
            "White: %{customdata[1]:.1f}% | Black: %{customdata[2]:.1f}% | Draw: %{customdata[3]:.1f}%<extra></extra>"
        ),
        marker=dict(line=dict(width=0)),
    )
    fig.update_coloraxes(showscale=False)
    return fig
    


def chart_heatmap(data: pd.DataFrame) -> go.Figure:
    cols = ["Avg Player", "Perf Rating", "White_win%", "Black_win%", "Draw %", "Num Games"]
    if data.empty or len(data) < 3:
        fig = go.Figure()
        fig.update_layout(**scene_layout(""))
        return fig

    corr = data[cols].corr().round(2)
    fig = px.imshow(
        corr,
        text_auto=True,
        color_continuous_scale=[
            [0, "#1f4d44"],
            [0.35, THEME["purple"]],
            [0.65, THEME["accent_soft"]],
            [1, THEME["accent"]],
        ],
        aspect="auto",
    )
    fig.update_layout(**scene_layout())
    fig.update_traces(
        hovertemplate="<b>%{x}</b> × <b>%{y}</b><br>r = %{z:.2f}<extra></extra>",
        textfont=dict(family="Fraunces, Georgia, serif", color="#0b0d12", size=13),
    )
    return fig


def chart_win_rates(data: pd.DataFrame) -> go.Figure:
    """Grouped bar: White / Black / Draw % for the top-10 openings by volume."""
    top = data.nlargest(10, "Num Games") if not data.empty else data
    if top.empty:
        fig = go.Figure()
        fig.update_layout(**scene_layout(""))
        return fig

    names = [
        (n[:28] + "…") if len(n) > 28 else n
        for n in top["Opening"].tolist()
    ]

    fig = go.Figure()
    common = dict(x=names, marker=dict(line=dict(width=0)), opacity=0.9)
    fig.add_trace(go.Bar(name="White Win %", y=top["White_win%"],
                         marker_color=THEME["white_win"],
                         customdata=top.index.astype(int).tolist(),
                         hovertemplate="<b>%{x}</b><br>White win: %{y:.1f}%<extra></extra>",
                         **common))
    fig.add_trace(go.Bar(name="Black Win %", y=top["Black_win%"],
                         marker_color=THEME["black_win"],
                         customdata=top.index.astype(int).tolist(),
                         hovertemplate="<b>%{x}</b><br>Black win: %{y:.1f}%<extra></extra>",
                         **common))
    fig.add_trace(go.Bar(name="Draw %",      y=top["Draw %"],
                         marker_color=THEME["draw"],
                         customdata=top.index.astype(int).tolist(),
                         hovertemplate="<b>%{x}</b><br>Draw: %{y:.1f}%<extra></extra>",
                         **common))

    lo = scene_layout()
    # Merge xaxis overrides cleanly (scene_layout already sets tickfont inside xaxis)
    xaxis_base = lo.pop("xaxis", {}) or {}
    xaxis_base.update(tickangle=-32, tickfont=dict(size=9, color=THEME["muted"]))
    yaxis_base = lo.pop("yaxis", {}) or {}
    yaxis_base.update(title="% of games")
    lo.update(
        barmode="group",
        xaxis=xaxis_base,
        yaxis=yaxis_base,
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            font=dict(color=THEME["muted"], size=11),
        ),
        height=420,
    )
    fig.update_layout(**lo)
    return fig


def chart_win_distribution(data: pd.DataFrame) -> go.Figure:
    if data.empty:
        fig = go.Figure()
        fig.update_layout(**scene_layout(""))
        return fig

    aw = data["White_win%"].mean()
    ab = data["Black_win%"].mean()
    ad = data["Draw %"].mean()

    fig = go.Figure(
        data=[
            go.Pie(
                labels=["White wins", "Black wins", "Draws"],
                values=[aw, ab, ad],
                hole=0.62,
                marker=dict(
                    colors=[THEME["white_win"], THEME["black_win"], THEME["draw"]],
                    line=dict(color="#0b0d12", width=3),
                ),
                textinfo="label+percent",
                textfont=dict(family="Fraunces, Georgia, serif", color=THEME["text"], size=12),
                hovertemplate="<b>%{label}</b><br>%{percent}<br>Avg: %{value:.1f}%<extra></extra>",
                pull=[0.015, 0.015, 0.03],
            )
        ]
    )
    fig.update_layout(
        **scene_layout(""),
        showlegend=True,
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=-0.18,
            font=dict(color=THEME["muted"], size=11),
        ),
    )
    return fig


def generate_insights(data: pd.DataFrame) -> list:
    if data.empty:
        return ["The board sits empty under the current filters — loosen a slider to bring it back to life."]

    insights = []
    aw = data["White_win%"].mean()
    ab = data["Black_win%"].mean()
    ad = data["Draw %"].mean()

    if aw > ab + 1.5:
        insights.append("The white side enjoys a discernible edge across this selection.")
    elif ab > aw + 1.5:
        insights.append("Black holds the upper hand here — the first move is no guarantee.")
    else:
        insights.append("The colours run nearly even; the position itself, not its origin, decides the game.")

    if len(data) >= 10:
        corr = data["Avg Player"].corr(data["Draw %"])
        if corr and corr > 0.12:
            insights.append("As ratings climb, the draw line lengthens — mastery breeds caution.")
        elif corr and corr < -0.12:
            insights.append("Lower-rated arenas trade precision for sharpness; draws are scarce.")

    top = data.loc[data["Num Games"].idxmax()]
    top_name = _safe_str(top["Opening"], fallback="An unnamed line")
    short = top_name[:55] + ("…" if len(top_name) > 55 else "")
    insights.append(f'“{short}” reigns over the field by sheer volume of play.')

    top10 = data.nlargest(min(10, len(data)), "Num Games")
    if len(top10) >= 3 and top10["White_win%"].mean() < aw - 1:
        insights.append("Popularity and prosperity diverge — the crowded lines are not the most rewarding for White.")
    else:
        insights.append("The well-trodden lines also pay the rent — popularity tracks White's returns.")

    if "Sicilian" in top_name:
        insights.append("The Sicilian family continues its long dominion over modern opening theory.")

    if ad > 26:
        insights.append("Draws run high — the play here is patient, positional, and precise.")

    return insights[:6]


def opening_record(idx: int) -> dict | None:
    if idx not in df.index:
        return None
    row = df.loc[idx]
    moves = str(row.get("Moves", "") or "").strip()
    if not moves or moves == "nan":
        moves = "Move sequence not available"

    move_parts = moves.replace(".", " ").split()
    return {
        "index": int(idx),
        "opening": _safe_str(row["Opening"]),
        "eco": _safe_str(row.get("ECO")),
        "num_games": int(row["Num Games"]),
        "white_win": round(float(row["White_win%"]), 1),
        "black_win": round(float(row["Black_win%"]), 1),
        "draw": round(float(row["Draw %"]), 1),
        "avg_player": int(row["Avg Player"]),
        "perf_rating": int(row["Perf Rating"]) if pd.notna(row.get("Perf Rating")) else None,
        "moves": moves,
        "move_steps": move_parts[:24],
        "colour": _safe_str(row.get("Colour")),
    }


def build_payload(filtered: pd.DataFrame) -> dict:
    top10 = filtered.nlargest(10, "Num Games") if not filtered.empty else filtered
    figures = {
        "scatter3d": chart_3d_scatter(filtered),
        "popular":   chart_popular(filtered),
        "win_rates": chart_win_rates(filtered),
        "heatmap":   chart_heatmap(filtered),
        "win_dist":  chart_win_distribution(filtered),
    }
    return {
        "kpis": compute_kpis(filtered),
        "insights": generate_insights(filtered),
        "charts": {key: fig_json(fig) for key, fig in figures.items()},
        "openings": [
            {
                "index": int(i),
                "name":  _safe_str(r["Opening"]),
                "games": int(r["Num Games"]),
                "eco":   _safe_str(r["ECO"]),
            }
            for i, r in filtered.nlargest(50, "Num Games").iterrows()
        ],
        "count": len(filtered),
        "popular_indices": [int(i) for i in top10.index],
    }


def build_page_initial(filtered: pd.DataFrame) -> dict:
    """Light payload for HTML embed (charts loaded via API to keep page fast)."""
    payload = build_payload(filtered)
    return {
        "kpis": payload["kpis"],
        "insights": payload["insights"],
        "openings": payload["openings"],
        "count": payload["count"],
        "popular_indices": payload["popular_indices"],
    }


@app.route("/")
def dashboard():
    filtered = df
    return render_template(
        "index.html",
        meta=META,
        initial=build_page_initial(filtered),
    )


@app.route("/api/dashboard", methods=["POST"])
def api_dashboard():
    params = request.get_json(silent=True) or {}
    return jsonify(build_payload(apply_filters(df, params)))


@app.route("/api/opening/<int:idx>")
def api_opening(idx):
    record = opening_record(idx)
    if record is None:
        return jsonify({"error": "Not found"}), 404
    return jsonify(record)


@app.route("/api/compare", methods=["POST"])
def api_compare():
    """Return two opening records side-by-side for the comparison panel."""
    params = request.get_json(silent=True) or {}
    idx_a  = params.get("idx_a")
    idx_b  = params.get("idx_b")
    rec_a  = opening_record(int(idx_a)) if idx_a is not None else None
    rec_b  = opening_record(int(idx_b)) if idx_b is not None else None
    return jsonify({"a": rec_a, "b": rec_b})


@app.route("/api/openings_list")
def api_openings_list():
    """Return the full opening list (index + name + eco) for comparison dropdowns."""
    rows = (
        df[["Opening", "ECO", "Num Games"]]
        .dropna(subset=["Opening"])
        .nlargest(500, "Num Games")
    )
    return jsonify([
        {
            "index": int(i),
            "name":  _safe_str(r["Opening"]),
            "eco":   _safe_str(r["ECO"]),
        }
        for i, r in rows.iterrows()
    ])


if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1")
