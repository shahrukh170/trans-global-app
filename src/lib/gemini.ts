import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export interface MarketAnalysis {
  recommendations: string;
  importExportDecision: string;
  repairabilityIndex: number;
  consistencyScore: number;
  arbitragePotential: 'High' | 'Medium' | 'Low';
  confidenceDiscussion: string;
}

export async function analyzeMarkets(
  device: string,
  repairType: string,
  frParts: any[],
  pkParts: any[],
  exchangeRate: number = 300 // 1 EUR = 300 PKR approx
): Promise<MarketAnalysis> {
  const prompt = `
    Analyze the electronics repair market for:
    Device: ${device}
    Repair Type: ${repairType}

    French Market Parts (Prices in EUR):
    ${JSON.stringify(frParts.map(p => ({ source: p.source, price: p.price, name: p.partName })))}

    Pakistani Market Parts (Prices in PKR):
    ${JSON.stringify(pkParts.map(p => ({ source: p.source, price: p.price, name: p.partName })))}

    Exchange Rate: 1 EUR = ${exchangeRate} PKR

    Evaluate based on:
    1. Match rate between product titles (Percentage).
    2. Price recommendations: Specific "Buy" and "Sell" price targets for FR/PK.
    3. Import/Export Viability: Analysis of shipping costs vs spread.
    4. Repairability Index: 1-10 based on part availability and difficulty.
    5. Availability Rating: Percentage of verified sources active.
    6. Consistency Score: Price stability across sources.
    7. Confidence Discussion: Narrative explaining risks (shipping, counterfeit parts).

    Provide a professional analytical response in JSON format.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendations: { type: Type.STRING },
            importExportDecision: { type: Type.STRING },
            repairabilityIndex: { type: Type.NUMBER },
            consistencyScore: { type: Type.NUMBER },
            arbitragePotential: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] },
            confidenceDiscussion: { type: Type.STRING },
          },
          required: ['recommendations', 'importExportDecision', 'repairabilityIndex', 'consistencyScore', 'arbitragePotential', 'confidenceDiscussion']
        }
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("AI Analysis failed:", error);
    return {
      recommendations: "Unable to generate AI recommendations at this time.",
      importExportDecision: "Data analysis inconclusive.",
      repairabilityIndex: 0,
      consistencyScore: 0,
      arbitragePotential: 'Low',
      confidenceDiscussion: "Please check your connectivity and API key."
    };
  }
}
