const socket = io();
const tableBuy = document.querySelector("#scannerTableBuy tbody");
const tableSell = document.querySelector("#scannerTableSell tbody");

// Function to update tables
function updateTables(alerts) {
  // Clear tables
  tableBuy.innerHTML = "";
  tableSell.innerHTML = "";

  alerts.forEach(alert => {
    const row = document.createElement("tr");
    
    row.innerHTML = `
      <td>${alert.Time}</td>
      <td>${alert.Ticker}</td>
      <td>${alert.PivotRel || ""}</td>
      <td>${alert.Trend || ""}</td>
      <td>${alert.Timeframe === "AI_5m" ? alert.Alert : ""}</td>
      <td>${alert.Timeframe === "AI_15m" ? alert.Alert : ""}</td>
      <td>${alert.Timeframe === "AI_1h" ? alert.Alert : ""}</td>
      <td>${alert.Price || ""}</td>
      <td>${alert.DayMid || ""}</td>
      <td>${alert.WeeklyMid || ""}</td>
      <td>${alert.MA20 || ""}</td>
      <td>${alert.NCPR || ""}</td>
      <td>${alert.Pivot || ""}</td>
    `;

    // Add row to Buy or Sell table
    if (alert.Alert === "Buy") {
      tableBuy.appendChild(row);
    } else if (alert.Alert === "Sell") {
      tableSell.appendChild(row);
    }
  });
}

// Listen for server updates
socket.on("alertsUpdate", (alerts) => {
  // Only consider AI_5m alerts for display
  const filtered = alerts.filter(a => a.Timeframe === "AI_5m");
  updateTables(filtered);
});
