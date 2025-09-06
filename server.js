const express = require("express");
const app = express();
const path = require("path");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const alerts = [];

// Receive webhook from TradingView
app.post("/webhook", (req, res) => {
    const alert = req.body;
    console.log("Received alert:", alert);
    alerts.push(alert);
    res.status(200).send("Alert received");
});

// Serve alerts on web page
app.get("/scanner", (req, res) => {
    let html = `<h1>Welcome to TradingView Scanner!</h1>`;
    if (alerts.length === 0) {
        html += `<p>No alerts yet.</p>`;
    } else {
        html += `<h2>Received Alerts:</h2>`;
        html += alerts.map(a => `<p>${JSON.stringify(a)}</p>`).join("");
    }
    res.send(html);
});

// Listen on Render-assigned port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    const localhostURL = `http://localhost:${PORT}/scanner`;
    const renderURL = process.env.RENDER_EXTERNAL_URL || "not deployed";
    console.log(`Server running at:\n- Local: ${localhostURL}\n- Render: ${renderURL}`);
});
