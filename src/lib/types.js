// JSDoc typedefs for every shape that crosses a module boundary. This module
// may not contain runtime code: it exports nothing and is imported for its
// types only. Every date is 'YYYY-MM-DD' UTC; every amount is a number in the
// account currency unless the field name says otherwise.

/** @typedef {string} ISODate 'YYYY-MM-DD' UTC */

/** @typedef {{ ticker:string, isin:string|null, name:string, shortName:string|null,
 *   currency:string, type:string, exchangeId:string|number|null,
 *   quantityPrecision:number, digitsPrecision:number }} Instrument */

/** A fill. side BUY|SELL; quantity positive; price in instrument currency;
 *  settled is the account-currency amount that left (negative) or arrived (positive),
 *  excluding fees and taxes, which the adapter reports separately;
 *  fxRate is instrument currency per account currency unit as stated by the API, or
 *  null; fees and taxes are account currency, positive numbers.
 *  kind is TRADE for a real fill; CORPORATE_ACTION for the other Fill.type values
 *  (splits, distributions, spin-offs, rights), which move quantity and no cash.
 *  rawType keeps the API's Fill.type. */
/** @typedef {{ id:string, date:ISODate, dateTime:string, ticker:string,
 *   side:'BUY'|'SELL', quantity:number, price:number, priceCurrency:string,
 *   settled:number, fxRate:number|null, fees:number,
 *   taxes:Array<{name:string, amount:number}>, kind:'TRADE'|'CORPORATE_ACTION',
 *   rawType:string, source:'api'|'csv' }} Trade */

/** gross and withheld are derived (ASSUMPTIONS A17): grossPayout = quantity ·
 *  grossPerShare in payoutCurrency; gross = grossPayout converted to account currency
 *  at the engine's rate on `date` (exact when currencies match); withheld = gross − net,
 *  floored at 0. withheldEstimated true when the parser could not do the conversion,
 *  in which case the engine recomputes both with its own rate for that day. */
/** @typedef {{ id:string, date:ISODate, ticker:string|null, quantity:number|null,
 *   gross:number, withheld:number, net:number, withheldEstimated:boolean,
 *   grossPerShare:number|null, payoutCurrency:string|null, rawType:string,
 *   category:'DIVIDEND'|'MANUFACTURED'|'RETURN_OF_CAPITAL'|'INTEREST'|'UNKNOWN' }} Dividend */

/** amount signed, in the row's own currency (A20). external true only for DEPOSIT
 *  and WITHDRAWAL. */
/** @typedef {{ id:string, date:ISODate, amount:number, currency:string, rawType:string,
 *   category:'DEPOSIT'|'WITHDRAWAL'|'FEE'|'INTEREST'|'LENDING'|'TRANSFER'|'UNKNOWN',
 *   external:boolean }} CashRow */

/** @typedef {{ ticker:string, quantity:number, averagePrice:number|null,
 *   currentPrice:number|null, currentValue:number|null }} Position */

/** All in account currency. total = investmentsValue + freeCash + pieCash +
 *  reservedCash is the anchor. The API's account id is dropped in the parser. */
/** @typedef {{ currency:string, investmentsValue:number, freeCash:number,
 *   pieCash:number, reservedCash:number, total:number }} Summary */

/** candles ascending by time; [epochSeconds, open, high, low, close, volume] */
/** @typedef {{ ticker:string, currency:string|null, candles:number[][] }} PriceSeries */

/** A counted problem in the input. `detail` names the accounts, tickers or
 *  currencies it is about, never a person. */
/** @typedef {{ code:string, count:number, detail?:string }} Warning */

/** One instrument's day-indexed history. qty is the ledger quantity, which can go
 *  negative when the ledger is incomplete; value clamps it at zero. fx is the
 *  instrument currency per account currency unit, NaN when the currency has no
 *  rate at all. lastDate is the day the position last closed, null while open. */
/** @typedef {{ qty:number[], value:number[], fx:number[], estimated:boolean[],
 *   firstDate:ISODate, lastDate:ISODate|null }} InstrumentHistory */

/** @typedef {{ rate:number[], measured:boolean[] }} FxHistory */

/** The engine result. Every array has the same length as days. Nothing here is
 *  rounded; rounding happens once, in the UI formatter. `estimated` is about
 *  prices, `dividendEstimated` about a withheld amount the engine had to derive. */
/** @typedef {{ days:ISODate[], value:number[], positionsValue:number[], cash:number[],
 *   netExternal:number[], paidIn:number[], pnl:number[],
 *   dividendGross:number[], dividendWithheld:number[], estimated:boolean[],
 *   dividendEstimated:boolean[],
 *   byInstrument:Record<string, InstrumentHistory>,
 *   fx:Record<string, FxHistory>, positionsToday:Record<string, number>,
 *   warnings:Warning[], baseCurrency:string }} PortfolioResult */

/** One line of the composition chart. weight is null on a day whose total is not
 *  positive, because a share of nothing is not zero, it is undefined. */
/** @typedef {{ ticker:string, value:number[], weight:Array<number|null> }} CompositionSeries */

/** @typedef {{ days:ISODate[], series:CompositionSeries[],
 *   other:{ count:number[], value:number[], weight:Array<number|null> },
 *   cash:{ value:number[], weight:Array<number|null> },
 *   ranking:string[] }} Composition */

/** @typedef {{ ticker:string, weightA:number|null, weightB:number|null,
 *   deltaPts:number|null, status:'held'|'opened'|'closed' }} CompositionDiff */

/** Dividend and cost totals for one period or one instrument. taxes is keyed by
 *  the API's tax name. totalCost counts every amount that left the account as a
 *  cost: trade fees, taxes not already inside those fees, withheld dividend tax
 *  and interest charged rather than earned. */
/** @typedef {{ dividend:{ gross:number, withheld:number, net:number, count:number },
 *   fees:number, taxes:Record<string, number>, fxFees:number,
 *   interest:number, lending:number, totalCost:number }} IncomeBucket */

/** @typedef {{ from:ISODate|null, to:ISODate|null, total:IncomeBucket,
 *   byInstrument:Record<string, IncomeBucket>,
 *   byMonth:Record<string, IncomeBucket>,
 *   byYear:Record<string, IncomeBucket> }} IncomeSummary */

/** @typedef {{ status:'OK'|'QUANTITY_MISMATCH'|'VALUE_MISMATCH'|'UNVERIFIED',
 *   deltaValue:number|null,
 *   quantityDeltas:Array<{ ticker:string, engine:number, broker:number }>,
 *   suspectedSplits:Array<{ ticker:string, date:ISODate, ratio:string }> }} Reconciliation */

export {};
