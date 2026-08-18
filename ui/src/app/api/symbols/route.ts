import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export interface SymbolOption {
  symbol: string;
  name: string;
  sector: string;
  isPopular?: boolean;
}

export const POPULAR_SYMBOLS: SymbolOption[] = [
  { symbol: 'SBIFUNDS.NS', name: 'SBI Funds Management Limited', sector: 'Asset Management / Financials', isPopular: true },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Limited', sector: 'Private Banking', isPopular: true },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', sector: 'Information Technology', isPopular: true },
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries Limited', sector: 'Conglomerate / Energy / Retail', isPopular: true },
  { symbol: 'INFY.NS', name: 'Infosys Limited', sector: 'Information Technology', isPopular: true },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank Limited', sector: 'Private Banking' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', sector: 'Public Sector Banking' },
  { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank', sector: 'Private Banking' },
  { symbol: 'LT.NS', name: 'Larsen & Toubro Limited', sector: 'Infrastructure / Capital Goods' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel Limited', sector: 'Telecommunications' },
  { symbol: 'NAM-INDIA.NS', name: 'Nippon Life India Asset Management', sector: 'Asset Management / Financials' },
  { symbol: 'HDFCAMC.NS', name: 'HDFC Asset Management Company', sector: 'Asset Management / Financials' },
];

export async function GET() {
  return NextResponse.json({ symbols: POPULAR_SYMBOLS });
}
