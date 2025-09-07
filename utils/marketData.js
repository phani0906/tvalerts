const fs = require('fs');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

const alertsFilePath = path.join(__dirname, '..', 'data', 'alerts.json');

async function fetchPrice(ticker) {
    try {
        const quote = await yahooFinance.quoteSummary(ticker, { modules: ['price', 'summaryDetail'] });
        return {
            Price: quote.price?.regularMarketPrice || 'N/A',
            DayMid: quote.summaryDetail?.dayLow && quote.summaryDetail?.dayHigh
                ? ((quote.summaryDetail.dayLow + quote.summaryDetail.dayHigh)/2).toFixed(2)
                : 'N/A',
            WeeklyMid: quote.summaryDetail?.fiftyTwoWeekLow && quote.summaryDetail?.fiftyTwoWeekHigh
                ? ((quote.summaryDetail.fiftyTwoWeekLow + quote.summaryDetail.fiftyTwoWeekHigh)/2).toFixed(2)
                : 'N/A',
            MA20: quote.summaryDetail?.fiftyDayAverage || 'N/A'
        };
    } catch (err) {
        console.error(`Error fetching ${ticker}:`, err.message);
        return { Price: 'Error', DayMid: 'Error', WeeklyMid: 'Error', MA20: 'Error' };
    }
}

function startMarketDataUpdater(io) {
    setInterval(async () => {
        if (!fs.existsSync(alertsFilePath)) return;
        const data = fs.readFileSync(alertsFilePath, 'utf8').trim();
        if (!data) return;

        let alerts = JSON.parse(data);
        const tickers = alerts.map(a => a.Ticker);

        const priceUpdates = {};
        for (const ticker of tickers) {
            priceUpdates[ticker] = await fetchPrice(ticker);
        }

        io.emit('priceUpdate', priceUpdates);

    }, 5000); // update every 5 seconds
}

module.exports = { startMarketDataUpdater };
