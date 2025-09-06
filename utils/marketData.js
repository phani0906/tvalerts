const yahooFinance = require('yahoo-finance2').default;

// Suppress survey notice for cleaner logs
yahooFinance.suppressNotices(['yahooSurvey']);

async function fetchMarketData(tickers) {
    const results = {};

    for (const ticker of tickers) {
        try {
            const quote = await yahooFinance.quoteSummary(ticker, { modules: ['price', 'summaryDetail'] });
            results[ticker] = {
                Price: quote.price?.regularMarketPrice || 'No value',
                DayMid: quote.summaryDetail?.dayLow && quote.summaryDetail?.dayHigh 
                        ? ((quote.summaryDetail.dayLow + quote.summaryDetail.dayHigh)/2).toFixed(2)
                        : 'No value',
                WeeklyMid: quote.summaryDetail?.fiftyTwoWeekLow && quote.summaryDetail?.fiftyTwoWeekHigh 
                            ? ((quote.summaryDetail.fiftyTwoWeekLow + quote.summaryDetail.fiftyTwoWeekHigh)/2).toFixed(2)
                            : 'No value',
                MA20: quote.summaryDetail?.fiftyDayAverage || 'No value',
                NCPR: 'No value',  // Placeholder
                Pivot: 'No value', // Placeholder
            };
        } catch (err) {
            console.error(`Error fetching market data for ${ticker}:`, err.message);
            results[ticker] = {
                Price: 'Error',
                DayMid: 'Error',
                WeeklyMid: 'Error',
                MA20: 'Error',
                NCPR: 'Error',
                Pivot: 'Error',
            };
        }
    }

    return results;
}

module.exports = { fetchMarketData };
