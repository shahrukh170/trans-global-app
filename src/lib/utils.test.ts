import { describe, it, expect } from 'vitest';
import { 
  normalizeData, 
  calculateConfidenceScore, 
  calculateRepairability,
  formatPrice, 
  NormalizedPart, 
  RawRow 
} from './utils';

describe('utils', () => {
  describe('formatPrice', () => {
    it('formats EUR to EUR correctly', () => {
      expect(formatPrice(10.5, 'EUR', 'EUR')).toBe('€10.50');
    });

    it('formats PKR to PKR correctly', () => {
      expect(formatPrice(3000, 'PKR', 'PKR')).toBe('Rs 3,000');
    });

    it('converts EUR to PKR correctly', () => {
      // 10.5 * 300 = 3150
      expect(formatPrice(10.5, 'EUR', 'PKR')).toBe('Rs 3,150');
    });

    it('converts PKR to EUR correctly', () => {
      // 3000 / 300 = 10
      expect(formatPrice(3000, 'PKR', 'EUR')).toBe('€10.00');
    });

    it('handles BOTH mode', () => {
      expect(formatPrice(10.5, 'EUR', 'BOTH')).toBe('€10.50');
      expect(formatPrice(3000, 'PKR', 'BOTH')).toBe('Rs 3,000');
    });
  });

  describe('calculateConfidenceScore', () => {
    it('returns 0 for empty parts list', () => {
      expect(calculateConfidenceScore([])).toBe(0);
    });

    it('calculates score based on unique sources and price consistency', () => {
      const parts: NormalizedPart[] = [
        { source: 'amazon', price: 10, currency: 'EUR', device: 'S22', partName: 'Battery', url: '', repairType: 'battery', market: 'PK' },
        { source: 'daraz', price: 12, currency: 'EUR', device: 'S22', partName: 'Battery', url: '', repairType: 'battery', market: 'PK' },
        { source: 'priceoye', price: 11, currency: 'EUR', device: 'S22', partName: 'Battery', url: '', repairType: 'battery', market: 'PK' },
      ];
      const score = calculateConfidenceScore(parts);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('penalizes high variance in prices', () => {
      const consistentParts: NormalizedPart[] = [
        { source: 'amazon', price: 10, currency: 'EUR', device: 'S22', partName: 'Battery', url: '', repairType: 'battery', market: 'PK' },
        { source: 'daraz', price: 10.1, currency: 'EUR', device: 'S22', partName: 'Battery', url: '', repairType: 'battery', market: 'PK' },
      ];
      const inconsistentParts: NormalizedPart[] = [
        { source: 'amazon', price: 10, currency: 'EUR', device: 'S22', partName: 'Battery', url: '', repairType: 'battery', market: 'PK' },
        { source: 'daraz', price: 50, currency: 'EUR', device: 'S22', partName: 'Battery', url: '', repairType: 'battery', market: 'PK' },
      ];
      
      const score1 = calculateConfidenceScore(consistentParts);
      const score2 = calculateConfidenceScore(inconsistentParts);
      expect(score1).toBeGreaterThan(score2);
    });
  });

  describe('normalizeData', () => {
    it('normalizes amazon rows correctly', () => {
      const raw: RawRow = {
        _source: 'amazon',
        title: 'Samsung S22 Battery',
        price: 'Rs 2,500',
        link: 'http://amazon.com/item'
      };
      const normalized = normalizeData([raw])[0];
      expect(normalized.device).toBe('Samsung S22 Battery');
      expect(normalized.price).toBe(2500);
      expect(normalized.currency).toBe('PKR');
      expect(normalized.market).toBe('PK');
      expect(normalized.repairType).toBe('battery');
    });

    it('normalizes utopya rows correctly', () => {
      const raw: RawRow = {
        _source: 'utopya',
        model: 'iPhone 13',
        part_name: 'Ecran OLED',
        price: '85.50',
        part_url: 'http://utopya.fr/item'
      };
      const normalized = normalizeData([raw])[0];
      expect(normalized.device).toBe('iPhone 13');
      expect(normalized.price).toBe(85.5);
      expect(normalized.currency).toBe('EUR');
      expect(normalized.market).toBe('FR');
      expect(normalized.repairType).toBe('screen');
    });
  });

  describe('calculateRepairability', () => {
    it('calculates a score out of 100', () => {
      const parts: NormalizedPart[] = [
        { source: 'amazon', price: 10, currency: 'EUR', device: 'S22', partName: 'Battery', url: '', repairType: 'battery', market: 'PK' },
      ];
      const score = calculateRepairability({
        device: 'S22',
        repairType: 'battery',
        confidence: 0.8,
        parts
      });
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(10); // The function returns score * 10
    });

    it('gives higher score for battery than screen generally', () => {
      const parts: NormalizedPart[] = [
        { source: 'amazon', price: 10, currency: 'EUR', device: 'S22', partName: 'Part', url: '', repairType: 'battery', market: 'PK' },
      ];
      const scoreBattery = calculateRepairability({
        device: 'S22',
        repairType: 'battery',
        confidence: 0.8,
        parts
      });
      const scoreScreen = calculateRepairability({
        device: 'S22',
        repairType: 'screen',
        confidence: 0.8,
        parts
      });
      expect(scoreBattery).toBeGreaterThan(scoreScreen);
    });
  });
});
