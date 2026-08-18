import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export interface SymbolOption {
  symbol: string;
  name: string;
  sector: string;
  isPopular?: boolean;
  aliases?: string[];
}

export const NSE_STOCK_UNIVERSE: SymbolOption[] = [
  {
    symbol: 'SBIFUNDS.NS',
    name: 'SBI Funds Management (SBI Mutual Fund)',
    sector: 'Asset Management / Mutual Funds',
    isPopular: true,
    aliases: ['sbi mutual fund', 'sbi mf', 'sbi funds', 'sbifunds', 'sbi amc'],
  },
  {
    symbol: 'SBIN.NS',
    name: 'State Bank of India (SBI)',
    sector: 'Public Sector Banking',
    isPopular: true,
    aliases: ['sbi', 'state bank', 'sbi bank'],
  },
  {
    symbol: 'HDFCAMC.NS',
    name: 'HDFC Asset Management (HDFC Mutual Fund)',
    sector: 'Asset Management / Mutual Funds',
    isPopular: true,
    aliases: ['hdfc mutual fund', 'hdfc amc', 'hdfc mf'],
  },
  {
    symbol: 'NAM-INDIA.NS',
    name: 'Nippon Life India AMC (Nippon Mutual Fund)',
    sector: 'Asset Management / Mutual Funds',
    isPopular: true,
    aliases: ['nippon mutual fund', 'nippon mf', 'nippon amc', 'reliance mutual fund'],
  },
  {
    symbol: 'UTIAMC.NS',
    name: 'UTI Asset Management (UTI Mutual Fund)',
    sector: 'Asset Management / Mutual Funds',
    aliases: ['uti mutual fund', 'uti amc', 'uti mf'],
  },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Limited', sector: 'Private Banking', isPopular: true },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'Information Technology', isPopular: true },
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries Limited', sector: 'Energy / Retail / Telecom', isPopular: true },
  { symbol: 'INFY.NS', name: 'Infosys Limited', sector: 'Information Technology', isPopular: true },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Limited', sector: 'Private Banking', isPopular: true },
  { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank', sector: 'Private Banking' },
  { symbol: 'AXISBANK.NS', name: 'Axis Bank Limited', sector: 'Private Banking' },
  { symbol: 'LT.NS', name: 'Larsen & Toubro Limited', sector: 'Infrastructure / Capital Goods', isPopular: true },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', sector: 'Telecommunications', isPopular: true },
  { symbol: 'ITC.NS', name: 'ITC Limited', sector: 'FMCG / Cigarettes / Hotels', isPopular: true },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Limited', sector: 'Automobiles / EV', isPopular: true },
  { symbol: 'TATASTEEL.NS', name: 'Tata Steel Limited', sector: 'Metals & Mining' },
  { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever Limited', sector: 'FMCG' },
  { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance Limited', sector: 'NBFC / Financials' },
  { symbol: 'MARUTI.NS', name: 'Maruti Suzuki India Limited', sector: 'Automobiles' },
  { symbol: 'SUNPHARMA.NS', name: 'Sun Pharmaceutical Industries', sector: 'Pharmaceuticals' },
  { symbol: 'ZOMATO.NS', name: 'Zomato Limited', sector: 'Internet / Consumer Tech', isPopular: true },
  { symbol: 'WIPRO.NS', name: 'Wipro Limited', sector: 'Information Technology' },
  { symbol: 'HCLTECH.NS', name: 'HCL Technologies Limited', sector: 'Information Technology' },
  { symbol: 'NTPC.NS', name: 'NTPC Limited', sector: 'Power / Utilities' },
  { symbol: 'POWERGRID.NS', name: 'Power Grid Corporation of India', sector: 'Power Transmission' },
  { symbol: 'ONGC.NS', name: 'Oil & Natural Gas Corporation', sector: 'Oil & Gas' },
  { symbol: 'COALINDIA.NS', name: 'Coal India Limited', sector: 'Metals & Mining' },
  { symbol: 'ADANIENT.NS', name: 'Adani Enterprises Limited', sector: 'Conglomerate / Commodities' },
  { symbol: 'ADANIPORTS.NS', name: 'Adani Ports and Special Economic Zone', sector: 'Ports & Logistics' },
];

export async function GET(request?: NextRequest | Request) {
  let query: string | undefined;

  if (request && request.url) {
    try {
      const { searchParams } = new URL(request.url);
      query = searchParams.get('q')?.trim().toLowerCase();
    } catch {
      // ignore invalid URL
    }
  }

  if (!query) {
    return NextResponse.json({ symbols: NSE_STOCK_UNIVERSE });
  }

  const filtered = NSE_STOCK_UNIVERSE.filter(
    (item) =>
      item.symbol.toLowerCase().includes(query!) ||
      item.name.toLowerCase().includes(query!) ||
      item.sector.toLowerCase().includes(query!) ||
      item.aliases?.some((a) => a.toLowerCase().includes(query!))
  );

  return NextResponse.json({ symbols: filtered });
}
