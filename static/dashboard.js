/**
 * ChessIQ — Analytics Dashboard (v2)
 * Filter system: Opening Search · ECO Family · Min Games · Skill Level · Opening Bias
 * + Opening Comparison module
 */
(function () {
    const CHARTS = {
        scatter3d: "chart3d",
        popular:   "chartPopular",
        win_rates: "chartWinRates",
        heatmap:   "chartHeatmap",
        win_dist:  "chartWinDist",
    };

    const BASE_CFG = {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
    };
    const STANDARD_CFG  = { ...BASE_CFG, scrollZoom: false };
    const THREE_D_CFG   = { ...BASE_CFG, scrollZoom: true  };

    function cfgFor(key) {
        return key === "scatter3d" ? THREE_D_CFG : STANDARD_CFG;
    }

    let META          = {};
    let INITIAL       = {};
    let popularIndices = [];
    let debounceTimer  = null;
    let miniBoardCleanup = null;
    let initialized    = false;
    let currentAbort   = null;
    let compareAbort   = null;

    // Currently highlighted comparison indices (for chart overlays)
    let compareHighlightA = null;
    let compareHighlightB = null;

    // Full opening list for comparison dropdowns
    let allOpenings = [];

    // Modal a11y
    let modalOpen = false;
    let lastFocusedBeforeModal = null;
    let priorBodyOverflow = "";
    const FOCUSABLE_SEL =
        'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]),' +
        ' select:not([disabled]), textarea:not([disabled]), iframe, object, embed,' +
        ' [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

    function getModalFocusables() {
        const modal = $("#modalBackdrop .modal");
        if (!modal) return [];
        return Array.from(modal.querySelectorAll(FOCUSABLE_SEL)).filter(
            (el) => el.offsetParent !== null || el === document.activeElement
        );
    }

    function onModalKeydown(e) {
        if (!modalOpen) return;
        if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
        if (e.key !== "Tab") return;
        const focusables = getModalFocusables();
        if (!focusables.length) { e.preventDefault(); return; }
        const first = focusables[0], last = focusables[focusables.length - 1];
        const active = document.activeElement;
        const modalEl = $("#modalBackdrop .modal");
        if (!modalEl.contains(active)) { e.preventDefault(); first.focus(); return; }
        if (e.shiftKey && active === first)  { e.preventDefault(); last.focus();  }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }

    const $ = (s) => document.querySelector(s);

    // ─── Toast system ──────────────────────────────────────────────────────────
    const toastTimers = new Map();

    function getToastContainer() {
        let c = document.getElementById("toastContainer");
        if (!c) {
            c = document.createElement("div");
            c.id = "toastContainer";
            c.className = "toast-container";
            c.setAttribute("aria-live", "polite");
            c.setAttribute("aria-atomic", "false");
            document.body.appendChild(c);
        }
        return c;
    }

    function dismissToast(id) {
        const t = toastTimers.get(id);
        if (t) { clearTimeout(t.timer); toastTimers.delete(id); }
        const el = document.querySelector(`[data-toast-id="${id}"]`);
        if (!el) return;
        el.classList.remove("show");
        setTimeout(() => el.remove(), 280);
    }

    function notify(message, opts) {
        opts = opts || {};
        const id    = opts.id    || `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const level = opts.level || "error";
        const persistent = !!opts.persistent;
        const timeout = opts.timeout || 5500;
        const title = opts.title || (level === "error" ? "Something went wrong" : level === "warning" ? "Heads up" : "Notice");
        const icon  = level === "error" ? "⚠" : level === "warning" ? "!" : "i";
        const container = getToastContainer();
        let el = container.querySelector(`[data-toast-id="${id}"]`);
        if (el) {
            el.classList.remove("toast--error", "toast--warning", "toast--info");
            el.classList.add(`toast--${level}`);
            el.querySelector(".toast__icon").textContent  = icon;
            el.querySelector(".toast__title").textContent = title;
            el.querySelector(".toast__msg").textContent   = message;
            const existing = toastTimers.get(id);
            if (existing) clearTimeout(existing.timer);
        } else {
            el = document.createElement("div");
            el.className = `toast toast--${level}`;
            el.setAttribute("role", level === "error" ? "alert" : "status");
            el.setAttribute("data-toast-id", id);
            el.innerHTML =
                '<span class="toast__icon"></span>' +
                '<div class="toast__body"><p class="toast__title"></p><p class="toast__msg"></p></div>' +
                '<button type="button" class="toast__close" aria-label="Dismiss notification">×</button>';
            el.querySelector(".toast__icon").textContent  = icon;
            el.querySelector(".toast__title").textContent = title;
            el.querySelector(".toast__msg").textContent   = message;
            el.querySelector(".toast__close").onclick = () => dismissToast(id);
            container.appendChild(el);
            requestAnimationFrame(() => el.classList.add("show"));
        }
        if (!persistent) {
            const timer = setTimeout(() => dismissToast(id), timeout);
            toastTimers.set(id, { timer });
        } else {
            toastTimers.delete(id);
        }
        return id;
    }

    // ─── Utilities ─────────────────────────────────────────────────────────────
    function parseJsonScript(id, fallback) {
        const el = document.getElementById(id);
        if (!el) return fallback;
        try { return JSON.parse(el.textContent); }
        catch (e) { console.error(`Failed to parse #${id}:`, e); return fallback; }
    }

    function hideLoader() {
        const loader = document.getElementById("loader");
        if (loader) loader.classList.add("hidden");
        document.body.classList.add("app-ready");
    }
    function showLoader() {
        const loader = document.getElementById("loader");
        if (loader) loader.classList.remove("hidden");
    }
    function armLoaderTimeout(ms = 4000) { setTimeout(hideLoader, ms); }

    // ─── Filter state ──────────────────────────────────────────────────────────
    function getSkillLevel() {
        const active = document.querySelector(".skill-btn.active");
        return active ? (active.dataset.skill || "all") : "all";
    }

    function getFilters() {
        return {
            search:       $("#searchOpening")?.value  || "",
            eco:          $("#ecoCode")?.value         || "all",
            min_games:    +($("#minGames")?.value      || META.games_min || 0),
            skill_level:  getSkillLevel(),
            opening_bias: $("#openingBias")?.value     || "all",
        };
    }

    /** Count active (non-default) filters for the badge */
    function countActiveFilters() {
        let n = 0;
        if ($("#searchOpening")?.value.trim())                   n++;
        if ($("#ecoCode")?.value !== "all")                      n++;
        if (+( $("#minGames")?.value || 0) > (META.games_min||0)) n++;
        if (getSkillLevel() !== "all")                           n++;
        if ($("#openingBias")?.value !== "all")                  n++;
        return n;
    }

    function refreshFilterBadge() {
        const badge = $("#filterActiveCount");
        if (!badge) return;
        const n = countActiveFilters();
        badge.textContent = n > 0 ? `${n} active` : "";
        badge.style.display = n > 0 ? "inline" : "none";
    }

    // ─── KPIs ──────────────────────────────────────────────────────────────────
    function animateKpi(el, end, suffix) {
        if (el.classList.contains("kpi-value--text")) { el.textContent = end ?? "—"; return; }
        const num = parseFloat(end);
        if (isNaN(num)) { el.textContent = "0" + (suffix || ""); return; }
        const isFloat = String(end).includes(".");
        if (typeof gsap !== "undefined") {
            const obj = { v: 0 };
            gsap.to(obj, {
                v: num, duration: 1.2, ease: "power3.out",
                onUpdate() {
                    el.textContent = (isFloat ? obj.v.toFixed(2) : Math.round(obj.v).toLocaleString()) + (suffix || "");
                },
            });
        } else {
            el.textContent = (isFloat ? num.toFixed(2) : num.toLocaleString()) + (suffix || "");
        }
    }

    function updateKpis(kpis) {
        if (!kpis) return;
        document.querySelectorAll(".kpi-value").forEach((el) => {
            animateKpi(el, kpis[el.dataset.key], el.dataset.suffix || "");
        });
        const heroCount = $("#heroCount");
        if (heroCount) heroCount.textContent = kpis.total_openings ?? 0;
    }

    // ─── Insights ──────────────────────────────────────────────────────────────
    function renderInsights(list) {
        const grid = $("#insightsGrid");
        if (!grid || !list) return;
        grid.innerHTML = "";
        list.forEach((text, i) => {
            const card = document.createElement("article");
            card.className = "insight-card glass-3d";
            card.innerHTML = `<span class="insight-icon">✦</span><p>${text}</p>`;
            grid.appendChild(card);
            if (typeof gsap !== "undefined") {
                gsap.from(card, { opacity: 0, y: 20, duration: 0.5, delay: i * 0.07, ease: "power3.out" });
            }
        });
    }

    // ─── Opening list ──────────────────────────────────────────────────────────
    function renderOpeningList(openings) {
        const ul = $("#openingList");
        if (!ul || !openings) return;
        ul.innerHTML = "";
        openings.slice(0, 20).forEach((o) => {
            const li  = document.createElement("li");
            const btn = document.createElement("button");
            const label = o.name.length > 42 ? o.name.slice(0, 42) + "…" : o.name;
            btn.textContent = `${label} (${o.games})`;
            btn.type = "button";
            btn.onclick = () => openOpening(o.index);
            // Highlight if in comparison
            if (o.index === compareHighlightA) btn.classList.add("compare-highlight-a");
            if (o.index === compareHighlightB) btn.classList.add("compare-highlight-b");
            li.appendChild(btn);
            ul.appendChild(li);
        });
    }

    // ─── Chart rendering ───────────────────────────────────────────────────────
    function ensureLayout(fig, chartKey) {
        const layout = { ...(fig.layout || {}) };
        layout.autosize = true;
        layout.paper_bgcolor = layout.paper_bgcolor || "rgba(0,0,0,0)";
        layout.height = chartKey === "scatter3d" ? 600 : chartKey === "heatmap" ? 440 : 420;
        if (chartKey === "scatter3d" && layout.scene) layout.scene.dragmode = "orbit";
        return layout;
    }

    async function plotChart(chartKey, fig) {
        if (!window.Plotly || !fig) return;
        const domId = CHARTS[chartKey];
        const container = document.getElementById(domId);
        if (!container) return;

        const data   = fig.data   || [];
        const layout = ensureLayout(fig, chartKey);
        const cfg    = cfgFor(chartKey);

        // Inject comparison highlights as extra shapes / annotations
        if ((chartKey === "popular" || chartKey === "win_rates") && (compareHighlightA !== null || compareHighlightB !== null)) {
            layout.shapes = layout.shapes || [];
            // We'll mark compared bars with a glow via an annotation approach (handled post-plot)
        }

        try {
            if (container.classList.contains("js-plotly-plot") && container.data) {
                await Plotly.react(container, data, layout, cfg);
            } else {
                if (container.querySelector(".plotly")) Plotly.purge(container);
                await Plotly.newPlot(container, data, layout, cfg);
            }
            container.classList.add("loaded");
            dismissToast(`chart-${chartKey}`);
            requestAnimationFrame(() => {
                try { Plotly.Plots.resize(container); } catch (_) {}
            });
        } catch (err) {
            console.error(`Chart "${chartKey}" error:`, err);
            container.innerHTML = '<p class="chart-error">Chart could not load. Try refreshing.</p>';
            notify("A chart failed to render. The data loaded correctly.", {
                id: `chart-${chartKey}`, level: "warning", title: "Chart render issue",
            });
        }
    }

    async function renderCharts(charts) {
        if (!charts) return;
        await Promise.all(
            Object.keys(CHARTS).map((key) => plotChart(key, charts[key]))
        );
        bindChartClicks();
        resizeAllCharts();
    }

    function resizeAllCharts() {
        if (!window.Plotly) return;
        Object.values(CHARTS).forEach((id) => {
            const el = document.getElementById(id);
            if (el && el.classList.contains("js-plotly-plot")) {
                try { Plotly.Plots.resize(el); } catch (_) {}
            }
        });
    }

    // ─── Chart click → opening modal ───────────────────────────────────────────
    function extractIdx(point, key) {
        if (!point) return null;
        const cd = point.customdata;
        if (cd != null && cd !== "") {
            const v = Array.isArray(cd) ? cd[0] : cd;
            return parseInt(v, 10);
        }
        if (key === "popular" && point.pointNumber != null) {
            return popularIndices[point.pointNumber] ?? null;
        }
        return null;
    }

    function bindChartClicks() {
        [
            ["chart3d",       "scatter3d"],
            ["chartPopular",  "popular"  ],
            ["chartWinRates", "win_rates"],
        ].forEach(([domId, key]) => {
            const el = document.getElementById(domId);
            if (!el || typeof el.on !== "function") return;
            try {
                if (typeof el.removeAllListeners === "function") el.removeAllListeners("plotly_click");
                el.on("plotly_click", (ev) => {
                    const idx = extractIdx(ev.points?.[0], key);
                    if (idx != null && !isNaN(idx)) openOpening(idx);
                });
            } catch (_) {}
        });
    }

    // ─── Opening detail modal ─────────────────────────────────────────────────
    async function openOpening(index) {
        try {
            const res = await fetch(`/api/opening/${index}`);
            if (!res.ok) {
                notify("Opening details could not be loaded.", { id: "opening-load", level: "error", title: "Opening unavailable" });
                return;
            }
            const d = await res.json();
            dismissToast("opening-load");

            $("#modalTitle").textContent  = d.opening;
            $("#modalEco").textContent    = d.eco;
            $("#modalGames").textContent  = d.num_games.toLocaleString();
            $("#modalWhite").textContent  = d.white_win + "%";
            $("#modalBlack").textContent  = d.black_win + "%";
            $("#modalDraw").textContent   = d.draw + "%";
            $("#modalRating").textContent = d.avg_player;

            const movesEl = $("#modalMoves");
            movesEl.innerHTML = "";
            (d.move_steps || d.moves.split(/\s+/)).slice(0, 20).forEach((m, i) => {
                if (!m.trim()) return;
                const span = document.createElement("span");
                span.className = "move-chip";
                span.textContent = m;
                span.style.animationDelay = `${i * 0.05}s`;
                movesEl.appendChild(span);
            });

            if (miniBoardCleanup) miniBoardCleanup();
            if (window.ChessScene3D) miniBoardCleanup = window.ChessScene3D.initMiniBoard("modalBoard3d");

            const backdrop = $("#modalBackdrop");
            backdrop.classList.add("open");
            backdrop.setAttribute("aria-hidden", "false");

            lastFocusedBeforeModal = document.activeElement;
            priorBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            modalOpen = true;
            document.addEventListener("keydown", onModalKeydown);
            requestAnimationFrame(() => { const cb = $("#modalClose"); if (cb) cb.focus(); });
        } catch (e) {
            console.error(e);
            notify("Opening details could not be loaded. Check your connection.", { id: "opening-load", level: "error", title: "Connection lost" });
        }
    }

    function closeModal() {
        const backdrop = $("#modalBackdrop");
        if (backdrop) { backdrop.classList.remove("open"); backdrop.setAttribute("aria-hidden", "true"); }
        if (miniBoardCleanup) { miniBoardCleanup(); miniBoardCleanup = null; }
        if (modalOpen) {
            modalOpen = false;
            document.removeEventListener("keydown", onModalKeydown);
            document.body.style.overflow = priorBodyOverflow;
            const target = lastFocusedBeforeModal;
            lastFocusedBeforeModal = null;
            if (target && typeof target.focus === "function" && document.contains(target)) {
                try { target.focus(); } catch (_) {}
            }
        }
    }

    // ─── Comparison module ─────────────────────────────────────────────────────
    async function loadAllOpenings() {
        try {
            const res = await fetch("/api/openings_list");
            if (!res.ok) return;
            allOpenings = await res.json();
            populateCompareSelects(allOpenings);
        } catch (e) {
            console.warn("Could not load openings list for comparison:", e);
        }
    }

    function populateCompareSelects(openings) {
        ["compareA", "compareB"].forEach((id) => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const placeholder = sel.options[0];
            sel.innerHTML = "";
            sel.appendChild(placeholder);
            openings.forEach((o) => {
                const opt = document.createElement("option");
                opt.value = o.index;
                opt.textContent = `${o.eco} — ${o.name.length > 48 ? o.name.slice(0, 48) + "…" : o.name}`;
                sel.appendChild(opt);
            });
        });
    }

    async function runComparison() {
        const selA = document.getElementById("compareA");
        const selB = document.getElementById("compareB");
        if (!selA || !selB) return;
        const idxA = selA.value;
        const idxB = selB.value;
        const result = document.getElementById("compareResult");
        if (!result) return;

        if (!idxA && !idxB) { result.innerHTML = ""; compareHighlightA = null; compareHighlightB = null; return; }

        result.innerHTML = '<div class="compare-loading">Analysing…</div>';

        try {
            compareAbort?.abort();
            const abort = new AbortController();
            compareAbort = abort;

            const res = await fetch("/api/compare", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idx_a: idxA ? +idxA : null, idx_b: idxB ? +idxB : null }),
                signal: abort.signal,
            });
            if (!res.ok) throw new Error(`Compare API ${res.status}`);
            const { a, b } = await res.json();

            compareHighlightA = a ? a.index : null;
            compareHighlightB = b ? b.index : null;

            result.innerHTML = buildCompareHTML(a, b);
            // Animate bars
            requestAnimationFrame(() => {
                result.querySelectorAll(".cmp-bar-fill").forEach((el) => {
                    el.style.width = el.dataset.target;
                });
            });
        } catch (e) {
            if (e.name === "AbortError") return;
            console.error("Comparison failed:", e);
            result.innerHTML = '<p class="compare-error">Could not load comparison data.</p>';
        }
    }

    function buildCompareHTML(a, b) {
        if (!a && !b) return "";

        const stats = [
            { key: "num_games",  label: "Games",         fmt: (v) => v?.toLocaleString() ?? "—", max: null },
            { key: "white_win",  label: "White Win %",   fmt: (v) => v != null ? v + "%" : "—",  max: 100  },
            { key: "black_win",  label: "Black Win %",   fmt: (v) => v != null ? v + "%" : "—",  max: 100  },
            { key: "draw",       label: "Draw %",        fmt: (v) => v != null ? v + "%" : "—",  max: 100  },
            { key: "avg_player", label: "Avg Rating",    fmt: (v) => v != null ? v.toLocaleString() : "—", max: 3000 },
            { key: "perf_rating",label: "Perf Rating",   fmt: (v) => v != null ? v.toLocaleString() : "—", max: 3000 },
        ];

        function header(rec, side) {
            if (!rec) return `<div class="cmp-header cmp-header--${side}"><em>No opening selected</em></div>`;
            return `
                <div class="cmp-header cmp-header--${side}">
                    <span class="cmp-eco">${rec.eco || "—"}</span>
                    <h4>${rec.opening || "—"}</h4>
                    <span class="cmp-moves-label">Moves: ${(rec.move_steps || []).slice(0,8).join(" ") || "—"}</span>
                </div>`;
        }

        function statRow(stat) {
            const va = a ? a[stat.key] : null;
            const vb = b ? b[stat.key] : null;
            const maxVal = stat.max || Math.max(+(va || 0), +(vb || 0), 1);

            function bar(v, side) {
                if (v == null) return `<div class="cmp-bar"><div class="cmp-bar-fill cmp-bar-fill--${side}" data-target="0%" style="width:0%"></div></div>`;
                const pct = Math.min(100, Math.round((+v / maxVal) * 100));
                return `<div class="cmp-bar"><div class="cmp-bar-fill cmp-bar-fill--${side}" data-target="${pct}%" style="width:0%"></div></div>`;
            }

            const winner = (va != null && vb != null)
                ? (va > vb ? "a" : vb > va ? "b" : "tie")
                : null;

            return `
                <div class="cmp-row">
                    <div class="cmp-cell cmp-cell--a ${winner === "a" ? "cmp-winner" : ""}">
                        <span class="cmp-val">${stat.fmt(va)}</span>
                        ${stat.max != null ? bar(va, "a") : ""}
                    </div>
                    <div class="cmp-label">${stat.label}</div>
                    <div class="cmp-cell cmp-cell--b ${winner === "b" ? "cmp-winner" : ""}">
                        <span class="cmp-val">${stat.fmt(vb)}</span>
                        ${stat.max != null ? bar(vb, "b") : ""}
                    </div>
                </div>`;
        }

        return `
            <div class="cmp-panel">
                <div class="cmp-headers">
                    ${header(a, "a")}
                    <div class="cmp-vs-divider">VS</div>
                    ${header(b, "b")}
                </div>
                <div class="cmp-rows">
                    ${stats.map(statRow).join("")}
                </div>
            </div>`;
    }

    // ─── Data loading ──────────────────────────────────────────────────────────
    async function loadDashboardData(filters) {
        currentAbort?.abort();
        const myAbort = new AbortController();
        currentAbort = myAbort;
        try {
            const res = await fetch("/api/dashboard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(filters || getFilters()),
                signal: myAbort.signal,
            });
            if (!res.ok) throw new Error(`API error ${res.status}`);
            return await res.json();
        } catch (e) {
            if (myAbort.signal.aborted) { const err = new Error("aborted"); err.name = "AbortError"; throw err; }
            throw e;
        }
    }

    function isAbort(err) { return err && (err.name === "AbortError" || err.code === 20); }

    async function refresh() {
        showLoader();
        refreshFilterBadge();
        try {
            const data = await loadDashboardData(getFilters());
            popularIndices = data.popular_indices || [];
            updateKpis(data.kpis);
            renderInsights(data.insights);
            renderOpeningList(data.openings);
            if (window.Plotly) await renderCharts(data.charts);
            hideLoader();
            dismissToast("dashboard-load");
        } catch (e) {
            if (isAbort(e)) return;
            console.error("Dashboard refresh failed:", e);
            hideLoader();
            notify("Failed to reload dashboard data. Try adjusting filters or refreshing.", {
                id: "dashboard-load", level: "error", title: "Could not reload",
            });
        }
    }

    function debouncedRefresh() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(refresh, 380);
    }

    // ─── Filter panel toggle ───────────────────────────────────────────────────
    function initFilterDropdown() {
        const toggle  = $("#filterToggle");
        const panel   = $("#filterPanel");
        const chevron = $("#filterChevron");
        if (!toggle || !panel) return;
        toggle.addEventListener("click", () => {
            const open = !panel.classList.contains("open");
            panel.classList.toggle("open", open);
            toggle.setAttribute("aria-expanded", String(open));
            if (chevron) chevron.textContent = open ? "▲" : "▼";
        });
    }

    function initCompareDropdown() {
        const toggle  = $("#compareToggle");
        const panel   = $("#comparePanel");
        const chevron = $("#compareChevron");
        if (!toggle || !panel) return;
        toggle.addEventListener("click", () => {
            const open = !panel.classList.contains("open");
            panel.classList.toggle("open", open);
            toggle.setAttribute("aria-expanded", String(open));
            if (chevron) chevron.textContent = open ? "▲" : "▼";
            if (open && !allOpenings.length) loadAllOpenings();
        });
    }

    // ─── Tilt cards ───────────────────────────────────────────────────────────
    function initTilt() {
        document.querySelectorAll("[data-tilt]").forEach((card) => {
            card.style.transition = "transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1)";
            card.addEventListener("mousemove", (e) => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width  - 0.5;
                const y = (e.clientY - rect.top)  / rect.height - 0.5;
                card.style.transition = "transform 0.12s linear";
                card.style.transform  = `perspective(1000px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg) translateY(-2px)`;
            });
            card.addEventListener("mouseleave", () => {
                card.style.transition = "transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1)";
                card.style.transform  = "";
            });
        });
    }

    // ─── Particle canvas ───────────────────────────────────────────────────────
    function initParticles() {
        const canvas = document.getElementById("particleCanvas");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        let w, h;
        const stars = [];
        function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
        resize();
        window.addEventListener("resize", resize);
        for (let i = 0; i < 55; i++) {
            stars.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.25,
                         vx: (Math.random() - 0.5) * 0.08, vy: (Math.random() - 0.5) * 0.08, a: Math.random() });
        }
        function draw() {
            ctx.clearRect(0, 0, w, h);
            stars.forEach((s) => {
                s.x += s.vx; s.y += s.vy;
                if (s.x < 0) s.x = w; if (s.x > w) s.x = 0;
                if (s.y < 0) s.y = h; if (s.y > h) s.y = 0;
                ctx.beginPath();
                ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(212, 175, 106, ${0.08 + s.a * 0.3})`;
                ctx.fill();
            });
            requestAnimationFrame(draw);
        }
        draw();
    }

    // ─── Scroll reveal ─────────────────────────────────────────────────────────
    function initReveal() {
        document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
        const obs = new IntersectionObserver(
            (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("visible"); obs.unobserve(e.target); } }),
            { threshold: 0.05 }
        );
        document.querySelectorAll(".reveal").forEach((el) => obs.observe(el));
    }

    // ─── Bind all UI events ─────────────────────────────────────────────────────
    function bindUI() {
        initFilterDropdown();
        initCompareDropdown();

        // Navbar toggle (mobile)
        const navToggle = $("#navToggle");
        if (navToggle) navToggle.onclick = () => $("#navLinks")?.classList.toggle("open");

        // Modal close
        const modalClose = $("#modalClose");
        if (modalClose) modalClose.onclick = closeModal;
        const backdrop = $("#modalBackdrop");
        if (backdrop) backdrop.onclick = (e) => { if (e.target === backdrop) closeModal(); };

        // Reset all filters
        const resetBtn = $("#resetFilters");
        if (resetBtn) {
            resetBtn.onclick = () => {
                // Search
                const search = $("#searchOpening");
                if (search) search.value = "";
                // ECO
                const eco = $("#ecoCode");
                if (eco) eco.value = "all";
                // Min games
                const mg = $("#minGames");
                if (mg) { mg.value = META.games_min; $("#minGamesVal").textContent = META.games_min; }
                // Skill level — reset to "All"
                document.querySelectorAll(".skill-btn").forEach((b) => b.classList.toggle("active", b.dataset.skill === "all"));
                // Opening bias
                const bias = $("#openingBias");
                if (bias) bias.value = "all";
                refresh();
            };
        }

        // Min games slider
        const minGamesEl  = document.getElementById("minGames");
        const minGamesVal = document.getElementById("minGamesVal");
        if (minGamesEl && minGamesVal) {
            minGamesEl.addEventListener("input", (e) => {
                minGamesVal.textContent = e.target.value;
                debouncedRefresh();
            });
        }

        // Skill level segmented control
        document.querySelectorAll(".skill-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".skill-btn").forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");
                debouncedRefresh();
            });
        });

        // Search + ECO + Bias
        const searchEl = $("#searchOpening");
        if (searchEl) searchEl.addEventListener("input", debouncedRefresh);
        const ecoEl = $("#ecoCode");
        if (ecoEl) ecoEl.addEventListener("change", debouncedRefresh);
        const biasEl = $("#openingBias");
        if (biasEl) biasEl.addEventListener("change", debouncedRefresh);

        // Comparison selects
        ["compareA", "compareB"].forEach((id) => {
            const sel = document.getElementById(id);
            if (sel) sel.addEventListener("change", runComparison);
        });

        // Navbar scroll
        window.addEventListener("scroll", () => {
            $("#navbar")?.classList.toggle("scrolled", window.scrollY > 40);
        });

        // Resize charts
        window.addEventListener("resize", () => {
            clearTimeout(window._chartResizeT);
            window._chartResizeT = setTimeout(resizeAllCharts, 150);
        });
    }

    // ─── Hero 3D ───────────────────────────────────────────────────────────────
    function initHero3D() {
        if (window.ChessScene3D) {
            try { window.ChessScene3D.initHero("heroCanvas"); }
            catch (e) { console.warn("Hero 3D scene skipped:", e); }
        }
    }

    // ─── Init ──────────────────────────────────────────────────────────────────
    async function init() {
        if (initialized) return;
        initialized = true;

        if (typeof window.Plotly === "undefined") {
            const loader = document.getElementById("loader");
            if (loader) loader.classList.add("hide");
            return;
        }

        armLoaderTimeout(3500);

        META    = parseJsonScript("dashboard-meta", {});
        INITIAL = parseJsonScript("dashboard-initial", {
            kpis: {}, insights: [], openings: [], count: 0, popular_indices: [],
        });

        bindUI();
        initParticles();
        initTilt();
        initReveal();
        initHero3D();

        popularIndices = INITIAL.popular_indices || [];
        updateKpis(INITIAL.kpis);
        renderInsights(INITIAL.insights);
        renderOpeningList(INITIAL.openings);

        document.querySelectorAll(".reveal").forEach((el) => el.classList.add("visible"));
        hideLoader();

        try {
            const data = await loadDashboardData({
                search: "", eco: "all",
                min_games:   META.games_min,
                skill_level: "all",
                opening_bias: "all",
            });
            popularIndices = data.popular_indices || [];
            updateKpis(data.kpis);
            renderInsights(data.insights);
            renderOpeningList(data.openings);
            if (window.Plotly) await renderCharts(data.charts);
            else console.warn("Plotly not loaded — charts skipped");
            hideLoader();
            dismissToast("dashboard-load");
            setTimeout(resizeAllCharts, 400);
        } catch (e) {
            if (isAbort(e)) return;
            console.error("Failed to load charts:", e);
            hideLoader();
            notify("The dashboard failed to load. Check your connection and refresh.", {
                id: "dashboard-load", level: "error", title: "Dashboard unavailable", persistent: true,
            });
            setTimeout(resizeAllCharts, 400);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
