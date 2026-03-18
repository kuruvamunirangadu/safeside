const API_BASE = "http://127.0.0.1:5000";
const statusEls = {
    mode: document.getElementById("mode"),
    battery: document.getElementById("battery"),
    position: document.getElementById("position"),
    velocity: document.getElementById("velocity"),
};
const eventList = document.getElementById("event-list");
const messageEl = document.getElementById("command-message");
const voiceBtn = document.getElementById("voice-btn");
let recognition = null;
const chartGroupEl = document.querySelector(".chart-group");
const analyticsFallbackEls = {
    container: document.getElementById("analytics-fallback"),
    latest: document.getElementById("fallback-risk-latest"),
    average: document.getElementById("fallback-risk-average"),
    max: document.getElementById("fallback-risk-max"),
    modes: document.getElementById("fallback-mode-common"),
    bars: document.getElementById("fallback-risk-bars"),
};
const analyticsFallbackState = {
    riskHistory: [],
    modeHistory: [],
};
const humanEls = {
    feeling: document.getElementById("human-feeling"),
    stress: document.getElementById("human-stress"),
    reason: document.getElementById("human-reason"),
    updated: document.getElementById("human-updated"),
};
const riskEls = {
    score: document.getElementById("risk-score"),
    level: document.getElementById("risk-level"),
    reason: document.getElementById("risk-reason"),
    updated: document.getElementById("risk-updated"),
    distance: document.getElementById("risk-distance"),
};
const trustEls = {
    level: document.getElementById("trust-level"),
    score: document.getElementById("trust-score"),
    reason: document.getElementById("trust-reason"),
    updated: document.getElementById("trust-updated"),
    humanCount: document.getElementById("trust-human-count"),
    aiCount: document.getElementById("trust-ai-count"),
};
const adapterEls = {
    status: document.getElementById("adapter-attached"),
    name: document.getElementById("adapter-name"),
    mode: document.getElementById("adapter-mode"),
    updated: document.getElementById("adapter-updated"),
    error: document.getElementById("adapter-error"),
    members: document.getElementById("adapter-members"),
};
const feelingSelect = document.getElementById("feeling-select");
const feelingReason = document.getElementById("feeling-reason");
const feelingSubmitBtn = document.getElementById("feeling-submit");
let feelingDirty = false;
const riskBanner = document.getElementById("risk-banner");
const adapterTraceEls = {
    list: document.getElementById("adapter-trace-list"),
    path: document.getElementById("adapter-trace-path"),
};
const experimentEls = {
    score: document.getElementById("exp-score"),
    duration: document.getElementById("exp-duration"),
    reason: document.getElementById("exp-reason"),
    details: document.getElementById("exp-details"),
    inject: document.getElementById("exp-inject"),
    clear: document.getElementById("exp-clear"),
    status: document.getElementById("exp-status"),
};
let dashboardTimer = null;
let isPlaybackActive = false;
const playbackEls = {
    recordStart: document.getElementById("record-start"),
    recordStop: document.getElementById("record-stop"),
    recordName: document.getElementById("record-name"),
    sessionSelect: document.getElementById("session-select"),
    sessionRefresh: document.getElementById("session-refresh"),
    play: document.getElementById("playback-play"),
    pause: document.getElementById("playback-pause"),
    exit: document.getElementById("playback-exit"),
    speedSlider: document.getElementById("playback-speed"),
    speedLabel: document.getElementById("playback-speed-label"),
    status: document.getElementById("playback-status"),
};
const playbackState = {
    data: [],
    index: 0,
    timer: null,
    speed: 1,
    session: null,
};
const simulation = (() => {
    const canvas = document.getElementById("sim-canvas");
    const ctx = canvas ? canvas.getContext("2d") : null;
    return {
        canvas,
        ctx,
        state: {
            position: { x: 0, y: 0 },
            velocity: { vx: 0, vy: 0 },
            mode: "IDLE",
            heading: 0,
        },
        history: [],
    };
})();
const perception = (() => {
    const canvas = document.getElementById("perception-canvas");
    const ctx = canvas ? canvas.getContext("2d") : null;
    return {
        canvas,
        ctx,
        state: {
            feeling: "SAFE",
            stress: 0,
            message: "No operator notes",
            updatedAt: null,
            mode: "IDLE",
            isPreview: false,
        },
    };
})();
const analyticsCharts = (() => {
    const ChartLib = window.Chart;
    const riskCanvas = document.getElementById("riskChart");
    const modeCanvas = document.getElementById("modeChart");
    if (!ChartLib || !riskCanvas || !modeCanvas) {
        return null;
    }
    const riskCtx = riskCanvas.getContext("2d");
    const modeCtx = modeCanvas.getContext("2d");
    const maxPoints = 120;
    const modeMap = {
        IDLE: 0,
        RUNNING: 1,
        WARNING: 2,
        CAUTION: 3,
        PAUSED: 4,
        HALTED: 5,
    };
    const modeColors = {
        IDLE: "rgba(107, 114, 128, 0.7)",
        RUNNING: "rgba(52, 211, 153, 0.8)",
        WARNING: "rgba(249, 115, 22, 0.8)",
        CAUTION: "rgba(249, 168, 38, 0.8)",
        PAUSED: "rgba(96, 165, 250, 0.8)",
        HALTED: "rgba(255, 70, 85, 0.8)",
    };

    const riskChart = new ChartLib(riskCtx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Risk score",
                    data: [],
                    borderColor: "#34d399",
                    borderWidth: 2,
                    fill: false,
                    tension: 0.25,
                    pointRadius: 0,
                },
            ],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    ticks: { maxRotation: 0 },
                    grid: { color: "rgba(255,255,255,0.05)" },
                },
                y: {
                    min: 0,
                    max: 1,
                    ticks: { stepSize: 0.2 },
                    grid: { color: "rgba(255,255,255,0.08)" },
                },
            },
        },
    });

    const modeChart = new ChartLib(modeCtx, {
        type: "bar",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Mode",
                    data: [],
                    backgroundColor: [],
                },
            ],
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxRotation: 0 },
                },
                y: {
                    min: 0,
                    max: 5,
                    ticks: { stepSize: 1, callback: (value) => value },
                    grid: { color: "rgba(255,255,255,0.08)" },
                },
            },
        },
    });

    const trim = (collection) => {
        while (collection.length > maxPoints) {
            collection.shift();
        }
    };

    const pushPoint = (snapshot) => {
        const timestamp = snapshot?.last_update
            ? new Date(snapshot.last_update * 1000).toLocaleTimeString()
            : new Date().toLocaleTimeString();
        const riskScoreRaw = snapshot?.risk_score;
        const riskScore = typeof riskScoreRaw === "number"
            ? riskScoreRaw
            : parseFloat(riskScoreRaw || "0") || 0;
        const mode = (snapshot?.mode || "IDLE").toString();
        riskChart.data.labels.push(timestamp);
        riskChart.data.datasets[0].data.push(Math.max(0, Math.min(1, riskScore)));
        trim(riskChart.data.labels);
        trim(riskChart.data.datasets[0].data);
        riskChart.update("none");

        const value = modeMap[mode] ?? 0;
        const color = modeColors[mode] || "rgba(96, 165, 250, 0.6)";
        const dataset = modeChart.data.datasets[0];
        modeChart.data.labels.push(timestamp);
        dataset.data.push(value);
        dataset.backgroundColor.push(color);
        trim(modeChart.data.labels);
        trim(dataset.data);
        trim(dataset.backgroundColor);
        modeChart.update("none");
    };

    return {
        pushPoint,
    };
})();

if (analyticsCharts) {
    if (analyticsFallbackEls.container) {
        analyticsFallbackEls.container.classList.add("hidden");
    }
    if (chartGroupEl) {
        chartGroupEl.classList.remove("hidden");
    }
} else {
    if (chartGroupEl) {
        chartGroupEl.classList.add("hidden");
    }
    if (analyticsFallbackEls.container) {
        analyticsFallbackEls.container.classList.remove("hidden");
    }
}

const stateVisualizer = (() => {
    const states = ["IDLE", "RUNNING", "WARNING", "CAUTION", "PAUSED", "HALTED"];
    const containerId = "stateMachine";

    const render = (current) => {
        const container = document.getElementById(containerId);
        if (!container) {
            return;
        }
        const strip = states
            .map((stateName) => {
                const active = stateName === current ? " state-active" : "";
                return `<div class="state-box${active}">${stateName}</div>`;
            })
            .join("");
        container.innerHTML = `<div class="state-strip">${strip}</div>`;
    };

    return {
        render,
    };
})();

function updateCharts(snapshot) {
    if (!snapshot) {
        return;
    }
    if (analyticsCharts) {
        analyticsCharts.pushPoint(snapshot);
        return;
    }
    updateAnalyticsFallback(snapshot);
}

function updateAnalyticsFallback(snapshot) {
    if (!analyticsFallbackEls.container) {
        return;
    }
    const riskScoreRaw = snapshot?.risk_score ?? snapshot?.predictive_risk_state?.score;
    const riskScore = typeof riskScoreRaw === "number"
        ? riskScoreRaw
        : parseFloat(riskScoreRaw ?? "0");
    const risk = Number.isFinite(riskScore) ? Math.max(0, Math.min(1, riskScore)) : 0;
    const mode = (snapshot?.mode || "IDLE").toString();

    analyticsFallbackState.riskHistory.push(risk);
    analyticsFallbackState.modeHistory.push(mode);
    const maxSamples = 20;
    if (analyticsFallbackState.riskHistory.length > maxSamples) {
        analyticsFallbackState.riskHistory.shift();
    }
    if (analyticsFallbackState.modeHistory.length > maxSamples) {
        analyticsFallbackState.modeHistory.shift();
    }

    const total = analyticsFallbackState.riskHistory.reduce((sum, value) => sum + value, 0);
    const count = analyticsFallbackState.riskHistory.length;
    const average = count ? total / count : 0;
    const maxRisk = analyticsFallbackState.riskHistory.reduce((max, value) => Math.max(max, value), 0);

    if (analyticsFallbackEls.latest) {
        analyticsFallbackEls.latest.textContent = risk.toFixed(2);
    }
    if (analyticsFallbackEls.average) {
        analyticsFallbackEls.average.textContent = `${average.toFixed(2)} (${count})`;
    }
    if (analyticsFallbackEls.max) {
        analyticsFallbackEls.max.textContent = maxRisk.toFixed(2);
    }

    if (analyticsFallbackEls.modes) {
        const modeCounts = analyticsFallbackState.modeHistory.reduce<Record<string, number>>((acc, value) => {
            acc[value] = (acc[value] || 0) + 1;
            return acc;
        }, {});
        const topModes = Object.entries(modeCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([name, hits]) => `${name} (${hits})`)
            .join(", ") || "-";
        analyticsFallbackEls.modes.textContent = topModes;
    }

    if (analyticsFallbackEls.bars) {
        const bars = analyticsFallbackState.riskHistory.map((value, index) => {
            const normalized = Math.max(0, Math.min(1, value));
            const height = Math.round(normalized * 48) + 6;
            const sequence = index + 1;
            return `<span style="height:${height}px" title="Sample ${sequence}: ${value.toFixed(2)}"></span>`;
        });
        analyticsFallbackEls.bars.innerHTML = bars.join("");
    }
}

function setPlaybackStatus(message, isError = false) {
    const statusEl = playbackEls.status;
    if (!statusEl) {
        return;
    }
    statusEl.textContent = message;
    statusEl.classList.toggle("error", Boolean(isError));
}

function stopPolling() {
    if (dashboardTimer !== null) {
        clearInterval(dashboardTimer);
        dashboardTimer = null;
    }
}

function startPolling() {
    if (dashboardTimer !== null) {
        return;
    }
    dashboardTimer = setInterval(() => {
        fetchDashboard();
    }, 1000);
}

async function refreshSessions(options = {}) {
    const quiet = Boolean(options.quiet);
    if (!playbackEls.sessionSelect) {
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/api/trace/list`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const payload = await res.json();
        const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
        const select = playbackEls.sessionSelect;
        const current = select.value;
        select.innerHTML = "";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = sessions.length ? "Select session" : "No sessions available";
        select.appendChild(placeholder);
        sessions.forEach((name) => {
            const option = document.createElement("option");
            option.value = name;
            option.textContent = name;
            if (name === current) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        if (!quiet) {
            setPlaybackStatus(`Sessions loaded (${sessions.length})`);
        }
    } catch (err) {
        setPlaybackStatus(`Session load error: ${err.message}`, true);
    }
}

async function startRecording() {
    try {
        const payload = {};
        const name = playbackEls.recordName?.value?.trim();
        if (name) {
            payload.name = name;
        }
        const res = await fetch(`${API_BASE}/api/trace/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        setPlaybackStatus(`Recording to ${data.file}`);
        if (playbackEls.recordName) {
            playbackEls.recordName.value = "";
        }
        await refreshSessions({ quiet: true });
    } catch (err) {
        setPlaybackStatus(`Record error: ${err.message}`, true);
    }
}

async function stopRecording() {
    try {
        const res = await fetch(`${API_BASE}/api/trace/stop`, { method: "POST" });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        setPlaybackStatus("Recording stopped");
        await refreshSessions({ quiet: true });
    } catch (err) {
        setPlaybackStatus(`Stop error: ${err.message}`, true);
    }
}

async function loadSession(filename) {
    if (!filename) {
        setPlaybackStatus("No session selected", true);
        return;
    }
    cancelPlaybackTimer(false);
    isPlaybackActive = false;
    try {
        const res = await fetch(`${API_BASE}/api/trace/get/${encodeURIComponent(filename)}`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        const lines = text
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length);
        const frames = lines.map((line) => JSON.parse(line));
        playbackState.data = frames;
        playbackState.index = 0;
        playbackState.session = filename;
        setPlaybackStatus(`Loaded ${frames.length} frames from ${filename}`);
    } catch (err) {
        playbackState.data = [];
        playbackState.index = 0;
        playbackState.session = null;
        setPlaybackStatus(`Load error: ${err.message}`, true);
    }
}

function cancelPlaybackTimer(resumeLive = false) {
    if (playbackState.timer) {
        clearInterval(playbackState.timer);
        playbackState.timer = null;
    }
    if (resumeLive) {
        isPlaybackActive = false;
        startPolling();
        fetchDashboard(true);
    }
}

function applyPlaybackFrame(frame) {
    if (!frame) {
        return;
    }
    const snapshot = frame.state || frame;
    if (!snapshot) {
        return;
    }
    renderStatus(snapshot);
    renderSimulation(snapshot);
    updateCharts(snapshot);
    stateVisualizer.render(snapshot.mode);
}

function playbackStart() {
    if (!playbackState.data.length) {
        setPlaybackStatus("Load a session first", true);
        return;
    }
    cancelPlaybackTimer(false);
    stopPolling();
    isPlaybackActive = true;
    if (playbackState.index >= playbackState.data.length) {
        playbackState.index = 0;
    }
    const interval = Math.max(60, 1000 / Math.max(0.01, playbackState.speed));
    playbackState.timer = setInterval(() => {
        if (playbackState.index >= playbackState.data.length) {
            cancelPlaybackTimer(true);
            setPlaybackStatus("Playback complete");
            playbackState.index = playbackState.data.length;
            return;
        }
        const frame = playbackState.data[playbackState.index];
        applyPlaybackFrame(frame);
        playbackState.index += 1;
        setPlaybackStatus(
            `Playing ${playbackState.index}/${playbackState.data.length}`,
        );
    }, interval);
}

function playbackPause() {
    if (!playbackState.timer) {
        setPlaybackStatus("Playback paused");
        return;
    }
    clearInterval(playbackState.timer);
    playbackState.timer = null;
    setPlaybackStatus(`Playback paused at frame ${playbackState.index}`);
}

function playbackExit() {
    cancelPlaybackTimer(true);
    playbackState.index = 0;
    setPlaybackStatus("Live telemetry resumed");
}

function handleSpeedChange(value) {
    const speed = parseFloat(value) || 1;
    playbackState.speed = speed;
    if (playbackEls.speedLabel) {
        const label = speed % 1 === 0 ? `${speed.toFixed(1)}x` : `${speed.toFixed(2)}x`;
        playbackEls.speedLabel.textContent = label;
    }
    if (playbackState.timer) {
        playbackStart();
    }
}

async function fetchDashboard(force = false) {
    if (!force && isPlaybackActive) {
        return;
    }
    try {
        const [statusRes, eventsRes, traceRes, overrideRes] = await Promise.all([
            fetch(`${API_BASE}/api/status`),
            fetch(`${API_BASE}/api/events?limit=25`),
            fetch(`${API_BASE}/api/adapter/trace?limit=15`),
            fetch(`${API_BASE}/api/risk/override`),
        ]);

        if (!statusRes.ok) {
            throw new Error(`Status fetch failed (${statusRes.status})`);
        }
        if (!eventsRes.ok) {
            throw new Error(`Events fetch failed (${eventsRes.status})`);
        }
        if (!traceRes.ok) {
            throw new Error(`Adapter trace fetch failed (${traceRes.status})`);
        }
        if (!overrideRes.ok) {
            throw new Error(`Risk override fetch failed (${overrideRes.status})`);
        }

        const status = await statusRes.json();
        const eventsPayload = await eventsRes.json();
        const events = Array.isArray(eventsPayload.events) ? eventsPayload.events : [];
        const tracePayload = await traceRes.json();
        const traceEvents = Array.isArray(tracePayload.events) ? tracePayload.events : [];
        const overridePayload = await overrideRes.json();

        renderStatus(status);
        renderEvents(events);
        renderAdapterTrace(traceEvents, tracePayload.path);
        renderOverrideStatus(overridePayload.override);
        renderSimulation(status);
        updateCharts(status);
        stateVisualizer.render(status.mode);
    } catch (err) {
        displayMessage(`Dashboard error: ${err.message}`, true);
    }
}

function renderStatus(state) {
    statusEls.mode.textContent = state.mode;
    statusEls.mode.dataset.mode = state.mode;
    statusEls.battery.textContent = `${state.battery_level.toFixed(1)}%`;
    statusEls.position.textContent = `x: ${state.position.x.toFixed(2)}, y: ${state.position.y.toFixed(2)}`;
    statusEls.velocity.textContent = `vx: ${state.velocity.vx.toFixed(2)}, vy: ${state.velocity.vy.toFixed(2)}`;
    renderHumanState(state.human_safety_state, state.mode);
    renderRiskState(state.predictive_risk_state);
    renderTrustState(state.trust_state);
    renderAdapterState(state.adapter_status);
}

function renderEvents(events) {
    eventList.innerHTML = "";
    if (!events.length) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "No safety events recorded yet.";
        eventList.appendChild(empty);
        return;
    }

    events.forEach((evt) => {
        const li = document.createElement("li");
        const reason = evt.reason ? ` – ${evt.reason}` : "";
        li.textContent = `[${evt.time}] ${evt.source}: ${evt.from} → ${evt.to}${reason}`;
        eventList.appendChild(li);
    });
}

async function sendCommand(action) {
    displayMessage(`Sending ${action}…`);
    try {
        const feeling = feelingSelect?.value || "SAFE";
        const reason = (feelingReason?.value || "").trim();
        const res = await fetch(`${API_BASE}/api/command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, source: "human-ui", feeling, reason }),
        });
        const payload = await res.json();
        if (!res.ok) {
            throw new Error(payload.message || payload.result?.message || "Unknown error");
        }

        let message = payload.result?.message || `Action ${action} applied`;
        if (payload.human_response?.escalated && !message.includes("Safety escalated")) {
            message += " (Safety escalated to CAUTION)";
        }
        displayMessage(message);
        if (feelingSelect && !feelingDirty && feeling && feelingSelect.value !== feeling) {
            feelingSelect.value = feeling;
        }
        renderStatus(payload.state);
        feelingDirty = false;
        await fetchEventsOnly();
        await fetchAdapterTraceOnly();
        await fetchOverrideStatusOnly();
        renderSimulation(payload.state);
        updateCharts(payload.state);
        stateVisualizer.render(payload.state.mode);
    } catch (err) {
        displayMessage(`Command error: ${err.message}`, true);
    }
}

async function fetchEventsOnly() {
    try {
        const res = await fetch(`${API_BASE}/api/events?limit=25`);
        if (!res.ok) {
            throw new Error(`Events fetch failed (${res.status})`);
        }
        const payload = await res.json();
        const events = Array.isArray(payload.events) ? payload.events : [];
        renderEvents(events);
    } catch (err) {
        displayMessage(`Events error: ${err.message}`, true);
    }
}

async function fetchAdapterTraceOnly() {
    try {
        const res = await fetch(`${API_BASE}/api/adapter/trace?limit=15`);
        if (!res.ok) {
            throw new Error(`Adapter trace fetch failed (${res.status})`);
        }
        const payload = await res.json();
        const events = Array.isArray(payload.events) ? payload.events : [];
        renderAdapterTrace(events, payload.path);
    } catch (err) {
        displayMessage(`Adapter trace error: ${err.message}`, true);
    }
}

async function fetchOverrideStatusOnly() {
    try {
        const res = await fetch(`${API_BASE}/api/risk/override`);
        if (!res.ok) {
            throw new Error(`Risk override fetch failed (${res.status})`);
        }
        const payload = await res.json();
        renderOverrideStatus(payload.override);
    } catch (err) {
        displayMessage(`Risk override error: ${err.message}`, true);
    }
}

async function injectRiskOverride() {
    if (!experimentEls.score || !experimentEls.duration) {
        return;
    }
    displayMessage("Injecting risk override…");
    const score = parseFloat(experimentEls.score.value || "0");
    if (!Number.isFinite(score)) {
        displayMessage("Invalid score", true);
        return;
    }
    const duration = parseFloat(experimentEls.duration.value || "1");
    if (!Number.isFinite(duration) || duration <= 0) {
        displayMessage("Invalid duration", true);
        return;
    }
    const reason = (experimentEls.reason?.value || "Experiment override").trim();
    const detailsText = (experimentEls.details?.value || "").trim();
    let details = {};
    if (detailsText) {
        try {
            details = JSON.parse(detailsText);
        } catch (err) {
            displayMessage(`Details JSON invalid: ${err.message}`, true);
            return;
        }
    }
    try {
        const res = await fetch(`${API_BASE}/api/risk/override`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ score, duration, reason, details }),
        });
        const payload = await res.json();
        if (!res.ok) {
            throw new Error(payload.message || "Override failed");
        }
        renderOverrideStatus({
            ...payload.override,
            remaining: duration,
        });
        displayMessage("Risk override injected.");
        await fetchOverrideStatusOnly();
    } catch (err) {
        displayMessage(`Override error: ${err.message}`, true);
    }
}

async function clearRiskOverride() {
    displayMessage("Clearing risk override…");
    try {
        const res = await fetch(`${API_BASE}/api/risk/override`, {
            method: "DELETE",
        });
        const payload = await res.json();
        if (!res.ok) {
            throw new Error(payload.message || "Failed to clear override");
        }
        renderOverrideStatus(null);
        displayMessage("Risk override cleared.");
        await fetchOverrideStatusOnly();
    } catch (err) {
        displayMessage(`Clear override error: ${err.message}`, true);
    }
}

function logEvent(message, isError = false) {
    console.log(`[Voice] ${message}`);
    displayMessage(`[Voice] ${message}`, isError);
}

async function logVoiceTranscript(transcript, triggered) {
    if (!triggered) {
        return;
    }
    try {
        await fetch(`${API_BASE}/api/human_state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                feeling: "DANGEROUS",
                reason: `voice: ${transcript}`,
                source: "voice",
            }),
        });
    } catch (err) {
        console.error("Voice transcript logging failed", err);
    }
}

function displayMessage(message, isError = false) {
    if (!messageEl) {
        return;
    }
    messageEl.textContent = message;
    messageEl.classList.toggle("error", isError);
}

function renderHumanState(humanState = {}, mode = "IDLE") {
    if (!humanEls.feeling) {
        return;
    }
    const feeling = humanState.last_feeling || "SAFE";
    humanEls.feeling.textContent = feeling;
    if (feelingSelect && !feelingDirty && feeling && feelingSelect.value !== feeling) {
        feelingSelect.value = feeling;
    }
    const stress = typeof humanState.stress_score === "number" ? humanState.stress_score : parseFloat(humanState.stress_score || 0);
    humanEls.stress.textContent = Number.isFinite(stress) ? stress.toFixed(2) : "0.00";
    humanEls.reason.textContent = humanState.last_reason || "-";
    humanEls.updated.textContent = humanState.updated_at ? new Date(humanState.updated_at).toLocaleTimeString() : "-";
    renderPerception(humanState, mode);
}

function renderPerception(humanState = {}, mode = "IDLE") {
    if (!perception.ctx) {
        return;
    }
    const feeling = (humanState.last_feeling || "SAFE").toString().toUpperCase();
    const stressValue = typeof humanState.stress_score === "number"
        ? humanState.stress_score
        : parseFloat(humanState.stress_score || "0");
    const stress = Number.isFinite(stressValue) ? Math.max(0, Math.min(stressValue, 1)) : 0;
    const note = (humanState.last_reason || humanState.note || "").trim();
    perception.state.feeling = feeling;
    perception.state.stress = stress;
    perception.state.message = note || "No operator notes";
    perception.state.updatedAt = humanState.updated_at ? new Date(humanState.updated_at) : null;
    perception.state.mode = mode;
    perception.state.isPreview = false;
}

function renderRiskState(riskState = {}) {
    if (!riskEls.score) {
        return;
    }

    const scoreValue = typeof riskState.score === "number" ? riskState.score : parseFloat(riskState.score || 0);
    const score = Number.isFinite(scoreValue) ? scoreValue : 0;
    riskEls.score.textContent = score.toFixed(2);

    const level = (riskState.level || "LOW").toString();
    if (riskEls.level) {
        riskEls.level.textContent = level;
        riskEls.level.dataset.level = level.toLowerCase();
    }

    if (riskEls.reason) {
        riskEls.reason.textContent = riskState.reason || "-";
    }
    if (riskEls.updated) {
        riskEls.updated.textContent = riskState.updated_at ? new Date(riskState.updated_at).toLocaleTimeString() : "-";
    }

    if (riskState.distance_to_hazard !== undefined && riskState.distance_to_hazard !== null) {
        const distValue = typeof riskState.distance_to_hazard === "number"
            ? riskState.distance_to_hazard
            : parseFloat(riskState.distance_to_hazard);
        if (riskEls.distance) {
            if (Number.isFinite(distValue)) {
                const distanceText = `${distValue.toFixed(2)} m${distValue < 0 ? " (breach)" : ""}`;
                riskEls.distance.textContent = distanceText;
            } else {
                riskEls.distance.textContent = "-";
            }
        }
    } else {
        if (riskEls.distance) {
            riskEls.distance.textContent = "-";
        }
    }

    if (riskBanner) {
        const levelKey = level.toLowerCase();
        riskBanner.dataset.level = levelKey;
        if (score >= 0.4) {
            riskBanner.classList.add("visible");
            let bannerMessage = riskState.reason || `Predictive risk ${level}`;
            if (levelKey === "critical") {
                bannerMessage = riskState.reason || "Critical risk detected – Safety Core escalating.";
            } else if (levelKey === "high") {
                bannerMessage = riskState.reason || "High predictive risk – entering WARNING.";
            }
            riskBanner.textContent = bannerMessage;
        } else {
            riskBanner.classList.remove("visible");
            riskBanner.textContent = "Predictive risk nominal";
        }
    }
}

function renderTrustState(trustState = {}) {
    if (!trustEls.level) {
        return;
    }

    const level = (trustState.level || "MEDIUM").toString().toLowerCase();
    trustEls.level.textContent = level.toUpperCase();
    trustEls.level.dataset.level = level;

    const scoreValue = typeof trustState.score === "number" ? trustState.score : parseFloat(trustState.score || 0.5);
    trustEls.score.textContent = Number.isFinite(scoreValue) ? scoreValue.toFixed(2) : "-";

    if (trustEls.reason) {
        trustEls.reason.textContent = trustState.last_reason || "-";
    }
    if (trustEls.updated) {
        trustEls.updated.textContent = trustState.last_adjustment
            ? new Date(trustState.last_adjustment).toLocaleTimeString()
            : "-";
    }
    if (trustEls.humanCount) {
        trustEls.humanCount.textContent = trustState.human_interventions ?? 0;
    }
    if (trustEls.aiCount) {
        trustEls.aiCount.textContent = trustState.ai_interventions ?? 0;
    }
}

function renderAdapterState(adapterState = {}) {
    if (!adapterEls.status) {
        return;
    }

    const attached = Boolean(adapterState.attached);
    const hasError = Boolean(adapterState.last_error);
    let statusKey = "disconnected";
    let statusLabel = "DISCONNECTED";
    if (hasError) {
        statusKey = "fault";
        statusLabel = "FAULT";
    } else if (attached) {
        statusKey = "connected";
        statusLabel = "CONNECTED";
    }

    adapterEls.status.dataset.status = statusKey;
    adapterEls.status.textContent = statusLabel;

    const name = adapterState.adapter_name || (attached ? "Adapter" : "None");
    if (adapterEls.name) {
        adapterEls.name.textContent = name;
    }

    if (adapterEls.mode) {
        adapterEls.mode.textContent = adapterState.last_mode || "-";
    }

    if (adapterEls.members) {
        const members = Array.isArray(adapterState.members) ? adapterState.members : [];
        const names = members.map((member) => {
            if (member && typeof member === "object") {
                const parts = [];
                const label = member.name || member.adapter_name || "Adapter";
                parts.push(label);
                if (typeof member.history_count === "number") {
                    parts.push(`history ${member.history_count}`);
                }
                if (member.path) {
                    parts.push(member.path);
                }
                if (member.describe_error) {
                    parts.push(`error: ${member.describe_error}`);
                }
                return parts.join(" – ");
            }
            return String(member || "Adapter");
        });
        adapterEls.members.textContent = names.length ? names.join(", ") : "-";
    }

    const updated = adapterState.last_update ? new Date(adapterState.last_update).toLocaleTimeString() : "-";
    if (adapterEls.updated) {
        adapterEls.updated.textContent = updated;
    }

    if (adapterEls.error) {
        if (hasError) {
            adapterEls.error.textContent = adapterState.last_error;
            adapterEls.error.dataset.hasError = "true";
        } else {
            adapterEls.error.textContent = "-";
            adapterEls.error.dataset.hasError = "false";
        }
    }
}

function renderAdapterTrace(events = [], path = "-") {
    if (!adapterTraceEls.list) {
        return;
    }

    adapterTraceEls.path.textContent = path || "-";
    adapterTraceEls.list.innerHTML = "";
    if (!events.length) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "No adapter trace yet.";
        adapterTraceEls.list.appendChild(empty);
        return;
    }

    events.forEach((evt) => {
        const li = document.createElement("li");
        const time = evt.time ? `[${evt.time}]` : "";
        const mode = evt.mode || "?";
        const risk = evt.risk_level ? ` risk=${evt.risk_level}` : "";
        const trust = evt.trust_level ? ` trust=${evt.trust_level}` : "";
        let positionText = "";
        if (evt.position && typeof evt.position === "object") {
            const px = Number(evt.position.x ?? 0);
            const py = Number(evt.position.y ?? 0);
            positionText = ` pos(x=${px.toFixed(2)}, y=${py.toFixed(2)})`;
        }
        li.textContent = `${time} mode=${mode}${risk}${trust}${positionText}`.trim();
        adapterTraceEls.list.appendChild(li);
    });
}

function renderOverrideStatus(override = null) {
    if (!experimentEls.status) {
        return;
    }

    if (!override) {
        experimentEls.status.textContent = "No override";
        experimentEls.status.dataset.state = "idle";
        return;
    }

    const score = Number(override.score ?? 0).toFixed(2);
    const remaining = Number(override.remaining ?? 0).toFixed(1);
    const reason = override.details?.reason || override.details?.log_reason || "";
    const parts = [`score=${score}`, `remaining=${remaining}s`];
    if (reason) {
        parts.push(reason);
    }
    experimentEls.status.textContent = parts.join(" | ");
    experimentEls.status.dataset.state = "active";
}

async function sendFeelingUpdate() {
    displayMessage("Sending feeling update…");
    try {
        const feeling = feelingSelect?.value || "SAFE";
        const reason = (feelingReason?.value || "").trim();
        const res = await fetch(`${API_BASE}/api/human_state`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feeling, reason }),
        });
        const payload = await res.json();
        if (!res.ok) {
            throw new Error(payload.message || "Feeling update failed");
        }
        let message = payload.message || "Feeling recorded";
        if (payload.escalated && !message.includes("Safety")) {
            message += " (Safety escalated to CAUTION)";
        }
        displayMessage(message);
        renderStatus(payload.state);
        feelingDirty = false;
        await fetchEventsOnly();
        await fetchAdapterTraceOnly();
        await fetchOverrideStatusOnly();
        renderSimulation(payload.state);
    } catch (err) {
        displayMessage(`Feeling error: ${err.message}`, true);
    }
}

document.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        sendCommand(action);
    });
});

if (feelingSubmitBtn) {
    feelingSubmitBtn.addEventListener("click", () => {
        sendFeelingUpdate();
    });
}

if (feelingSelect) {
    feelingSelect.addEventListener("change", () => {
        feelingDirty = true;
        previewPerceptionFromForm();
    });
}

if (feelingReason) {
    feelingReason.addEventListener("input", () => {
        feelingDirty = true;
        previewPerceptionFromForm();
    });
}

if (experimentEls.inject) {
    experimentEls.inject.addEventListener("click", () => {
        injectRiskOverride();
    });
}

if (experimentEls.clear) {
    experimentEls.clear.addEventListener("click", () => {
        clearRiskOverride();
    });
}

if (playbackEls.recordStart) {
    playbackEls.recordStart.addEventListener("click", () => {
        startRecording();
    });
}

if (playbackEls.recordStop) {
    playbackEls.recordStop.addEventListener("click", () => {
        stopRecording();
    });
}

if (playbackEls.sessionRefresh) {
    playbackEls.sessionRefresh.addEventListener("click", () => {
        refreshSessions();
    });
}

if (playbackEls.sessionSelect) {
    playbackEls.sessionSelect.addEventListener("change", () => {
        const value = playbackEls.sessionSelect.value;
        if (value) {
            loadSession(value);
        }
    });
}

if (playbackEls.play) {
    playbackEls.play.addEventListener("click", () => {
        playbackStart();
    });
}

if (playbackEls.pause) {
    playbackEls.pause.addEventListener("click", () => {
        playbackPause();
    });
}

if (playbackEls.exit) {
    playbackEls.exit.addEventListener("click", () => {
        playbackExit();
    });
}

if (playbackEls.speedSlider) {
    playbackEls.speedSlider.addEventListener("input", (event) => {
        handleSpeedChange(event.target.value);
    });
    handleSpeedChange(playbackEls.speedSlider.value || "1");
}

if (voiceBtn) {
    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SR();
        recognition.lang = "en-US";
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onresult = (event) => {
            const result = event?.results?.[0]?.[0];
            const transcriptRaw = result?.transcript || "";
            const transcript = transcriptRaw.trim().toLowerCase();
            if (!transcript) {
                logEvent("Voice heard (empty result)");
                return;
            }
            console.log("Heard:", transcript);
            if (transcript.includes("stop") || transcript.includes("halt") || transcript.includes("emergency")) {
                logEvent(`Voice command triggered: ${transcript}`);
                logVoiceTranscript(transcript, true);
                sendCommand("emergency_stop");
            } else {
                logEvent(`Voice heard (ignored): ${transcript}`);
            }
        };
        recognition.onerror = (event) => {
            console.error("Speech recognition error", event);
            logEvent("Voice error", true);
        };
    } else {
        voiceBtn.disabled = true;
        voiceBtn.title = "SpeechRecognition not supported";
    }

    voiceBtn.addEventListener("click", () => {
        if (!recognition) {
            logEvent("Speech recognition unavailable", true);
            return;
        }
        try {
            recognition.start();
            logEvent("Listening for voice command...");
        } catch (err) {
            console.error("Speech recognition start failed", err);
            logEvent("Voice start failed", true);
        }
    });
}

document.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
        const shouldTrigger = window.confirm("Space pressed — trigger EMERGENCY STOP?");
        if (shouldTrigger) {
            sendCommand("emergency_stop");
        }
    }
});

function previewPerceptionFromForm() {
    if (!perception.ctx || !feelingSelect) {
        return;
    }
    const feeling = (feelingSelect.value || "SAFE").toString().toUpperCase();
    const note = (feelingReason?.value || "").trim();
    let stress = 0.25;
    if (feeling === "UNSURE") {
        stress = 0.55;
    } else if (feeling === "DANGEROUS") {
        stress = 0.9;
    }
    perception.state.feeling = feeling;
    perception.state.stress = stress;
    perception.state.message = note || "Pending submission";
    perception.state.updatedAt = null;
    perception.state.mode = simulation.state.mode;
    perception.state.isPreview = true;
}

function renderSimulation(state = {}) {
    if (!simulation.ctx) {
        return;
    }

    const position = state.position || {};
    const velocity = state.velocity || {};
    const mode = state.mode || "IDLE";

    const px = Number(position.x ?? 0);
    const py = Number(position.y ?? 0);
    const vx = Number(velocity.vx ?? 0);
    const vy = Number(velocity.vy ?? 0);
    const speed = Math.hypot(vx, vy);

    simulation.state.position = { x: px, y: py };
    simulation.state.velocity = { vx, vy };
    simulation.state.mode = mode;
    if (speed > 0.05) {
        simulation.state.heading = Math.atan2(vy, vx);
    }

    const now = Date.now();
    simulation.history.push({ x: px, y: py, ts: now });
    if (simulation.history.length > 120) {
        simulation.history.shift();
    }
}

if (simulation.ctx) {
    const { canvas, ctx } = simulation;
    const config = {
        boundaryRadius: 0.8,
        workspaceRadius: 1.0,
        trailFadeMs: 6000,
        robotRadius: 0.06,
    };

    const draw = () => {
        const { position, velocity, mode } = simulation.state;
        const scale = (Math.min(canvas.width, canvas.height) * 0.45) / config.workspaceRadius;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);

        // Draw floor grid
        ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
        ctx.lineWidth = 1;
        const gridStep = 0.2;
        for (let g = -config.workspaceRadius; g <= config.workspaceRadius; g += gridStep) {
            const gy = g * scale;
            ctx.beginPath();
            ctx.moveTo(-canvas.width, -gy);
            ctx.lineTo(canvas.width, -gy);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(g * scale, -canvas.height);
            ctx.lineTo(g * scale, canvas.height);
            ctx.stroke();
        }

        // Hazard boundary
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 70, 85, 0.5)";
        ctx.lineWidth = 2;
        ctx.arc(0, 0, config.boundaryRadius * scale, 0, Math.PI * 2);
        ctx.stroke();

        // Trail
        const trailCutoff = Date.now() - config.trailFadeMs;
        for (let i = 1; i < simulation.history.length; i += 1) {
            const prev = simulation.history[i - 1];
            const curr = simulation.history[i];
            if (!prev || !curr) {
                continue;
            }
            if (curr.ts < trailCutoff) {
                continue;
            }
            const alpha = Math.max(0.05, Math.min(1, (curr.ts - trailCutoff) / config.trailFadeMs));
            ctx.strokeStyle = `rgba(52, 134, 255, ${alpha})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(prev.x * scale, -prev.y * scale);
            ctx.lineTo(curr.x * scale, -curr.y * scale);
            ctx.stroke();
        }

        // Robot representation as simplified humanoid
        const modeColors = {
            IDLE: "#6b7280",
            RUNNING: "#34d399",
            CAUTION: "#f9a826",
            WARNING: "#f97316",
            PAUSED: "#60a5fa",
            HALTED: "#ff4655",
        };
        const robotColor = modeColors[mode] || "#34d399";
        const rx = position.x * scale;
        const ry = -position.y * scale;
        const heading = simulation.state.heading || 0;
        const forwardX = Math.cos(heading);
        const forwardY = Math.sin(heading);
        const rightX = -forwardY;
        const rightY = forwardX;
        const bodyLength = config.workspaceRadius * 0.45 * scale;
        const torsoTopX = rx - forwardX * bodyLength * 0.5;
        const torsoTopY = ry + forwardY * bodyLength * 0.5;
        const headCenterX = torsoTopX - forwardX * bodyLength * 0.18;
        const headCenterY = torsoTopY + forwardY * bodyLength * 0.18;

        // Torso
        ctx.strokeStyle = robotColor;
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(torsoTopX, torsoTopY);
        ctx.stroke();

        // Head
        ctx.fillStyle = robotColor;
        ctx.beginPath();
        ctx.arc(headCenterX, headCenterY, config.robotRadius * scale * 0.9, 0, Math.PI * 2);
        ctx.fill();

        const armSpan = bodyLength * 0.45;
        const legSpan = bodyLength * 0.35;
        const armOffset = bodyLength * 0.15;
        const legOffset = bodyLength * 0.2;

        // Arms
        const leftShoulderX = torsoTopX + rightX * armOffset;
        const leftShoulderY = torsoTopY - rightY * armOffset;
        const leftHandX = leftShoulderX + rightX * armSpan - forwardX * bodyLength * 0.05;
        const leftHandY = leftShoulderY - rightY * armSpan + forwardY * bodyLength * 0.05;
        const rightShoulderX = torsoTopX - rightX * armOffset;
        const rightShoulderY = torsoTopY + rightY * armOffset;
        const rightHandX = rightShoulderX - rightX * armSpan - forwardX * bodyLength * 0.05;
        const rightHandY = rightShoulderY + rightY * armSpan + forwardY * bodyLength * 0.05;

        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(leftShoulderX, leftShoulderY);
        ctx.lineTo(leftHandX, leftHandY);
        ctx.moveTo(rightShoulderX, rightShoulderY);
        ctx.lineTo(rightHandX, rightHandY);
        ctx.stroke();

        // Legs
        const leftHipX = rx + rightX * legOffset;
        const leftHipY = ry - rightY * legOffset;
        const rightHipX = rx - rightX * legOffset;
        const rightHipY = ry + rightY * legOffset;
        const leftFootX = leftHipX - forwardX * legSpan;
        const leftFootY = leftHipY + forwardY * legSpan;
        const rightFootX = rightHipX - forwardX * legSpan;
        const rightFootY = rightHipY + forwardY * legSpan;

        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(leftHipX, leftHipY);
        ctx.lineTo(leftFootX, leftFootY);
        ctx.moveTo(rightHipX, rightHipY);
        ctx.lineTo(rightFootX, rightFootY);
        ctx.stroke();

        // Velocity arrow for context
        const speed = Math.hypot(velocity.vx, velocity.vy);
        if (speed > 0.01) {
            const arrowScale = Math.min(1.2, speed) * 0.6 * scale;
            const ax = rx + forwardX * arrowScale;
            const ay = ry - forwardY * arrowScale;

            ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(rx, ry);
            ctx.lineTo(ax, ay);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(
                ax - Math.cos(heading - Math.PI / 6) * 10,
                ay + Math.sin(heading - Math.PI / 6) * 10,
            );
            ctx.lineTo(
                ax - Math.cos(heading + Math.PI / 6) * 10,
                ay + Math.sin(heading + Math.PI / 6) * 10,
            );
            ctx.closePath();
            ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
            ctx.fill();
        }

        // Center point
        ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
        requestAnimationFrame(draw);
    };

    requestAnimationFrame(draw);
}

if (perception.ctx) {
    const { canvas, ctx } = perception;
    const feelingColors = {
        SAFE: "#34d399",
        UNSURE: "#f9a826",
        DANGEROUS: "#ff4655",
    };
    const postureMap = {
        SAFE: { arms: [0.3, 0.3], headTilt: 0, lean: 0.05, stance: 0.24 },
        UNSURE: { arms: [0.68, 0.42], headTilt: 0.12, lean: 0.12, stance: 0.2 },
        DANGEROUS: { arms: [0.98, 0.95], headTilt: -0.18, lean: 0.22, stance: 0.14 },
    };

    const drawPerception = (timestamp) => {
        const t = timestamp / 1000;
        const { feeling, stress, message, updatedAt, mode, isPreview } = perception.state;
        const accent = feelingColors[feeling] || "#60a5fa";

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        background.addColorStop(0, "rgba(15, 23, 42, 0.88)");
        background.addColorStop(1, "rgba(12, 14, 20, 0.92)");
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        const base = Math.min(canvas.width, canvas.height) * 0.35;
        ctx.translate(canvas.width / 2, canvas.height * 0.65);

        const posture = postureMap[feeling] || postureMap.SAFE;
        const sway = Math.sin(t * (1.2 + stress * 1.8)) * posture.lean * base;
        const bob = Math.sin(t * (2.4 + stress * 2.2)) * stress * base * 0.06;
        ctx.translate(sway, bob);

        const auraPulse = 1 + Math.sin(t * (2 + stress * 3)) * (0.08 + stress * 0.05);
        const auraRadius = base * (0.95 + stress * 0.35) * auraPulse;
        ctx.fillStyle = hexToRgba(accent, 0.12 + stress * 0.08);
        ctx.beginPath();
        ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(accent, 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
        ctx.stroke();

        const torsoTop = -base * 0.75;
        const torsoBottom = base * 0.45;
        const shoulderY = torsoTop + base * 0.2;
        const hipY = torsoBottom - base * 0.08;

        ctx.strokeStyle = hexToRgba(accent, 0.95);
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(0, torsoTop);
        ctx.lineTo(0, torsoBottom);
        ctx.stroke();

        const armSpan = base * 0.55;
        const jitter = Math.sin(t * (3.2 + stress * 4.5)) * base * 0.05 * (0.3 + stress);
        const leftArmLift = posture.arms[0];
        const rightArmLift = posture.arms[1];
        const leftHandX = -armSpan + leftArmLift * base * 0.12 + jitter;
        const rightHandX = armSpan - rightArmLift * base * 0.12 - jitter;
        const leftHandY = shoulderY - base * leftArmLift;
        const rightHandY = shoulderY - base * rightArmLift;

        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, shoulderY);
        ctx.lineTo(leftHandX, leftHandY);
        ctx.moveTo(0, shoulderY);
        ctx.lineTo(rightHandX, rightHandY);
        ctx.stroke();

        const stance = base * (posture.stance + stress * 0.05);
        const footLift = Math.sin(t * (3 + stress * 5)) * stress * base * 0.08;
        const leftFootX = -stance;
        const rightFootX = stance;
        const footY = hipY + base * 0.55;

        ctx.beginPath();
        ctx.moveTo(0, hipY);
        ctx.lineTo(leftFootX, footY - footLift);
        ctx.moveTo(0, hipY);
        ctx.lineTo(rightFootX, footY + footLift);
        ctx.stroke();

        const headRadius = base * (0.16 + stress * 0.03);
        const headOffsetX = Math.sin(posture.headTilt) * base * 0.12;
        const headCenterY = torsoTop - base * 0.22;
        ctx.fillStyle = hexToRgba(accent, 0.9);
        ctx.beginPath();
        ctx.arc(headOffsetX, headCenterY, headRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(12, 16, 23, 0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(headOffsetX, headCenterY + headRadius * 0.25, headRadius * 0.5, 0, Math.PI);
        ctx.stroke();

        ctx.fillStyle = hexToRgba("#ffffff", 0.18);
        ctx.beginPath();
        ctx.arc(0, (torsoTop + torsoBottom) / 2, base * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexToRgba(accent, 0.92);
        ctx.beginPath();
        ctx.arc(0, (torsoTop + torsoBottom) / 2, base * 0.05, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.font = "600 16px 'Segoe UI', Arial, sans-serif";
        ctx.fillText(`Feeling: ${feeling}`, 18, 26);
        ctx.font = "12px 'Segoe UI', Arial, sans-serif";
        const stressPercent = Math.round(stress * 100);
        const timestampLabel = isPreview ? "Preview" : (updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : "No recent update");
        ctx.fillText(`Stress: ${stressPercent}%`, 18, 44);
        ctx.fillText(timestampLabel, 18, 60);

        const badgeText = (mode || "IDLE").toString();
        ctx.font = "600 12px 'Segoe UI', Arial, sans-serif";
        const badgeWidth = ctx.measureText(badgeText).width + 18;
        const badgeX = canvas.width - badgeWidth - 18;
        const badgeY = 18;
        drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, 26, 10);
        ctx.fillStyle = hexToRgba(accent, 0.28);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(accent, 0.6);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = hexToRgba(accent, 0.95);
        ctx.fillText(badgeText, badgeX + 9, badgeY + 17);

        const bubbleWidth = canvas.width - 36;
        const innerWidth = bubbleWidth - 32;
        const bodyFont = "12px 'Segoe UI', Arial, sans-serif";
        ctx.font = bodyFont;
        const lines = computeWrappedLines(ctx, message, innerWidth);
        const bubbleHeight = Math.max(74, 34 + lines.length * 18);
        const bubbleX = 18;
        const bubbleY = canvas.height - bubbleHeight - 24;
        drawRoundedRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 14);
        ctx.fillStyle = "rgba(12, 14, 20, 0.78)";
        ctx.fill();
        ctx.strokeStyle = hexToRgba(accent, 0.55);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = "600 11px 'Segoe UI', Arial, sans-serif";
        ctx.fillStyle = hexToRgba(accent, 0.9);
        ctx.fillText(isPreview ? "Preview note" : "Latest note", bubbleX + 16, bubbleY + 20);
        ctx.font = bodyFont;
        ctx.fillStyle = "rgba(236, 240, 247, 0.9)";
        let textY = bubbleY + 40;
        lines.forEach((line) => {
            ctx.fillText(line, bubbleX + 16, textY);
            textY += 18;
        });

        requestAnimationFrame(drawPerception);
    };

    requestAnimationFrame(drawPerception);
}

function hexToRgba(hex, alpha) {
    const sanitized = hex.replace("#", "");
    if (sanitized.length !== 6) {
        return `rgba(52, 134, 255, ${alpha})`;
    }
    const value = parseInt(sanitized, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function computeWrappedLines(ctx, text, maxWidth) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    if (!words.length) {
        return [""];
    }
    words.forEach((word) => {
        const testLine = current ? `${current} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && current) {
            lines.push(current);
            current = word;
        } else {
            current = testLine;
        }
    });
    if (current) {
        lines.push(current);
    }
    return lines;
}

fetchDashboard();
startPolling();
setPlaybackStatus("Playback idle");
refreshSessions({ quiet: true });
