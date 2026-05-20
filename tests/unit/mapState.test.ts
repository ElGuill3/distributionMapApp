import { describe, it, expect, beforeEach } from 'vitest';
import * as mapState from '../../src/ts/state/mapState.js';

describe('mapState', () => {
  beforeEach(() => {
    mapState.resetState();
  });

  describe('hasBbox', () => {
    it('should return false when bbox is null', () => {
      expect(mapState.hasBbox()).toBe(false);
    });

    it('should return true when bbox is set', () => {
      mapState.setBbox([-92, 17, -91, 18]);
      expect(mapState.hasBbox()).toBe(true);
    });

    it('should return false after clearing bbox', () => {
      mapState.setBbox([-92, 17, -91, 18]);
      expect(mapState.hasBbox()).toBe(true);
      mapState.clearBbox();
      expect(mapState.hasBbox()).toBe(false);
    });
  });

  describe('TaskFlowState integration', () => {
    it('should have currentVariable in taskFlow state', () => {
      const tf = mapState.getTaskFlowState();
      expect(tf.currentVariable).toBe('ndvi');
    });

    it('should have hasBbox in taskFlow state', () => {
      const tf = mapState.getTaskFlowState();
      expect(tf.hasBbox).toBe(false);
    });

    it('should sync currentVariable to taskFlow on setCurrentVariable', () => {
      mapState.setCurrentVariable('temp');
      const tf = mapState.getTaskFlowState();
      expect(tf.currentVariable).toBe('temp');
      expect(mapState.getCurrentVariable()).toBe('temp');
    });

    it('should sync hasBbox to true on setBbox', () => {
      mapState.setBbox([-92, 17, -91, 18]);
      const tf = mapState.getTaskFlowState();
      expect(tf.hasBbox).toBe(true);
    });

    it('should sync hasBbox to false on clearBbox', () => {
      mapState.setBbox([-92, 17, -91, 18]);
      mapState.clearBbox();
      const tf = mapState.getTaskFlowState();
      expect(tf.hasBbox).toBe(false);
    });
  });
});
