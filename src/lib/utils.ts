import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface RawRow extends Record<string, any> {
  _source: string;
}

export interface NormalizedPart {
  device: string;
  partName: string;
  price: number;
  currency: 'EUR' | 'PKR';
  url: string;
  repairType: string;
  source: string;
  market: 'FR' | 'PK';
}

const PK_SOURCES = ['amazon', 'priceoye', 'aliexpress', 'ebay', 'daraz', 'cjdropship'];
const FR_SOURCES = ['utopya', 'wefix', 'ifixit', 'pcbd', 'save'];

export function cleanDevice(text: string): string {
  let cleaned = str(text).toLowerCase();
  // remove brand noise
  cleaned = cleaned.replace(/apple|samsung/g, "");
  // remove variants
  cleaned = cleaned.replace(/pro max|pro|plus|ultra/g, "");
  // remove brackets
  cleaned = cleaned.replace(/\(.*?\)/g, "");
  // fix iphone12 → iphone 12
  cleaned = cleaned.replace(/([a-z])([0-9])/g, "$1 $2");
  // remove symbols
  cleaned = cleaned.replace(/[^a-z0-9 ]/g, "");
  return cleaned.trim();
}

function str(val: any): string {
  return val ? String(val) : "";
}

export function translateMobileParts(text: string): string {
  const translations: Record<string, string> = {
    "screen": "écran",
    "lcd": "écran lcd",
    "display": "écran",
    "speaker": "haut-parleur",
    "camera": "caméra",
    "battery": "batterie",
    "connector": "connecteur",
    "charging port": "port de charge",
    "buttons": "boutons",
    "button": "bouton",
    "microphone": "microphone",
    "mic": "microphone",
    "earpiece": "écouteur interne",
    "back cover": "coque arrière",
    "housing": "châssis",
  };

  const normalized = text.toLowerCase().strip();
  if (translations[normalized]) return translations[normalized];

  for (const key in translations) {
    if (normalized.includes(key)) return translations[key];
  }
  return text;
}

export function normalizeRepair(text: string): string {
  const t = str(text).toLowerCase();
  if (t.match(/screen|display|lcd|écran|ecran|vitre/)) return "screen";
  if (t.match(/battery|batterie|accu/)) return "battery";
  if (t.match(/camera|caméra|module photo|appareil photo/)) return "camera";
  if (t.match(/charger|charging|port|charge|connecteur|dock/)) return "charging";
  if (t.match(/button|bouton|nappe power|vibreur/)) return "button";
  if (t.match(/loudspeaker|speaker|haut-parleur|vibreur/)) return "speaker";
  return t.trim();
}

export function calculateConfidenceScore(parts: NormalizedPart[]): number {
  // Porting Python confidence logic: 0.5 * availability + 0.5 * consistency
  if (parts.length === 0) return 0;
  
  const uniqueSources = new Set(parts.map(p => p.source)).size;
  const availability = Math.min(1, uniqueSources / 3);

  if (parts.length < 2) return availability * 0.5;

  const prices = parts.map(p => p.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  
  const consistency = 1 - Math.min(stdDev / (mean || 1), 1);
  return Number((0.5 * availability + 0.5 * consistency).toFixed(2));
}

// Extension of String prototype for convenience similar to Python's .strip()
declare global {
  interface String {
    strip(): string;
  }
}
if (!String.prototype.strip) {
  String.prototype.strip = function() { return this.trim(); };
}

export function calculateRepairability(row: { device: string, repairType: string, confidence: number, parts: NormalizedPart[] }): number {
  const numSources = new Set(row.parts.map(p => p.source)).size;
  const availabilityScore = Math.min(1, numSources / 5);

  const difficultyMap: Record<string, number> = {
    "battery": 0.9,
    "screen": 0.7,
    "camera": 0.6,
    "speaker": 0.8,
    "connector": 0.5
  };

  const difficultyScore = difficultyMap[row.repairType] || 0.5;
  
  // Base logic from python script
  // score = (0.45 * price_score + 0.35 * difficulty_score + 0.30 * availability_score + 0.30 * confidence_score)
  // Simplified for this context as we combine price_score into confidence
  const score = (0.4 * difficultyScore + 0.3 * availabilityScore + 0.3 * row.confidence);
  
  return Number((score * 10).toFixed(2));
}

export function exportToCSV(parts: NormalizedPart[], filename: string) {
  if (!parts.length) return;
  
  const headers = ['Market', 'Source', 'Device', 'Part Name', 'Repair Type', 'Price', 'Currency', 'URL'];
  const csvContent = [
    headers.join(','),
    ...parts.map(p => [
      p.market,
      p.source,
      `"${p.device.replace(/"/g, '""')}"`,
      `"${p.partName.replace(/"/g, '""')}"`,
      p.repairType,
      p.price,
      p.currency,
      p.url
    ].join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function getDecisionLabel(price: number, marketPrice: number): 'cheap' | 'fair' | 'expensive' {
  if (!marketPrice) return 'fair';
  if (price < marketPrice * 0.9) return 'cheap';
  if (price > marketPrice * 1.2) return 'expensive';
  return 'fair';
}

export const EXCHANGE_RATE = 300;

export function formatPrice(price: number, sourceCurrency: 'EUR' | 'PKR', targetCurrency: 'EUR' | 'PKR' | 'BOTH'): string {
  if (targetCurrency === 'BOTH') {
    return sourceCurrency === 'EUR' ? `€${price.toFixed(2)}` : `Rs ${price.toLocaleString()}`;
  }

  if (sourceCurrency === targetCurrency) {
    return targetCurrency === 'EUR' ? `€${price.toFixed(2)}` : `Rs ${price.toLocaleString()}`;
  }

  // Convert
  if (sourceCurrency === 'EUR' && targetCurrency === 'PKR') {
    const converted = price * EXCHANGE_RATE;
    return `Rs ${converted.toLocaleString()}`;
  }

  if (sourceCurrency === 'PKR' && targetCurrency === 'EUR') {
    const converted = price / EXCHANGE_RATE;
    return `€${converted.toFixed(2)}`;
  }

  return `${price}`;
}

export function normalizeData(rows: RawRow[]): NormalizedPart[] {
  return rows.map((row) => {
    const source = row._source.toLowerCase();
    const market = PK_SOURCES.includes(source) ? 'PK' : 'FR';
    const currency = market === 'PK' ? 'PKR' : 'EUR';

    let device = '';
    let partName = '';
    let url = '';
    let repairType = '';
    let price = parseFloat(row.price?.toString().replace(/[^0-9.]/g, '') || '0');

    // Renaming and Mapping Columns as requested
    if (source === 'utopya') {
      device = row.model || row.device || '';
      partName = row.part_name || row.repair_name || '';
      url = row.part_url || row.product_url || '';
      repairType = normalizeRepair(row.repair_type || row.part_name || '');
    } else if (source === 'aliexpress') {
      device = row.title || '';
      partName = row.title || '';
      url = row.link || '';
      repairType = normalizeRepair(row.title || '');
    } else if (source === 'amazon' || source === 'ebay' || source === 'priceoye') {
      device = row.title || row.model || '';
      partName = row.title || '';
      url = row.link || '';
      repairType = normalizeRepair(row.title || '');
    } else if (['ifixit', 'wefix', 'pcbd', 'save'].includes(source)) {
      device = row.model || row.device || '';
      partName = row.repair_name || row.part_name || row.repair_type || '';
      url = row.part_url || row.model_url || row.brand_url || '';
      repairType = normalizeRepair(row.repair_type || row.repair_name || '');
    } else {
      device = row.model || row.title || row.device || '';
      partName = row.part_name || row.title || '';
      url = row.link || row.url || '';
      repairType = normalizeRepair(partName || device || '');
    }

    return {
      device,
      partName,
      price,
      currency,
      url,
      repairType,
      source: row._source,
      market,
    };
  });
}
