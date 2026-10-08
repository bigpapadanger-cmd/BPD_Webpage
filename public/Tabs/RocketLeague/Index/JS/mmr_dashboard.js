"use strict";

import { formatRocketLeagueTimestamp } from "../../shared/profilePresentation.js";
import { getMmrRankReferences, MMR_RANK_REFERENCE_DATE } from "../../shared/mmrRankReferences.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const historyRenders = new WeakMap();
const HISTORY_LIMIT = 90;
const WINDOW_HISTORY_LIMIT = 1000;
const SERIES = [
    { key: "ones", label: "1v1", color: "#b49aff", pattern: "solid", dash: "none" },
    { key: "twos", label: "2v2", color: "#68c5ff", pattern: "dashed", dash: "8 4" },
    { key: "threes", label: "3v3", color: "#64e0b1", pattern: "dotted", dash: "2 5" }
];

function textElement(documentRef, tag, text, className) {
    const element = documentRef.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    return element;
}

function formatMmr(value) {
    return Number.isSafeInteger(value) && value >= 0 ? `${value.toLocaleString()} MMR` : "Unavailable";
}

export function renderMmrProgression(progression, documentRef = document) {
    const target = documentRef.getElementById("rocketLeagueMmrProgression");
    const status = documentRef.getElementById("rocketLeagueMmrProgressionStatus");
    if (!target || !status) return;

    target.replaceChildren();
    const items = Array.isArray(progression?.playlists) ? progression.playlists : [];
    if (!items.length) {
        status.textContent = "Recent MMR change is temporarily unavailable.";
        status.hidden = false;
        return;
    }

    if (progression.previous === null) {
        status.textContent = "No previous capture yet.";
        status.hidden = false;
    } else {
        const comparedAt = formatRocketLeagueTimestamp(progression.previous?.capturedAt);
        status.textContent = comparedAt
            ? `Compared with ${comparedAt}.`
            : "Compared with the previous saved capture.";
        status.hidden = false;
    }

    const current = progression.current || {};
    for (const item of items) {
        const card = documentRef.createElement("article");
        card.className = "rl-mmr-change-item";
        const title = textElement(documentRef, "span", item.label, "rl-mmr-change-playlist");
        const mmr = textElement(documentRef, "strong", formatMmr(current[item.key]), "rl-mmr-change-current");
        const delta = documentRef.createElement("span");
        delta.className = "rl-mmr-change-delta";
        if (item.status === "no_previous") delta.textContent = "No previous capture";
        else if (item.status !== "available" || !Number.isSafeInteger(item.delta)) delta.textContent = "Change unavailable";
        else if (item.delta > 0) {
            delta.textContent = `+${item.delta.toLocaleString()} MMR`;
            card.dataset.change = "positive";
        } else if (item.delta < 0) {
            delta.textContent = `${item.delta.toLocaleString()} MMR`;
            card.dataset.change = "negative";
        } else {
            delta.textContent = "No change";
            card.dataset.change = "unchanged";
        }
        card.append(title, mmr, delta);
        target.append(card);
    }
}

export function normalizeMmrHistoryForChart(history, options = {}) {
    if (!Array.isArray(history)) return null;
    const snapshots = [];
    for (const row of history) {
        if (!row || typeof row !== "object" || Array.isArray(row)
            || typeof row.capturedAt !== "string" || !Number.isFinite(Date.parse(row.capturedAt))) return null;
        const snapshot = { capturedAt: row.capturedAt };
        for (const series of SERIES) {
            const value = row[series.key];
            if (!value || typeof value !== "object" || Array.isArray(value)) return null;
            if (value.mmr !== null && (!Number.isSafeInteger(value.mmr) || value.mmr < 0)) return null;
            snapshot[series.key] = { mmr: value.mmr, tier: typeof value.tier === "string" ? value.tier : null };
        }
        snapshots.push(snapshot);
    }
    const limit = Number.isSafeInteger(options.days) && options.days > 0 ? WINDOW_HISTORY_LIMIT : HISTORY_LIMIT;
    let ordered = snapshots
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
        .slice(0, limit)
        .reverse();
    if (Number.isSafeInteger(options.days) && options.days > 0) {
        const cutoff = (Number.isFinite(options.now) ? options.now : Date.now()) - options.days * 24 * 60 * 60 * 1000;
        const now = Number.isFinite(options.now) ? options.now : Date.now();
        ordered = ordered.filter(row => Date.parse(row.capturedAt) >= cutoff && Date.parse(row.capturedAt) <= now);
    }
    if (options.dailyAverages === true && Number.isSafeInteger(options.days) && options.days > 0) {
        const today = new Date(Number.isFinite(options.now) ? options.now : Date.now());
        today.setUTCHours(0, 0, 0, 0);
        const byDate = new Map(ordered.map(row => [row.capturedAt.slice(0, 10), row]));
        return Array.from({ length: options.days }, (_, index) => {
            const date = new Date(today);
            date.setUTCDate(date.getUTCDate() - options.days + 1 + index);
            return byDate.get(date.toISOString().slice(0, 10)) || {
                capturedAt: date.toISOString(), ones: { mmr: null, tier: null },
                twos: { mmr: null, tier: null }, threes: { mmr: null, tier: null }
            };
        });
    }
    if (options.averageByUtcDay !== true) return ordered;

    const days = new Map();
    for (const row of ordered) {
        const day = new Date(row.capturedAt).toISOString().slice(0, 10);
        if (!days.has(day)) days.set(day, { captureCount: 0, values: { ones: [], twos: [], threes: [] }, tiers: { ones: null, twos: null, threes: null } });
        const bucket = days.get(day);
        bucket.captureCount += 1;
        for (const series of SERIES) {
            const value = row[series.key];
            if (Number.isSafeInteger(value.mmr)) bucket.values[series.key].push(value.mmr);
            if (value.tier) bucket.tiers[series.key] = value.tier;
        }
    }
    return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, bucket]) => {
        const average = { capturedAt: `${day}T00:00:00.000Z`, captureCount: bucket.captureCount };
        for (const series of SERIES) {
            const values = bucket.values[series.key];
            average[series.key] = {
                mmr: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
                tier: bucket.tiers[series.key],
                captureCount: values.length
            };
        }
        return average;
    });
}

function svgElement(documentRef, tag, attributes = {}, label = "") {
    const element = documentRef.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (label) element.textContent = label;
    return element;
}

function dateLabel(timestamp, utc = false) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(utc ? { timeZone: "UTC" } : {}) }).format(new Date(timestamp));
}

function dateTooltip(timestamp) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

export function renderMmrHistory(history, documentRef = document, options = {}) {
    const target = documentRef.getElementById(options.graphId || "rocketLeagueMmrHistoryGraph");
    const status = documentRef.getElementById(options.statusId || "rocketLeagueMmrHistoryStatus");
    if (!target || !status) return;
    const baseOptions = options;
    const ranges = options.dailyAverages === true
        ? [{ value: "all", label: `All ${options.days} days`, days: options.days }, { value: "7", label: "7 Days", days: 7 }]
        : [{ value: "all", label: "All loaded captures" }, { value: "1", label: "24 Hours", days: 1 }, { value: "7", label: "7 Days", days: 7 }];
    const range = ranges.find(item => item.value === target.dataset.chartRange) || ranges[0];
    target.dataset.chartRange = range.value;
    options = { ...options, ...(range.days ? { days: range.days } : {}) };
    const selectedSeries = ["all", ...SERIES.map(series => series.key)].includes(target.dataset.chartPlaylist)
        ? target.dataset.chartPlaylist : "all";
    target.dataset.chartPlaylist = selectedSeries;
    const visibleSeries = SERIES.filter(series => selectedSeries === "all" || selectedSeries === series.key);
    const controls = documentRef.createElement("div");
    controls.className = "rl-mmr-chart-reference-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "MMR playlist display");
    for (const series of [{ key: "all", label: "All" }, ...SERIES]) {
        const button = textElement(documentRef, "button", series.label);
        button.type = "button";
        button.setAttribute("aria-pressed", String(series.key === selectedSeries));
        button.addEventListener("click", () => {
            target.dataset.chartPlaylist = series.key;
            target.dataset.rankReferencePlaylist = series.key === "all" ? "twos" : series.key;
            renderMmrHistory(history, documentRef, baseOptions);
            target.querySelector?.('button[aria-pressed="true"]')?.focus();
        });
        controls.append(button);
    }
    const rangeLabel = textElement(documentRef, "label", "History range");
    const select = documentRef.createElement("select");
    select.setAttribute("aria-label", "MMR history range");
    for (const item of ranges) {
        const option = textElement(documentRef, "option", item.label);
        option.value = item.value;
        select.append(option);
    }
    select.value = range.value;
    select.addEventListener("change", () => {
        target.dataset.chartRange = select.value;
        renderMmrHistory(history, documentRef, baseOptions);
        target.querySelector?.('select')?.focus();
    });
    rangeLabel.append(select);
    controls.append(rangeLabel);
    const snapshots = normalizeMmrHistoryForChart(history, options);
    const renderKey = JSON.stringify([snapshots, options, target.dataset.chartPlaylist, target.dataset.rankReferencePlaylist]);
    if (historyRenders.get(target) === renderKey) return;
    historyRenders.delete(target);
    target.replaceChildren();
    if (snapshots === null) {
        status.textContent = "Saved MMR history is temporarily unavailable.";
        status.hidden = false;
        return;
    }
    if (!snapshots.length) {
        target.append(controls);
        status.textContent = options.days ? `No saved MMR captures from the last ${options.days} days.` : "No saved MMR captures yet.";
        status.hidden = false;
        return;
    }

    const values = snapshots.flatMap(row => visibleSeries.map(series => row[series.key].mmr).filter(Number.isSafeInteger));
    if (!values.length) {
        target.append(controls);
        status.textContent = "No playlist MMR values are available in these captures.";
        status.hidden = false;
        return;
    }
    const observedDays = snapshots.filter(row => visibleSeries.some(series => row[series.key].mmr !== null)).length;
    status.textContent = options.dailyAverages === true
        ? `${observedDays} UTC daily average${observedDays === 1 ? "" : "s"} in the ${options.days}-day window; these are not match results.`
        : options.averageByUtcDay === true
        ? `${snapshots.length} UTC daily average${snapshots.length === 1 ? "" : "s"} from saved captures; these are not match results.`
        : `${snapshots.length} saved capture${snapshots.length === 1 ? "" : "s"}; observations are not match results.`;
    status.hidden = false;

    const width = 720;
    const height = 290;
    const margin = { top: 20, right: 156, bottom: 38, left: 58 };
    const minTime = Date.parse(snapshots[0].capturedAt);
    const maxTime = Date.parse(snapshots.at(-1).capturedAt);
    const minMmr = Math.min(...values);
    const maxMmr = Math.max(...values);
    const mmrRange = Math.max(maxMmr - minMmr, 100);
    const lower = minMmr - mmrRange * 0.1;
    const upper = maxMmr + mmrRange * 0.1;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = time => margin.left + (maxTime === minTime ? plotWidth / 2 : ((time - minTime) / (maxTime - minTime)) * plotWidth);
    const y = mmr => margin.top + ((upper - mmr) / (upper - lower)) * plotHeight;

    const svg = svgElement(documentRef, "svg", {
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        "aria-labelledby": `${target.id || options.graphId || "rocketLeagueMmrHistoryGraph"}-title ${target.id || options.graphId || "rocketLeagueMmrHistoryGraph"}-description`,
        preserveAspectRatio: "xMidYMid meet",
        class: "rl-mmr-chart-surface"
    });
    svg.append(
        svgElement(documentRef, "title", { id: `${target.id || options.graphId || "rocketLeagueMmrHistoryGraph"}-title` }, "Rocket League MMR history"),
        svgElement(documentRef, "desc", { id: `${target.id || options.graphId || "rocketLeagueMmrHistoryGraph"}-description` }, options.averageByUtcDay === true || options.dailyAverages === true
            ? "Per-playlist average MMR for each UTC day in the selected period."
            : "Playlist MMR values across saved captures, positioned by capture time.")
    );
    svg.append(svgElement(documentRef, "rect", { x: 1, y: 1, width: width - 2, height: height - 2,
        rx: 14, fill: "#142235", stroke: "#35465f", "stroke-width": 1 }));

    for (let tick = 0; tick <= 3; tick += 1) {
        const value = upper - ((upper - lower) * tick) / 3;
        const yPosition = y(value);
        svg.append(
            svgElement(documentRef, "line", { x1: margin.left, x2: width - margin.right, y1: yPosition, y2: yPosition, class: "rl-mmr-chart-gridline" }),
            svgElement(documentRef, "text", { x: margin.left - 10, y: yPosition + 4, "text-anchor": "end", class: "rl-mmr-chart-axis-label" }, String(Math.round(value)))
        );
    }

    const referencePlaylist = SERIES.some(series => series.key === target.dataset.rankReferencePlaylist)
        ? target.dataset.rankReferencePlaylist : "twos";
    target.dataset.rankReferencePlaylist = referencePlaylist;
    const references = getMmrRankReferences(referencePlaylist, options.rankReferences);
    for (const [index, reference] of references.entries()) {
        if (reference.mmr < lower || reference.mmr > upper) continue;
        const position = y(reference.mmr);
        const next = references[index + 1];
        const rangeTop = y(Math.min(next?.mmr ?? upper, upper));
        const labelX = width - margin.right + 12;
        svg.append(
            svgElement(documentRef, "line", { x1: margin.left, x2: labelX - 4, y1: position, y2: position, stroke: "#8297b2", "stroke-width": .5, "stroke-opacity": .6, class: "rl-mmr-chart-rank-line" }),
            svgElement(documentRef, "line", { x1: labelX - 4, x2: labelX - 4, y1: rangeTop, y2: position, stroke: "#8297b2", "stroke-width": .5 }),
            svgElement(documentRef, "line", { x1: labelX - 7, x2: labelX, y1: rangeTop, y2: rangeTop, stroke: "#8297b2", "stroke-width": .5 }),
            svgElement(documentRef, "rect", { x: labelX, y: position - 9, width: margin.right - 22, height: 18, rx: 6, fill: "#22364e", stroke: "#526983", "stroke-width": .5, class: "rl-mmr-chart-rank-box" }),
            svgElement(documentRef, "text", { x: labelX + 5, y: position + 3, fill: "#dce8fa", "font-size": 10, class: "rl-mmr-chart-rank-label" }, `${reference.rank} · ${reference.mmr}`)
        );
    }

    svg.append(
        svgElement(documentRef, "text", { x: margin.left, y: height - 10, "text-anchor": "start", class: "rl-mmr-chart-axis-label" }, dateLabel(snapshots[0].capturedAt, options.averageByUtcDay === true || options.dailyAverages === true)),
        svgElement(documentRef, "text", { x: width - margin.right, y: height - 10, "text-anchor": "end", class: "rl-mmr-chart-axis-label" }, dateLabel(snapshots.at(-1).capturedAt, options.averageByUtcDay === true || options.dailyAverages === true))
    );

    for (const series of SERIES) {
        if (selectedSeries !== "all" && selectedSeries !== series.key) continue;
        let segment = [];
        const segments = [];
        for (const snapshot of snapshots) {
            const mmr = snapshot[series.key].mmr;
            if (mmr === null) {
                if (segment.length) segments.push(segment);
                segment = [];
            } else {
                segment.push({ snapshot, mmr, x: x(Date.parse(snapshot.capturedAt)), y: y(mmr) });
            }
        }
        if (segment.length) segments.push(segment);
        for (const points of segments) {
            if (points.length > 1) {
                const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
                svg.append(svgElement(documentRef, "path", { d: path, class: "rl-mmr-chart-line", stroke: series.color, "stroke-dasharray": series.dash }));
            }
            for (const point of points) {
                const circle = svgElement(documentRef, "circle", { cx: point.x, cy: point.y, r: 4.5, class: "rl-mmr-chart-point", fill: series.color });
                const pointDate = options.averageByUtcDay === true || options.dailyAverages === true ? dateLabel(point.snapshot.capturedAt, true) : dateTooltip(point.snapshot.capturedAt);
                const averageInfo = options.averageByUtcDay === true ? ` · average of ${point.snapshot[series.key].captureCount} values` : "";
                circle.append(svgElement(documentRef, "title", {}, `${series.label}: ${point.mmr.toLocaleString()} MMR · ${pointDate}${averageInfo}`));
                svg.append(circle);
            }
        }
    }

    target.append(svg);
    const legend = documentRef.createElement("div");
    legend.className = "rl-mmr-chart-legend";
    for (const series of visibleSeries) {
        const item = documentRef.createElement("span");
        item.className = "rl-mmr-chart-legend-item";
        item.dataset.series = series.key;
        item.textContent = `${series.label} · ${series.pattern}`;
        legend.append(item);
    }
    target.append(legend);
    target.append(controls);
    const source = textElement(documentRef, "p", "", "rl-mmr-chart-reference-note");
    const referenceLabel = SERIES.find(series => series.key === referencePlaylist).label;
    source.textContent = `Ranking estimates · ${referenceLabel}. Based on data available when the rank references were last adjusted (${MMR_RANK_REFERENCE_DATE}; adjustment time not recorded). MMR values use the saved update dates and times shown.`;
    target.append(source);
    const disclosure = textElement(documentRef, "details", "", "rl-mmr-chart-data");
    disclosure.append(textElement(documentRef, "summary", "View MMR values"));
    const table = documentRef.createElement("table");
    table.append(textElement(documentRef, "caption", "Saved MMR observations; missing values are unavailable."));
    const header = documentRef.createElement("tr");
    for (const label of [options.dailyAverages || options.averageByUtcDay ? "UTC date" : "Capture time (UTC)", ...visibleSeries.map(series => series.label)]) {
        const cell = textElement(documentRef, "th", label); cell.setAttribute("scope", "col"); header.append(cell);
    }
    const head = documentRef.createElement("thead"); head.append(header); table.append(head);
    const body = documentRef.createElement("tbody");
    for (const row of snapshots) {
        const line = documentRef.createElement("tr");
        line.append(textElement(documentRef, "td", options.dailyAverages || options.averageByUtcDay ? row.capturedAt.slice(0, 10) : new Date(row.capturedAt).toISOString()));
        for (const series of visibleSeries) line.append(textElement(documentRef, "td", row[series.key].mmr === null ? "—" : String(row[series.key].mmr)));
        body.append(line);
    }
    table.append(body); disclosure.append(table); target.append(disclosure);
    historyRenders.set(target, JSON.stringify([snapshots, options, target.dataset.chartPlaylist, target.dataset.rankReferencePlaylist]));
}
