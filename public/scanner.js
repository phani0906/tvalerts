const socket = io();

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

function createRow(data) {
    const tr = document.createElement("tr");

    const timeTd = document.createElement("td");
    timeTd.textContent = data.timestamp || "No value";

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

// Listen for alerts
socket.on("newAlert", (alerts) => {
    const tbodyBuy = document.querySelector("#scannerTableBuy tbody");
    const tbodySell = document.querySelector("#scannerTableSell tbody");

    tbodyBuy.innerHTML = "";
    tbodySell.innerHTML = "";

    alerts.forEach((data) => {
        if (data.AI_5m && data.AI_5m.toLowerCase() === "buy") {
            tbodyBuy.appendChild(createRow(data));
        } else if (data.AI_5m && data.AI_5m.toLowerCase() === "sell") {
            tbodySell.appendChild(createRow(data));
        }
    });
});
