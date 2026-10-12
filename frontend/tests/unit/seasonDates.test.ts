import { describe, it, expect } from 'vitest';
import { isLeapYear, seasonToDates } from '../../src/ts/utils/seasonDates.js';
import type { Season } from '../../src/ts/types.js';

describe('isLeapYear', () => {
  it('returns true for leap years divisible by 4 but not 100', () => {
    expect(isLeapYear(2020)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
  });

  it('returns false for non-leap years', () => {
    expect(isLeapYear(2021)).toBe(false);
    expect(isLeapYear(2022)).toBe(false);
    expect(isLeapYear(2023)).toBe(false);
  });

  it('returns true for years divisible by 400', () => {
    expect(isLeapYear(2000)).toBe(true);
  });

  it('returns false for years divisible by 100 but not 400', () => {
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
  });
});

describe('seasonToDates', () => {
  it('converts invierno to Dec 1 .. Feb 28/29', () => {
    const result = seasonToDates(2023, 'invierno' as Season);
    expect(result.start).toBe('2023-12-01');
    expect(result.end).toBe('2024-02-29'); // 2024 is leap year
  });

  it('converts invierno for non-leap end year to Feb 28', () => {
    const result = seasonToDates(2022, 'invierno' as Season);
    expect(result.start).toBe('2022-12-01');
    expect(result.end).toBe('2023-02-28'); // 2023 is not leap year
  });

  it('converts primavera to Mar 1 .. May 31', () => {
    const result = seasonToDates(2023, 'primavera' as Season);
    expect(result.start).toBe('2023-03-01');
    expect(result.end).toBe('2023-05-31');
  });

  it('converts verano to Jun 1 .. Aug 31', () => {
    const result = seasonToDates(2023, 'verano' as Season);
    expect(result.start).toBe('2023-06-01');
    expect(result.end).toBe('2023-08-31');
  });

  it('converts otono to Sep 1 .. Nov 30', () => {
    const result = seasonToDates(2023, 'otono' as Season);
    expect(result.start).toBe('2023-09-01');
    expect(result.end).toBe('2023-11-30');
  });

  it('converts anual to Jan 1 .. Dec 31', () => {
    const result = seasonToDates(2023, 'anual' as Season);
    expect(result.start).toBe('2023-01-01');
    expect(result.end).toBe('2023-12-31');
  });
});
