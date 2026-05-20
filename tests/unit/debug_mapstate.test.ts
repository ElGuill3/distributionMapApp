import { describe, it, expect } from 'vitest';
import * as mapState from '../../static/state/mapState.js';

describe('debug mapState', () => {
  it('should have currentVariable in taskFlow', () => {
    const tf = mapState.getTaskFlowState();
    expect(tf).toHaveProperty('currentVariable');
    expect(tf).toHaveProperty('hasBbox');
  });

  it('should update currentVariable in taskFlow', () => {
    mapState.resetState();
    mapState.setCurrentVariable('temp');
    expect(mapState.getCurrentVariable()).toBe('temp');
    expect(mapState.getTaskFlowState().currentVariable).toBe('temp');
  });
});
