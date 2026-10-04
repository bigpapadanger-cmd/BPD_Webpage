"use strict";

import { formatRocketLeagueTimestamp } from "../../shared/profilePresentation.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HISTORY_LIMIT = 90;
const SERIES = [
    { key: "ones", label: "1v1", color: "#b49aff" },
    { key: "twos", label: "2v2", color: "#68c5ff" },
    { key: "threes", label: "3v3", color: "#64e0b1" }
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

export function normalizeMmrHistoryForChart(history) {
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
    return snapshots
        .sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))
        .slice(0, HISTORY_LIMIT)
        .reverse();
}

function svgElement(documentRef, tag, attributes = {}, label = "") {
    const element = documentRef.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (label) element.textContent = label;
    return element;
}

function dateLabel(timestamp) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function dateTooltip(timestamp) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

export function renderMmrHistory(history, documentRef = document) {
    const target = documentRef.getElementById("rocketLeagueMmrHistoryGraph");
    const status = documentRef.getElementById("rocketLeagueMmrHistoryStatus");
    if (!target || !status) return;
    target.replaceChildren();

    const snapshots = normalizeMmrHistoryForChart(history);
    if (snapshots === null) {
        status.textContent = "Saved MMR history is temporarily unavailable.";
        status.hidden = false;
        return;
    }
    if (!snapshots.length) {
        status.textContent = "No saved MMR captures yet.";
        status.hidden = false;
        return;
    }

    const values = snapshots.flatMap(row => SERIES.map(series => row[series.key].mmr).filter(Number.isSafeInteger));
    if (!values.length) {
        status.textContent = "No playlist MMR values are available in these captures.";
        status.hidden = false;
        return;
    }
    status.textContent = `${snapshots.length} saved capture${snapshots.length === 1 ? "" : "s"}; observations are not match results.`;
    status.hidden = false;

    const width = 720;
    const height = 290;
    const margin = { top: 20, right: 18, bottom: 38, left: 58 };
    const minTime = Date.parse(snapshots[0].capturedAt);
    const maxTime = Date.parse(snapshots.at(-1).capturedAt);
    const minMmr = Math.min(...values);
    const maxMmr = Math.max(...values);
    const range = Math.max(maxMmr - minMmr, 100);
    const lower = minMmr - range * 0.1;
    const upper = maxMmr + range * 0.1;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = time => margin.left + (maxTime === minTime ? plotWidth / 2 : ((time - minTime) / (maxTime - minTime)) * plotWidth);
    const y = mmr => margin.top + ((upper - mmr) / (upper - lower)) * plotHeight;

    const svg = svgElement(documentRef, "svg", {
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        "aria-labelledby": "rocketLeagueMmrHistorySvgTitle rocketLeagueMmrHistorySvgDescription",
        preserveAspectRatio: "xMidYMid meet"
    });
    svg.append(
        svgElement(documentRef, "title", { id: "rocketLeagueMmrHistorySvgTitle" }, "Rocket League MMR history"),
        svgElement(documentRef, "desc", { id: "rocketLeagueMmrHistorySvgDescription" }, "Playlist MMR values across saved captures, positioned by capture time.")
    );

    for (let tick = 0; tick <= 3; tick += 1) {
        const value = upper - ((upper - lower) * tick) / 3;
        const yPosition = y(value);
        svg.append(
            svgElement(documentRef, "line", { x1: margin.left, x2: width - margin.right, y1: yPosition, y2: yPosition, class: "rl-mmr-chart-gridline" }),
            svgElement(documentRef, "text", { x: margin.left - 10, y: yPosition + 4, "text-anchor": "end", class: "rl-mmr-chart-axis-label" }, String(Math.round(value)))
        );
    }

    svg.append(
        svgElement(documentRef, "text", { x: margin.left, y: height - 10, "text-anchor": "start", class: "rl-mmr-chart-axis-label" }, dateLabel(snapshots[0].capturedAt)),
        svgElement(documentRef, "text", { x: width - margin.right, y: height - 10, "text-anchor": "end", class: "rl-mmr-chart-axis-label" }, dateLabel(snapshots.at(-1).capturedAt))
    );

    for (const series of SERIES) {
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
                svg.append(svgElement(documentRef, "path", { d: path, class: "rl-mmr-chart-line", stroke: series.color }));
            }
            for (const point of points) {
                const circle = svgElement(documentRef, "circle", { cx: point.x, cy: point.y, r: 4.5, class: "rl-mmr-chart-point", fill: series.color });
                circle.append(svgElement(documentRef, "title", {}, `${series.label}: ${point.mmr.toLocaleString()} MMR · ${dateTooltip(point.snapshot.capturedAt)}`));
                svg.append(circle);
            }
        }
    }

    target.append(svg);
    const legend = documentRef.createElement("div");
    legend.className = "rl-mmr-chart-legend";
    for (const series of SERIES) {
        const item = documentRef.createElement("span");
        item.className = "rl-mmr-chart-legend-item";
        item.dataset.series = series.key;
        item.textContent = series.label;
        legend.append(item);
    }
    target.append(legend);
}
