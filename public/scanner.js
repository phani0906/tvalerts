const socket = io();

// Store rows by Ticker for fast lookup
const buyRows = {};
const sellRows = {};

// Helpers
function getPivotRelColor(value) {
    switch (value) {
        case "HV":
        case "OHV":
            return "green";
        case "LV":
        case "OLV":
            return "red";
        case "IV":
            return "blue";
        case "OV":
        case "NC":
            return "gray";
        default:
            return "white";
    }
}

function getTrendArrow(value) {
    if (!value) return "No value";
    value = value.toLowerCase();
    if (value.includes("bullish")) return { arrow: "↗", className: "trend-bull" };
    if (value.includes("bearish")) return { arrow: "↘", className: "trend-bear" };
    return { arrow: "→", className: "" };
}

function getAISignalColor(signal) {
    if (!signal) return "white";
    if (signal.toLowerCase() === "buy") return "lime";
    if (signal.toLowerCase() === "sell") return "red";
    return "white";
}

// Create a new table row for Buy/Sell
function createRow(data) {
    const tr = document.createElement("tr");

    const timeTd = document.createElement("td");
    timeTd.textContent = data.Time || "No value";

    const tickerTd = document.createElement("td");
    tickerTd.textContent = data.Ticker || "No value";

    const pivotTd = document.createElement("td");
    pivotTd.textContent = data.Rel || "No value";
    pivotTd.style.color = getPivotRelColor(data.Rel);
    pivotTd.style.fontWeight = "bold";

    const trendTd = document.createElement("td");
    const trendInfo = getTrendArrow(data.Trend);
    trendTd.textContent = trendInfo.arrow;
    trendTd.className = "trend-arrow " + trendInfo.className;

    const ai5Td = document.createElement("td");
    ai5Td.textContent = data.AI_5m || "No value";
    ai5Td.style.color = getAISignalColor(data.AI_5m);
    ai5Td.style.fontWeight = "bold";

    const ai15Td = document.createElement("td");
    ai15Td.textContent = data.AI_15m || "No value";
    ai15Td.style.color = getAISignalColor(data.AI_15m);
    ai15Td.style.fontWeight = "bold";

    const ai1hTd = document.createElement("td");
    ai1hTd.textContent = data.AI_1h || "No value";
    ai1hTd.style.color = getAISignalColor(data.AI_1h);
    ai1hTd.style.fontWeight = "bold";

    const priceTd = document.createElement("td");
    priceTd.textContent = data.Price || "No value";

    const dayMidTd = document.createElement("td");
    dayMidTd.textContent = data.DayMid || "No value";

    const weeklyMidTd = document.createElement("td");
    weeklyMidTd.textContent = data.WeeklyMid || "No value";

    const ma20Td = document.createElement("td");
    ma20Td.textContent = data.MA20 || "No value";

    const ncprTd = document.createElement("td");
    ncprTd.textContent = data.NCPR || "No value";

    const pivotCalcTd = document.createElement("td");
    pivotCalcTd.textContent = data.Pivot || "No value";

    tr.append(
        timeTd,
        tickerTd,
        pivotTd,
        trendTd,
        ai5Td,
        ai15Td,
        ai1hTd,
        priceTd,
        dayMidTd,
        weeklyMidTd,
        ma20Td,
        ncprTd,
        pivotCalcTd
    );

    return tr;
}

// Update a single row cell by timeframe
function updateRowCell(row, timeframe, alert) {
    switch (timeframe) {
        case "AI_5m":
            row.children[4].textContent = alert;
            row.children[4].style.color = getAISignalColor(alert);
            break;
        case "AI_15m":
            row.children[5].textContent = alert;
            row.children[5].style.color = getAISignalColor(alert);
            break;
        case "AI_1h":
            row.children[6].textContent = alert;
            row.children[6].style.color = getAISignalColor(alert);
            break;
    }
}

// Function to add/update a row
function addOrUpdateRow(ticker, timeframe, alertSignal, time) {
    let row;
    let rowsMap;
    let table;

    // Determine if it is a Buy/Sell table
    if (timeframe === "AI_5m") {
        if (alertSignal.toLowerCase() === "buy") {
            table = document.querySelector("#scannerTableBuy tbody");
            rowsMap = buyRows;
        } else {
            table = document.querySelector("#scannerTableSell tbody");
            rowsMap = sellRows;
        }
    } else {
        // For 15m or 1h, row may exist in either table
        row = buyRows[ticker] || sellRows[ticker];
        rowsMap = buyRows[ticker] ? buyRows : sellRows;
        table = buyRows[ticker] ? document.querySelector("#scannerTableBuy tbody") : document.querySelector("#scannerTableSell tbody");
    }

    if (!row) {
        // Create placeholder row
        const rowData = {
            Time: timeframe === "AI_5m" ? time || new Date().toLocaleTimeString() : "No value",
            Ticker: ticker,
            Rel: "",
            Trend: "",
            AI_5m: timeframe === "AI_5m" ? alertSignal : "No value",
            AI_15m: timeframe === "AI_15m" ? alertSignal : "No value",
            AI_1h: timeframe === "AI_1h" ? alertSignal : "No value",
            Price: "",
            DayMid: "",
            WeeklyMid: "",
            MA20: "",
            NCPR: "",
            Pivot: ""
        };
        row = createRow(rowData);
        table.appendChild(row);
        rowsMap[ticker] = row;
    } else {
        // Update existing row
        if (timeframe === "AI_5m") {
            // Update time for 5m alerts
            row.children[0].textContent = time || row.children[0].textContent;
        }
        updateRowCell(row, timeframe, alertSignal);
    }
}

// Listen for alerts from server
socket.on("newAlert", (alerts) => {
    alerts.forEach((data) => {
        addOrUpdateRow(data.Ticker, data.Timeframe, data.Alert, data.Time);
    });
});
